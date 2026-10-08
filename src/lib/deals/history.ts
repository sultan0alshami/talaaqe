import { Prisma, type Deal } from "@prisma/client";
import { campaignBriefDTO, type CampaignBriefDTO } from "@/lib/campaigns/core";
import { canonicalHash } from "@/lib/onboarding/drafts";
import type { OrganizationActor } from "@/lib/organizations/context";
import { DealError } from "./contracts";
import { lockDealSession, retryDealCapture } from "./session";

type Tx = Prisma.TransactionClient;
export type HistoryIdentity = { id: string; campaignId: string; creatorId: string; brandId: string; briefVersion: number;
  first: { id: string; proposerUserId: string; recipientUserId: string } };
export type HistoricalDealFrame = { deal: Deal; first: HistoryIdentity["first"]; role: "BRAND" | "CREATOR";
  brandUserId: string; creatorUserId: string };

// Scalar preflight is a lock inventory only. No current campaign/profile source
// is required to discover the two actual version-one parties.
export async function captureHistoricalDeal(tx: Tx, id: string): Promise<HistoryIdentity | null> {
  const deal = await tx.deal.findUnique({ where: { id }, select: { id: true, campaignId: true, creatorId: true, brandId: true, briefVersion: true } });
  if (!deal) return null;
  const first = await tx.dealOffer.findUnique({ where: { dealId_version: { dealId: id, version: 1 } },
    select: { id: true, proposerUserId: true, recipientUserId: true } });
  if (!first || first.proposerUserId === first.recipientUserId) throw new DealError("INVALID_DEAL_HISTORY");
  return { ...deal, first };
}
export async function lockHistoricalUsers(tx: Tx, actor: string, captures: readonly (HistoryIdentity | null)[], write: boolean): Promise<ReadonlySet<string>> {
  if (captures.length > 51) throw new DealError("RETRY_REQUIRED", 503);
  const ids = [...new Set([actor, ...captures.flatMap(row => row ? [row.first.proposerUserId, row.first.recipientUserId] : [])])].sort();
  if (ids.length > 103) throw new DealError("RETRY_REQUIRED", 503);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id ${Prisma.raw(write ? "FOR UPDATE" : "FOR SHARE")}`);
  await lockDealSession(tx);
  return new Set(ids);
}
export async function lockHistoricalDeal(tx: Tx, capture: HistoryIdentity | null, actor: Readonly<OrganizationActor>,
  write: boolean, owners: ReadonlySet<string>): Promise<HistoricalDealFrame> {
  if (!capture) throw new DealError("NOT_FOUND", 404);
  if (!owners.has(capture.first.proposerUserId) || !owners.has(capture.first.recipientUserId)) retryDealCapture();
  const role = actor.userId === capture.first.proposerUserId ? "BRAND" : actor.userId === capture.first.recipientUserId ? "CREATOR" : null;
  if (!role) throw new DealError("NOT_FOUND", 404);
  if (actor.role !== role) throw new DealError("FORBIDDEN", 403);
  if (write) await tx.$queryRaw`SELECT id FROM "Deal" WHERE id=${capture.id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Deal" WHERE id=${capture.id} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "DealOffer" WHERE id=${capture.first.id} FOR SHARE`;
  const current = await captureHistoricalDeal(tx, capture.id);
  if (!current || canonicalHash(current) !== canonicalHash(capture)) retryDealCapture();
  const deal = await tx.deal.findUniqueOrThrow({ where: { id: capture.id } });
  return { deal, first: current.first, role, brandUserId: current.first.proposerUserId, creatorUserId: current.first.recipientUserId };
}
export async function retainedApprovedBrief(tx: Tx, deal: Pick<Deal, "campaignId" | "briefVersion">,
  originalBrandUserId: string, now: Date): Promise<CampaignBriefDTO> {
  await tx.$queryRaw`SELECT id FROM "CampaignBrief" WHERE "campaignId"=${deal.campaignId} AND version=${deal.briefVersion} FOR SHARE`;
  const row = await tx.campaignBrief.findUnique({ where: { campaignId_version: { campaignId: deal.campaignId, version: deal.briefVersion } } });
  if (!row || !row.approvedAt || row.approvedAt > now || row.approvedByUserId !== originalBrandUserId) throw new DealError("INVALID_DEAL_HISTORY");
  try { return campaignBriefDTO(row); }
  catch { throw new DealError("INVALID_DEAL_HISTORY"); }
}
