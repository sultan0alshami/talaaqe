import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
// Only Next's request-cookie context is a seam. Signed tokens, current native
// User/AuthSession records, ownership and campaign/policy producers are real.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
import { GET as list, POST as create } from "@/app/api/campaigns/route";
import { GET as read } from "@/app/api/campaigns/[id]/route";
import { POST as mutate } from "@/app/api/campaigns/[id]/commands/route";
import { POST as generate } from "@/app/api/campaigns/[id]/brief/generate/route";
import { POST as approve } from "@/app/api/campaigns/[id]/brief/approve/route";
import { POST as chat } from "@/app/api/campaigns/[id]/chat/route";
import { POST as paragraph } from "@/app/api/campaigns/[id]/paragraph/route";
import { campaignFields } from "./fixtures";

const users: string[] = [];
const tokens = new Map<string, string>();
const origin = "http://127.0.0.1:3100";
let previousOrigin: string | undefined;
beforeAll(() => { previousOrigin = process.env.APP_ORIGIN; process.env.APP_ORIGIN = origin; });
afterAll(async () => {
  token = null; tokens.clear();
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
  await prisma.outboxEvent.deleteMany({ where: { OR: users.map((id) => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.campaign.deleteMany({ where: { brand: { userId: { in: users } } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});
async function actor(role: "BRAND" | "CREATOR" = "BRAND") {
  const id = randomUUID();
  const user = await prisma.user.create({ data: { id, name: "Synthetic campaign API", email: `${id}@example.invalid`, passwordHash: "not-a-login", role, active: true, isTest: true } });
  users.push(id);
  if (role === "BRAND") await prisma.brand.create({ data: { userId: id, slug: `api-${id}`, name: "Synthetic API brand", countryCode: "KW", isTest: true } });
  else await prisma.creator.create({ data: { userId: id, handle: "api_" + id.replace(/-/g, "").slice(0, 16), displayName: "Synthetic campaign API creator", isTest: true } });
  token = await openSession(id, user.sessionVersion, user.passwordHash);
  const session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native campaign route session did not resolve");
  expect(session.userId).toBe(id); expect(session.role).toBe(role); tokens.set(id, token);
  return id;
}
function request(path: string, body?: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/campaigns${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { origin: requestOrigin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function newCampaign() {
  const response = await create(request("", { operationKey: randomUUID(), fields: { title: "حملة API" } }));
  expect(response.status).toBe(200);
  return (await response.json()).data.campaign as { id: string; revision: number };
}
describe("campaign transport: genuine signed native sessions and PostgreSQL domain authorization", () => {
  it("returns canonical request envelopes/private no-store and lists only the current owner's campaigns", async () => {
    const owner = await actor();
    const campaign = await newCampaign();
    const readResponse = await read(request(`/${campaign.id}`), ctx(campaign.id));
    expect(readResponse.headers.get("cache-control")).toBe("private, no-store");
    const body = await readResponse.json();
    expect(body.data.id).toBe(campaign.id);
    expect(body.requestId).toBe(readResponse.headers.get("x-request-id"));
    expect((await (await list(request(""))).json()).data.campaigns.map((row: { id: string }) => row.id)).toEqual([campaign.id]);
    await actor();
    const outsider = await read(request(`/${campaign.id}`), ctx(campaign.id));
    expect(outsider.status).toBe(404);
    expect((await outsider.json()).error.code).toBe("NOT_FOUND");
    expect((await (await list(request(""))).json()).data.campaigns).toEqual([]);
    token = tokens.get(owner)!;
    await prisma.user.update({ where: { id: owner }, data: { active: false } });
    // Genuine resolveSession rejects suspension before route authorization;
    // the former issuer mock bypassed that check and reached domain403 instead.
    expect(await resolveSession(token)).toBeNull();
    expect((await list(request(""))).status).toBe(401);
  });
  it("rejects anonymous/wrong-role callers, wrong Origin and forged server contexts/actions", async () => {
    token = null;
    expect((await list(request(""))).status).toBe(401);
    await actor("CREATOR");
    expect((await create(request("", { operationKey: randomUUID(), fields: {} }))).status).toBe(403);
    await actor();
    expect((await create(request("", { operationKey: randomUUID(), fields: {} }, "https://unrelated.invalid"))).status).toBe(403);
    const campaign = await newCampaign();
    for (const body of [
      { action: "GREETING", payload: { text: { text: "Injected server message", language: "en" } } },
      { action: "PROPOSE_FIELDS", payload: { type: "PROPOSE_FIELDS", patch: { title: "Injected tool" }, originalText: { text: "Injected", language: "en" } } },
      { action: "UPDATE_FIELDS", channel: "CHAT_TOOL", payload: { patch: { title: "Injected channel" } } },
      { action: "UPDATE_FIELDS", actorUserId: "another-actor", payload: { patch: { title: "Injected actor" } } },
    ]) {
      const response = await mutate(request(`/${campaign.id}/commands`, { operationKey: randomUUID(), expectedRevision: campaign.revision, ...body }), ctx(campaign.id));
      expect(response.status).toBe(400);
    }
  });
  it("uses shared strict form validation, has no automatic generation/approval and reports missing manual requirements", async () => {
    await actor();
    const campaign = await newCampaign();
    const invalid = await mutate(request(`/${campaign.id}/commands`, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: campaign.revision, payload: { patch: { budget: { amountMinor: 100, currencyCode: "KWD" } } } }), ctx(campaign.id));
    expect(invalid.status).toBe(400);
    const changed = await mutate(request(`/${campaign.id}/commands`, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: campaign.revision, payload: { patch: { title: "عنوان جديد" } } }), ctx(campaign.id));
    const current = (await changed.json()).data.campaign;
    expect(current.status).toBe("DRAFT");
    expect(current.currentBriefVersion).toBeNull();
    const missing = await generate(request(`/${campaign.id}/brief/generate`, { operationKey: randomUUID(), expectedRevision: current.revision }), ctx(campaign.id));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("MISSING_REQUIREMENTS");
    const invalidApproval = await approve(request(`/${campaign.id}/brief/approve`, { operationKey: randomUUID(), expectedRevision: current.revision, briefId: "invented", expectedBriefVersion: 1, policyReview: { reviewed: true } }), ctx(campaign.id));
    expect(invalidApproval.status).toBe(400);
  });
  it("keeps chat and paragraph capabilities honestly unavailable after owner checks", async () => {
    await actor();
    const campaign = await newCampaign();
    for (const action of [chat, paragraph]) {
      const unavailable = await action(request(`/${campaign.id}/chat`, { text: "Paragraph not processed" }), ctx(campaign.id));
      expect(unavailable.status).toBe(503);
      expect((await unavailable.json()).error).toMatchObject({ code: "CAPABILITY_UNAVAILABLE", retryable: true });
    }
    await actor();
    expect((await chat(request(`/${campaign.id}/chat`, {}), ctx(campaign.id))).status).toBe(404);
  });
  it("saves full form fields then generates and explicitly approves the same immutable brief over transport", async () => {
    const owner = await actor(), campaign = await newCampaign();
    const save = await mutate(request(`/${campaign.id}/commands`, { operationKey: randomUUID(), expectedRevision: campaign.revision, action: "UPDATE_FIELDS", payload: { patch: campaignFields } }), ctx(campaign.id));
    expect(save.status).toBe(200);
    const saved = (await save.json()).data.campaign;
    const generated = await generate(request(`/${campaign.id}/brief/generate`, { operationKey: randomUUID(), expectedRevision: saved.revision }), ctx(campaign.id));
    expect(generated.status).toBe(200);
    const generatedData = (await generated.json()).data;
    expect(generatedData.brief.approvedAt).toBeNull();
    const input = { operationKey: randomUUID(), expectedRevision: generatedData.campaign.revision, briefId: generatedData.brief.id, expectedBriefVersion: generatedData.brief.version };
    const approved = await approve(request(`/${campaign.id}/brief/approve`, input), ctx(campaign.id));
    expect(approved.status).toBe(200);
    const approvedData = (await approved.json()).data;
    expect(approvedData.brief.approvedByUserId).toBe(owner);
    expect(approvedData.brief.content.requirements.budget).toEqual(campaignFields.budget);
    expect(approvedData.brief.content.policyReview).toBeNull();
    expect((await (await approve(request(`/${campaign.id}/brief/approve`, input), ctx(campaign.id))).json()).data.replayed).toBe(true);
  });
});
