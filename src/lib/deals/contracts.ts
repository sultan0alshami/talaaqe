import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { OfferTermsSchema, type OfferTerms } from "@/lib/contracts/offers";
import { InterfaceLanguageSchema, OriginalTextSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import type { CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import type { MatchingPolicyReader } from "@/lib/matching/persistence";
import type { EvidenceActorLocks } from "@/lib/evidence/readiness";
import type { OrganizationActor } from "@/lib/organizations/context";
import type { CampaignBriefDTO } from "@/lib/campaigns/core";

export class DealError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "DealError"; }
}
export type DealPolicyEvidence = {
  governingTerms: { id: string; language: "ar" | "en"; content: string };
  marketPolicyVersions: Prisma.JsonValue[];
  licenceSnapshots: Prisma.JsonValue[];
  policyVersion: string;
};
export type DealPolicyContext = { requirements: CampaignRequirementsDTO; dealId: string | null; agreement?: AgreementContent; evidenceActors?: EvidenceActorLocks };
// Trusted server dependency only: neither request bodies nor model tool arguments
// may provide this function/evidence. It reads current reviewed records in this tx.
export type DealPolicyVerifier = (tx: Prisma.TransactionClient, actorUserId: string, campaignId: string,
  creatorId: string, terms: OfferTerms | undefined, stage: "OFFER" | "ACCEPT" | "CONFIRM", requestedLanguage?: "ar" | "en",
  context?: DealPolicyContext) => Promise<DealPolicyEvidence>;
// Trusted server metadata only; never a legacy command field/hash input.
// Public entrypoints fail closed when this captured native tuple is absent.
export type DealOptions = { client?: PrismaClient; now?: Date; policyVerifier?: DealPolicyVerifier; policyReader?: MatchingPolicyReader;
  serverAuth?: OrganizationActor };
const id = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
const key = z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/);
// Trusted/current scope is proved natively, never by choosing this query lane.
// These interfaces are inert until the independent historical failure witnesses.
export const DealComposeQuerySchema = z.object({ campaignId: id, creatorId: id, dealId: id.optional(),
  matchRunId: id.optional(), view: z.literal("CURRENT_EXECUTION").optional() }).strict()
  .refine(value => value.view === undefined || value.dealId !== undefined);
export type RetainedDealComposeDTO = {
  kind: "HISTORY_ONLY"; dealId: string;
  campaign: { id: string; title: string; briefVersion: number };
  approvedBrief: CampaignBriefDTO;
  parties: { brand: { userId: string; name: string | null };
    creator: { userId: string; name: string | null; handle: string | null } };
  readiness: { canSend: false; blockedReasons: ["HISTORY_ONLY"] };
  origin: string; matchRunId: string | null;
};
export const CreateDealSchema = z.object({
  operationKey: key, campaignId: id, creatorId: id, expectedCampaignRevision: z.number().int().positive(),
  expectedBriefVersion: z.number().int().positive(), origin: z.enum(["MATCH", "DIRECT", "INVITE"]).default("DIRECT"),
  matchRunId: id.nullable().default(null), terms: OfferTermsSchema,
}).strict();
export type CreateDealInput = z.input<typeof CreateDealSchema>;
const base = { operationKey: key, expectedVersion: z.number().int().positive() };
const offer = { expectedOfferVersion: z.number().int().positive(), offerId: id };
const reason = OriginalTextSchema.refine((value) => value.text.trim().length > 0, "Reason required");
export const DealCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, ...offer, action: z.literal("COUNTER"), terms: OfferTermsSchema }).strict(),
  z.object({ ...base, ...offer, action: z.literal("ACCEPT"), language: InterfaceLanguageSchema.default("ar") }).strict(),
  z.object({ ...base, ...offer, action: z.literal("DECLINE"), reason }).strict(),
  z.object({ ...base, action: z.literal("CONFIRM"), agreementId: id, expectedAgreementVersion: z.number().int().positive() }).strict(),
  z.object({ ...base, action: z.literal("DELIVER"), evidence: z.object({ text: reason,
    links: z.array(z.url().refine((value) => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; })).max(20),
  }).strict() }).strict(),
  z.object({ ...base, action: z.literal("COMPLETE") }).strict(),
  z.object({ ...base, action: z.literal("CANCEL"), reason }).strict(),
  z.object({ ...base, action: z.literal("DECLARE_PAID") }).strict(),
  z.object({ ...base, action: z.literal("DECLARE_RECEIVED") }).strict(),
  z.object({ ...base, action: z.literal("RATE"), stars: z.number().int().min(1).max(5), comment: OriginalTextSchema.nullable() }).strict(),
  z.object({ ...base, action: z.literal("MESSAGE"), text: reason }).strict(),
]);
export type DealCommandInput = z.input<typeof DealCommandSchema>;
export type DealCommand = z.infer<typeof DealCommandSchema>;
export const AgreementContentSchema = z.object({
  schemaVersion: z.literal(1), acceptedOfferId: id, language: InterfaceLanguageSchema, terms: OfferTermsSchema,
  brandCountryCode: z.string(), creatorCountryCode: z.string(), campaignMarketCountryCodes: z.array(z.string()),
  partiesSnapshot: z.record(z.string(), z.string()), reviewedLicenceSnapshots: z.array(z.json()),
  marketPolicyVersions: z.array(z.json()), policyVersion: z.string(), governingTermsVersionId: id,
  content: z.string().min(1).max(100_000), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedAt: UtcDateTimeSchema,
}).strict();
export type AgreementContent = z.infer<typeof AgreementContentSchema>;
