import { expect, it } from "vitest";
import { QualificationVersionContentSchema, QualificationVersionSchema,
  ReviewedPrincipalEvidenceContentSchema, ReviewedPrincipalEvidenceSchema } from "@/lib/managed/qualified-evidence-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { COUNTRY_CODES } from "@/lib/contracts/vocabulary";

// Exactly three pure groups. Synthetic declarations and LIVE/APPROVED enum
// cases validate shape only; no controlled attestation, qualification, review,
// entity/person, native authority or provider readiness is provisioned.
const sha = (digit: string) => digit.repeat(64);
const original = (text: string, language: string | null = "ar") => ({ text, language });
function validity() { return { validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", recheckAt: "2026-12-31T23:59:59.999Z" }; }
function qualification() {
  return { schemaVersion: 1 as const, userId: "qualified-reviewer", provenance: "DEVELOPMENT_FIXTURE" as const, version: 1,
    discipline: "CONTRACT_TERMS" as const, jurisdictionCountryCodes: ["SA"],
    authoritySource: { kind: "DEPLOYMENT_ATTESTATION" as const, manifestId: "review-anchor~v1", manifestHash: sha("a"),
      referenceOriginal: original("  مرجع تأهيل أصلي\nOriginal controlled qualification reference\t  "), observedAt: "2026-10-01T00:00:00.000Z" }, validity: validity() };
}
function qualificationVersion(input = qualification(), createdAt = "2026-10-07T03:00:00.000Z") {
  return { ...input, id: "qualification-version~1", sourceHash: canonicalHash(input), createdAt };
}
function evidence() {
  return { schemaVersion: 1 as const, evidenceId: "evidence~a", reviewRevision: 1, provenance: "DEVELOPMENT_FIXTURE" as const,
    subject: { kind: "ENTITY_VERSION" as const, principalId: "principal~a", principalVersionId: "principal-version~1", principalSourceHash: sha("b") },
    checkKind: "CUSTOMER_TERMS" as const,
    source: { kind: "EXTERNAL_RECORD" as const, referenceOriginal: original("  مصدر مراجعة أصلي\r\nOriginal subject-bound observation  ", null), observationHash: sha("c") },
    reviewer: { userId: "qualified-reviewer", qualificationVersionId: "qualification-version~1", qualificationVersion: 1, qualificationSourceHash: sha("d") },
    observedAt: "2026-10-07T01:00:00.000Z", reviewedAt: "2026-10-07T02:00:00.000Z", decision: "APPROVED" as const,
    validity: validity(), coverage: { declaredActivityKeys: ["managed-campaigns"], marketCountryCodes: ["KW"],
      documentPins: [{ versionId: "managed-customer-terms~1", kind: "MANAGED_CUSTOMER_TERMS" as const, contentHash: sha("e") }] },
    independence: { controllerUserId: "principal-controller" as string | null, operatorUserId: "quote-operator" as string | null } };
}
function evidenceVersion(input: unknown = evidence(), createdAt = "2026-10-07T03:00:00.000Z") {
  return { ...(input as Record<string, unknown>), id: "reviewed-evidence-version~1", sourceHash: canonicalHash(input), createdAt };
}
function replaced(input: unknown, path: string[], value: unknown) {
  const result = structuredClone(input) as Record<string, unknown>; let parent = result;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path.at(-1)!] = value; return result;
}
function omitted(input: unknown, key: string) { const result = structuredClone(input) as Record<string, unknown>; delete result[key]; return result; }
const natural = { kind: "NATURAL_USER", principalId: "principal~a", principalVersionId: "principal-version~1", principalSourceHash: sha("b"),
  userId: "subject-person", personIdentityEvidence: null };
const personPin = { id: "person-identity-evidence~1", revision: 1, sourceHash: sha("f") };
const asset = { kind: "PRIVATE_ASSET", assetId: "private-evidence~1", ownerUserId: "qualified-reviewer", purpose: "MANAGED_PRINCIPAL_EVIDENCE", checksum: sha("1") };
const documentKinds = ["MANAGED_SUBMISSION_ACCESS", "MANAGED_QUOTE_POLICY", "MANAGED_CUSTOMER_TERMS", "MANAGED_SUPPLIER_TERMS", "MANAGED_TAX_TREATMENT", "MANAGED_PRIVACY_RETENTION"];

it("qualification/evidence originals, source variants and flat versions preserve exact content-only hashes without asserting actual qualified authority", () => {
  const q = qualification(), e = evidence();
  expect(QualificationVersionContentSchema.parse(q)).toEqual(q); expect(ReviewedPrincipalEvidenceContentSchema.parse(e)).toEqual(e);
  const qv = qualificationVersion(q), ev = evidenceVersion(e);
  expect(QualificationVersionSchema.parse(qv)).toEqual(qv); expect(ReviewedPrincipalEvidenceSchema.parse(ev)).toEqual(ev);
  expect(qv.sourceHash).toBe(canonicalHash(q)); expect(ev.sourceHash).toBe(canonicalHash(e));
  expect(QualificationVersionSchema.parse({ ...qv, id: "another-qualification-id", createdAt: "2026-10-08T03:00:00.000Z" }).sourceHash).toBe(qv.sourceHash);
  expect(ReviewedPrincipalEvidenceSchema.parse({ ...ev, id: "another-review-id", createdAt: "2026-10-08T03:00:00.000Z" }).sourceHash).toBe(ev.sourceHash);
  // Professional jurisdiction does not become campaign market by inference.
  expect(q.jurisdictionCountryCodes).toEqual(["SA"]); expect(e.coverage.marketCountryCodes).toEqual(["KW"]);
  for (const discipline of ["ENTITY_REGISTRATION", "PERSON_IDENTITY", "ACTIVITY_PERMISSION", "REPRESENTATION", "CONTRACT_TERMS", "TAX", "PRIVATE_STORAGE"]) {
    expect(QualificationVersionContentSchema.safeParse({ ...q, discipline }).success).toBe(true);
  }
  for (const provenance of ["LIVE", "DEVELOPMENT_FIXTURE"]) {
    expect(QualificationVersionContentSchema.safeParse({ ...q, provenance }).success).toBe(true);
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, provenance }).success).toBe(true);
  }
  const identity = { ...e, subject: natural, checkKind: "PERSON_IDENTITY" };
  expect(ReviewedPrincipalEvidenceContentSchema.parse(identity)).toEqual(identity);
  const representation = { ...e, subject: { ...natural, personIdentityEvidence: personPin }, checkKind: "REPRESENTATION", source: asset };
  expect(ReviewedPrincipalEvidenceContentSchema.parse(representation)).toEqual(representation);
  expect(ReviewedPrincipalEvidenceSchema.parse(evidenceVersion(representation)).sourceHash).toBe(canonicalHash(representation));
  // Asset custody may be the reviewer; independence binds people/subject, not
  // who uploaded the document. No bytes/storage readiness is asserted here.
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, source: asset }).success).toBe(true);
  const noClaims = { ...e, coverage: { declaredActivityKeys: [], marketCountryCodes: [], documentPins: [] },
    independence: { controllerUserId: null, operatorUserId: null } };
  expect(ReviewedPrincipalEvidenceContentSchema.parse(noClaims)).toEqual(noClaims);
  const reverse = Object.fromEntries(Object.entries(e).reverse());
  expect(ReviewedPrincipalEvidenceSchema.parse(evidenceVersion(reverse))).toEqual(ev);
});

it("subject/check/independence and strict bounded declarations reject wrong people, legacy aliases, duplicate scope and private/authority extras", () => {
  const q = qualification(), e = evidence(); expect(ReviewedPrincipalEvidenceContentSchema.parse(e)).toEqual(e);
  for (const checkKind of ["ENTITY_REGISTRATION", "ACTIVITY_PERMISSION", "CUSTOMER_TERMS", "SUPPLIER_TERMS", "TAX", "PRIVATE_STORAGE"]) {
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, checkKind }).success).toBe(true);
  }
  for (const checkKind of ["PERSON_IDENTITY", "REPRESENTATION"]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, checkKind }).success).toBe(false);
  for (const checkKind of ["ENTITY_REGISTRATION", "ACTIVITY_PERMISSION", "CUSTOMER_TERMS", "SUPPLIER_TERMS", "TAX", "PRIVATE_STORAGE"]) {
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, subject: natural, checkKind }).success).toBe(false);
  }
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, subject: natural, checkKind: "REPRESENTATION" }).success).toBe(false);
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, subject: { ...natural, personIdentityEvidence: personPin }, checkKind: "PERSON_IDENTITY" }).success).toBe(false);
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, subject: omitted(natural, "personIdentityEvidence"), checkKind: "PERSON_IDENTITY" }).success).toBe(false);
  for (const pin of [{ id: "identity-a" }, { ...personPin, sourceHash: "A".repeat(64) }, { ...personPin, revision: 0 }, { ...personPin, proof: "private" }]) {
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, subject: { ...natural, personIdentityEvidence: pin }, checkKind: "REPRESENTATION" }).success).toBe(false);
  }
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, subject: { ...natural, userId: e.reviewer.userId }, checkKind: "PERSON_IDENTITY" }).success).toBe(false);
  for (const field of ["controllerUserId", "operatorUserId"]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e,
    independence: { ...e.independence, [field]: e.reviewer.userId } }).success).toBe(false);
  const fifty = COUNTRY_CODES.slice(0, 50), activities = Array.from({ length: 50 }, (_, index) => `activity-${index}`);
  const six = documentKinds.map((kind, index) => ({ kind, versionId: `managed-document-${index}`, contentHash: sha(String(index)) }));
  expect(QualificationVersionContentSchema.safeParse({ ...q, jurisdictionCountryCodes: fifty }).success).toBe(true);
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, coverage: { declaredActivityKeys: activities, marketCountryCodes: fifty, documentPins: six } }).success).toBe(true);
  for (const codes of [[], ["SA", "SA"], ["ZZ"], ["sa"], COUNTRY_CODES.slice(0, 51)]) expect(QualificationVersionContentSchema.safeParse({ ...q, jurisdictionCountryCodes: codes }).success).toBe(false);
  for (const codes of [["SA", "SA"], ["ZZ"], ["sa"], COUNTRY_CODES.slice(0, 51)]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, coverage: { ...e.coverage, marketCountryCodes: codes } }).success).toBe(false);
  for (const keys of [["managed-campaigns", "managed-campaigns"], [...activities, "extra-activity"], ["1activity"], ["Activity"], ["activity--scope"], ["activity-"], ["activité"], ["a".repeat(101)]]) {
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, coverage: { ...e.coverage, declaredActivityKeys: keys } }).success).toBe(false);
  }
  for (const kind of ["GOVERNING_TERMS", "MARKET", "UNKNOWN", "MANAGED_CREATOR_TERMS"]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e,
    coverage: { ...e.coverage, documentPins: [{ ...e.coverage.documentPins[0], kind }] } }).success).toBe(false);
  const firstPin = e.coverage.documentPins[0]!;
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, coverage: { ...e.coverage, documentPins: [firstPin, { ...firstPin, versionId: "different-id" }] } }).success).toBe(false);
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, coverage: { ...e.coverage, documentPins: [...six, { ...six[0], versionId: "extra-document" }] } }).success).toBe(false);
  for (const purpose of ["LEGAL_POLICY_REVIEW", "REPRESENTATIVE", "OWNERSHIP_PROOF", "MARKETING_REFERENCE"]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, source: { ...asset, purpose } }).success).toBe(false);
  for (const path of [["evidenceId"], ["subject", "principalId"], ["subject", "principalVersionId"], ["reviewer", "userId"], ["reviewer", "qualificationVersionId"]]) {
    for (const id of ["", "has space", "اسم", "i".repeat(201), null]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse(replaced(e, path, id)).success).toBe(false);
  }
  for (const revision of [0, -1, 1.5, 2147483647, NaN, Infinity, "1", null]) {
    expect(QualificationVersionContentSchema.safeParse({ ...q, version: revision }).success).toBe(false);
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, reviewRevision: revision }).success).toBe(false);
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse(replaced(e, ["reviewer", "qualificationVersion"], revision)).success).toBe(false);
  }
  expect(QualificationVersionContentSchema.safeParse({ ...q, version: 2147483646 }).success).toBe(true);
  expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, reviewRevision: 2147483646 }).success).toBe(true);
  for (const addition of [{ actorUserId: "admin" }, { sessionId: "private" }, { readiness: "READY" }, { signing: true }, { supplierCost: "1" }, { storageKey: "private:proof" }]) {
    expect(QualificationVersionContentSchema.safeParse({ ...q, ...addition }).success).toBe(false);
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, ...addition }).success).toBe(false);
  }
  expect(QualificationVersionContentSchema.safeParse({ ...q, marketCountryCodes: ["SA"] }).success).toBe(false);
  for (const field of ["subject", "source", "reviewer", "coverage", "independence", "validity"]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e,
    [field]: { ...(e[field as keyof typeof e] as object), actorUserId: "injected" } }).success).toBe(false);
});

it("qualified/evidence chronology and hashes fail closed for expired approvals, contradictory identity/time metadata and recoverable oversize originals", () => {
  const q = qualification(), e = evidence(), qv = qualificationVersion(q), ev = evidenceVersion(e);
  expect(QualificationVersionSchema.parse(qv)).toEqual(qv); expect(ReviewedPrincipalEvidenceSchema.parse(ev)).toEqual(ev);
  expect(QualificationVersionSchema.safeParse({ ...qv, createdAt: q.authoritySource.observedAt }).success).toBe(true);
  expect(ReviewedPrincipalEvidenceSchema.safeParse({ ...ev, createdAt: e.reviewedAt }).success).toBe(true);
  expect(QualificationVersionSchema.safeParse({ ...qv, createdAt: "2026-09-30T23:59:59.999Z" }).success).toBe(false);
  expect(ReviewedPrincipalEvidenceSchema.safeParse({ ...ev, createdAt: "2026-10-07T01:59:59.999Z" }).success).toBe(false);
  const reversedReview = { ...e, reviewedAt: "2026-10-07T00:59:59.999Z" };
  expect(ReviewedPrincipalEvidenceSchema.safeParse(evidenceVersion(reversedReview)).success).toBe(false);
  for (const validityValue of [{ ...e.validity, recheckAt: e.reviewedAt }, { ...e.validity, recheckAt: "2026-10-06T23:59:59.999Z" },
    { ...e.validity, expiresAt: e.reviewedAt, recheckAt: e.reviewedAt }]) expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, validity: validityValue }).success).toBe(false);
  for (const decision of ["REJECTED", "NEEDS_RECHECK"]) {
    const historical = { ...e, decision, reviewedAt: "2028-01-01T00:00:00.000Z" };
    expect(ReviewedPrincipalEvidenceSchema.safeParse(evidenceVersion(historical, "2028-01-01T00:00:00.001Z")).success).toBe(true);
  }
  const pastApproval = { ...e, reviewedAt: "2028-01-01T00:00:00.000Z" };
  expect(ReviewedPrincipalEvidenceSchema.safeParse(evidenceVersion(pastApproval, "2028-01-01T00:00:00.001Z")).success).toBe(false);
  const early = { ...q, authoritySource: { ...q.authoritySource, observedAt: "0001-01-01T00:00:00.000Z" } };
  expect(QualificationVersionSchema.safeParse(qualificationVersion(early, "9999-12-31T23:59:59.999Z")).success).toBe(true);
  for (const instant of ["0000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", "2023-02-29T00:00:00.000Z", "2026-10-07T03:00:00.000+03:00", "bad", null]) {
    expect(QualificationVersionSchema.safeParse({ ...qv, createdAt: instant }).success).toBe(false);
    expect(ReviewedPrincipalEvidenceSchema.safeParse({ ...ev, createdAt: instant }).success).toBe(false);
    expect(ReviewedPrincipalEvidenceContentSchema.safeParse({ ...e, observedAt: instant }).success).toBe(false);
  }
  for (const hash of ["A".repeat(64), "a".repeat(63), "g".repeat(64), "0".repeat(64), null]) {
    expect(QualificationVersionSchema.safeParse({ ...qv, sourceHash: hash }).success).toBe(false);
    expect(ReviewedPrincipalEvidenceSchema.safeParse({ ...ev, sourceHash: hash }).success).toBe(false);
  }
  expect(QualificationVersionSchema.safeParse({ ...qv, version: 2 }).success).toBe(false);
  expect(ReviewedPrincipalEvidenceSchema.safeParse({ ...ev, reviewRevision: 2 }).success).toBe(false);
  const { sourceHash: _qh, ...qMetadata } = qv, { sourceHash: _eh, ...eMetadata } = ev; void _qh; void _eh;
  expect(QualificationVersionSchema.safeParse({ ...qv, sourceHash: canonicalHash(qMetadata) }).success).toBe(false);
  expect(ReviewedPrincipalEvidenceSchema.safeParse({ ...ev, sourceHash: canonicalHash(eMetadata) }).success).toBe(false);
  for (const text of ["", " \t\r\n ", "unsafe\u0000original", "ع".repeat(2001), "x".repeat(1_100_000)]) {
    const badQualification = replaced(qv, ["authoritySource", "referenceOriginal", "text"], text);
    const badEvidence = replaced(ev, ["source", "referenceOriginal", "text"], text);
    expect(() => QualificationVersionSchema.safeParse(badQualification)).not.toThrow();
    expect(QualificationVersionSchema.safeParse(badQualification).success).toBe(false);
    expect(() => ReviewedPrincipalEvidenceSchema.safeParse(badEvidence)).not.toThrow();
    expect(ReviewedPrincipalEvidenceSchema.safeParse(badEvidence).success).toBe(false);
  }
  const atBound = "ع".repeat(2000), qBound = replaced(q, ["authoritySource", "referenceOriginal", "text"], atBound), eBound = replaced(e, ["source", "referenceOriginal", "text"], atBound);
  expect(QualificationVersionContentSchema.safeParse(qBound).success).toBe(true); expect(ReviewedPrincipalEvidenceContentSchema.safeParse(eBound).success).toBe(true);
  expect(ReviewedPrincipalEvidenceSchema.safeParse({ ...ev, currentClock: ev.createdAt }).success).toBe(false);
});
