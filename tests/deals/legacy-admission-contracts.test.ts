import { expect, it } from "vitest";
import {
  LegacyDirectAdmissionContentSchema,
  LegacyDirectAdmissionVersionSchema,
  LegacyDirectAdmissionStateSchema,
  LegacyDirectAdmissionManifestContentSchema,
  LegacyDirectAdmissionManifestSchema,
} from "@/lib/deals/legacy-admission-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";

// Exactly four PURE groups against the declaration freeze. All subjects, source
// pins and references below are synthetic declarations. LIVE/ACTIVE labels,
// matching hashes and an envelope link prove no native history, controlled
// allowlist, current session, legal review, production admission or capability.
// No mocks, Date replacement, SQL, native rows, service/fixture import or bypass.
// Root adopts only after the five named exports exist; a module error is not RED.
const hash = (letter: string) => letter.repeat(64);
const originalReference = { text: "  مرجع اختبار أصلي\nOriginal admission reference\t  ", language: "ar" };
function fresh() {
  return {
    schemaVersion: 1 as const, admissionId: "admission~fresh:1", provenance: "DEVELOPMENT_FIXTURE" as const,
    version: 1, capability: "FRESH_PINNED_SCOPE" as const,
    subject: { campaignId: "campaign~original", brandId: "brand~original", brandUserId: "brand-user~original",
      creatorId: "creator~original", creatorUserId: "creator-user~original" },
    approvedBrief: { id: "brief~original:1", version: 1, inputRevision: 1, approvedByUserId: "brand-user~original", contentHash: hash("a") },
    validity: { validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", recheckAt: "2026-12-31T23:59:59.999Z" },
    manifest: { id: "manifest~reviewed:1", entryId: "entry~fresh:1" },
    source: { kind: "CAMPAIGN_COMMAND" as const, id: "campaign-command~original", actorUserId: "brand-user~original",
      operationKey: "create:original_campaign-1", payloadHash: hash("b"), resultHash: hash("c") },
  };
}
function continuation() {
  const base = fresh();
  return { ...base, admissionId: "admission~continuation:1", capability: "CONTINUE_PINNED_DEAL" as const,
    manifest: { ...base.manifest, entryId: "entry~continuation:1" },
    source: { ...base.source, kind: "DEAL_COMMAND" as const, id: "deal-command~original" },
    existingDeal: { id: "deal~original", sourceHash: hash("d"), firstOffer: { id: "offer~original:1", version: 1 as const,
      proposerUserId: base.subject.brandUserId, recipientUserId: base.subject.creatorUserId, contentHash: hash("e") } } };
}
type Content = ReturnType<typeof fresh> | ReturnType<typeof continuation>;
function retained(content: unknown = fresh(), id = "admission-version~1", createdAt = "2026-10-08T00:00:00.000Z") {
  return { ...(content as Record<string, unknown>), id, sourceHash: canonicalHash(content), createdAt };
}
function state() {
  return { admissionId: fresh().admissionId, revision: 1, state: "DRAFT" as const, currentVersion: null,
    createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" };
}
function manifestContent(contents: Content[] = [fresh(), continuation()]) {
  return { schemaVersion: 1 as const, manifestId: "manifest~reviewed:1", provenance: "DEVELOPMENT_FIXTURE" as const,
    createdAt: "2026-10-08T00:00:00.000Z", reviewReferenceOriginal: { ...originalReference },
    entries: contents.map(content => ({ entryId: content.manifest.entryId, admissionId: content.admissionId,
      version: content.version, sourceHash: canonicalHash(content) })) };
}
function manifest(content = manifestContent()) { return { ...content, sourceHash: canonicalHash(content) }; }
function replaced(input: unknown, path: string[], value: unknown) {
  const result = structuredClone(input) as Record<string, unknown>;
  let parent = result;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path.at(-1)!] = value;
  return result;
}
function without(input: unknown, key: string) {
  const result = structuredClone(input) as Record<string, unknown>;
  delete result[key];
  return result;
}

it("strict FRESH and CONTINUE declarations retain exact original subjects, brief/source pins and first-offer parties", () => {
  for (const content of [fresh(), continuation()]) {
    const before = structuredClone(content);
    expect(LegacyDirectAdmissionContentSchema.parse(content)).toEqual(content);
    expect(content).toEqual(before);
    expect(LegacyDirectAdmissionVersionSchema.parse(retained(content))).toEqual(retained(content));
    for (const field of ["schemaVersion", "admissionId", "provenance", "version", "capability", "subject", "approvedBrief", "validity", "manifest", "source"]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse(without(content, field)).success).toBe(false);
    }
    for (const subject of [without(content.subject, "creatorId"), { ...content.subject, creatorId: null },
      { ...content.subject, creatorUserId: content.subject.brandUserId }, { ...content.subject, currentOwnerUserId: "replacement-owner" }]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, subject }).success).toBe(false);
    }
    // Central printable IDs include literal '*'. Preserve it as an exact ID,
    // never a glob; this declaration proves no actual native row or authority.
    for (const field of ["campaignId", "creatorId"]) {
      const literalStar = { ...content, subject: { ...content.subject, [field]: "*" } };
      expect(LegacyDirectAdmissionContentSchema.parse(literalStar)).toEqual(literalStar);
      expect(LegacyDirectAdmissionVersionSchema.parse(retained(literalStar)).sourceHash).toBe(canonicalHash(literalStar));
    }
    for (const addition of [{ actorUserId: "request-actor" }, { sessionId: "session-alias" }, { sessionVersion: 1 },
      { currentProfile: { ownerUserId: "replacement-owner" } }, { sourceText: "private source words" }, { creatorIds: ["*"] },
      { bindingAbsent: true }, { cutoverAt: "2026-10-08T00:00:00.000Z" }, { granted: true }]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, ...addition }).success).toBe(false);
    }
    for (const field of ["id", "version", "inputRevision", "approvedByUserId", "contentHash"]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, approvedBrief: without(content.approvedBrief, field) }).success).toBe(false);
    }
    expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, ["approvedBrief", "approvedByUserId"], content.subject.creatorUserId)).success).toBe(false);
    expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, ["source", "actorUserId"], content.subject.creatorUserId)).success).toBe(false);
    for (const field of ["kind", "id", "actorUserId", "operationKey", "payloadHash", "resultHash"]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, source: without(content.source, field) }).success).toBe(false);
    }
    for (const addition of [{ action: "CREATE" }, { role: "BRAND" }, { createdAt: "2026-10-08T00:00:00.000Z" },
      { body: { privateText: "not a declaration field" } }, { approved: true }]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, source: { ...content.source, ...addition } }).success).toBe(false);
    }
    for (const operationKey of ["", "with space", "key~alias", "اسم", "key\nline", "k".repeat(121), null, 1]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, ["source", "operationKey"], operationKey)).success).toBe(false);
    }
    const maximalOperationKey = content.capability === "FRESH_PINNED_SCOPE" ? `create:${"k".repeat(120)}` : "k".repeat(120);
    expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, ["source", "operationKey"], maximalOperationKey)).success).toBe(true);
    if (content.capability === "FRESH_PINNED_SCOPE") {
      expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, ["source", "operationKey"], `create:${"k".repeat(121)}`)).success).toBe(false);
    }
    for (const path of [["admissionId"], ["subject", "campaignId"], ["subject", "brandId"], ["subject", "brandUserId"],
      ["subject", "creatorId"], ["subject", "creatorUserId"], ["approvedBrief", "id"], ["source", "id"],
      ["manifest", "id"], ["manifest", "entryId"]]) {
      for (const id of ["", "with space", "line\nbreak", "اسم", "i".repeat(201), null, 1]) {
        expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, path, id)).success).toBe(false);
      }
    }
    expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, ["subject", "campaignId"], "i".repeat(200))).success).toBe(true);
    for (const path of [["version"], ["approvedBrief", "version"], ["approvedBrief", "inputRevision"]]) {
      for (const revision of [0, -1, 1.5, 2147483647, NaN, Infinity, "1", null]) {
        expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, path, revision)).success).toBe(false);
      }
      expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, path, 2147483646)).success).toBe(true);
    }
    for (const path of [["approvedBrief", "contentHash"], ["source", "payloadHash"], ["source", "resultHash"]]) {
      for (const pin of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), null, 1]) {
        expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, path, pin)).success).toBe(false);
      }
      // A valid hash-shaped reference is a declaration, not actual producer proof.
      expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, path, hash("0"))).success).toBe(true);
    }
  }
  const f = fresh(), c = continuation();
  expect(LegacyDirectAdmissionContentSchema.safeParse({ ...f, existingDeal: c.existingDeal }).success).toBe(false);
  expect(LegacyDirectAdmissionContentSchema.safeParse({ ...f, source: c.source }).success).toBe(false);
  expect(LegacyDirectAdmissionContentSchema.safeParse({ ...c, source: f.source }).success).toBe(false);
  for (const capability of ["READ_CAMPAIGN", "FRESH", "CONTINUE", "fresh_pinned_scope", null]) {
    expect(LegacyDirectAdmissionContentSchema.safeParse({ ...f, capability }).success).toBe(false);
  }
  expect(LegacyDirectAdmissionContentSchema.safeParse(without(c, "existingDeal")).success).toBe(false);
  expect(LegacyDirectAdmissionContentSchema.safeParse({ ...c, existingDeal: null }).success).toBe(false);
  for (const firstOffer of [{ ...c.existingDeal.firstOffer, version: 2 }, { ...c.existingDeal.firstOffer, version: 0 },
    { ...c.existingDeal.firstOffer, proposerUserId: c.subject.creatorUserId },
    { ...c.existingDeal.firstOffer, recipientUserId: c.subject.brandUserId },
    { ...c.existingDeal.firstOffer, status: "PENDING" }, { ...c.existingDeal.firstOffer, acceptedAt: "2026-10-08T00:00:00.000Z" }]) {
    expect(LegacyDirectAdmissionContentSchema.safeParse({ ...c, existingDeal: { ...c.existingDeal, firstOffer } }).success).toBe(false);
  }
  for (const path of [["existingDeal", "sourceHash"], ["existingDeal", "firstOffer", "contentHash"]]) {
    expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(c, path, "A".repeat(64))).success).toBe(false);
  }
  for (const field of ["id", "sourceHash", "firstOffer"]) {
    expect(LegacyDirectAdmissionContentSchema.safeParse({ ...c, existingDeal: without(c.existingDeal, field) }).success).toBe(false);
  }
});

it("supported declared UTC validity and strict current labels do not consult a clock or establish native authority", () => {
  const f = fresh(), c = continuation();
  for (const content of [f, c]) {
    for (const provenance of ["LIVE", "DEVELOPMENT_FIXTURE"]) {
      expect(LegacyDirectAdmissionContentSchema.parse({ ...content, provenance })).toEqual({ ...content, provenance });
    }
    for (const provenance of ["FIXTURE", "CONTROLLED", "live", "UNKNOWN", null]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, provenance }).success).toBe(false);
    }
    expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, validity: { ...content.validity, expiresAt: null } }).success).toBe(true);
    expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, validity: { ...content.validity, recheckAt: content.validity.expiresAt } }).success).toBe(true);
    for (const validity of [{ ...content.validity, recheckAt: content.validity.validFrom },
      { ...content.validity, recheckAt: "2025-12-31T23:59:59.999Z" },
      { ...content.validity, expiresAt: content.validity.validFrom }, { ...content.validity, expiresAt: "2025-12-31T23:59:59.999Z" },
      { ...content.validity, recheckAt: "2027-01-01T00:00:00.001Z" }]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, validity }).success).toBe(false);
    }
    for (const field of ["validFrom", "expiresAt", "recheckAt"]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, validity: without(content.validity, field) }).success).toBe(false);
      for (const instant of ["0000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", "2026-02-29T00:00:00.000Z",
        "2026-10-08T03:00:00.000+03:00", "2026-10-08T00:00:00.000+00:00", "2026-10-08", "bad", 1]) {
        expect(LegacyDirectAdmissionContentSchema.safeParse(replaced(content, ["validity", field], instant)).success).toBe(false);
      }
    }
    // Both reviewed future validity and an already elapsed declaration are shape
    // valid. Actual current admission/expiry is a subsequent native boundary.
    for (const validity of [
      { validFrom: "9000-01-01T00:00:00.000Z", recheckAt: "9999-12-31T23:59:59.999Z", expiresAt: null },
      { validFrom: "0001-01-01T00:00:00.000Z", recheckAt: "2000-01-01T00:00:00.000Z", expiresAt: "2001-01-01T00:00:00.000Z" },
    ]) expect(LegacyDirectAdmissionVersionSchema.safeParse(retained({ ...content, validity })).success).toBe(true);
    for (const addition of [{ currentTime: content.validity.validFrom }, { trusted: true }, { testMode: true }, { qualifiedReviewer: "admin" }]) {
      expect(LegacyDirectAdmissionContentSchema.safeParse({ ...content, ...addition }).success).toBe(false);
    }
  }
  const draft = state(), saved = retained(f), pointer = { id: saved.id, version: f.version, sourceHash: saved.sourceHash };
  expect(LegacyDirectAdmissionStateSchema.parse(draft)).toEqual(draft);
  for (const state of ["ACTIVE", "PAUSED", "REVOKED"]) {
    const value = { ...draft, state, currentVersion: pointer };
    expect(LegacyDirectAdmissionStateSchema.parse(value)).toEqual(value);
  }
  expect(LegacyDirectAdmissionStateSchema.parse({ ...draft, state: "REVOKED" }).currentVersion).toBeNull();
  expect(LegacyDirectAdmissionStateSchema.safeParse({ ...draft, currentVersion: pointer }).success).toBe(false);
  for (const state of ["ACTIVE", "PAUSED"]) expect(LegacyDirectAdmissionStateSchema.safeParse({ ...draft, state }).success).toBe(false);
  for (const state of ["APPROVED", "AVAILABLE", "active", null]) expect(LegacyDirectAdmissionStateSchema.safeParse({ ...draft, state }).success).toBe(false);
  const active = { ...draft, state: "ACTIVE", currentVersion: pointer };
  for (const currentVersion of [{ id: saved.id }, { ...pointer, version: 0 }, { ...pointer, version: 2147483647 },
    { ...pointer, sourceHash: "A".repeat(64) }, { ...pointer, admissionId: draft.admissionId }, { ...pointer, trusted: true }]) {
    expect(LegacyDirectAdmissionStateSchema.safeParse({ ...active, currentVersion }).success).toBe(false);
  }
  expect(LegacyDirectAdmissionStateSchema.safeParse({ ...draft, updatedAt: "2026-10-07T23:59:59.999Z" }).success).toBe(false);
  expect(LegacyDirectAdmissionStateSchema.safeParse({ ...draft, createdAt: "0001-01-01T00:00:00.000Z", updatedAt: "9999-12-31T23:59:59.999Z" }).success).toBe(true);
  for (const revision of [0, -1, 1.5, 2147483647, NaN, Infinity, "1", null]) {
    expect(LegacyDirectAdmissionStateSchema.safeParse({ ...draft, revision }).success).toBe(false);
  }
  for (const addition of [{ provenance: "LIVE" }, { capability: "FRESH_PINNED_SCOPE" }, { currentTime: draft.updatedAt },
    { grantsAdmission: true }, { sessionId: "not a state field" }]) {
    expect(LegacyDirectAdmissionStateSchema.safeParse({ ...active, ...addition }).success).toBe(false);
  }
});

it("admission hashes include exact validated content, exclude retained storage metadata and fail bounded validation safely", () => {
  for (const content of [fresh(), continuation()]) {
    const saved = retained(content), before = structuredClone(content);
    expect(LegacyDirectAdmissionVersionSchema.parse(saved).sourceHash).toBe(canonicalHash(content));
    expect(content).toEqual(before);
    expect(LegacyDirectAdmissionVersionSchema.parse({ ...saved, id: "another-storage-id", createdAt: "0001-01-01T00:00:00.000Z" }).sourceHash).toBe(saved.sourceHash);
    expect(LegacyDirectAdmissionVersionSchema.parse({ ...saved, createdAt: "9999-12-31T23:59:59.999Z" }).sourceHash).toBe(saved.sourceHash);
    const reverseKeys = Object.fromEntries(Object.entries(content).reverse());
    expect(canonicalHash(reverseKeys)).toBe(saved.sourceHash);
    expect(LegacyDirectAdmissionVersionSchema.parse({ ...reverseKeys, id: saved.id, createdAt: saved.createdAt, sourceHash: saved.sourceHash })).toEqual(saved);
    for (const changed of [{ ...content, version: 2 }, { ...content, provenance: "LIVE" },
      replaced(content, ["approvedBrief", "contentHash"], hash("f")), replaced(content, ["source", "operationKey"], content.capability === "FRESH_PINNED_SCOPE" ? "create:changed-source-key" : "changed-source-key"),
      replaced(content, ["source", "payloadHash"], hash("f")), replaced(content, ["source", "resultHash"], hash("f")),
      replaced(content, ["manifest", "entryId"], "another-entry"), replaced(content, ["subject", "creatorId"], "another-exact-creator")]) {
      expect(LegacyDirectAdmissionVersionSchema.safeParse({ ...saved, ...changed }).success).toBe(false);
      const rehashed = retained(changed);
      expect(rehashed.sourceHash).not.toBe(saved.sourceHash);
      expect(LegacyDirectAdmissionVersionSchema.safeParse(rehashed).success).toBe(true);
    }
    const { sourceHash: _hash, ...withStorage } = saved; void _hash;
    expect(LegacyDirectAdmissionVersionSchema.safeParse({ ...saved, sourceHash: canonicalHash(withStorage) }).success).toBe(false);
    for (const sourceHash of [hash("0"), "A".repeat(64), "a".repeat(63), "g".repeat(64), null]) {
      expect(LegacyDirectAdmissionVersionSchema.safeParse({ ...saved, sourceHash }).success).toBe(false);
    }
    for (const field of ["id", "sourceHash", "createdAt"]) expect(LegacyDirectAdmissionVersionSchema.safeParse(without(saved, field)).success).toBe(false);
    for (const addition of [{ state: "ACTIVE" }, { content }, { nativeProof: true }, { allowlisted: true }]) {
      expect(LegacyDirectAdmissionVersionSchema.safeParse({ ...saved, ...addition }).success).toBe(false);
    }
    // Legitimate IDs/fields are tightly bounded; do not invent a padding field
    // merely to reach 131072. Exercise maximal valid fields and malformed huge
    // existing fields, including beyond the canonical codec's own 524288 limit.
    const maximal = replaced(content, ["subject", "campaignId"], "i".repeat(200));
    expect(Buffer.byteLength(JSON.stringify(maximal), "utf8")).toBeLessThanOrEqual(131072);
    expect(LegacyDirectAdmissionContentSchema.safeParse(maximal).success).toBe(true);
    for (const size of [131073, 524289, 1_100_000]) {
      const oversizedContent = replaced(content, ["subject", "campaignId"], "x".repeat(size));
      const oversizedVersion = { ...saved, ...oversizedContent };
      expect(() => LegacyDirectAdmissionContentSchema.safeParse(oversizedContent)).not.toThrow();
      expect(LegacyDirectAdmissionContentSchema.safeParse(oversizedContent).success).toBe(false);
      expect(() => LegacyDirectAdmissionVersionSchema.safeParse(oversizedVersion)).not.toThrow();
      expect(LegacyDirectAdmissionVersionSchema.safeParse(oversizedVersion).success).toBe(false);
    }
  }
  const c = continuation(), saved = retained(c);
  for (const path of [["existingDeal", "sourceHash"], ["existingDeal", "firstOffer", "contentHash"]]) {
    const changed = replaced(c, path, hash("f"));
    expect(LegacyDirectAdmissionVersionSchema.safeParse({ ...saved, ...changed }).success).toBe(false);
    expect(LegacyDirectAdmissionVersionSchema.safeParse(retained(changed)).success).toBe(true);
  }
});

it("strict manifest entries preserve originals/order, reject duplicates and pin changed admission content without a hash cycle", () => {
  const f = fresh(), c = continuation(), source = manifestContent([f, c]), before = structuredClone(source), saved = manifest(source);
  expect(LegacyDirectAdmissionManifestContentSchema.parse(source)).toEqual(source);
  expect(LegacyDirectAdmissionManifestSchema.parse(saved)).toEqual(saved);
  expect(source).toEqual(before);
  expect(LegacyDirectAdmissionManifestSchema.parse(saved).reviewReferenceOriginal.text).toBe(originalReference.text);
  expect(saved.sourceHash).toBe(canonicalHash(source));
  expect(LegacyDirectAdmissionManifestContentSchema.parse(source).entries).toEqual(source.entries);
  for (const content of [f, c]) {
    const entry = source.entries.find(entry => entry.entryId === content.manifest.entryId)!;
    expect(content.manifest.id).toBe(source.manifestId);
    expect(entry.admissionId).toBe(content.admissionId);
    expect(entry.version).toBe(content.version);
    expect(entry.sourceHash).toBe(retained(content).sourceHash);
  }
  // Scalar linkage is declared, not a native lookup or trusted allowlist check.
  expect(LegacyDirectAdmissionContentSchema.safeParse({ ...f, manifest: { ...f.manifest, sourceHash: saved.sourceHash } }).success).toBe(false);
  expect(LegacyDirectAdmissionContentSchema.safeParse({ ...f, manifest: { ...f.manifest, entryHash: source.entries[0].sourceHash } }).success).toBe(false);
  const reversed = { ...source, entries: [...source.entries].reverse() };
  expect(canonicalHash(reversed)).not.toBe(saved.sourceHash);
  expect(LegacyDirectAdmissionManifestSchema.safeParse({ ...saved, entries: reversed.entries }).success).toBe(false);
  expect(LegacyDirectAdmissionManifestSchema.parse(manifest(reversed)).entries).toEqual(reversed.entries);
  const trimmed = { ...source, reviewReferenceOriginal: { ...source.reviewReferenceOriginal, text: source.reviewReferenceOriginal.text.trim() } };
  expect(canonicalHash(trimmed)).not.toBe(saved.sourceHash);
  expect(LegacyDirectAdmissionManifestSchema.safeParse({ ...saved, reviewReferenceOriginal: trimmed.reviewReferenceOriginal }).success).toBe(false);
  expect(LegacyDirectAdmissionManifestSchema.parse(manifest(trimmed)).reviewReferenceOriginal.text).toBe(trimmed.reviewReferenceOriginal.text);
  expect(LegacyDirectAdmissionManifestSchema.safeParse({ ...saved, createdAt: "2026-10-08T00:00:00.001Z" }).success).toBe(false);
  const changed = { ...f, source: { ...f.source, payloadHash: hash("f") } }, changedVersion = retained(changed);
  expect(changedVersion.sourceHash).not.toBe(source.entries[0].sourceHash);
  expect(LegacyDirectAdmissionVersionSchema.safeParse({ ...retained(f), source: changed.source }).success).toBe(false);
  const changedManifestContent = { ...source, entries: source.entries.map((entry, index) => index === 0 ? { ...entry, sourceHash: changedVersion.sourceHash } : entry) };
  expect(LegacyDirectAdmissionManifestSchema.safeParse({ ...saved, entries: changedManifestContent.entries }).success).toBe(false);
  expect(LegacyDirectAdmissionManifestSchema.parse(manifest(changedManifestContent)).sourceHash).not.toBe(saved.sourceHash);
  const fifty = Array.from({ length: 50 }, (_, index) => ({ ...source.entries[0], entryId: `entry~${index}`, admissionId: `admission~${index}` }));
  const largestValid = { ...source, entries: fifty, reviewReferenceOriginal: { text: "ع".repeat(2000), language: "ar" } };
  expect(Buffer.byteLength(JSON.stringify(largestValid), "utf8")).toBeLessThanOrEqual(131072);
  expect(LegacyDirectAdmissionManifestContentSchema.safeParse(largestValid).success).toBe(true);
  expect(LegacyDirectAdmissionManifestSchema.safeParse(manifest(largestValid)).success).toBe(true);
  for (const entries of [[], null, [...fifty, { ...fifty[0], entryId: "entry~extra", admissionId: "admission~extra" }],
    [source.entries[0], { ...source.entries[1], entryId: source.entries[0].entryId }],
    [source.entries[0], { ...source.entries[1], admissionId: source.entries[0].admissionId, version: source.entries[0].version }]]) {
    expect(LegacyDirectAdmissionManifestContentSchema.safeParse({ ...source, entries }).success).toBe(false);
  }
  expect(LegacyDirectAdmissionManifestContentSchema.safeParse({ ...source, entries: [source.entries[0], { ...source.entries[0], entryId: "entry~version2", version: 2 }] }).success).toBe(true);
  for (const entry of [{ ...source.entries[0], actorUserId: "injected" }, { ...source.entries[0], sourceHash: "A".repeat(64) },
    { ...source.entries[0], version: 0 }, { ...source.entries[0], entryId: " " }, without(source.entries[0], "sourceHash")]) {
    expect(LegacyDirectAdmissionManifestContentSchema.safeParse({ ...source, entries: [entry] }).success).toBe(false);
  }
  for (const text of ["", " \t\r\n ", "unsafe\u0000reference", "unsafe\u007freference", "ع".repeat(2001), "x".repeat(1_100_000)]) {
    const invalidContent = replaced(source, ["reviewReferenceOriginal", "text"], text);
    const invalidManifest = { ...saved, ...invalidContent };
    expect(() => LegacyDirectAdmissionManifestContentSchema.safeParse(invalidContent)).not.toThrow();
    expect(LegacyDirectAdmissionManifestContentSchema.safeParse(invalidContent).success).toBe(false);
    expect(() => LegacyDirectAdmissionManifestSchema.safeParse(invalidManifest)).not.toThrow();
    expect(LegacyDirectAdmissionManifestSchema.safeParse(invalidManifest).success).toBe(false);
  }
  for (const addition of [{ trusted: true }, { allowlistDigest: saved.sourceHash }, { actorUserId: "admin" },
    { entriesByCampaign: true }, { currentTime: source.createdAt }, { admissionContents: [f, c] }]) {
    expect(LegacyDirectAdmissionManifestContentSchema.safeParse({ ...source, ...addition }).success).toBe(false);
    expect(LegacyDirectAdmissionManifestSchema.safeParse({ ...saved, ...addition }).success).toBe(false);
  }
  for (const field of ["schemaVersion", "manifestId", "provenance", "createdAt", "reviewReferenceOriginal", "entries"]) {
    expect(LegacyDirectAdmissionManifestContentSchema.safeParse(without(source, field)).success).toBe(false);
  }
  expect(LegacyDirectAdmissionManifestSchema.safeParse(without(saved, "sourceHash")).success).toBe(false);
  // Rehashing a changed envelope is structurally valid but changes the externally
  // allowlisted digest. These five pure schemas deliberately grant no authority.
});
