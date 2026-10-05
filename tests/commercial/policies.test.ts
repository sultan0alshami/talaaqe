import { expect, it } from "vitest";
import { assessForecast, cancellationLiability, priceForMargin, reachBand, totalWithTax } from "@/lib/commercial/policies";
import type { Money } from "@/lib/contracts/money";

const sar = (amountMinor: string): Money => ({ amountMinor, currencyCode: "SAR" });
const costs = (creator = "300000", overrides: Record<string, Money> = {}) => ({
  creator: sar(creator), production: sar("0"), labor: sar("25000"), paymentFees: sar("5000"),
  operationsAi: sar("1000"), rework: sar("10000"), nonrecoverableTax: sar("0"), contingency: sar("9000"), ...overrides,
});
const reviewedTax = { policyVersionId: "synthetic-tax-review-v1", reviewedAt: "2026-10-05T01:00:00.000Z", treatment: "STANDARD_RATE", rateBasisPoints: 1500 };
const schedule = { policyVersion: "infame-commercial-v1-2026-10-05", itemNet: sar("10000"), stages: {
  BEFORE_COMMITMENT: sar("0"), BOOKED: sar("2000"), DRAFT: sar("5000"), APPROVED: sar("7500"), PUBLISHED_COMPLETED: sar("10000"),
} };

it("compares contribution margins exactly, includes every cost category and preserves actual loss arithmetic", () => {
  expect(assessForecast(sar("500000"), costs())).toMatchObject({ directCost: sar("350000"), contributionMinor: "150000", targetMet: true, commitmentAllowed: true });
  expect(assessForecast(sar("500000"), costs("325000"))).toMatchObject({ directCost: sar("375000"), targetMet: false, commitmentAllowed: true });
  expect(assessForecast(sar("500000"), costs("325001"))).toMatchObject({ targetMet: false, commitmentAllowed: false });
  expect(assessForecast(sar("500000"), costs("450001"))).toMatchObject({ contributionMinor: "-1", commitmentAllowed: false });
  expect(assessForecast(sar("0"), costs("0", { labor: sar("0"), paymentFees: sar("0"), operationsAi: sar("0"), rework: sar("0"), contingency: sar("0") }))).toMatchObject({ targetMet: false, commitmentAllowed: false });
  // BIGINT boundary stays exact; there is no float conversion or rounded threshold.
  expect(assessForecast(sar("9223372036854775807"), costs("6917529027641081855", { labor: sar("0"), paymentFees: sar("0"), operationsAi: sar("0"), rework: sar("0"), contingency: sar("0") }))).toMatchObject({ commitmentAllowed: true });
  expect(assessForecast(sar("9223372036854775807"), costs("6917529027641081856", { labor: sar("0"), paymentFees: sar("0"), operationsAi: sar("0"), rework: sar("0"), contingency: sar("0") }))).toMatchObject({ commitmentAllowed: false });
});
it("rejects omitted costs, floating amounts, currency mismatch, overflow and invented cost categories", () => {
  const { labor: omitted, ...incomplete } = costs(); expect(omitted).toEqual(sar("25000"));
  for (const input of [incomplete, costs("300000", { labor: { amountMinor: "1", currencyCode: "KWD" } }), costs("9223372036854775807"),
    { ...costs(), labor: { amountMinor: 25000, currencyCode: "SAR" } }, { ...costs(), discount: sar("0") }]) expect(() => assessForecast(sar("500000"), input)).toThrow();
});
it("prices margin as cost divided by retained ratio with exact upward minor-unit rounding", () => {
  expect(priceForMargin(sar("350000"))).toEqual(sar("500000"));
  expect(priceForMargin(sar("1"))).toEqual(sar("2"));
  expect(priceForMargin(sar("375000"), 2500)).toEqual(sar("500000"));
  for (const invalid of [-1, 10000, 1.5, NaN]) expect(() => priceForMargin(sar("1"), invalid)).toThrow();
  expect(() => priceForMargin(sar("9223372036854775807"))).toThrow();
});
it.each([["9900", "1485", "11385"], ["29900", "4485", "34385"], ["99900", "14985", "114885"]])("produces exact selected net/tax/gross totals for explicitly reviewed 15%% treatment", (net, tax, gross) => {
  expect(totalWithTax(sar(net), reviewedTax)).toEqual({ net: sar(net), tax: sar(tax), gross: sar(gross), treatment: reviewedTax });
});
it("requires an explicit treatment and rate rather than inferring VAT from Saudi currency or a key", () => {
  expect(totalWithTax(sar("10"), reviewedTax)).toMatchObject({ tax: sar("2"), gross: sar("12") });
  expect(totalWithTax(sar("9900"), { ...reviewedTax, treatment: "EXEMPT", rateBasisPoints: 0 })).toMatchObject({ tax: sar("0"), gross: sar("9900") });
  for (const invalid of [null, {}, { ...reviewedTax, rateBasisPoints: "1500" }, { ...reviewedTax, treatment: "EXEMPT" },
    { ...reviewedTax, policyVersionId: "" }, { ...reviewedTax, guessedCountry: "SA" }]) expect(() => totalWithTax(sar("9900"), invalid)).toThrow();
  expect(() => totalWithTax(sar("9223372036854775807"), reviewedTax)).toThrow();
});
it("uses a reached cancellation stage's total once, validates all explicit monotonic bounded terms and never sums stage fees", () => {
  expect(cancellationLiability(schedule, "DRAFT")).toEqual(sar("5000"));
  expect(cancellationLiability(schedule, "BEFORE_COMMITMENT")).toEqual(sar("0"));
  const { APPROVED: omitted, ...missing } = schedule.stages; expect(omitted).toEqual(sar("7500"));
  for (const invalid of [ { ...schedule, stages: missing }, { ...schedule, stages: { ...schedule.stages, BEFORE_COMMITMENT: sar("1") } },
    { ...schedule, stages: { ...schedule.stages, DRAFT: sar("1999") } }, { ...schedule, stages: { ...schedule.stages, PUBLISHED_COMPLETED: sar("10001") } },
    { ...schedule, stages: { ...schedule.stages, BOOKED: { amountMinor: "2000", currencyCode: "USD" } } }, { ...schedule, extraFee: sar("1") } ]) expect(() => cancellationLiability(invalid, "DRAFT")).toThrow();
  expect(() => cancellationLiability(schedule, "automatically-approved")).toThrow();
});
it.each([[null, null], ["0", null], ["999", null], ["1000", "NANO"], ["9999", "NANO"], ["10000", "MICRO"], ["99999", "MICRO"],
  ["100000", "MID"], ["499999", "MID"], ["500000", "MACRO"], ["999999", "MACRO"], ["1000000", "MEGA"], ["9223372036854775807", "MEGA"]])("classifies per-account reach boundary %s without fame or inferred followers", (followers, expected) => {
  expect(reachBand(followers)).toBe(expected);
});
it("rejects coerced/noninteger/signed/unsafe follower inputs without changing unknown into zero", () => {
  for (const invalid of [1000, "01", "1000.5", "-1", "9223372036854775808", undefined, NaN]) expect(() => reachBand(invalid as never)).toThrow();
});
