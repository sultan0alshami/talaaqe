import type { Prisma } from "@prisma/client";
import type { OrganizationActor, OrganizationOptions } from "@/lib/organizations/context";
import { captureOrganizationActor, organizationDb, withOrganizationTransaction } from "@/lib/organizations/context";
import { OrganizationIdSchema } from "@/lib/organizations/contracts";
import { CampaignPlanningError } from "./contracts";

// Apply before count, limit or cursor selection; excluded CLIENT identities
// must not affect the owner's retained legacy projection.
export const legacyCampaignWhere = { planningBindings: { none: { workspace: { scope: "CLIENT" as const } } } };
async function withLegacyOwner<T>(actorInput: OrganizationActor, options: OrganizationOptions,
  action: (tx: Prisma.TransactionClient, brandId: string) => Promise<T>, missing?: () => T): Promise<T> {
  const actor = captureOrganizationActor(actorInput), captured = { client: organizationDb(options) };
  return withOrganizationTransaction(actor, captured, { write: false }, async tx => {
    const first = await tx.brand.findUnique({ where: { userId: actor.userId }, select: { id: true } });
    if (!first) { if (missing) return missing(); throw new CampaignPlanningError("NOT_FOUND", 404); }
    await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${first.id} FOR SHARE`;
    const current = await tx.brand.findUnique({ where: { id: first.id }, select: { userId: true } });
    if (current?.userId !== actor.userId) throw new CampaignPlanningError("NOT_FOUND", 404);
    return action(tx, first.id);
  });
}

export type LegacyCampaignOverview = { campaignCount: number; recentCampaigns: {
  id: string; title: string; status: string; currentBriefVersion: number | null; updatedAt: string;
}[] };
export async function getLegacyCampaignOverview(actor: OrganizationActor, options: OrganizationOptions = {}): Promise<LegacyCampaignOverview> {
  return withLegacyOwner(actor, options, async (tx, brandId) => {
    const where = { brandId, ...legacyCampaignWhere };
    const [campaignCount, rows] = await Promise.all([
      tx.campaign.count({ where }),
      tx.campaign.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5,
        select: { id: true, title: true, status: true, currentBriefVersion: true, updatedAt: true } }),
    ]);
    return { campaignCount, recentCampaigns: rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })) };
  }, () => ({ campaignCount: 0, recentCampaigns: [] }));
}
export async function selectLegacyOwnerCampaign(actor: OrganizationActor,
  input: { campaignId?: string; approvedOnly?: boolean } = {}, options: OrganizationOptions = {}): Promise<{ id: string } | null> {
  const captured = { campaignId: input.campaignId, approvedOnly: input.approvedOnly };
  return withLegacyOwner(actor, options, async (tx, brandId) => {
    if (captured.campaignId !== undefined && !OrganizationIdSchema.safeParse(captured.campaignId).success)
      throw new CampaignPlanningError("VALIDATION", 422);
    const row = await tx.campaign.findFirst({ where: { brandId, ...legacyCampaignWhere,
      ...(captured.campaignId !== undefined ? { id: captured.campaignId } : {}),
      ...(captured.approvedOnly ? { currentBriefVersion: { not: null } } : {}),
    }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true } });
    if (captured.campaignId !== undefined && !row) throw new CampaignPlanningError("NOT_FOUND", 404);
    return row;
  }, captured.campaignId === undefined ? () => null : undefined);
}
// Root-private DB-only guards; callers already hold current actor/domain locks.
async function boundScope(tx: Prisma.TransactionClient, campaignId: string) {
  const binding = await tx.campaignPlanningBinding.findUnique({ where: { campaignId }, select: { workspace: { select: { scope: true } } } });
  return binding?.workspace.scope ?? null;
}
export async function assertLegacyCampaignReadable(tx: Prisma.TransactionClient, campaignId: string): Promise<void> {
  if (await boundScope(tx, campaignId) === "CLIENT") throw new CampaignPlanningError("NOT_FOUND", 404);
}
export async function assertLegacyCampaignFreshWrite(tx: Prisma.TransactionClient, campaignId: string): Promise<void> {
  const scope = await boundScope(tx, campaignId);
  if (scope === "CLIENT") throw new CampaignPlanningError("NOT_FOUND", 404);
  if (scope !== null) throw new CampaignPlanningError("SCOPED_PLANNING_REQUIRED", 409);
}
export async function assertFreshDirectCampaign(tx: Prisma.TransactionClient, campaignId: string): Promise<void> {
  const scope = await boundScope(tx, campaignId);
  if (scope === "CLIENT") throw new CampaignPlanningError("NOT_FOUND", 404);
  if (scope !== null) throw new CampaignPlanningError("MANAGED_CAMPAIGN_REQUIRED", 409);
}
