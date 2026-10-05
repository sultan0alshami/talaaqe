import type { Prisma, PrismaClient } from "@prisma/client";
import { checkOrganizationActor, withOrganizationTransaction, type OrganizationActor } from "@/lib/organizations/context";
import { runtimeConfig } from "@/lib/env";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { DiscoveryError, DiscoveryPageSchema, DiscoveryQuerySchema, PublicDiscoveryCreatorSchema, type DiscoveryPage } from "./contracts";
import { decodeDiscoveryCursor, discoveryQueryHash, encodeDiscoveryCursor } from "./cursor";
import { loadPublicCreatorIdentities } from "./public-identity";

export type DiscoveryOptions = { client?: PrismaClient; now?: Date };
export async function getDiscoveryPage(
  actor: OrganizationActor, input: unknown = {}, options: DiscoveryOptions = {},
): Promise<DiscoveryPage> {
  await checkOrganizationActor(actor, options);
  if (options.now && !Number.isFinite(options.now.getTime())) throw new DiscoveryError("INVALID_CLOCK", 400);
  return withOrganizationTransaction(actor, options, { write: false }, async tx => {
    const parsed = DiscoveryQuerySchema.safeParse(input);
    if (!parsed.success) throw new DiscoveryError("VALIDATION", 422);
    const query = parsed.data, now = options.now ?? new Date();
    const reader = createEvidenceReceiptReader();
    const secret = runtimeConfig().AUTH_SECRET;
    const after = query.cursor ? decodeDiscoveryCursor(query.cursor, actor.userId, query, now, secret) : null;
    const literal = query.q.replace(/[\\%_]/g, value => "\\" + value);
    const where: Prisma.CreatorWhereInput = {
      state: "PUBLISHED", isTest: false, userId: { not: null }, publicConsentAt: { not: null, lte: now },
      user: { active: true, role: "CREATOR", isTest: false, emailVerifiedAt: { not: null, lte: now } },
      ...(after ? { id: { gt: after } } : {}),
      ...(query.residenceCountryCode ? { countryCode: query.residenceCountryCode } : {}),
      ...(query.platform ? { accounts: { some: { publicVisible: true, platform: query.platform } } } : {}),
      ...(literal ? { OR: [{ handle: { contains: literal, mode: "insensitive" } }, { displayName: { contains: literal, mode: "insensitive" } }] } : {}),
    };
    reader.checkpoint();
    const rows = await tx.creator.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: query.limit + 1 });
    reader.checkpoint();
    const scanned = rows.slice(0, query.limit), ids = scanned.map(row => row.id);
    const projected = ids.length ? await loadPublicCreatorIdentities(tx, ids, now, reader) : [];
    reader.checkpoint();
    const allowed = new Set(ids);
    const creators = projected.filter(creator => {
      reader.checkpoint();
      const valid = PublicDiscoveryCreatorSchema.safeParse(creator);
      reader.checkpoint();
      if (!valid.success || !allowed.has(creator.id)) throw new DiscoveryError("RETRY_REQUIRED");
      if (query.residenceCountryCode && creator.residenceCountryCode !== query.residenceCountryCode) return false;
      return (!query.platform && !query.reachBand) || creator.accounts.some(account => {
        reader.checkpoint();
        return (!query.platform || account.platform === query.platform) && (!query.reachBand || account.followersObservation?.band === query.reachBand);
      });
    });
    if (new Set(creators.map(creator => creator.id)).size !== creators.length) throw new DiscoveryError("RETRY_REQUIRED");
    reader.checkpoint();
    const nextCursor = rows.length > query.limit
      ? encodeDiscoveryCursor(scanned[scanned.length - 1]!.id, actor.userId, query, now, secret) : null;
    const result = DiscoveryPageSchema.parse({ scope: query.scope, asOf: now.toISOString(), creators, nextCursor });
    reader.checkpoint();
    const audit = { actorUserId: actor.userId, action: "discovery.public_accessed",
      resourceType: "CreatorDiscovery", resourceId: "public_profiles",
      snapshot: { scope: result.scope, asOf: result.asOf, queryHash: discoveryQueryHash(query), scanned: scanned.length, returned: result.creators.length } };
    reader.checkpoint();
    await tx.adminAudit.create({ data: audit });
    reader.checkpoint();
    return result;
  });
}
