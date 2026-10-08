import { z } from "zod";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { OriginalTextSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { ManagedAuthorityValiditySchema } from "@/lib/managed/principal-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const provenance = z.enum(["LIVE", "DEVELOPMENT_FIXTURE"]);
const instant = UtcDateTimeSchema.refine(value => /^[0-9]{4}-/.test(value) && value.slice(0, 4) !== "0000");
const bounded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 131072;
const receipt = { id, actorUserId: id, operationKey: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/),
  payloadHash: hash, resultHash: hash };
const common = { schemaVersion: z.literal(1), admissionId: id, provenance, version: revision,
  subject: z.object({ campaignId: id, brandId: id, brandUserId: id, creatorId: id, creatorUserId: id }).strict(),
  approvedBrief: z.object({ id, version: revision, inputRevision: revision, approvedByUserId: id, contentHash: hash }).strict(),
  validity: ManagedAuthorityValiditySchema, manifest: z.object({ id, entryId: id }).strict() };
const fresh = { capability: z.literal("FRESH_PINNED_SCOPE"),
  // Campaign CREATE retains the literal prefix plus the original1..120 key.
  // The whole stored string participates in the hash; never strip or alias it.
  source: z.object({ ...receipt, kind: z.literal("CAMPAIGN_COMMAND"),
    operationKey: z.string().min(8).max(127).regex(/^create:[A-Za-z0-9_:-]{1,120}$/) }).strict() };
const continuation = { capability: z.literal("CONTINUE_PINNED_DEAL"),
  source: z.object({ ...receipt, kind: z.literal("DEAL_COMMAND") }).strict(),
  existingDeal: z.object({ id, sourceHash: hash, firstOffer: z.object({ id, version: z.literal(1),
    proposerUserId: id, recipientUserId: id, contentHash: hash }).strict() }).strict() };
const freshContent = z.object({ ...common, ...fresh }).strict();
const continuationContent = z.object({ ...common, ...continuation }).strict();
const contentShape = z.discriminatedUnion("capability", [freshContent, continuationContent]);
function parties(value: z.infer<typeof contentShape>) {
  return value.subject.brandUserId !== value.subject.creatorUserId
    && value.approvedBrief.approvedByUserId === value.subject.brandUserId
    && value.source.actorUserId === value.subject.brandUserId
    && (value.capability === "FRESH_PINNED_SCOPE"
      || value.existingDeal.firstOffer.proposerUserId === value.subject.brandUserId
      && value.existingDeal.firstOffer.recipientUserId === value.subject.creatorUserId);
}

// Strict declarations only. Receipt labels, LIVE/ACTIVE and matching hashes
// cannot classify native history, establish trusted manifest access or admit work.
// IDs retain the complete central grammar; a literal '*' is never a glob.
export const LegacyDirectAdmissionContentSchema = contentShape.refine(parties, "Admission declaration party mismatch")
  .refine(bounded, "Admission declaration exceeds131072 bytes");
const storage = { id, sourceHash: hash, createdAt: instant };
export const LegacyDirectAdmissionVersionSchema = z.discriminatedUnion("capability", [
  freshContent.extend(storage).strict(), continuationContent.extend(storage).strict(),
]).refine(parties, "Admission declaration party mismatch")
  .refine(value => {
    const { id: storageId, sourceHash, createdAt, ...input } = value;
    void storageId; void createdAt;
    // Recoverable Zod size issues must fail before the bounded canonical codec.
    const content = LegacyDirectAdmissionContentSchema.safeParse(input);
    return content.success && sourceHash === canonicalHash(content.data);
  }, "Admission declaration hash mismatch");
export const LegacyDirectAdmissionStateSchema = z.object({ admissionId: id, revision,
  state: z.enum(["DRAFT", "ACTIVE", "PAUSED", "REVOKED"]),
  currentVersion: z.object({ id, version: revision, sourceHash: hash }).strict().nullable(),
  createdAt: instant, updatedAt: instant }).strict().refine(value =>
  Date.parse(value.updatedAt) >= Date.parse(value.createdAt)
  && (value.state === "REVOKED" || (value.state === "DRAFT" ? value.currentVersion === null : value.currentVersion !== null)),
"Admission state pointer or timestamp mismatch");

const reference = OriginalTextSchema.extend({ text: z.string().min(1).max(2000)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/).refine(value => value.trim().length > 0) }).strict();
const manifest = { schemaVersion: z.literal(1), manifestId: id, provenance, createdAt: instant,
  reviewReferenceOriginal: reference,
  entries: z.array(z.object({ entryId: id, admissionId: id, version: revision, sourceHash: hash }).strict()).min(1).max(50)
    .refine(values => new Set(values.map(value => value.entryId)).size === values.length
      && new Set(values.map(value => JSON.stringify([value.admissionId, value.version]))).size === values.length) };
// Admission content stores manifest/entry IDs; this envelope pins content hashes.
// There is no cyclic digest. Cross-envelope/provenance/source verification and an
// externally controlled allowlist remain subsequent native obligations.
export const LegacyDirectAdmissionManifestContentSchema = z.object(manifest).strict().refine(bounded, "Admission manifest exceeds131072 bytes");
export const LegacyDirectAdmissionManifestSchema = z.object({ ...manifest, sourceHash: hash }).strict().refine(value => {
  const { sourceHash, ...input } = value;
  const content = LegacyDirectAdmissionManifestContentSchema.safeParse(input);
  return content.success && sourceHash === canonicalHash(content.data);
}, "Admission manifest hash mismatch");

export type LegacyDirectAdmissionContent = z.infer<typeof LegacyDirectAdmissionContentSchema>;
export type LegacyDirectAdmissionVersion = z.infer<typeof LegacyDirectAdmissionVersionSchema>;
export type LegacyDirectAdmissionState = z.infer<typeof LegacyDirectAdmissionStateSchema>;
export type LegacyDirectAdmissionManifestContent = z.infer<typeof LegacyDirectAdmissionManifestContentSchema>;
export type LegacyDirectAdmissionManifest = z.infer<typeof LegacyDirectAdmissionManifestSchema>;
