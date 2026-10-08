import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Session } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import { ClientCapabilitiesSchema, OrganizationError, OrganizationIdSchema } from "./contracts";

export type OrganizationActor = Pick<Session, "userId" | "role" | "sessionId" | "sessionVersion">;
export type OrganizationOptions = { client?: PrismaClient };
export type OrganizationTransaction = Prisma.TransactionClient;
const ActorSchema = z.object({ userId: OrganizationIdSchema, role: z.enum(["BRAND", "CREATOR", "ADMIN"]),
  sessionId: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/), sessionVersion: z.number().int().positive().max(2147483647) }).strict();
export function organizationDb(options: OrganizationOptions = {}) { return options.client ?? prisma; }

function claims(actor: OrganizationActor) {
  const parsed = ActorSchema.safeParse(actor && { userId: actor.userId, role: actor.role, sessionId: actor.sessionId, sessionVersion: actor.sessionVersion });
  if (!parsed.success) throw new OrganizationError("UNAUTHENTICATED", 401);
  return parsed.data;
}
export function captureOrganizationActor(actor: OrganizationActor): Readonly<OrganizationActor> {
  return Object.freeze(claims(actor));
}
export async function organizationAwait<T>(checkpoint: (() => void) | undefined, query: () => Promise<T>) {
  checkpoint?.();
  try { return await query(); } finally { checkpoint?.(); }
}
const checkpointed = organizationAwait;
const organizationRoles = Object.freeze(["BRAND"] as const);
const profileRoles = Object.freeze(["CREATOR", "BRAND"] as const);
async function authorizeActor(tx: Pick<OrganizationTransaction, "user" | "authSession">, actor: OrganizationActor,
  checkpoint?: () => void, allowedRoles: readonly string[] = organizationRoles) {
  const user = await checkpointed(checkpoint, () => tx.user.findUnique({ where: { id: actor.userId }, select: { id: true, active: true, role: true, sessionVersion: true } }));
  const session = await checkpointed(checkpoint, () => tx.authSession.findUnique({ where: { id: actor.sessionId } }));
  if (!user?.active || user.role !== actor.role || user.sessionVersion !== actor.sessionVersion || !session
    || session.userId !== actor.userId || session.version !== actor.sessionVersion || session.revokedAt || session.expiresAt <= new Date()) {
    throw new OrganizationError("UNAUTHENTICATED", 401);
  }
  if (!allowedRoles.includes(user.role)) throw new OrganizationError("FORBIDDEN", 403);
}
// Trusted callers hold owner/reviewer User locks and the exact AuthSession lock.
// This fixed BRAND predicate reads current authority and acquires no new locks.
export async function assertLockedOrganizationActor(tx: Pick<OrganizationTransaction, "user" | "authSession">, actor: OrganizationActor) {
  await authorizeActor(tx, claims(actor));
}
// Self-profile/deal participants are fixed BRAND+CREATOR authority, distinct
// from tenant authority. Trusted callers already hold complete owner/reviewer
// User locks and this exact AuthSession lock; this helper adds no locks or roles.
export async function assertLockedProfileActor(tx: Pick<OrganizationTransaction, "user" | "authSession">,
  actor: OrganizationActor, checkpoint?: () => void) {
  await authorizeActor(tx, claims(actor), checkpoint, profileRoles);
}
export async function checkOrganizationActor(actor: OrganizationActor, options: OrganizationOptions = {}, checkpoint?: () => void) {
  await authorizeActor(organizationDb(options), claims(actor), checkpoint);
}
// Self-profile access is distinct from tenant authority. No caller can broaden
// the fixed role set, and existing organization exports remain BRAND-only.
export async function checkProfileActor(actor: OrganizationActor, options: OrganizationOptions = {}, checkpoint?: () => void) {
  await authorizeActor(organizationDb(options), claims(actor), checkpoint, profileRoles);
}
export function withProfileActorTransaction<T>(actor: OrganizationActor, options: OrganizationOptions,
  config: { write: boolean; userIds?: string[]; reviewerIds?: string[]; checkpoint?: () => void },
  action: (tx: OrganizationTransaction, ownerIds: ReadonlySet<string>, reviewerIds: ReadonlySet<string>) => Promise<T>): Promise<T> {
  return withActorTransaction(actor, options, config, action, profileRoles);
}
function retryConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034"
    || (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code))));
}

// Preflight identity IDs are locks only, never an authority claim. The handler
// must recheck every owner/membership/client binding under these native locks.
export function withOrganizationTransaction<T>(actor: OrganizationActor, options: OrganizationOptions,
  config: { write: boolean; userIds?: string[]; reviewerIds?: string[]; checkpoint?: () => void },
  action: (tx: OrganizationTransaction, ownerIds: ReadonlySet<string>, reviewerIds: ReadonlySet<string>) => Promise<T>): Promise<T> {
  return withActorTransaction(actor, options, config, action, organizationRoles);
}
async function withActorTransaction<T>(actorInput: OrganizationActor, options: OrganizationOptions,
  config: { write: boolean; userIds?: string[]; reviewerIds?: string[]; checkpoint?: () => void },
  action: (tx: OrganizationTransaction, lockedUserIds: ReadonlySet<string>, reviewerIds: ReadonlySet<string>) => Promise<T>,
  allowedRoles: readonly ("CREATOR" | "BRAND")[]): Promise<T> {
  const actor = claims(actorInput);
  const write = config.write;
  const ids = z.array(OrganizationIdSchema).max(63).parse(config.userIds ?? []);
  const ordered = [...new Set([actor.userId, ...ids])].sort();
  const reviewerIds = [...new Set(z.array(OrganizationIdSchema).max(2412).parse(config.reviewerIds ?? []))].sort();
  const owners = new Set(ordered), logicalReviewers = new Set(reviewerIds);
  const reviewers = reviewerIds.filter(id => !owners.has(id));
  const checkpoint = config.checkpoint;
  const client = organizationDb(options);
  const attempts = write ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      checkpoint?.();
      return await client.$transaction(async tx => {
        checkpoint?.();
        await checkpointed(checkpoint, () => write
          ? tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ordered)}) ORDER BY id FOR UPDATE`)
          : tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ordered)}) ORDER BY id FOR SHARE`));
        if (reviewers.length) await checkpointed(checkpoint, () => tx.$queryRaw(Prisma.sql`SELECT id FROM "User"
          WHERE id IN (${Prisma.join(reviewers)}) ORDER BY id FOR SHARE`));
        await checkpointed(checkpoint, () => tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.sessionId} FOR SHARE`);
        await authorizeActor(tx, actor, checkpoint, allowedRoles);
        const result = await checkpointed(checkpoint, () => action(tx, new Set(owners), new Set(logicalReviewers)));
        await authorizeActor(tx, actor, checkpoint, allowedRoles);
        checkpoint?.();
        return result;
      }, { isolationLevel: write ? "Serializable" : "RepeatableRead", maxWait: 10000, timeout: 20000 });
    } catch (error) {
      if (!retryConflict(error)) throw error;
      if (attempt + 1 >= attempts) throw new OrganizationError("RETRY_REQUIRED", 503);
    }
  }
  throw new OrganizationError("RETRY_REQUIRED", 503);
}

export async function lockOrganization(tx: OrganizationTransaction, id: string, lockedUsers: ReadonlySet<string>, write = false, checkpoint?: () => void) {
  const organization = await lockStoredOrganization(tx, id, lockedUsers, write, checkpoint);
  if (!organization.active) throw new OrganizationError("NOT_FOUND", 404);
  const owner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: organization.ownerUserId }, select: { active: true, role: true } }));
  if (!owner?.active || owner.role !== "BRAND") throw new OrganizationError("NOT_FOUND", 404);
  return organization;
}

// Only rights-removal, own recipient membership metadata and current Brand-owner
// history may use stored identity. Each caller proves its own narrow binding.
// This does not authorize an inactive organization, its owner or any delegation.
export async function lockStoredOrganization(tx: OrganizationTransaction, id: string, lockedUsers: ReadonlySet<string>, write = false, checkpoint?: () => void) {
  await organizationAwait(checkpoint, () => write ? tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${id} FOR UPDATE`
    : tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${id} FOR SHARE`);
  const organization = await organizationAwait(checkpoint, () => tx.organization.findUnique({ where: { id } }));
  if (!organization) throw new OrganizationError("NOT_FOUND", 404);
  if (!lockedUsers.has(organization.ownerUserId)) throw new OrganizationError("RETRY_REQUIRED", 503);
  return organization;
}

// Call after Org→Membership→Client→Grant locks. Association state alone is insufficient.
export async function validateClientDelegation(tx: OrganizationTransaction, client: {
  brandId: string; state: string; authorizingUserId: string | null; authorizingSessionVersion: number | null; allowedCapabilities: unknown;
}, lockedUsers: ReadonlySet<string>, checkpoint?: () => void) {
  if (client.state !== "ACTIVE") throw new OrganizationError("NOT_FOUND", 404);
  await organizationAwait(checkpoint, () => tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${client.brandId} FOR SHARE`);
  const brand = await organizationAwait(checkpoint, () => tx.brand.findUnique({ where: { id: client.brandId }, select: { id: true, userId: true, name: true } }));
  if (!brand || brand.userId !== client.authorizingUserId) throw new OrganizationError("NOT_FOUND", 404);
  if (!lockedUsers.has(brand.userId)) throw new OrganizationError("RETRY_REQUIRED", 503);
  const owner = await organizationAwait(checkpoint, () => tx.user.findUnique({ where: { id: brand.userId }, select: { active: true, role: true, sessionVersion: true } }));
  const caps = ClientCapabilitiesSchema.safeParse(client.allowedCapabilities);
  if (!owner?.active || owner.role !== "BRAND" || owner.sessionVersion !== client.authorizingSessionVersion || !caps.success) throw new OrganizationError("NOT_FOUND", 404);
  return { brand, capabilities: caps.data };
}
