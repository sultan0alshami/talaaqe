import { expect, it } from "vitest";
import {
  LegacyDirectAdmissionContentSchema,
  LegacyDirectAdmissionVersionSchema,
} from "@/lib/deals/legacy-admission-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";

// ONE pure declaration group. Synthetic pins confer no native authority or
// producer-payload proof. Retain stored keys exactly; no aliases or rewriting.
// Root adopts after the frozen history checkpoint, then runs behavioral RED.
const hash = (letter: string) => letter.repeat(64);
function fresh(operationKey = "create:original_campaign-1") {
  return {
    schemaVersion: 1 as const, admissionId: "admission~fresh:1", provenance: "DEVELOPMENT_FIXTURE" as const,
    version: 1, capability: "FRESH_PINNED_SCOPE" as const,
    subject: { campaignId: "campaign~original", brandId: "brand~original", brandUserId: "brand-user~original",
      creatorId: "creator~original", creatorUserId: "creator-user~original" },
    approvedBrief: { id: "brief~original:1", version: 1, inputRevision: 1, approvedByUserId: "brand-user~original", contentHash: hash("a") },
    validity: { validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", recheckAt: "2026-12-31T23:59:59.999Z" },
    manifest: { id: "manifest~reviewed:1", entryId: "entry~fresh:1" },
    source: { kind: "CAMPAIGN_COMMAND" as const, id: "campaign-command~original", actorUserId: "brand-user~original",
      operationKey, payloadHash: hash("b"), resultHash: hash("c") },
  };
}
function continuation(operationKey = "original_deal-1") {
  const base = fresh();
  return { ...base, admissionId: "admission~continuation:1", capability: "CONTINUE_PINNED_DEAL" as const,
    manifest: { ...base.manifest, entryId: "entry~continuation:1" },
    source: { ...base.source, kind: "DEAL_COMMAND" as const, id: "deal-command~original", operationKey },
    existingDeal: { id: "deal~original", sourceHash: hash("d"), firstOffer: { id: "offer~original:1", version: 1 as const,
      proposerUserId: base.subject.brandUserId, recipientUserId: base.subject.creatorUserId, contentHash: hash("e") } } };
}
function retained<T extends object>(content: T) {
  return { ...content, id: "admission-version~1", sourceHash: canonicalHash(content), createdAt: "2026-10-08T00:00:00.000Z" };
}

it("preserves exact CREATE campaign receipt keys through127 and unchanged deal-command keys through120", () => {
  const campaignKeys = ["create:A", "create:_", "create:-", "create::", "create:AZ_09-:az", "create:create:A",
    ...Array.from({ length: 7 }, (_, index) => `create:${"A".repeat(114 + index)}`)];
  for (const operationKey of campaignKeys) {
    const content = fresh(operationKey), before = structuredClone(content);
    expect(operationKey.length).toBeGreaterThanOrEqual(8);
    expect(operationKey.length).toBeLessThanOrEqual(127);
    const parsed = LegacyDirectAdmissionContentSchema.parse(content);
    expect(parsed).toEqual(before);
    expect(parsed.source.operationKey).toBe(operationKey);
    expect(content).toEqual(before);
    const version = retained(content);
    expect(LegacyDirectAdmissionVersionSchema.parse(version)).toEqual(version);
    expect(canonicalHash(parsed)).toBe(version.sourceHash);
    expect(parsed.source.payloadHash).toBe(content.source.payloadHash);
    expect(parsed.source.resultHash).toBe(content.source.resultHash);
  }
  expect(campaignKeys.slice(-7).map(key => key.length)).toEqual([121, 122, 123, 124, 125, 126, 127]);
  for (const operationKey of ["", "create:", `create:${"A".repeat(121)}`, "createA", "CREATE:A", "update:A", "xcreate:A",
    "create:a b", "create:a/b", "create:a.b", "create:é", "create:a\tb", "create:a\nb",
    "create:A\n", "create:A\r\n", "create:A\r", "create:A\u2028", "create:A\u2029"]) {
    expect(LegacyDirectAdmissionContentSchema.safeParse(fresh(operationKey)).success).toBe(false);
    expect(LegacyDirectAdmissionVersionSchema.safeParse(retained(fresh(operationKey))).success).toBe(false);
  }

  for (const operationKey of ["A", "_", "-", ":", "AZ_09-:az", "create:create:A", "A".repeat(120)]) {
    const content = continuation(operationKey), before = structuredClone(content);
    expect(LegacyDirectAdmissionContentSchema.parse(content)).toEqual(before);
    expect(LegacyDirectAdmissionVersionSchema.parse(retained(content))).toEqual(retained(content));
    expect(content.source.operationKey).toBe(operationKey);
    expect(content).toEqual(before);
  }
  for (const operationKey of ["", "A".repeat(121), "A".repeat(128), "a b", "a/b", "a.b", "é", "a\tb", "a\nb"]) {
    expect(LegacyDirectAdmissionContentSchema.safeParse(continuation(operationKey)).success).toBe(false);
    expect(LegacyDirectAdmissionVersionSchema.safeParse(retained(continuation(operationKey))).success).toBe(false);
  }

  // Each exact stored string participates in the existing content codec. A
  // changed valid suffix with the old digest must fail; do not strip create:.
  const original = fresh(`create:${"A".repeat(120)}`), version = retained(original);
  const changed = { ...original, source: { ...original.source, operationKey: `create:${"A".repeat(119)}B` } };
  expect(canonicalHash(changed)).not.toBe(version.sourceHash);
  expect(LegacyDirectAdmissionVersionSchema.safeParse({ ...version, source: changed.source }).success).toBe(false);
  expect(LegacyDirectAdmissionVersionSchema.parse(retained(changed))).toEqual(retained(changed));
  const nested = fresh("create:create:A"), single = fresh("create:A");
  expect(canonicalHash(nested)).not.toBe(canonicalHash(single));
  expect(LegacyDirectAdmissionContentSchema.parse(nested).source.operationKey).toBe("create:create:A");
  const plainDeal = continuation("A"), prefixedDeal = continuation("create:A");
  expect(canonicalHash(plainDeal)).not.toBe(canonicalHash(prefixedDeal));

  // The source-kind length distinction adds no creator receipt authority.
  for (const content of [fresh("create:A"), continuation("A")]) {
    expect(content.source.actorUserId).toBe(content.subject.brandUserId);
    const creatorReceipt = { ...content, source: { ...content.source, actorUserId: content.subject.creatorUserId } };
    expect(LegacyDirectAdmissionContentSchema.safeParse(creatorReceipt).success).toBe(false);
    expect(LegacyDirectAdmissionVersionSchema.safeParse(retained(creatorReceipt)).success).toBe(false);
    const wrongKind = { ...content, source: { ...content.source,
      kind: content.source.kind === "CAMPAIGN_COMMAND" ? "DEAL_COMMAND" : "CAMPAIGN_COMMAND" } };
    expect(LegacyDirectAdmissionContentSchema.safeParse(wrongKind).success).toBe(false);
  }
});
