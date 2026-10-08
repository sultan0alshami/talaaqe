import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDealOffer, applyDealCommand, type DealDTO } from "@/lib/deals/service";
import { fixture, cleanup, user } from "./fixtures";
import { nativeDealActor } from "./native-actors";

// One independently authored native SQL group before additive migration22.
// Actual guarded rows, native sessions and domain transitions; the existing
// fixture policy is synthetic legal prose and proves no live legal/provider or
// admission readiness. Raw rating writes isolate the database participant guard,
// not a new service permission. No global clock/auth/DB mock or test-mode bypass.
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || process.env.NODE_ENV === "production" || process.env.INFAME_ENV === "production") throw new Error("Rating SQL witness requires the exact guarded test target");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== taskId || rows[0].kind !== "test" || rows[0].db !== `${taskId}_test` || rows[0].host !== "127.0.0.1") throw new Error("Rating SQL witness marker mismatch");
});
afterEach(cleanup);
const key = () => randomUUID();
async function completedFixture() {
  const f = await fixture(2, "10001", { now: new Date(), target: "test" });
  await prisma.creator.update({ where: { id: f.target.id }, data: { state: "PUBLISHED", brandVisible: true } });
  const brand = await nativeDealActor(f.brandUserId), creator = await nativeDealActor(f.target.userId);
  const brandOptions = { policyVerifier: f.options.policyVerifier, serverAuth: brand.actor };
  const creatorOptions = { ...brandOptions, serverAuth: creator.actor };
  let deal = (await createDealOffer(f.brandUserId, f.input, brandOptions)).deal;
  const run = async (actor: string, options: typeof brandOptions, action: string, extra: Record<string, unknown> = {}) => {
    deal = (await applyDealCommand(actor, deal.id, { action, operationKey: key(), expectedVersion: deal.version, ...extra }, options)).deal;
  };
  await run(f.target.userId, creatorOptions, "ACCEPT", { offerId: deal.currentOffer.id, expectedOfferVersion: deal.currentOffer.version, language: "ar" });
  const agreement = { agreementId: deal.agreement!.id, expectedAgreementVersion: deal.agreement!.version };
  await run(f.brandUserId, brandOptions, "CONFIRM", agreement);
  await run(f.target.userId, creatorOptions, "CONFIRM", agreement);
  await run(f.target.userId, creatorOptions, "DELIVER", { evidence: { text: { text: "Synthetic completed SQL witness only", language: "en" }, links: [] } });
  await run(f.brandUserId, brandOptions, "COMPLETE");
  expect(deal.status).toBe("COMPLETED");
  return { ...f, deal, originalAgreement: structuredClone(deal.agreement) };
}
function rating(deal: DealDTO, userId: string, role: "BRAND" | "CREATOR") {
  return { id: key(), dealId: deal.id, userId, role, score: 4,
    comment: "Original synthetic SQL feedback", language: "en", createdAt: new Date() };
}
function insertRating(row: ReturnType<typeof rating>) {
  return prisma.$executeRaw(Prisma.sql`INSERT INTO "DealRating" (id,"dealId","userId",role,score,comment,language,"createdAt")
    VALUES (${row.id},${row.dealId},${row.userId},${row.role}::"Role",${row.score},${row.comment},${row.language},${row.createdAt.toISOString()}::timestamp(3))`);
}

it("completed rating SQL keeps both immutable first-offer users and their original roles after either or both profile transfers", async () => {
  for (const mode of ["BRAND", "CREATOR", "BOTH"] as const) {
    const f = await completedFixture();
    const first = await prisma.dealOffer.findUniqueOrThrow({ where: { dealId_version: { dealId: f.deal.id, version: 1 } } });
    const agreement = await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: f.deal.agreement!.id } });
    const replacements: Array<{ id: string; role: "BRAND" | "CREATOR" }> = [];
    if (mode !== "CREATOR") {
      const id = await user("BRAND");
      await prisma.brand.update({ where: { id: f.brandId }, data: { userId: id } }); replacements.push({ id, role: "BRAND" });
    }
    if (mode !== "BRAND") {
      const id = await user("CREATOR");
      await prisma.creator.update({ where: { id: f.target.id }, data: { userId: id } }); replacements.push({ id, role: "CREATOR" });
    }
    expect(first).toMatchObject({ proposerUserId: f.brandUserId, recipientUserId: f.target.userId });
    expect(f.originalAgreement?.partiesSnapshot).toMatchObject({ brandUserId: f.brandUserId, creatorUserId: f.target.userId });
    // Wrong-role and replacement attempts happen BEFORE any valid row, so a
    // deal/user unique violation cannot masquerade as a participant guard.
    for (const denied of [rating(f.deal, f.brandUserId, "CREATOR"), rating(f.deal, f.target.userId, "BRAND"),
      ...replacements.map(actor => rating(f.deal, actor.id, actor.role))]) {
      await expect(insertRating(denied)).rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
      expect(await prisma.dealRating.count({ where: { dealId: f.deal.id } })).toBe(0);
    }
    const brandRating = rating(f.deal, f.brandUserId, "BRAND"), creatorRating = rating(f.deal, f.target.userId, "CREATOR");
    await expect(insertRating(brandRating)).resolves.toBe(1);
    await expect(insertRating(creatorRating)).resolves.toBe(1);
    expect(await prisma.dealRating.findUniqueOrThrow({ where: { id: brandRating.id } })).toMatchObject(brandRating);
    expect(await prisma.dealRating.findUniqueOrThrow({ where: { id: creatorRating.id } })).toMatchObject(creatorRating);
    expect(await prisma.dealRating.findMany({ where: { dealId: f.deal.id }, select: { userId: true, role: true }, orderBy: { userId: "asc" } }))
      .toEqual([{ userId: f.brandUserId, role: "BRAND" }, { userId: f.target.userId, role: "CREATOR" }].sort((a, b) => a.userId.localeCompare(b.userId)));
    expect(await prisma.dealOffer.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
    expect(await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: agreement.id } })).toEqual(agreement);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: f.deal.id } })).status).toBe("COMPLETED");
    // Qualified AgreementConfirmation is intentionally untouched by this SQL
    // witness; every confirmation above occurred genuinely BEFORE transfers.
  }
}, 90000);
