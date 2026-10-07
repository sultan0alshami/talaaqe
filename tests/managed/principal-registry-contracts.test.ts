import { expect, it } from "vitest";
import { PrincipalVersionContentSchema, PrincipalVersionSchema, PrincipalStateSchema } from "@/lib/managed/principal-registry-contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { COUNTRY_CODES } from "@/lib/contracts/vocabulary";

// Exactly three pure groups. These synthetic declarations/hash pins establish
// no registered entity, native row/lifecycle, qualified review, current authority,
// signing or live readiness. Root alone adopts/runs this draft; no mocks/DB.
function content() {
  return { schemaVersion: 1 as const, principalId: "principal:a", provenance: "DEVELOPMENT_FIXTURE" as const, version: 1,
    party: { legalNameOriginal: { text: "  إنفيم أصلية / Original legal name\t  ", language: "ar" }, tradingNameOriginal: null,
      legalFormOriginal: { text: "  Original legal form  ", language: "en" }, jurisdiction: "SA",
      registration: { authorityOriginal: { text: "  جهة أصلية Original authority  ", language: "ar" }, identifier: "  CR-١٢٣ / Original identifier  " },
      registeredAddressOriginal: { text: "  عنوان أصلي\r\nOriginal address\t  ", language: "ar" } },
    declaredActivityKeys: ["managed-campaigns", "content-production2"], marketCountryCodes: ["SA", "KW"] };
}
function version(input = content()) { return { ...input, id: "principal-version:a1", sourceHash: canonicalHash(input), createdAt: "2026-10-07T00:00:00.000Z" }; }
function state() {
  const v = version(); return { principalId: v.principalId, revision: 1, state: "DRAFT" as const, currentVersion: null,
    createdAt: v.createdAt, updatedAt: v.createdAt };
}
function replaced(input: unknown, path: string[], value: unknown) {
  const result = structuredClone(input) as Record<string, unknown>; let parent = result;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path.at(-1)!] = value; return result;
}
function without(input: unknown, key: string) { const result = structuredClone(input) as Record<string, unknown>; delete result[key]; return result; }

it("principal versions preserve original content and hash exactly content without identity/time/state normalization", () => {
  const source = content(), before = structuredClone(source), parsed = PrincipalVersionContentSchema.parse(source);
  expect(parsed).toEqual(source); expect(source).toEqual(before);
  const saved = version(source), result = PrincipalVersionSchema.parse(saved);
  expect(result).toEqual(saved); expect(result.sourceHash).toBe(canonicalHash(parsed));
  expect(result.party.legalNameOriginal.text).toBe(source.party.legalNameOriginal.text);
  expect(result.party.registration.identifier).toBe(source.party.registration.identifier);
  expect(result.party.registeredAddressOriginal.text).toBe(source.party.registeredAddressOriginal.text);
  expect(result.party.tradingNameOriginal).toBeNull();
  const printableIdentity = { ...source, principalId: "principal~a:1" };
  expect(PrincipalVersionContentSchema.parse(printableIdentity)).toEqual(printableIdentity);
  expect(PrincipalVersionSchema.parse({ ...printableIdentity, id: "principal-version~a:1", createdAt: saved.createdAt,
    sourceHash: canonicalHash(printableIdentity) }).id).toBe("principal-version~a:1");
  expect(PrincipalVersionSchema.parse({ ...saved, id: "another-native-version-id", createdAt: "9999-12-31T23:59:59.999Z" }).sourceHash).toBe(saved.sourceHash);
  expect(PrincipalVersionSchema.parse({ ...saved, createdAt: "0001-01-01T00:00:00.000Z" }).sourceHash).toBe(saved.sourceHash);
  const live = { ...source, provenance: "LIVE" };
  expect(PrincipalVersionSchema.parse({ ...live, id: saved.id, createdAt: saved.createdAt, sourceHash: canonicalHash(live) }).provenance).toBe("LIVE");
  expect(PrincipalVersionSchema.safeParse({ ...saved, provenance: "LIVE" }).success).toBe(false);
  expect(PrincipalVersionSchema.safeParse({ ...saved, version: 2 }).success).toBe(false);
  const secondContent = { ...source, version: 2 };
  expect(PrincipalVersionSchema.parse({ ...secondContent, id: "principal-version:a2", createdAt: saved.createdAt,
    sourceHash: canonicalHash(secondContent) }).sourceHash).toBe(canonicalHash(secondContent));
  // A wrong hash over the whole stored row cannot masquerade as content hash.
  const { sourceHash: _hash, ...metadataIncluded } = saved; void _hash;
  expect(PrincipalVersionSchema.safeParse({ ...saved, sourceHash: canonicalHash(metadataIncluded) }).success).toBe(false);
  const trimmed = { ...source, party: { ...source.party, legalNameOriginal: { ...source.party.legalNameOriginal,
    text: source.party.legalNameOriginal.text.trim() } } };
  expect(PrincipalVersionSchema.safeParse({ ...saved, sourceHash: canonicalHash(trimmed) }).success).toBe(false);
  const reverseKeys = Object.fromEntries(Object.entries(source).reverse());
  expect(canonicalHash(reverseKeys)).toBe(saved.sourceHash);
  expect(PrincipalVersionSchema.parse({ ...reverseKeys, id: saved.id, createdAt: saved.createdAt, sourceHash: saved.sourceHash })).toEqual(saved);
});

it("principal version content and stored metadata reject strict extras, unsafe/duplicate activity and market bounds, IDs/revisions/hashes/years", () => {
  const source = content(); expect(PrincipalVersionContentSchema.parse(source)).toEqual(source);
  const fiftyActivities = Array.from({ length: 50 }, (_, index) => `activity-${index}`), fiftyMarkets = COUNTRY_CODES.slice(0, 50);
  expect(PrincipalVersionContentSchema.safeParse({ ...source, declaredActivityKeys: fiftyActivities, marketCountryCodes: fiftyMarkets }).success).toBe(true);
  expect(PrincipalVersionContentSchema.safeParse({ ...source, declaredActivityKeys: ["a", "a".repeat(100)] }).success).toBe(true);
  for (const declaredActivityKeys of [[], ["managed-campaigns", "managed-campaigns"], [...fiftyActivities, "activity-extra"], ["a".repeat(101)],
    [""], ["1activity"], ["UPPER"], ["activity_scope"], ["activity scope"], ["activité"], ["-activity"], ["activity-"], ["activity--scope"], ["activity\u0000scope"], null]) {
    expect(PrincipalVersionContentSchema.safeParse({ ...source, declaredActivityKeys }).success).toBe(false);
  }
  for (const marketCountryCodes of [[], ["SA", "SA"], COUNTRY_CODES.slice(0, 51), ["ZZ"], ["sa"], ["SAU"], ["SA", 1], null]) {
    expect(PrincipalVersionContentSchema.safeParse({ ...source, marketCountryCodes }).success).toBe(false);
  }
  for (const revision of [0, -1, 1.5, 2147483647, NaN, Infinity, "1", null]) expect(PrincipalVersionContentSchema.safeParse({ ...source, version: revision }).success).toBe(false);
  expect(PrincipalVersionContentSchema.safeParse({ ...source, version: 2147483646 }).success).toBe(true);
  for (const principalId of ["", "has space", "line\nbreak", "اسم", "i".repeat(201), null, 1]) expect(PrincipalVersionContentSchema.safeParse({ ...source, principalId }).success).toBe(false);
  expect(PrincipalVersionContentSchema.safeParse({ ...source, principalId: "i".repeat(200) }).success).toBe(true);
  for (const provenance of ["UNKNOWN", "FIXTURE", "live", null]) expect(PrincipalVersionContentSchema.safeParse({ ...source, provenance }).success).toBe(false);
  for (const addition of [{ id: "stored-id" }, { sourceHash: "a".repeat(64) }, { createdAt: "2026-10-07T00:00:00.000Z" }, { state: "ACTIVE" },
    { actorUserId: "operator" }, { brandId: "customer-alias" }, { sessionId: "private" }, { evidence: "private" }, { readiness: "LIVE" },
    { signing: true }, { supplierCost: "1" }]) expect(PrincipalVersionContentSchema.safeParse({ ...source, ...addition }).success).toBe(false);
  for (const value of [{ ...source.party, jurisdiction: "ZZ" }, { ...source.party, legalNameOriginal: { ...source.party.legalNameOriginal, text: " \t\n " } },
    { ...source.party, registration: { ...source.party.registration, storageKey: "private:evidence" } },
    replaced(source.party, ["registeredAddressOriginal", "text"], "unsafe\u0000address")]) {
    expect(PrincipalVersionContentSchema.safeParse({ ...source, party: value }).success).toBe(false);
  }
  for (const field of ["schemaVersion", "principalId", "provenance", "version", "party", "declaredActivityKeys", "marketCountryCodes"]) {
    expect(PrincipalVersionContentSchema.safeParse(without(source, field)).success).toBe(false);
  }
  const saved = version();
  for (const hash of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), "0".repeat(64), null]) expect(PrincipalVersionSchema.safeParse({ ...saved, sourceHash: hash }).success).toBe(false);
  for (const id of ["", "has space", "اسم", "i".repeat(201), null]) expect(PrincipalVersionSchema.safeParse({ ...saved, id }).success).toBe(false);
  for (const createdAt of ["0000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", "2023-02-29T00:00:00.000Z",
    "2026-10-07T03:00:00.000+03:00", "2026-10-07T00:00:00.000+00:00", "2026-10-07", "bad", null, 1]) {
    expect(PrincipalVersionSchema.safeParse({ ...saved, createdAt }).success).toBe(false);
  }
  for (const addition of [{ content: source }, { state: "ACTIVE" }, { reviewedBy: "admin" }, { qualified: true }, { signature: "private" }, { authority: "ADMIN" }]) {
    expect(PrincipalVersionSchema.safeParse({ ...saved, ...addition }).success).toBe(false);
  }
  for (const field of ["id", "sourceHash", "createdAt"]) expect(PrincipalVersionSchema.safeParse(without(saved, field)).success).toBe(false);
  // Independent review witness: recoverable Zod size failures must not escape
  // safeParse through the canonical codec's separate 524288-byte exception.
  const oversized = replaced(saved, ["party", "registeredAddressOriginal", "text"], "x".repeat(524289));
  expect(() => PrincipalVersionSchema.safeParse(oversized)).not.toThrow();
  expect(PrincipalVersionSchema.safeParse(oversized).success).toBe(false);
});

it("principal state preserves explicit draft/active/paused/revoked pointer relationships and timestamp bounds without asserting native lifecycle", () => {
  const draft = state(), saved = version(), pointer = { id: saved.id, version: saved.version, sourceHash: saved.sourceHash };
  expect(PrincipalStateSchema.parse(draft)).toEqual(draft);
  for (const state of ["ACTIVE", "PAUSED", "REVOKED"]) {
    const value = { ...draft, state, currentVersion: pointer, revision: 2, updatedAt: "2026-10-07T00:00:00.001Z" };
    expect(PrincipalStateSchema.parse(value)).toEqual(value);
  }
  expect(PrincipalStateSchema.parse({ ...draft, state: "REVOKED" }).currentVersion).toBeNull();
  expect(PrincipalStateSchema.safeParse({ ...draft, currentVersion: pointer }).success).toBe(false);
  for (const state of ["ACTIVE", "PAUSED"]) expect(PrincipalStateSchema.safeParse({ ...draft, state }).success).toBe(false);
  const active = { ...draft, state: "ACTIVE", currentVersion: pointer };
  for (const pointerValue of [{ id: saved.id }, { id: saved.id, version: 1 }, { ...pointer, sourceHash: "A".repeat(64) },
    { ...pointer, version: 0 }, { ...pointer, version: 2147483647 }, { ...pointer, id: " " }, { ...pointer, principalId: draft.principalId },
    { ...pointer, evidence: "private" }]) expect(PrincipalStateSchema.safeParse({ ...active, currentVersion: pointerValue }).success).toBe(false);
  expect(PrincipalStateSchema.safeParse({ ...active, currentVersion: { ...pointer, version: 2147483646 }, revision: 2147483646 }).success).toBe(true);
  for (const revision of [0, -1, 1.5, 2147483647, NaN, Infinity, "1", null]) expect(PrincipalStateSchema.safeParse({ ...draft, revision }).success).toBe(false);
  expect(PrincipalStateSchema.safeParse({ ...draft, updatedAt: "2026-10-06T23:59:59.999Z" }).success).toBe(false);
  expect(PrincipalStateSchema.safeParse({ ...draft, createdAt: "0001-01-01T00:00:00.000Z", updatedAt: "9999-12-31T23:59:59.999Z" }).success).toBe(true);
  for (const instant of ["0000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", "2023-02-29T00:00:00.000Z", "2026-10-07T03:00:00.000+03:00", "bad", null]) {
    for (const field of ["createdAt", "updatedAt"]) expect(PrincipalStateSchema.safeParse({ ...draft, [field]: instant }).success).toBe(false);
  }
  for (const state of ["AVAILABLE", "APPROVED", "active", "UNKNOWN", null]) expect(PrincipalStateSchema.safeParse({ ...draft, state }).success).toBe(false);
  for (const addition of [{ provenance: "LIVE" }, { sourceHash: saved.sourceHash }, { party: saved.party }, { currentTime: draft.updatedAt },
    { actorUserId: "admin" }, { sessionId: "private" }, { evidence: "private" }, { readiness: "READY" }, { supplierCost: "1" }]) {
    expect(PrincipalStateSchema.safeParse({ ...draft, ...addition }).success).toBe(false);
  }
  for (const field of ["principalId", "revision", "state", "currentVersion", "createdAt", "updatedAt"]) expect(PrincipalStateSchema.safeParse(without(draft, field)).success).toBe(false);
  // The pointer's actual row/principal/hash/provenance relationship and terminal
  // lifecycle are intentionally left to independently authored native guards.
});
