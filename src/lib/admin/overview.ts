import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { AdminOverviewSchema, AdminReadError, type AdminOverviewDTO } from "./contracts";

type AdminActor = Pick<Session, "userId" | "role" | "sessionId" | "sessionVersion">;
type Options = { client?: PrismaClient; now?: Date };
const ActorSchema = z.object({ userId: z.string().min(1).max(200), role: z.enum(["ADMIN", "BRAND", "CREATOR"]), sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/), sessionVersion: z.number().int().positive().max(2147483647) }).strict();

async function adminRead<T>(actor: AdminActor, options: Options, load: (tx: Prisma.TransactionClient, asOf: Date) => Promise<T>): Promise<T> {
  const parsed = ActorSchema.safeParse(actor && { userId: actor.userId, role: actor.role, sessionId: actor.sessionId, sessionVersion: actor.sessionVersion });
  if (!parsed.success) throw new AdminReadError("UNAUTHENTICATED", 401);
  if (options.now && !Number.isFinite(options.now.getTime())) throw new AdminReadError("INVALID_CLOCK", 400);
  const claims = parsed.data;
  try {
    return await (options.client ?? prisma).$transaction(async tx => {
      // User first agrees with identity writes and evidence review lock order.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${claims.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${claims.sessionId} FOR SHARE`;
      async function authorized() {
        const user = await tx.user.findUnique({ where: { id: claims.userId }, select: { active: true, role: true, sessionVersion: true } });
        const session = await tx.authSession.findUnique({ where: { id: claims.sessionId } });
        // Authentication always uses the actual clock, including after waits.
        if (!user?.active || !session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= new Date() || session.version !== claims.sessionVersion || user.sessionVersion !== claims.sessionVersion || user.role !== claims.role) throw new AdminReadError("UNAUTHENTICATED", 401);
        if (user.role !== "ADMIN") throw new AdminReadError("FORBIDDEN", 403);
      }
      await authorized();
      const result = await load(tx, options.now ?? new Date());
      await authorized();
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 20000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2010" && error.meta?.code === "40001")) throw new AdminReadError("RETRY_REQUIRED", 503);
    throw error;
  }
}

async function pendingCounts(tx: Prisma.TransactionClient): Promise<AdminOverviewDTO["pending"]> {
  const counts = await Promise.all([
    tx.ownershipChallenge.count({ where: { status: "PENDING" } }),
    tx.metricsSnapshot.count({ where: { reviewStatus: "PENDING", source: { in: ["SELF_REPORTED", "SCREENSHOT_VERIFIED"] }, evidenceAssetId: { not: null } } }),
    tx.advertisingLicence.count({ where: { status: "PENDING" } }),
    tx.businessVerification.count({ where: { status: "PENDING", kind: "REPRESENTATIVE" } }),
    tx.businessVerification.count({ where: { status: "PENDING", kind: "BUSINESS_REGISTRATION" } }),
  ]);
  return (["OWNERSHIP", "SCREENSHOT", "ADVERTISING_LICENCE", "REPRESENTATIVE", "BUSINESS_REGISTRATION"] as const).map((kind, index) => ({ kind, count: counts[index] }));
}

export async function getAdminPendingCount(actor: AdminActor, options: Options = {}) {
  return adminRead(actor, options, async tx => (await pendingCounts(tx)).reduce((sum, row) => sum + row.count, 0));
}

export async function getAdminOverview(actor: AdminActor, options: Options = {}): Promise<AdminOverviewDTO> {
  return adminRead(actor, options, async (tx, asOf) => {
    // Stored records include all states/private/test/suspended rows. These
    // canonical counts do not assert traction, eligibility or current trust.
    const users = await tx.user.count();
    const [brandAccounts, creatorAccounts, campaigns, weeklyCampaigns, briefVersions, deals, pending, challenges] = await Promise.all([
      tx.user.count({ where: { role: "BRAND" } }), tx.user.count({ where: { role: "CREATOR" } }), tx.campaign.count(),
      tx.campaign.count({ where: { createdAt: { gte: new Date(asOf.getTime() - 7 * 86400000), lte: asOf } } }), tx.campaignBrief.count(), tx.deal.count(), pendingCounts(tx),
      tx.ownershipChallenge.findMany({ where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 8, select: { id: true, accountId: true, createdAt: true, proofAssetId: true } }),
    ]);
    const accounts = await tx.socialAccount.findMany({ where: { id: { in: challenges.map(row => row.accountId) } }, select: { id: true, platform: true, handle: true } });
    const result = AdminOverviewSchema.parse({ asOf: asOf.toISOString(), scope: "ALL_STORED_RECORDS", counts: { users, brandAccounts, creatorAccounts, campaigns, weeklyCampaigns, briefVersions, deals, pendingEvidence: pending.reduce((sum, row) => sum + row.count, 0) }, pending,
      ownershipPreview: challenges.map(row => { const account = accounts.find(item => item.id === row.accountId); return { id: row.id, platform: account?.platform ?? "UNKNOWN", handle: account?.handle ?? "—", startedAt: row.createdAt.toISOString(), hasEvidenceReference: row.proofAssetId !== null }; }),
    });
    await tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "admin.overview_accessed", resourceType: "AdminOverview", resourceId: "platform", snapshot: { asOf: result.asOf, scope: result.scope, counts: result.counts } } });
    return result;
  });
}
