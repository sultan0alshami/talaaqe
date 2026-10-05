import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession }));
import { GET as list, POST as create } from "@/app/api/deals/route";
import { GET as read } from "@/app/api/deals/[id]/route";
import { POST as mutate } from "@/app/api/deals/[id]/commands/route";
import { POST as draft } from "@/app/api/deals/drafts/route";
import { GET as readDraft } from "@/app/api/deals/drafts/[id]/route";
import { applyDealCommand, createDealOffer } from "@/lib/deals/service";
import { cleanup, fixture, user, now } from "./fixtures";

const origin = "http://127.0.0.1:3100";
let previousOrigin: string | undefined;
beforeAll(() => {
  previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = origin;
  // The shared domain fixtures use an explicit fixed observation clock. Freeze
  // Date only so the actual production adapter evaluates that same instant.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterAll(async () => {
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousOrigin;
  vi.useRealTimers();
  await cleanup();
});
function session(userId: string, role: "BRAND" | "CREATOR") {
  getSession.mockResolvedValue({ userId, role });
}
function request(path: string, body?: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/deals${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { origin: requestOrigin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
describe("deal transport with real PostgreSQL and trusted production policy adapters", () => {
  it("loads original-participant private histories, preserves envelopes and conceals foreign deals", async () => {
    const f = await fixture(),
      deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    session(f.brandUserId, "BRAND");
    const response = await read(request(`/${deal.id}`), ctx(deal.id)),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
    expect(body.data.id).toBe(deal.id);
    expect(
      (await (await list(request(""))).json()).data.deals.map(
        (row: { id: string }) => row.id,
      ),
    ).toContain(deal.id);
    session(f.target.userId, "CREATOR");
    expect((await read(request(`/${deal.id}`), ctx(deal.id))).status).toBe(200);
    const outsider = await user("BRAND");
    session(outsider, "BRAND");
    expect((await read(request(`/${deal.id}`), ctx(deal.id))).status).toBe(404);
    expect((await (await list(request(""))).json()).data.deals).toEqual([]);
    await prisma.creator.update({
      where: { id: f.target.id },
      data: { userId: await user("CREATOR") },
    });
    const replacement = await prisma.creator.findUniqueOrThrow({
      where: { id: f.target.id },
    });
    session(replacement.userId!, "CREATOR");
    expect((await read(request(`/${deal.id}`), ctx(deal.id))).status).toBe(404);
  });
  it("enforces current roles, exact mutation origin, strict schemas and unavailable legal readiness", async () => {
    const f = await fixture();
    getSession.mockResolvedValue(null);
    expect((await list(request(""))).status).toBe(401);
    session(f.target.userId, "CREATOR");
    expect((await create(request("", f.input))).status).toBe(403);
    session(f.brandUserId, "BRAND");
    expect(
      (await create(request("", f.input, "https://attacker.invalid"))).status,
    ).toBe(403);
    for (const extra of [
      { policyVerifier: true },
      { actorUserId: f.target.userId },
      { policyReview: { reviewed: true } },
      { paymentVerified: true },
    ]) {
      expect((await create(request("", { ...f.input, ...extra }))).status).toBe(
        400,
      );
    }
    const blocked = await create(request("", f.input));
    expect([409, 503]).toContain(blocked.status);
    expect([
      "BRAND_CONTACT_VERIFICATION_REQUIRED",
      "POLICY_UNAVAILABLE",
      "POLICY_REVIEW_REQUIRED",
    ]).toContain((await blocked.json()).error.code);
    expect(
      await prisma.deal.count({ where: { campaignId: f.campaign.id } }),
    ).toBe(0);
    await prisma.user.update({
      where: { id: f.brandUserId },
      data: { active: false },
    });
    expect((await list(request(""))).status).toBe(403);
  });
  it("saves resumable incomplete original-language terms despite blocked sending and never exposes another actor's draft", async () => {
    const f = await fixture();
    session(f.brandUserId, "BRAND");
    const input = {
      campaignId: f.campaign.id,
      creatorId: f.target.id,
      operationKey: randomUUID(),
      expectedRevision: 0,
      patch: {
        amount: { currencyCode: "KWD" },
        note: { text: "شروط خاصة لم تكتمل", language: "ar" },
      },
    };
    const saved = await draft(request("/drafts", input));
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()).data;
    expect(savedBody.draft.terms).not.toHaveProperty("governingTermsVersionId");
    expect(
      (await (await draft(request("/drafts", input))).json()).data.replayed,
    ).toBe(true);
    expect(
      (
        await (
          await readDraft(
            request(`/drafts/${savedBody.draft.id}`),
            ctx(savedBody.draft.id),
          )
        ).json()
      ).data.terms.note.text,
    ).toBe("شروط خاصة لم تكتمل");
    const stale = await draft(
      request("/drafts", { ...input, operationKey: randomUUID() }),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("STALE_VERSION");
    session(f.target.userId, "CREATOR");
    expect(
      (
        await readDraft(
          request(`/drafts/${savedBody.draft.id}`),
          ctx(savedBody.draft.id),
        )
      ).status,
    ).toBe(404);
  });
  it("rejects own acceptance, stale commands and role-forged delivery while safely replaying original messages", async () => {
    const f = await fixture(),
      deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    session(f.brandUserId, "BRAND");
    const accept = {
      action: "ACCEPT",
      operationKey: randomUUID(),
      expectedVersion: deal.version,
      offerId: deal.currentOffer.id,
      expectedOfferVersion: deal.currentOffer.version,
    };
    const own = await mutate(
      request(`/${deal.id}/commands`, accept),
      ctx(deal.id),
    );
    expect(own.status).toBe(403);
    expect((await own.json()).error.code).toBe("RECIPIENT_ONLY");
    const message = {
      action: "MESSAGE",
      operationKey: randomUUID(),
      expectedVersion: deal.version,
      text: { text: "نص أصلي يبقى عربيًا", language: "ar" },
    };
    const first = await mutate(
      request(`/${deal.id}/commands`, message),
      ctx(deal.id),
    );
    expect(first.status).toBe(200);
    const current = (await first.json()).data.deal;
    expect(
      (
        await (
          await mutate(request(`/${deal.id}/commands`, message), ctx(deal.id))
        ).json()
      ).data.replayed,
    ).toBe(true);
    expect(await prisma.dealMessage.count({ where: { dealId: deal.id } })).toBe(
      1,
    );
    const stale = await mutate(
      request(`/${deal.id}/commands`, {
        ...message,
        operationKey: randomUUID(),
      }),
      ctx(deal.id),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("STALE_VERSION");
    const forged = await mutate(
      request(`/${deal.id}/commands`, {
        ...message,
        expectedVersion: current.version,
        operationKey: randomUUID(),
        role: "CREATOR",
      }),
      ctx(deal.id),
    );
    expect(forged.status).toBe(400);
    const delivered = await mutate(
      request(`/${deal.id}/commands`, {
        action: "DELIVER",
        operationKey: randomUUID(),
        expectedVersion: current.version,
        evidence: { text: { text: "Wrong role", language: "en" }, links: [] },
      }),
      ctx(deal.id),
    );
    expect(delivered.status).toBe(403);
    expect((await delivered.json()).error.code).toBe("ROLE_ONLY");
  });
  it("filters sealed ratings and sensitive events for the other original participant through actual GET/list", async () => {
    const f = await fixture();
    let deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
    const send = async (actor: string, action: string, fields: object = {}) => {
      deal = (
        await applyDealCommand(
          actor,
          deal.id,
          {
            action,
            operationKey: randomUUID(),
            expectedVersion: deal.version,
            ...fields,
          },
          f.options,
        )
      ).deal;
    };
    await send(f.target.userId, "ACCEPT", {
      offerId: deal.currentOffer.id,
      expectedOfferVersion: deal.currentOffer.version,
    });
    const agreement = {
      agreementId: deal.agreement!.id,
      expectedAgreementVersion: deal.agreement!.version,
    };
    await send(f.brandUserId, "CONFIRM", agreement);
    await send(f.target.userId, "CONFIRM", agreement);
    await send(f.target.userId, "DELIVER", {
      evidence: { text: { text: "إثبات اختبار", language: "ar" }, links: [] },
    });
    await send(f.brandUserId, "COMPLETE");
    session(f.brandUserId, "BRAND");
    const rated = await mutate(
      request(`/${deal.id}/commands`, {
        action: "RATE",
        operationKey: randomUUID(),
        expectedVersion: deal.version,
        stars: 2,
        comment: { text: "sealed transport secret", language: "en" },
      }),
      ctx(deal.id),
    );
    expect(rated.status).toBe(200);
    session(f.target.userId, "CREATOR");
    for (const response of [
      await read(request(`/${deal.id}`), ctx(deal.id)),
      await list(request("")),
    ]) {
      const text = JSON.stringify(await response.json());
      expect(text).not.toContain("sealed transport secret");
      expect(text).not.toContain('"stars":2');
    }
  });
});
