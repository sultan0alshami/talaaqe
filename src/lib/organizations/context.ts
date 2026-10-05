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
async function authorizeActor(tx: Pick<OrganizationTransaction, "user" | "authSession">, actor: OrganizationActor) {
  const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { id: true, active: true, role: true, sessionVersion: true } });
  const session = await tx.authSession.findUnique({ where: { id: actor.sessionId } });
  if (!user?.active || user.role !== actor.role || user.sessionVersion !== actor.sessionVersion || !session
    || session.userId !== actor.userId || session.version !== actor.sessionVersion || session.revokedAt || session.expiresAt <= new Date()) {
    throw new OrganizationError("UNAUTHENTICATED", 401);
  }
  if (user.role !== "BRAND") throw new OrganizationError("FORBIDDEN", 403);
}
export async function checkOrganizationActor(actor: OrganizationActor, options: OrganizationOptions = {}) {
  await authorizeActor(organizationDb(options), claims(actor));
}
function retryConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034"
    || (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code))));
}

// Preflight identity IDs are locks only, never an authority claim. The handler
// must recheck every owner/membership/client binding under these native locks.
export async function withOrganizationTransaction<T>(actorInput: OrganizationActor, options: OrganizationOptions,
  config: { write: boolean; userIds?: string[] }, action: (tx: OrganizationTransaction, lockedUserIds: ReadonlySet<string>) => Promise<T>): Promise<T> {
  const actor = claims(actorInput);
  const ids = z.array(OrganizationIdSchema).max(63).parse(config.userIds ?? []);
  const ordered = [...new Set([actor.userId, ...ids])].sort();
  const client = organizationDb(options);
  const attempts = config.write ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await client.$transaction(async tx => {
        if (config.write) await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ordered)}) ORDER BY id FOR UPDATE`);
        else await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ordered)}) ORDER BY id FOR SHARE`);
        await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id=${actor.sessionId} FOR SHARE`;
        await authorizeActor(tx, actor);
        const result = await action(tx, new Set(ordered));
        await authorizeActor(tx, actor);
        return result;
      }, { isolationLevel: config.write ? "Serializable" : "RepeatableRead", maxWait: 10000, timeout: 20000 });
    } catch (error) {
      if (!retryConflict(error)) throw error;
      if (attempt + 1 >= attempts) throw new OrganizationError("RETRY_REQUIRED", 503);
    }
  }
  throw new OrganizationError("RETRY_REQUIRED", 503);
}

export async function lockOrganization(tx: OrganizationTransaction, id: string, lockedUsers: ReadonlySet<string>, write = false) {
  if (write) await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${id} FOR SHARE`;
  const organization = await tx.organization.findUnique({ where: { id } });
  if (!organization?.active) throw new OrganizationError("NOT_FOUND", 404);
  if (!lockedUsers.has(organization.ownerUserId)) throw new OrganizationError("RETRY_REQUIRED", 503);
  const owner = await tx.user.findUnique({ where: { id: organization.ownerUserId }, select: { active: true, role: true } });
  if (!owner?.active || owner.role !== "BRAND") throw new OrganizationError("NOT_FOUND", 404);
  return organization;
}

// Call after Org→Membership→Client→Grant locks. Association state alone is insufficient.
export async function validateClientDelegation(tx: OrganizationTransaction, client: {
  brandId: string; state: string; authorizingUserId: string | null; authorizingSessionVersion: number | null; allowedCapabilities: unknown;
}, lockedUsers: ReadonlySet<string>) {
  if (client.state !== "ACTIVE") throw new OrganizationError("NOT_FOUND", 404);
  await tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${client.brandId} FOR SHARE`;
  const brand = await tx.brand.findUnique({ where: { id: client.brandId }, select: { id: true, userId: true, name: true } });
  if (!brand || brand.userId !== client.authorizingUserId) throw new OrganizationError("NOT_FOUND", 404);
  if (!lockedUsers.has(brand.userId)) throw new OrganizationError("RETRY_REQUIRED", 503);
  const owner = await tx.user.findUnique({ where: { id: brand.userId }, select: { active: true, role: true, sessionVersion: true } });
  const caps = ClientCapabilitiesSchema.safeParse(client.allowedCapabilities);
  if (!owner?.active || owner.role !== "BRAND" || owner.sessionVersion !== client.authorizingSessionVersion || !caps.success) throw new OrganizationError("NOT_FOUND", 404);
  return { brand, capabilities: caps.data };
}
