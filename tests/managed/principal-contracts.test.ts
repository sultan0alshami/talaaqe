import { expect, it } from "vitest";
import { ManagedAuthorityValiditySchema, PrincipalPartySchema, ManagedOperationalGrantSchema } from "@/lib/managed/principal-contracts";
import { COUNTRY_CODES } from "@/lib/contracts/vocabulary";
import { MAX_MINOR_UNITS } from "@/lib/contracts/money";

// Exactly four pure groups. Synthetic structural declarations exercise contract
// validation only: no entity, governance seat, qualified review, current grant,
// registration, signing, quote issuance or provider readiness is established.
// Root alone adopts/runs this draft. No clock, producer or authority mock.
type Original = { text: string; language: string | null };
const original = (text: string, language: string | null = "ar"): Original => ({ text, language });
const sha = (digit: string) => digit.repeat(64);
function validity() {
  return { validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", recheckAt: "2026-12-31T23:59:59.999Z" };
}
function party() {
  return { legalNameOriginal: original("  إنفيم الأصلية / Original legal name\t  "),
    tradingNameOriginal: original("  اسم تجاري أصلي  ") as Original | null,
    legalFormOriginal: original("  شركة محدودة / Original legal form  ", "ar-SA"), jurisdiction: "SA",
    registration: { authorityOriginal: original("  جهة تسجيل أصلية / Original registration authority  "), identifier: "  سجل-١٢٣ / CR-123\t  " },
    registeredAddressOriginal: original("  ص.ب. ١٢٣\r\nOriginal Street 7\t  ") };
}
function view() {
  return { schemaVersion: 1 as const, id: "grant:view-1", revision: 1, state: "ACTIVE" as const,
    provenance: "DEVELOPMENT_FIXTURE" as const, operatorUserId: "operator-a", principalId: "principal-a", principalVersionId: "principal-version-1",
    principalSourceHash: sha("a"), binding: { orderId: "order-a", workspaceId: "workspace-a", campaignId: "campaign-a",
      submissionId: "submission-a", submissionVersion: 1, submissionHash: sha("b") },
    grantor: { userId: "controller-a", governanceSeatId: "governance-seat-a", governanceSeatRevision: 1 },
    authorizationEvidence: { id: "authorization-evidence-a", revision: 1, sourceHash: sha("c") },
    validity: validity(), sourceHash: sha("d"), purpose: "VIEW_SUBMITTED_ORDER" as const,
    accessPolicy: { versionId: "managed-submitted-access-v1", kind: "MANAGED_SUBMISSION_ACCESS" as const, contentHash: sha("e") } };
}
function issue() {
  const { purpose: _purpose, accessPolicy: _accessPolicy, ...common } = view(); void _purpose; void _accessPolicy;
  return { ...common, purpose: "ISSUE_RETAIL_QUOTE" as const,
    quotePolicy: { versionId: "managed-quote-v1", kind: "MANAGED_QUOTE_POLICY" as const, contentHash: sha("1") },
    customerTermsPolicy: { versionId: "managed-customer-terms-v1", kind: "MANAGED_CUSTOMER_TERMS" as const, contentHash: sha("2") },
    taxPolicy: { versionId: "managed-tax-v1", kind: "MANAGED_TAX_TREATMENT" as const, contentHash: sha("3") },
    maximumGross: { amountMinor: "1000000", currencyCode: "SAR" }, marketCountryCodes: ["SA", "KW"] };
}
function replaced(input: unknown, path: string[], value: unknown) {
  const result = structuredClone(input) as Record<string, unknown>;
  let target = result;
  for (const part of path.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[path.at(-1)!] = value; return result;
}
function omitted(input: unknown, name: string) { const result = structuredClone(input) as Record<string, unknown>; delete result[name]; return result; }

it("principal party originals preserve declared words/whitespace/null and enforce safe bounded identity without Brand aliases", () => {
  const value = party(), encoded = JSON.stringify(value);
  expect(PrincipalPartySchema.parse(value)).toEqual(value); expect(JSON.stringify(value)).toBe(encoded);
  const unknownTrading = { ...party(), tradingNameOriginal: null };
  expect(PrincipalPartySchema.parse(unknownTrading)).toEqual(unknownTrading);
  const unknownLanguage = party(); unknownLanguage.legalNameOriginal.language = null;
  expect(PrincipalPartySchema.parse(unknownLanguage).legalNameOriginal.language).toBeNull();
  expect(PrincipalPartySchema.safeParse(omitted(value, "tradingNameOriginal")).success).toBe(false);
  for (const text of ["", " ", "\t\r\n"]) {
    for (const path of [["legalNameOriginal", "text"], ["tradingNameOriginal", "text"], ["legalFormOriginal", "text"],
      ["registration", "authorityOriginal", "text"], ["registration", "identifier"], ["registeredAddressOriginal", "text"]]) {
      expect(PrincipalPartySchema.safeParse(replaced(value, path, text)).success).toBe(false);
    }
  }
  // HT/LF/CR are preserved ordinary whitespace. Unsafe C0 and DEL are rejected,
  // including inside otherwise nonblank originals/registration identifiers.
  for (const text of ["A\u0000B", "A\u0001B", "A\u000bB", "A\u000cB", "A\u001fB", "A\u007fB"]) {
    for (const path of [["legalNameOriginal", "text"], ["legalFormOriginal", "text"], ["registration", "authorityOriginal", "text"],
      ["registration", "identifier"], ["registeredAddressOriginal", "text"]]) expect(PrincipalPartySchema.safeParse(replaced(value, path, text)).success).toBe(false);
  }
  for (const path of [["legalNameOriginal", "text"], ["tradingNameOriginal", "text"], ["legalFormOriginal", "text"],
    ["registration", "authorityOriginal", "text"], ["registration", "identifier"]]) {
    expect(PrincipalPartySchema.safeParse(replaced(value, path, "ع".repeat(500))).success).toBe(true);
    expect(PrincipalPartySchema.safeParse(replaced(value, path, "ع".repeat(501))).success).toBe(false);
  }
  expect(PrincipalPartySchema.safeParse(replaced(value, ["registeredAddressOriginal", "text"], "ع".repeat(2000))).success).toBe(true);
  expect(PrincipalPartySchema.safeParse(replaced(value, ["registeredAddressOriginal", "text"], "ع".repeat(2001))).success).toBe(false);
  for (const jurisdiction of ["ZZ", "XK", "sa", "SAU", " SA", null, 1]) expect(PrincipalPartySchema.safeParse({ ...value, jurisdiction }).success).toBe(false);
  expect(PrincipalPartySchema.safeParse({ ...value, jurisdiction: "KW" }).success).toBe(true);
  for (const language of ["ar_SA", "", "not a tag", 1]) expect(PrincipalPartySchema.safeParse(replaced(value, ["legalNameOriginal", "language"], language)).success).toBe(false);
  for (const addition of [{ brandId: "customer-brand" }, { organizationId: "payer-org" }, { buyer: "customer" }, { actorUserId: "admin" },
    { proof: "private evidence" }, { storageKey: "private:proof" }]) expect(PrincipalPartySchema.safeParse({ ...value, ...addition }).success).toBe(false);
  expect(PrincipalPartySchema.safeParse({ ...value, registration: { ...value.registration, countryCode: "SA" } }).success).toBe(false);
  expect(PrincipalPartySchema.safeParse({ ...value, legalNameOriginal: { ...value.legalNameOriginal, translatedText: "Invented translation" } }).success).toBe(false);
});

it("authority validity preserves explicit nullable expiry and validates Gregorian/UTC/year/order bounds without a current clock", () => {
  const value = validity(); expect(ManagedAuthorityValiditySchema.parse(value)).toEqual(value);
  const unlimitedExpiry = { ...value, expiresAt: null }; expect(ManagedAuthorityValiditySchema.parse(unlimitedExpiry)).toEqual(unlimitedExpiry);
  const atExpiry = { ...value, recheckAt: value.expiresAt }; expect(ManagedAuthorityValiditySchema.parse(atExpiry)).toEqual(atExpiry);
  const old = { validFrom: "0001-01-01T00:00:00.000Z", expiresAt: "0001-01-03T00:00:00.000Z", recheckAt: "0001-01-02T00:00:00.000Z" };
  const future = { validFrom: "9999-12-29T00:00:00.000Z", expiresAt: "9999-12-31T23:59:59.999Z", recheckAt: "9999-12-30T00:00:00.000Z" };
  expect(ManagedAuthorityValiditySchema.parse(old)).toEqual(old); expect(ManagedAuthorityValiditySchema.parse(future)).toEqual(future);
  const leap = { validFrom: "2024-02-29T00:00:00.000Z", expiresAt: null, recheckAt: "2024-03-01T00:00:00.000Z" };
  expect(ManagedAuthorityValiditySchema.parse(leap)).toEqual(leap);
  for (const altered of [{ ...value, recheckAt: value.validFrom }, { ...value, recheckAt: "2025-12-31T23:59:59.999Z" },
    { ...value, expiresAt: value.validFrom }, { ...value, expiresAt: "2025-12-31T23:59:59.999Z" },
    { ...value, expiresAt: "2026-12-01T00:00:00.000Z" }]) expect(ManagedAuthorityValiditySchema.safeParse(altered).success).toBe(false);
  for (const instant of ["0000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", "-000001-01-01T00:00:00.000Z",
    "2023-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z", "2026-01-01T24:00:00.000Z", "2026-01-01T00:00:60.000Z",
    "2026-01-01T03:00:00.000+03:00", "2026-01-01T00:00:00.000+00:00", "2026-01-01T00:00:00.000z",
    "2026-01-01", "2026-01-01T00:00:00.000", "2026-01-01T00:00:00.0000Z", "bad", 1, new Date("2026-01-01T00:00:00.000Z")]) {
    for (const field of ["validFrom", "expiresAt", "recheckAt"]) expect(ManagedAuthorityValiditySchema.safeParse({ ...value, [field]: instant }).success).toBe(false);
  }
  for (const field of ["validFrom", "expiresAt", "recheckAt"]) expect(ManagedAuthorityValiditySchema.safeParse(omitted(value, field)).success).toBe(false);
  expect(ManagedAuthorityValiditySchema.safeParse({ ...value, currentTime: value.validFrom }).success).toBe(false);
  expect(ManagedAuthorityValiditySchema.safeParse({ ...value, timezone: "Asia/Riyadh" }).success).toBe(false);
});

it("VIEW is strict submitted-order authority with bounded native-shaped IDs/revisions/hashes and no quote/money/sign/private source escalation", () => {
  const value = view(), before = structuredClone(value); expect(ManagedOperationalGrantSchema.parse(value)).toEqual(value); expect(value).toEqual(before);
  for (const state of ["ACTIVE", "PAUSED", "REVOKED"]) expect(ManagedOperationalGrantSchema.safeParse({ ...value, state }).success).toBe(true);
  for (const provenance of ["LIVE", "DEVELOPMENT_FIXTURE"]) expect(ManagedOperationalGrantSchema.safeParse({ ...value, provenance }).success).toBe(true);
  for (const addition of [{ maximumGross: issue().maximumGross }, { quotePolicy: issue().quotePolicy }, { customerTermsPolicy: issue().customerTermsPolicy },
    { taxPolicy: issue().taxPolicy }, { marketCountryCodes: ["SA"] }, { sign: true }, { actorUserId: "another-admin" }, { sessionId: "private-session" },
    { proof: "private proof" }, { storageKey: "private:proof" }, { supplierCost: { amountMinor: "1", currencyCode: "SAR" } },
    { source: party() }, { snapshot: { conversation: "private words" } }]) expect(ManagedOperationalGrantSchema.safeParse({ ...value, ...addition }).success).toBe(false);
  for (const purpose of ["SIGN", "SIGN_CUSTOMER", "VIEW", "ISSUE_RETAIL_QUOTE", "view_submitted_order"]) {
    expect(ManagedOperationalGrantSchema.safeParse({ ...value, purpose }).success).toBe(false);
  }
  for (const path of [["id"], ["operatorUserId"], ["principalId"], ["principalVersionId"], ["binding", "orderId"], ["binding", "workspaceId"],
    ["binding", "campaignId"], ["binding", "submissionId"], ["grantor", "userId"], ["grantor", "governanceSeatId"],
    ["authorizationEvidence", "id"], ["accessPolicy", "versionId"]]) {
    expect(ManagedOperationalGrantSchema.safeParse(replaced(value, path, "i".repeat(200))).success).toBe(true);
    for (const id of ["", "with space", "line\nbreak", "اسم", "i".repeat(201), null, 1]) expect(ManagedOperationalGrantSchema.safeParse(replaced(value, path, id)).success).toBe(false);
  }
  for (const path of [["revision"], ["binding", "submissionVersion"], ["grantor", "governanceSeatRevision"], ["authorizationEvidence", "revision"]]) {
    expect(ManagedOperationalGrantSchema.safeParse(replaced(value, path, 2147483646)).success).toBe(true);
    for (const revision of [0, -1, 1.5, 2147483647, Number.MAX_SAFE_INTEGER, NaN, Infinity, "1", BigInt(1), null]) {
      expect(ManagedOperationalGrantSchema.safeParse(replaced(value, path, revision)).success).toBe(false);
    }
  }
  for (const path of [["principalSourceHash"], ["sourceHash"], ["binding", "submissionHash"], ["authorizationEvidence", "sourceHash"], ["accessPolicy", "contentHash"]]) {
    for (const hash of ["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), " " + sha("a"), 1, null]) expect(ManagedOperationalGrantSchema.safeParse(replaced(value, path, hash)).success).toBe(false);
  }
  for (const kind of ["GOVERNING_TERMS", "MARKET", "MANAGED_CUSTOMER_TERMS"]) expect(ManagedOperationalGrantSchema.safeParse(replaced(value, ["accessPolicy", "kind"], kind)).success).toBe(false);
  for (const field of ["binding", "grantor", "authorizationEvidence", "accessPolicy", "validity"]) {
    const nested = value[field as keyof typeof value];
    expect(ManagedOperationalGrantSchema.safeParse({ ...value, [field]: { ...(nested as object), actorUserId: "injected" } }).success).toBe(false);
  }
  expect(ManagedOperationalGrantSchema.safeParse({ ...value, grantor: { ...value.grantor, userId: value.operatorUserId } }).success).toBe(false);
  for (const field of ["schemaVersion", "principalVersionId", "principalSourceHash", "sourceHash", "accessPolicy", "validity"]) expect(ManagedOperationalGrantSchema.safeParse(omitted(value, field)).success).toBe(false);
});

it("ISSUE pins exact managed policy purposes plus positive canonical single-currency gross and explicit bounded markets without governing/self-sign authority", () => {
  const value = issue(), before = structuredClone(value); expect(ManagedOperationalGrantSchema.parse(value)).toEqual(value); expect(value).toEqual(before);
  for (const currencyCode of ["SAR", "JPY", "KWD"]) {
    const allowed = { ...value, maximumGross: { amountMinor: "1", currencyCode } };
    const parsed = ManagedOperationalGrantSchema.parse(allowed);
    if (parsed.purpose !== "ISSUE_RETAIL_QUOTE") throw new Error("Issue fixture parsed as another purpose");
    expect(parsed.maximumGross).toEqual(allowed.maximumGross);
  }
  expect(ManagedOperationalGrantSchema.safeParse({ ...value, maximumGross: { amountMinor: MAX_MINOR_UNITS.toString(), currencyCode: "SAR" } }).success).toBe(true);
  for (const amountMinor of ["0", "00", "01", "+1", "-1", "1.00", "1e3", "1,000", " 1", "1 ", (MAX_MINOR_UNITS + BigInt(1)).toString(), "9".repeat(40), 1, NaN, Infinity, BigInt(1), null]) {
    expect(ManagedOperationalGrantSchema.safeParse({ ...value, maximumGross: { amountMinor, currencyCode: "SAR" } }).success).toBe(false);
  }
  for (const currencyCode of ["sar", "ZZZ", "SA", " SAR", 1, null]) expect(ManagedOperationalGrantSchema.safeParse({ ...value, maximumGross: { amountMinor: "1", currencyCode } }).success).toBe(false);
  expect(ManagedOperationalGrantSchema.safeParse({ ...value, maximumGross: { ...value.maximumGross, tax: "1" } }).success).toBe(false);
  const fifty = COUNTRY_CODES.slice(0, 50), fiftyOne = COUNTRY_CODES.slice(0, 51);
  const bounded = ManagedOperationalGrantSchema.parse({ ...value, marketCountryCodes: fifty });
  if (bounded.purpose !== "ISSUE_RETAIL_QUOTE") throw new Error("Bounded markets fixture parsed as another purpose");
  expect(bounded.marketCountryCodes).toEqual(fifty);
  for (const marketCountryCodes of [[], ["SA", "SA"], ["ZZ"], ["sa"], ["SAU"], fiftyOne, ["SA", 1], null]) {
    expect(ManagedOperationalGrantSchema.safeParse({ ...value, marketCountryCodes }).success).toBe(false);
  }
  for (const field of ["quotePolicy", "customerTermsPolicy", "taxPolicy"] as const) {
    for (const kind of ["GOVERNING_TERMS", "MARKET", "MANAGED_SUBMISSION_ACCESS", "SIGN"]) expect(ManagedOperationalGrantSchema.safeParse({
      ...value, [field]: { ...value[field], kind },
    }).success).toBe(false);
    for (const contentHash of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), null]) expect(ManagedOperationalGrantSchema.safeParse({
      ...value, [field]: { ...value[field], contentHash },
    }).success).toBe(false);
    expect(ManagedOperationalGrantSchema.safeParse({ ...value, [field]: { ...value[field], versionId: " " } }).success).toBe(false);
    expect(ManagedOperationalGrantSchema.safeParse({ ...value, [field]: { ...value[field], privateEvidence: "private proof" } }).success).toBe(false);
    expect(ManagedOperationalGrantSchema.safeParse(omitted(value, field)).success).toBe(false);
  }
  expect(ManagedOperationalGrantSchema.safeParse({ ...value, grantor: { ...value.grantor, userId: value.operatorUserId } }).success).toBe(false);
  for (const addition of [{ accessPolicy: view().accessPolicy }, { authority: { role: "ADMIN" } }, { signerUserId: value.operatorUserId },
    { session: { sessionId: "private-session" } }, { supplierCost: "1" }, { sourceContent: party() }]) expect(ManagedOperationalGrantSchema.safeParse({ ...value, ...addition }).success).toBe(false);
  expect(ManagedOperationalGrantSchema.safeParse({ ...value, purpose: "SIGN" }).success).toBe(false);
  expect(ManagedOperationalGrantSchema.safeParse({ ...value, purpose: "VIEW_SUBMITTED_ORDER" }).success).toBe(false);
  for (const field of ["maximumGross", "marketCountryCodes", "authorizationEvidence", "grantor"]) expect(ManagedOperationalGrantSchema.safeParse(omitted(value, field)).success).toBe(false);
});
