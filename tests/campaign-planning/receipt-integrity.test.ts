import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { executeCampaignPlanningCommand, getPlanningCampaign } from "@/lib/campaign-planning/service";
import { CampaignPlanningCommandSchema, type PlanningCampaign } from "@/lib/campaign-planning/contracts";
import { inputJson } from "@/lib/onboarding/drafts";
import { campaignFields } from "../campaigns/fixtures";

// Native commands produce both proposals/briefs and the original receipt.
// A deliberately malformed stored receipt simulates data corruption, not a
// client command or live provider. It must never acknowledge a different item.
const owners: string[] = [], brands: string[] = [];
afterEach(async () => {
  const workspaces = await prisma.planningWorkspace.findMany({ where: { brandId: { in: brands } }, select: { id: true } });
  if (workspaces.length) {
    const ids = workspaces.map(row => row.id);
    for (const table of ["PlanningReviewCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
      "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding"] as const)
      await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
    await prisma.planningWorkspace.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.campaign.deleteMany({ where: { brandId: { in: brands } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: owners } } });
  if (owners.length) await prisma.outboxEvent.deleteMany({ where: { OR: owners.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.brand.deleteMany({ where: { id: { in: brands.splice(0) } } });
  await prisma.user.deleteMany({ where: { id: { in: owners.splice(0) } } });
});
async function fixture() {
  const id = randomUUID(); owners.push(id);
  const user = await prisma.user.create({ data: { id, role: "BRAND", name: "Synthetic receipt integrity", email: `${id}@example.invalid`,
    passwordHash: "not-a-login", active: true, isTest: true, emailVerifiedAt: new Date() } });
  const brand = await prisma.brand.create({ data: { userId: id, slug: "receipt-" + id, name: "Synthetic original company", countryCode: "KW", isTest: true } }); brands.push(brand.id);
  const token = await openSession(id, user.sessionVersion, user.passwordHash), actor = await resolveSession(token);
  if (!actor) throw new Error("Native receipt fixture session missing");
  const scope = { kind: "OWN_BRAND" as const, brandId: brand.id };
  const made = await executeCampaignPlanningCommand(actor, { operationKey: randomUUID(), scope, action: "CREATE", expectedCampaignRevision: 0,
    expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0, payload: { fields: campaignFields, selection: { kind: "NONE" }, narrative: null } });
  const current = () => getPlanningCampaign(actor, { scope, campaignId: made.campaignId });
  const command = (state: PlanningCampaign, action: string, payload: unknown) => CampaignPlanningCommandSchema.parse({ operationKey: randomUUID(), scope,
    campaignId: made.campaignId, action, expectedCampaignRevision: state.campaign.revision, expectedPlanningRevision: state.planning.revision,
    expectedSelectionId: state.planning.selection.id, expectedSelectionRevision: state.planning.selection.revision, payload });
  return { actor, scope, made, current, command };
}
async function replaceReceipt(actorUserId: string, operationKey: string, patch: Record<string, unknown>) {
  const row = await prisma.campaignPlanningCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId, operationKey } } });
  await prisma.$transaction(async tx => {
    await tx.campaignPlanningCommand.delete({ where: { id: row.id } });
    await tx.campaignPlanningCommand.create({ data: { ...row, result: inputJson({ ...(row.result as Record<string, unknown>), ...patch }) } });
  });
}
function savedState(current: PlanningCampaign) {
  const { asOf, ...saved } = current; void asOf; return saved;
}
it("rejects an otherwise-valid APPLY receipt acknowledging another native proposal", async () => {
  const f = await fixture();
  const one = await executeCampaignPlanningCommand(f.actor, f.command(await f.current(), "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { tone: "Original first tone" }, originalText: { text: "First original proposal", language: "en" } }));
  const two = await executeCampaignPlanningCommand(f.actor, f.command(await f.current(), "PROPOSE_FIELDS", { type: "PROPOSE_FIELDS", patch: { tone: "Original second tone" }, originalText: { text: "Second original proposal", language: "en" } }));
  const command = f.command(await f.current(), "APPLY_PROPOSAL", { proposalId: one.proposalId, toneDecision: null });
  await executeCampaignPlanningCommand(f.actor, command);
  const before = savedState(await f.current());
  await replaceReceipt(f.actor.userId, command.operationKey, { proposalId: two.proposalId });
  await expect(executeCampaignPlanningCommand(f.actor, command)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
  expect(savedState(await f.current())).toEqual(before);
});
it("rejects a GENERATE receipt acknowledging an old brief with the same fields and a different NONE identity", async () => {
  const f = await fixture();
  const first = await executeCampaignPlanningCommand(f.actor, f.command(await f.current(), "GENERATE_BRIEF", {}));
  await executeCampaignPlanningCommand(f.actor, f.command(await f.current(), "SET_SELECTION", { selection: { kind: "NONE" } }));
  const command = f.command(await f.current(), "GENERATE_BRIEF", {}), second = await executeCampaignPlanningCommand(f.actor, command);
  expect(first.briefId).not.toBe(second.briefId); expect(first.inputRevision).toBe(second.inputRevision);
  const before = savedState(await f.current());
  await replaceReceipt(f.actor.userId, command.operationKey, { briefId: first.briefId, version: first.version });
  await expect(executeCampaignPlanningCommand(f.actor, command)).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
  expect(savedState(await f.current())).toEqual(before);
});
