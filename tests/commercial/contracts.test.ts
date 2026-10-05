import { afterEach, expect, it, vi } from "vitest";
import {
  CancellationScheduleSchema, CancellationStageSchema, COMMERCIAL_CAPABILITIES, COMMERCIAL_LIMITS,
  COMMERCIAL_POLICY_VERSION, DirectCostsSchema, PLANNING_PLANS, PLANNING_SESSION_LIMITS,
  RateGuidanceSchema, ReachBandSchema, ReachObservationSchema, REACH_TAXONOMY_VERSION,
  TaxTreatmentSchema, type ReachBand,
} from "@/lib/commercial/contracts";
import { assessForecast, cancellationLiability, priceForMargin, totalWithTax } from "@/lib/commercial/policies";
import type { Money } from "@/lib/contracts/money";

// Explicit synthetic structural-policy fixtures. No provider, source authenticity,
// tax review, accepted contract, payment or refund is exercised by these pure tests.
const sar = (amountMinor: string): Money => ({ amountMinor, currencyCode: "SAR" });
const at = "2026-10-05T01:00:00.000Z";
const zeroCosts = () => ({
  creator: sar("0"), production: sar("0"), labor: sar("0"), paymentFees: sar("0"),
  operationsAi: sar("0"), rework: sar("0"), nonrecoverableTax: sar("0"), contingency: sar("0"),
});
const tax = () => ({ policyVersionId: "synthetic-policy-shape-only", reviewedAt: at, treatment: "STANDARD_RATE", rateBasisPoints: 1500 });
const cancellation = () => ({
  policyVersion: COMMERCIAL_POLICY_VERSION, itemNet: sar("10000"), stages: {
    BEFORE_COMMITMENT: sar("0"), BOOKED: sar("2000"), DRAFT: sar("5000"),
    APPROVED: sar("7500"), PUBLISHED_COMPLETED: sar("10000"),
  },
});
const guidance = () => ({
  sourceClass: "VENDOR_ESTIMATE", sourceReference: "  Synthetic original source sheet — نطاق خاص  ", sourceDate: at,
  // A source's 10k–50k range is retained; it is not widened to Infame's Micro range.
  followerBounds: { minimum: "10000", maximumExclusive: "50000" },
  platform: "SNAPCHAT", format: "STORY", unit: "WEEK",
  rights: "  Original declared scope: organic publication only; paid reuse excluded.  ", amount: sar("4000000"),
});
const reachCases: [string | null, ReachBand | null][] = [
  [null, null], ["0", null], ["999", null], ["1000", "NANO"], ["9999", "NANO"],
  ["10000", "MICRO"], ["99999", "MICRO"], ["100000", "MID"], ["499999", "MID"],
  ["500000", "MACRO"], ["999999", "MACRO"], ["1000000", "MEGA"], ["9223372036854775807", "MEGA"],
];
const observation = (followers: string | null, band: ReachBand | null) => ({
  accountId: "synthetic-social-account", platform: "INSTAGRAM", followers, observedAt: at,
  taxonomyVersion: REACH_TAXONOMY_VERSION, band,
});

afterEach(() => { vi.unstubAllEnvs(); });

it("freezes the exact selected EX-VAT price/session and bounded-session policy without legacy prices or credits", () => {
  expect(COMMERCIAL_POLICY_VERSION).toBe("infame-commercial-v1-2026-10-05");
  expect(PLANNING_PLANS).toStrictEqual([
    { id: "STARTER", policyVersion: COMMERCIAL_POLICY_VERSION, netMonthly: sar("9900"), sessions: 3 },
    { id: "GROWTH", policyVersion: COMMERCIAL_POLICY_VERSION, netMonthly: sar("29900"), sessions: 15 },
    { id: "PRO", policyVersion: COMMERCIAL_POLICY_VERSION, netMonthly: sar("99900"), sessions: 75 },
  ]);
  expect(PLANNING_SESSION_LIMITS).toStrictEqual({ chatTurns: 10, brief: 1, strategy: 1, ideasPack: 1, combinedRefinement: 1 });
  expect(COMMERCIAL_LIMITS).toStrictEqual({
    targetMarginBasisPoints: 3000, commitmentFloorBasisPoints: 2500,
    pilotSlots: 5, trialSessions: 1, rollover: false, variableAiCostTargetBasisPoints: 1000,
  });
});

it("prevents nested price, plan, allowance and capability mutation rather than freezing only the outer array", () => {
  expect(Object.isFrozen(PLANNING_PLANS)).toBe(true);
  for (const plan of PLANNING_PLANS) {
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.netMonthly)).toBe(true);
    expect(Reflect.set(plan.netMonthly, "amountMinor", "1")).toBe(false);
    expect(Reflect.set(plan, "sessions", 999999)).toBe(false);
    expect(Reflect.deleteProperty(plan, "policyVersion")).toBe(false);
  }
  expect(Reflect.set(PLANNING_PLANS, "3", { id: "UNLIMITED" })).toBe(false);
  for (const policy of [PLANNING_SESSION_LIMITS, COMMERCIAL_LIMITS, COMMERCIAL_CAPABILITIES]) expect(Object.isFrozen(policy)).toBe(true);
  expect(Reflect.set(PLANNING_SESSION_LIMITS, "combinedRefinement", 5)).toBe(false);
  expect(Reflect.set(COMMERCIAL_LIMITS, "rollover", true)).toBe(false);
  expect(Reflect.set(COMMERCIAL_LIMITS, "pilotSlots", 6)).toBe(false);
  for (const capability of Object.values(COMMERCIAL_CAPABILITIES)) {
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Reflect.set(capability, "mode", "AVAILABLE_FROM_KEY")).toBe(false);
  }
});

it("keeps inert acceptance gates unavailable with synthetic environment keys and an advertised PRO plan", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-not-a-provider-credential");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-not-a-provider-credential");
  vi.stubEnv("MOYASAR_SECRET_KEY", "synthetic-not-a-provider-credential");
  // Reload only this pure module: no provider/checkout function exists or is called.
  vi.resetModules();
  const policy = await import("@/lib/commercial/contracts");
  expect(policy.PLANNING_PLANS.find(plan => plan.id === "PRO")?.sessions).toBe(75);
  expect(policy.COMMERCIAL_CAPABILITIES).toStrictEqual({
    managedCheckout: { mode: "UNAVAILABLE", reason: "MERCHANT_AND_MANAGED_ORDER_ACCEPTANCE_REQUIRED" },
    recurringBilling: { mode: "UNAVAILABLE", reason: "RECURRING_MERCHANT_ACCEPTANCE_REQUIRED" },
    anthropicPlanning: { mode: "UNAVAILABLE", reason: "PLANNING_QUALITY_COST_AND_ORCHESTRATION_ACCEPTANCE_REQUIRED" },
    openai: { mode: "UNAVAILABLE", reason: "FOUNDER_DISABLED" },
    voice: { mode: "UNAVAILABLE", reason: "VOICE_PROVIDER_AND_TRUSTED_SPEND_ACCEPTANCE_REQUIRED" },
    manualPlanning: { mode: "AVAILABLE", price: "FREE" },
    deterministicMatching: { mode: "AVAILABLE", price: "FREE" },
  });
});

it.each(reachCases)("binds the dated per-account projection at %s followers to exactly %s", (followers, expected) => {
  const value = observation(followers, expected);
  expect(ReachObservationSchema.parse(value)).toStrictEqual(value);
  // The projection itself is authoritative; calling reachBand elsewhere is insufficient.
  for (const wrong of [null, ...ReachBandSchema.options]) {
    if (wrong !== expected) expect(ReachObservationSchema.safeParse(observation(followers, wrong)).success).toBe(false);
  }
});

it("requires exact dated/account/platform/taxonomy reach metadata and rejects grades, aggregate facts and coercion", () => {
  const value = observation("1000", "NANO");
  for (const invalid of [
    null, {}, { ...value, accountId: "" }, { ...value, platform: "ALL_PLATFORMS" },
    { ...value, followers: 1000 }, { ...value, followers: undefined }, { ...value, followers: "1000.0" },
    { ...value, followers: "01000" }, { ...value, followers: "-1" }, { ...value, followers: "9223372036854775808" },
    { ...value, observedAt: "2026-10-05" }, { ...value, observedAt: null },
    { ...value, taxonomyVersion: "infame-reach-v1" }, { ...value, band: "CELEBRITY" },
    { ...value, qualityGrade: "A" }, { ...value, totalAcrossPlatforms: "1000000" },
  ]) expect(ReachObservationSchema.safeParse(invalid).success).toBe(false);
});

it.each(["CREATOR_ASK", "VENDOR_ESTIMATE", "AGREED_SUBCONTRACT", "ACHIEVED_TRANSACTION"])("retains %s guidance original scope, unit, date, bounds and currency without converting it to an Infame tier", sourceClass => {
  const value = { ...guidance(), sourceClass, amount: { amountMinor: "4998", currencyCode: "KWD" } };
  expect(RateGuidanceSchema.parse(value)).toStrictEqual(value);
  expect(RateGuidanceSchema.parse({ ...value, followerBounds: { minimum: null, maximumExclusive: null } }).followerBounds).toStrictEqual({ minimum: null, maximumExclusive: null });
  expect(RateGuidanceSchema.parse({ ...value, followerBounds: { minimum: "500000", maximumExclusive: null } }).followerBounds).toStrictEqual({ minimum: "500000", maximumExclusive: null });
});

it("rejects incomplete or reversed source scope, invented classifications/units, added quality bands and numeric money", () => {
  const value = guidance();
  const { rights: omitted, ...withoutRights } = value; expect(omitted.length).toBeGreaterThan(0);
  for (const invalid of [
    null, {}, withoutRights, { ...value, sourceClass: "MARKET_MEDIAN" }, { ...value, sourceReference: "" },
    { ...value, sourceDate: "2026-10-05" }, { ...value, rights: "" }, { ...value, unit: "FOLLOWER_CPM" },
    { ...value, platform: "UNKNOWN" }, { ...value, format: "STORY_SET" }, { ...value, currency: "SAR" },
    { ...value, followerBounds: null }, { ...value, followerBounds: { minimum: "10000", maximumExclusive: "10000" } },
    { ...value, followerBounds: { minimum: "50000", maximumExclusive: "10000" } },
    { ...value, followerBounds: { minimum: 10000, maximumExclusive: "50000" } },
    { ...value, followerBounds: { minimum: "10000", maximumExclusive: "50000", band: "MICRO" } },
    { ...value, infameTier: "MICRO" }, { ...value, amount: { amountMinor: 4000000, currencyCode: "SAR" } },
  ]) expect(RateGuidanceSchema.safeParse(invalid).success).toBe(false);
});

it("rejects whitespace-only required scope and policy references without trimming meaningful original source text", () => {
  const value = guidance();
  expect(RateGuidanceSchema.parse(value).sourceReference).toBe(value.sourceReference);
  expect(RateGuidanceSchema.parse(value).rights).toBe(value.rights);
  for (const invalid of [{ ...value, sourceReference: " \n\t " }, { ...value, rights: " \n\t " }]) {
    expect(RateGuidanceSchema.safeParse(invalid).success).toBe(false);
  }
  expect(TaxTreatmentSchema.safeParse({ ...tax(), policyVersionId: " \n\t " }).success).toBe(false);
  expect(ReachObservationSchema.safeParse({ ...observation("1000", "NANO"), accountId: " \n\t " }).success).toBe(false);
});

it("rejects an empty nonnegative follower interval even when the source lower bound is unknown", () => {
  const value = guidance();
  expect(RateGuidanceSchema.safeParse({ ...value, followerBounds: { minimum: null, maximumExclusive: "0" } }).success).toBe(false);
  // Unknown is preserved independently; a meaningful one-sided source interval is valid.
  expect(RateGuidanceSchema.parse({ ...value, followerBounds: { minimum: null, maximumExclusive: "1" } }).followerBounds).toStrictEqual({ minimum: null, maximumExclusive: "1" });
});

it("returns validation failures without throwing for malformed follower bounds, source prices and every cancellation money position", () => {
  // A recoverable regex/range issue can still reach a Zod refinement. It must not
  // escape safeParse as a BigInt SyntaxError or silently coerce the invalid text.
  for (const invalid of ["1.5", "-1", "+1", "9223372036854775808", "1e3", " \n\t "]) {
    const source = guidance(), schedule = cancellation();
    const probes: (() => { success: boolean })[] = [
      () => ReachObservationSchema.safeParse(observation(invalid, "NANO")),
      () => RateGuidanceSchema.safeParse({ ...source, followerBounds: { ...source.followerBounds, minimum: invalid } }),
      () => RateGuidanceSchema.safeParse({ ...source, followerBounds: { minimum: null, maximumExclusive: invalid } }),
      () => RateGuidanceSchema.safeParse({ ...source, amount: sar(invalid) }),
      () => DirectCostsSchema.safeParse({ ...zeroCosts(), labor: sar(invalid) }),
      () => CancellationScheduleSchema.safeParse({ ...schedule, itemNet: sar(invalid) }),
      ...CancellationStageSchema.options.map(stage => () => CancellationScheduleSchema.safeParse({
        ...schedule, stages: { ...schedule.stages, [stage]: sar(invalid) },
      })),
    ];
    for (const probe of probes) {
      const observed: { result?: { success: boolean } } = {};
      expect(() => { observed.result = probe(); }).not.toThrow();
      expect(observed.result?.success).toBe(false);
    }
  }
});

it.each(Object.keys(zeroCosts()) as (keyof ReturnType<typeof zeroCosts>)[])("requires an explicit known %s cost and includes its currency in the financial comparison", category => {
  const value = zeroCosts();
  const incomplete = { ...value }; delete (incomplete as Partial<typeof value>)[category];
  for (const invalid of [incomplete, { ...value, [category]: null }, { ...value, [category]: undefined }]) {
    expect(DirectCostsSchema.safeParse(invalid).success).toBe(false);
    expect(() => assessForecast(sar("10000"), invalid)).toThrow();
  }
  // Even a zero cost in a different currency is not a same-currency component.
  expect(() => assessForecast(sar("10000"), { ...value, [category]: { amountMinor: "0", currencyCode: "USD" } })).toThrow();
});

it("keeps free/zero economics distinct from a paid commitment and catches aggregate overflow", () => {
  expect(DirectCostsSchema.parse(zeroCosts())).toStrictEqual(zeroCosts());
  expect(assessForecast(sar("0"), zeroCosts())).toStrictEqual({ directCost: sar("0"), contributionMinor: "0", targetMet: false, commitmentAllowed: false });
  expect(assessForecast(sar("0"), { ...zeroCosts(), labor: sar("1") })).toMatchObject({ contributionMinor: "-1", targetMet: false, commitmentAllowed: false });
  expect(priceForMargin(sar("0"))).toStrictEqual(sar("0"));
  expect(() => assessForecast(sar("9223372036854775807"), { ...zeroCosts(), creator: sar("9223372036854775807"), labor: sar("1") })).toThrow();
  expect(() => assessForecast(sar("1"), { ...zeroCosts(), operationsAi: sar("-1") })).toThrow();
});

it("validates every cancellation stage before choosing one and accepts equal explicit liabilities without summing them", () => {
  const value = cancellation();
  const equalStages = { ...value, stages: { BEFORE_COMMITMENT: sar("0"), BOOKED: sar("2000"), DRAFT: sar("2000"), APPROVED: sar("2000"), PUBLISHED_COMPLETED: sar("2000") } };
  expect(CancellationScheduleSchema.parse(equalStages)).toStrictEqual(equalStages);
  expect(cancellationLiability(equalStages, "PUBLISHED_COMPLETED")).toStrictEqual(sar("2000"));
  for (const stage of CancellationStageSchema.options) {
    const missing = { ...value.stages }; delete (missing as Partial<typeof missing>)[stage];
    for (const invalid of [
      { ...value, stages: missing }, { ...value, stages: { ...value.stages, [stage]: null } },
      { ...value, stages: { ...value.stages, [stage]: { amountMinor: "0", currencyCode: "USD" } } },
      { ...value, stages: { ...value.stages, [stage]: sar("10001") } },
    ]) expect(() => cancellationLiability(invalid, "BEFORE_COMMITMENT")).toThrow();
  }
  expect(() => cancellationLiability({ ...value, policyVersion: "unreviewed-version" }, "DRAFT")).toThrow();
  expect(() => cancellationLiability({ ...value, stages: { ...value.stages, extraFee: sar("1") } }, "DRAFT")).toThrow();
});

it("keeps cancellation retention net and separate from tax totals instead of interpreting it as an executed gross refund", () => {
  const liability = cancellationLiability(cancellation(), "DRAFT");
  expect(liability).toStrictEqual(sar("5000"));
  expect(totalWithTax(liability, tax())).toMatchObject({ net: sar("5000"), tax: sar("750"), gross: sar("5750") });
  expect(COMMERCIAL_CAPABILITIES.managedCheckout.mode).toBe("UNAVAILABLE");
  // No paid balance, immutable tax allocation or cumulative refund journal exists here.
  // This pure subtotal therefore cannot establish a refundable amount or move funds.
});

it("requires bounded explicit dated tax metadata and does not infer registration/treatment from SAR", () => {
  for (const treatment of ["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"]) {
    const value = { ...tax(), treatment, rateBasisPoints: 0 };
    expect(TaxTreatmentSchema.parse(value)).toStrictEqual(value);
    expect(totalWithTax(sar("9900"), value)).toMatchObject({ tax: sar("0"), gross: sar("9900") });
    expect(TaxTreatmentSchema.safeParse({ ...value, rateBasisPoints: 1 }).success).toBe(false);
  }
  for (const invalid of [
    null, {}, { ...tax(), policyVersionId: null }, { ...tax(), policyVersionId: "" },
    { ...tax(), reviewedAt: "2026-10-05" }, { ...tax(), reviewedAt: null }, { ...tax(), treatment: "GUESS_FROM_SAR" },
    { ...tax(), rateBasisPoints: 0 }, { ...tax(), rateBasisPoints: -1 }, { ...tax(), rateBasisPoints: 10001 },
    { ...tax(), rateBasisPoints: 1500.5 }, { ...tax(), rateBasisPoints: "1500" }, { ...tax(), verified: true },
  ]) expect(() => totalWithTax(sar("9900"), invalid)).toThrow();
  // Structurally accepted synthetic metadata is not evidence of professional review.
  expect(totalWithTax(sar("0"), tax())).toMatchObject({ net: sar("0"), tax: sar("0"), gross: sar("0") });
  expect(COMMERCIAL_CAPABILITIES.managedCheckout.mode).toBe("UNAVAILABLE");
});
