import { randomUUID } from "node:crypto";
import { Prisma, type SocialAccount } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canonicalHash, inputJson, record } from "@/lib/onboarding/drafts";
import { OriginalTextSchema } from "@/lib/contracts/vocabulary";
import { EvidenceError, type EvidenceStorage } from "./storage";
import type { PrismaClient } from "@prisma/client";

export type Tx = Prisma.TransactionClient;
export type EvidenceOptions = { storage: EvidenceStorage; client?: PrismaClient; now?: Date };
export const Id = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
export const Key = z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/);
export const Revision = z.number().int().positive();
export const Note = OriginalTextSchema.refine(n => n.text.trim().length > 0 && n.text.length <= 4000);
export const Review = z.object({ operationKey: Key, expectedRevision: Revision, decision: z.enum(["VERIFIED", "REJECTED", "REVOKED"]), note: Note }).strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) throw new EvidenceError("INVALID_COMMAND", 400); return result.data;
}
export function clock(options: EvidenceOptions) { const now = options.now ?? new Date(); if (!Number.isFinite(now.getTime())) throw new EvidenceError("INVALID_CLOCK", 400); return now; }
export async function transaction<T>(options: EvidenceOptions, callback: (tx: Tx, now: Date) => Promise<T>) {
  const now = clock(options);
  return (options.client ?? prisma).$transaction(tx => callback(tx, now), { maxWait: 10_000, timeout: 25_000 });
}
type Table = "User" | "Creator" | "Brand" | "SocialAccount" | "OwnershipChallenge" | "PrivateAsset" | "MetricsSnapshot" | "FactCorrection" | "AdvertisingLicence" | "BusinessVerification" | "PolicyVersion";
export async function lock(tx: Tx, table: Table, id: string, share = false) {
  await tx.$queryRaw(Prisma.sql(["SELECT id FROM ", " WHERE id=", share ? " FOR SHARE" : " FOR UPDATE"], Prisma.raw('"' + table + '"'), id));
}
export async function active(tx: Tx, id: string, role?: "CREATOR" | "BRAND" | "ADMIN") {
  await lock(tx, "User", id);
  const user = await tx.user.findUnique({ where: { id } });
  if (!user?.active || role && user.role !== role) throw new EvidenceError("FORBIDDEN", 403);
  return user;
}
// Every review locks the resource owner's User first, then current ADMIN User,
// then domain rows. The owner's suspension and identity changes linearize here.
export async function creatorContext(tx: Tx, actor: string, creatorId: string, review = false, otherReviewers: string[] = []) {
  const initial = await tx.creator.findUnique({ where: { id: creatorId }, select: { userId: true } });
  if (!initial?.userId || !review && initial.userId !== actor) throw new EvidenceError("NOT_FOUND", 404);
  await active(tx, initial.userId, "CREATOR");
  if (review) for (const reviewer of [...new Set([actor, ...otherReviewers])].sort()) await active(tx, reviewer, "ADMIN");
  await lock(tx, "Creator", creatorId);
  const creator = await tx.creator.findUniqueOrThrow({ where: { id: creatorId } });
  if (creator.userId !== initial.userId) throw new EvidenceError("STALE_OWNER");
  return creator;
}
export async function brandContext(tx: Tx, actor: string, brandId: string, review = false) {
  const initial = await tx.brand.findUnique({ where: { id: brandId }, select: { userId: true } });
  if (!initial || !review && initial.userId !== actor) throw new EvidenceError("NOT_FOUND", 404);
  await active(tx, initial.userId, "BRAND");
  if (review) await active(tx, actor, "ADMIN");
  await lock(tx, "Brand", brandId);
  const brand = await tx.brand.findUniqueOrThrow({ where: { id: brandId } });
  if (brand.userId !== initial.userId) throw new EvidenceError("STALE_OWNER");
  return brand;
}
export async function accountContext(tx: Tx, actor: string, accountId: string, review = false) {
  const initial = await tx.socialAccount.findUnique({ where: { id: accountId }, select: { creatorId: true } });
  if (!initial) throw new EvidenceError("NOT_FOUND", 404);
  const creator = await creatorContext(tx, actor, initial.creatorId, review);
  await lock(tx, "SocialAccount", accountId);
  const account = await tx.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (account.creatorId !== creator.id) throw new EvidenceError("STALE_OWNER");
  return { creator, account };
}
export function identity(account: SocialAccount) {
  return { platform: account.platform, normalizedHandle: account.handle, providerAccountId: account.providerAccountId, confirmedOrigin: null };
}
export function identityHash(account: SocialAccount) { return canonicalHash(identity(account)); }
export function requireMapping(account: SocialAccount, revision: number, hash?: string) {
  if (account.mappingRevision !== revision || hash && hash !== identityHash(account)) throw new EvidenceError("STALE_IDENTITY");
}
export function requireRevision(actual: number, expected: number) { if (actual !== expected) throw new EvidenceError("STALE_VERSION"); }
export async function previous(tx: Tx, actor: string, operationKey: string, hash: string) {
  const command = await tx.evidenceCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: actor, operationKey } } });
  if (command && command.payloadHash !== hash) throw new EvidenceError("IDEMPOTENCY_CONFLICT");
  return command;
}
export async function receipt(tx: Tx, actor: string, operationKey: string, hash: string, resourceType: string, resourceId: string, revision: number, now: Date, metadata: Record<string, unknown> = {}) {
  await tx.evidenceCommand.create({ data: { actorUserId: actor, operationKey, payloadHash: hash, resourceType, resourceId,
    resultJson: inputJson({ resourceId, revision, ...metadata }), createdAt: now } });
}
export async function event(tx: Tx, actor: string, operationKey: string, type: string, resourceType: string, resourceId: string, revision: number, now: Date, payload: Record<string, unknown>) {
  const envelope = { id: randomUUID(), type, actorUserId: actor, aggregateType: resourceType, aggregateId: resourceId, aggregateVersion: revision, idempotencyKey: operationKey, occurredAt: now.toISOString(), payload };
  await tx.adminAudit.create({ data: { actorUserId: actor, action: type, resourceType, resourceId, snapshot: inputJson(envelope), createdAt: now } });
  await tx.outboxEvent.create({ data: { deduplicationKey: "evidence:" + actor + ":" + operationKey + ":" + type, type, payload: inputJson(envelope), createdAt: now, availableAt: now } });
}
export async function reviewLanguage(tx: Tx, resourceType: string, resourceId: string, revision: number): Promise<string | null> {
  const command = await tx.evidenceCommand.findFirst({ where: { resourceType, resourceId, resultJson: { path: ["revision"], equals: revision } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const language = record(command?.resultJson).noteLanguage; return typeof language === "string" ? language : null;
}
export { canonicalHash, inputJson, record };
