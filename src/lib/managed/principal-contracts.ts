import { z } from "zod";
import { OriginalTextSchema, CountryCodeSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { MoneySchema } from "@/lib/contracts/money";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const safeText = (maximum: number) => z.string().min(1).max(maximum)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/).refine(value => value.trim().length > 0);
const original = (maximum: number) => OriginalTextSchema.extend({ text: safeText(maximum) }).strict();
const instant = UtcDateTimeSchema.refine(value => /^[0-9]{4}-/.test(value) && value.slice(0, 4) !== "0000");
export const ManagedAuthorityValiditySchema = z.object({ validFrom: instant,
  expiresAt: instant.nullable(), recheckAt: instant }).strict()
  .refine(value => Date.parse(value.validFrom) < Date.parse(value.recheckAt)
    && (value.expiresAt === null || Date.parse(value.validFrom) < Date.parse(value.expiresAt)
      && Date.parse(value.recheckAt) <= Date.parse(value.expiresAt)));
export const PrincipalPartySchema = z.object({ legalNameOriginal: original(500), tradingNameOriginal: original(500).nullable(),
  legalFormOriginal: original(500), jurisdiction: CountryCodeSchema,
  registration: z.object({ authorityOriginal: original(500), identifier: safeText(500) }).strict(),
  registeredAddressOriginal: original(2000) }).strict();
const pin = <T extends string>(kind: T) => z.object({ versionId: id, kind: z.literal(kind), contentHash: hash }).strict();
const grant = { schemaVersion: z.literal(1), id, revision, state: z.enum(["ACTIVE", "PAUSED", "REVOKED"]),
  provenance: z.enum(["LIVE", "DEVELOPMENT_FIXTURE"]), operatorUserId: id, principalId: id, principalVersionId: id,
  principalSourceHash: hash, binding: z.object({ orderId: id, workspaceId: id, campaignId: id, submissionId: id,
    submissionVersion: revision, submissionHash: hash }).strict(),
  grantor: z.object({ userId: id, governanceSeatId: id, governanceSeatRevision: revision }).strict(),
  authorizationEvidence: z.object({ id, revision, sourceHash: hash }).strict(), validity: ManagedAuthorityValiditySchema, sourceHash: hash };
export const ManagedOperationalGrantSchema = z.discriminatedUnion("purpose", [
  z.object({ ...grant, purpose: z.literal("VIEW_SUBMITTED_ORDER"), accessPolicy: pin("MANAGED_SUBMISSION_ACCESS") }).strict(),
  z.object({ ...grant, purpose: z.literal("ISSUE_RETAIL_QUOTE"), quotePolicy: pin("MANAGED_QUOTE_POLICY"),
    customerTermsPolicy: pin("MANAGED_CUSTOMER_TERMS"), taxPolicy: pin("MANAGED_TAX_TREATMENT"),
    maximumGross: MoneySchema.refine(value => value.amountMinor !== "0"),
    marketCountryCodes: z.array(CountryCodeSchema).min(1).max(50).refine(value => new Set(value).size === value.length) }).strict(),
]).refine(value => value.operatorUserId !== value.grantor.userId);
export type ManagedAuthorityValidity = z.infer<typeof ManagedAuthorityValiditySchema>;
export type PrincipalParty = z.infer<typeof PrincipalPartySchema>;
export type ManagedOperationalGrant = z.infer<typeof ManagedOperationalGrantSchema>;
