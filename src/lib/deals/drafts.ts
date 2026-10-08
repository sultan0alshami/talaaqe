import { z } from "zod";
import type { OfferDraft, Prisma } from "@prisma/client";
import { lockEvidenceActors } from "@/lib/evidence/readiness";
import { beginDealSession, withDealSession, lockDealSession } from "./session";
import { MoneySchema } from "@/lib/contracts/money";
import { OfferTermsSchema } from "@/lib/contracts/offers";
import { TimeZoneSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { canonicalHash, inputJson, record } from "@/lib/onboarding/drafts";
import { DealError, type DealOptions } from "./contracts";
import { dealParticipantContext } from "./service";
import { assertFreshDirectCampaign } from "@/lib/campaign-planning/legacy";

const Id = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
// Presence of a field means its actual value is validated. Missing fields remain
// unknown; saving a draft never asserts live eligibility or approves legal rules.
export const OfferDraftTermsSchema = OfferTermsSchema.partial().extend({
  amount: MoneySchema.partial().optional(),
  period: z.object({ startsAt: UtcDateTimeSchema.optional(), endsAt: UtcDateTimeSchema.optional(), timeZone: TimeZoneSchema.optional() }).strict()
    .refine(p => !p.startsAt || !p.endsAt || Date.parse(p.startsAt) < Date.parse(p.endsAt), "Invalid period").optional(),
}).strict();
const SaveSchema = z.object({ campaignId: Id, creatorId: Id, operationKey: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/),
  expectedRevision: z.number().int().nonnegative(), patch: OfferDraftTermsSchema }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new DealError("INVALID_COMMAND", 400); return parsed.data; }
function dto(draft: OfferDraft) { return { id: draft.id, campaignId: draft.campaignId, creatorId: draft.creatorId, revision: draft.revision,
  terms: parse(OfferDraftTermsSchema, draft.terms), createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString() }; }
export type OfferDraftDTO = ReturnType<typeof dto>;
async function creatorDraftParty(tx: Prisma.TransactionClient, actor: string, campaignId: string, creatorId: string, role: "BRAND" | "CREATOR") {
  if (role === "CREATOR" && !await tx.deal.findFirst({ where: { campaignId, creatorId, creator: { userId: actor }, offers: { some: { version: 1, recipientUserId: actor } } }, select: { id: true } })) throw new DealError("NOT_FOUND", 404);
}
export async function getOfferDraft(actor: string, draftId: string, options: DealOptions = {}): Promise<OfferDraftDTO> {
  const session = await beginDealSession(actor, options);
  parse(Id, draftId);
  return withDealSession(session, false, async tx => {
    const draft = await tx.offerDraft.findFirst({ where: { id: draftId, actorUserId: actor }, select: { campaignId: true, creatorId: true } });
    if (!draft) { await lockEvidenceActors(tx, { otherOwnerIds: [actor] }); await lockDealSession(tx); throw new DealError("NOT_FOUND", 404); }
    const ctx = await dealParticipantContext(tx, actor, draft.campaignId, draft.creatorId, false, undefined, "FRESH_READ");
    await creatorDraftParty(tx, actor, draft.campaignId, draft.creatorId, ctx.role);
    await tx.$queryRaw`SELECT id FROM "OfferDraft" WHERE id=${draftId} FOR SHARE`;
    return dto(await tx.offerDraft.findUniqueOrThrow({ where: { id: draftId } }));
  });
}
export async function saveOfferDraft(actor: string, input: unknown, options: DealOptions = {}): Promise<{ draft: OfferDraftDTO; replayed: boolean }> {
  const session = await beginDealSession(actor, options); options = session.options;
  const command = parse(SaveSchema, input), hash = canonicalHash(command), now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new DealError("INVALID_CLOCK", 400);
  return withDealSession(session, true, async tx => {
    const ctx = await dealParticipantContext(tx, actor, command.campaignId, command.creatorId, true, undefined, "CREATE_REPLAY");
    await creatorDraftParty(tx, actor, command.campaignId, command.creatorId, ctx.role);
    const previous = await tx.offerDraftCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: actor, operationKey: command.operationKey } } });
    if (previous) {
      if (previous.payloadHash !== hash) throw new DealError("IDEMPOTENCY_CONFLICT");
      return { draft: dto(await tx.offerDraft.findUniqueOrThrow({ where: { id: previous.draftId } })), replayed: true };
    }
    await assertFreshDirectCampaign(tx, command.campaignId);
    let draft = await tx.offerDraft.findUnique({ where: { actorUserId_campaignId_creatorId: { actorUserId: actor, campaignId: command.campaignId, creatorId: command.creatorId } } });
    if (!draft) {
      if (command.expectedRevision !== 0) throw new DealError("STALE_VERSION");
      draft = await tx.offerDraft.create({ data: { actorUserId: actor, campaignId: command.campaignId, creatorId: command.creatorId, terms: inputJson(command.patch), createdAt: now, updatedAt: now } });
    } else {
      await tx.$queryRaw`SELECT id FROM "OfferDraft" WHERE id=${draft.id} FOR UPDATE`;
      draft = await tx.offerDraft.findUniqueOrThrow({ where: { id: draft.id } });
      if (draft.revision !== command.expectedRevision) throw new DealError("STALE_VERSION");
      const merged = { ...record(draft.terms), ...command.patch };
      // Nested form fragments preserve other already-entered money/date fields.
      for (const key of ["amount", "period"] as const) if (command.patch[key]) merged[key] = { ...record(record(draft.terms)[key]), ...command.patch[key] };
      const terms = parse(OfferDraftTermsSchema, merged);
      const updated = await tx.offerDraft.updateMany({ where: { id: draft.id, revision: command.expectedRevision }, data: { revision: { increment: 1 }, terms: inputJson(terms), updatedAt: now } });
      if (updated.count !== 1) throw new DealError("STALE_VERSION");
      draft = await tx.offerDraft.findUniqueOrThrow({ where: { id: draft.id } });
    }
    await tx.offerDraftCommand.create({ data: { draftId: draft.id, actorUserId: actor, operationKey: command.operationKey, payloadHash: hash, result: { draftId: draft.id, revision: draft.revision }, createdAt: now } });
    return { draft: dto(draft), replayed: false };
  });
}
