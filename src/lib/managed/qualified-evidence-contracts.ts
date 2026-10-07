import { z } from "zod";
import { CountryCodeSchema, OriginalTextSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { ManagedAuthorityValiditySchema } from "./principal-contracts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = UtcDateTimeSchema.refine(value => /^[0-9]{4}-/.test(value) && value.slice(0, 4) !== "0000");
const original = OriginalTextSchema.extend({ text: z.string().min(1).max(2000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/).refine(value => value.trim().length > 0) }).strict();
const provenance = z.enum(["LIVE", "DEVELOPMENT_FIXTURE"]);
const pin = z.object({ id, revision, sourceHash: hash }).strict();
const activity = z.string().min(1).max(100).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const countries = (minimum: number) => z.array(CountryCodeSchema).min(minimum).max(50)
  .refine(values => new Set(values).size === values.length);

export const QUALIFICATION_DISCIPLINES = Object.freeze({ ENTITY_REGISTRATION: "ENTITY_REGISTRATION", PERSON_IDENTITY: "PERSON_IDENTITY",
  ACTIVITY_PERMISSION: "ACTIVITY_PERMISSION", REPRESENTATION: "REPRESENTATION", CUSTOMER_TERMS: "CONTRACT_TERMS",
  SUPPLIER_TERMS: "CONTRACT_TERMS", TAX: "TAX", PRIVATE_STORAGE: "PRIVATE_STORAGE" } as const);
const discipline = z.enum(["ENTITY_REGISTRATION", "PERSON_IDENTITY", "ACTIVITY_PERMISSION", "REPRESENTATION", "CONTRACT_TERMS", "TAX", "PRIVATE_STORAGE"]);
const qualificationShape = { schemaVersion: z.literal(1), userId: id, provenance, version: revision,
  discipline, jurisdictionCountryCodes: countries(1),
  authoritySource: z.object({ kind: z.literal("DEPLOYMENT_ATTESTATION"), manifestId: id, manifestHash: hash,
    referenceOriginal: original, observedAt: instant }).strict(), validity: ManagedAuthorityValiditySchema };
export const QualificationVersionContentSchema = z.object(qualificationShape).strict();

// Pure declarations never verify an attestation, qualification or current access.
// Validate bounded content before the canonical codec, even after recoverable
// Zod errors; malformed safeParse must never throw its payload-size exception.
function hashMatches(schema: z.ZodType, value: Record<string, unknown>) {
  const content = Object.fromEntries(Object.entries(value).filter(([key]) => !["id", "sourceHash", "createdAt"].includes(key)));
  const parsed = schema.safeParse(content);
  return parsed.success && value.sourceHash === canonicalHash(parsed.data);
}
export const QualificationVersionSchema = z.object({ ...qualificationShape, id, sourceHash: hash, createdAt: instant }).strict()
  .refine(value => Date.parse(value.createdAt) >= Date.parse(value.authoritySource.observedAt))
  .refine(value => hashMatches(QualificationVersionContentSchema, value));

const entity = { principalId: id, principalVersionId: id, principalSourceHash: hash };
const subject = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ENTITY_VERSION"), ...entity }).strict(),
  z.object({ kind: z.literal("NATURAL_USER"), ...entity, userId: id, personIdentityEvidence: pin.nullable() }).strict(),
]);
const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EXTERNAL_RECORD"), referenceOriginal: original, observationHash: hash }).strict(),
  z.object({ kind: z.literal("PRIVATE_ASSET"), assetId: id, ownerUserId: id,
    purpose: z.literal("MANAGED_PRINCIPAL_EVIDENCE"), checksum: hash }).strict(),
]);
const document = z.object({ versionId: id, kind: z.enum(["MANAGED_SUBMISSION_ACCESS", "MANAGED_QUOTE_POLICY", "MANAGED_CUSTOMER_TERMS",
  "MANAGED_SUPPLIER_TERMS", "MANAGED_TAX_TREATMENT", "MANAGED_PRIVACY_RETENTION"]), contentHash: hash }).strict();
const evidenceShape = { schemaVersion: z.literal(1), evidenceId: id, reviewRevision: revision, provenance, subject,
  checkKind: z.enum(["ENTITY_REGISTRATION", "PERSON_IDENTITY", "ACTIVITY_PERMISSION", "REPRESENTATION", "CUSTOMER_TERMS", "SUPPLIER_TERMS", "TAX", "PRIVATE_STORAGE"]),
  source, reviewer: z.object({ userId: id, qualificationVersionId: id, qualificationVersion: revision, qualificationSourceHash: hash }).strict(),
  observedAt: instant, reviewedAt: instant, decision: z.enum(["APPROVED", "REJECTED", "NEEDS_RECHECK"]), validity: ManagedAuthorityValiditySchema,
  coverage: z.object({ declaredActivityKeys: z.array(activity).max(50).refine(values => new Set(values).size === values.length),
    marketCountryCodes: countries(0), documentPins: z.array(document).max(6).refine(values => new Set(values.map(pin => pin.kind)).size === values.length) }).strict(),
  independence: z.object({ controllerUserId: id.nullable(), operatorUserId: id.nullable() }).strict() };
type EvidenceContent = z.infer<z.ZodObject<typeof evidenceShape>>;
function coherentReview(value: EvidenceContent) {
  const subject = value.subject;
  let subjectCheck: boolean;
  if (subject.kind === "NATURAL_USER") {
    if (value.reviewer.userId === subject.userId) return false;
    subjectCheck = value.checkKind === "PERSON_IDENTITY" && subject.personIdentityEvidence === null
      || value.checkKind === "REPRESENTATION" && subject.personIdentityEvidence !== null;
  } else subjectCheck = value.checkKind !== "PERSON_IDENTITY" && value.checkKind !== "REPRESENTATION";
  return subjectCheck
    && value.reviewer.userId !== value.independence.controllerUserId && value.reviewer.userId !== value.independence.operatorUserId
    && Date.parse(value.reviewedAt) >= Date.parse(value.observedAt)
    && (value.decision !== "APPROVED" || Date.parse(value.reviewedAt) < Date.parse(value.validity.recheckAt)
      && (value.validity.expiresAt === null || Date.parse(value.reviewedAt) < Date.parse(value.validity.expiresAt)));
}
export const ReviewedPrincipalEvidenceContentSchema = z.object(evidenceShape).strict().refine(coherentReview);
export const ReviewedPrincipalEvidenceSchema = z.object({ ...evidenceShape, id, sourceHash: hash, createdAt: instant }).strict()
  .refine(coherentReview).refine(value => Date.parse(value.createdAt) >= Date.parse(value.reviewedAt))
  .refine(value => hashMatches(ReviewedPrincipalEvidenceContentSchema, value));

export type QualificationVersionContent = z.infer<typeof QualificationVersionContentSchema>;
export type QualificationVersion = z.infer<typeof QualificationVersionSchema>;
export type ReviewedPrincipalEvidenceContent = z.infer<typeof ReviewedPrincipalEvidenceContentSchema>;
export type ReviewedPrincipalEvidence = z.infer<typeof ReviewedPrincipalEvidenceSchema>;
