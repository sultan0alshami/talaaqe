import { describe, expect, it } from "vitest";
import type { TaxTreatment } from "@/lib/commercial/contracts";
import { MAX_MINOR_UNITS } from "@/lib/contracts/money";
import { calculateManagedQuote, ManagedQuoteCalculationError } from "@/lib/managed/quote-calculation";

const reviewedTax: TaxTreatment = {
  policyVersionId: "synthetic-quote-tax-review-v1",
  reviewedAt: "2026-10-07T01:00:00.000Z",
  treatment: "STANDARD_RATE",
  rateBasisPoints: 1500,
};
const exemptTax: TaxTreatment = { ...reviewedTax, treatment: "EXEMPT", rateBasisPoints: 0 };

function cancellation(netMinor: string, booked = "0", draft = booked, approved = draft, completed = netMinor) {
  return { BEFORE_COMMITMENT: "0", BOOKED: booked, DRAFT: draft, APPROVED: approved, PUBLISHED_COMPLETED: completed };
}
function item(id: string, netMinor: string, stages = cancellation(netMinor)) {
  return { id, netMinor, cancellation: stages };
}
function quoteInput(
  items = [item("retail-item", "10")], expectedNetMinor = "10", currencyCode = "SAR", taxTreatment = reviewedTax,
) {
  return { currencyCode, expectedNetMinor, taxTreatment, items };
}
function expectCalculationError(input: unknown, code: "VALIDATION" | "AMOUNT_OVERFLOW" | "TOTAL_MISMATCH") {
  let failure: unknown;
  try { calculateManagedQuote(input); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ManagedQuoteCalculationError);
  expect(failure).toMatchObject({ code, status: 422 });
}

describe("managed customer retail quote calculation", () => {
  it("allocates rounded subtotal VAT by net weight and immutable ID while retaining caller item order", () => {
    const entries = [
      item("a", "3", cancellation("3", "1", "2", "3")),
      item("middle", "4", cancellation("4", "1", "2", "3")),
      item("Z", "3", cancellation("3", "1", "2", "3")),
      item("000-zero", "0"),
    ];
    const input = quoteInput(entries);
    const original = structuredClone(input);
    const result = calculateManagedQuote(input);
    // VAT is 1.5 minor units, rounded once to 2. Remainders rank middle first,
    // then Z before a by ASCII ID. The zero-weight row receives no VAT.
    expect(result).toEqual({
      currencyCode: "SAR", net: "10", tax: "2", gross: "12", treatment: reviewedTax,
      items: [
        { id: "a", net: "3", tax: "0", gross: "3", cancellation: entries[0].cancellation },
        { id: "middle", net: "4", tax: "1", gross: "5", cancellation: entries[1].cancellation },
        { id: "Z", net: "3", tax: "1", gross: "4", cancellation: entries[2].cancellation },
        { id: "000-zero", net: "0", tax: "0", gross: "0", cancellation: entries[3].cancellation },
      ],
      cancellationTotals: cancellation("10", "3", "6", "9"),
    });
    const shuffled = calculateManagedQuote(quoteInput([entries[2], entries[3], entries[0], entries[1]]));
    expect(shuffled.items.map(row => row.id)).toEqual(["Z", "000-zero", "a", "middle"]);
    expect(Object.fromEntries(shuffled.items.map(row => [row.id, row.tax]))).toEqual({
      Z: "1", "000-zero": "0", a: "0", middle: "1",
    });
    expect(shuffled).toMatchObject({ net: result.net, tax: result.tax, gross: result.gross, cancellationTotals: result.cancellationTotals });
    expect(input).toEqual(original);
    // Allocate the recorded rounded tax subtotal, rather than re-taxing each row:
    // 5 tax units over 21/6/3 net gives quotas 3.5/1/0.5 and the ID tie goes to bulk-a.
    const subtotalAllocation = calculateManagedQuote(quoteInput([
      item("small-z", "3"), item("middle", "6"), item("bulk-a", "21"),
    ], "30"));
    expect(subtotalAllocation).toMatchObject({ net: "30", tax: "5", gross: "35" });
    expect(subtotalAllocation.items.map(row => ({ id: row.id, tax: row.tax, gross: row.gross }))).toEqual([
      { id: "small-z", tax: "0", gross: "3" }, { id: "middle", tax: "1", gross: "7" }, { id: "bulk-a", tax: "4", gross: "25" },
    ]);
  });

  it("accepts 100 arbitrary retail items independently of the 12-creator matching limit and rejects 101", () => {
    const entries = Array.from({ length: 100 }, (_, index) => item(`retail-${index.toString().padStart(3, "0")}`, "1")).reverse();
    const result = calculateManagedQuote(quoteInput(entries, "100"));
    expect(result).toMatchObject({ net: "100", tax: "15", gross: "115", cancellationTotals: cancellation("100") });
    expect(result.items.map(row => row.id)).toEqual(entries.map(row => row.id));
    expect(result.items).toHaveLength(100);
    for (const row of result.items) {
      expect(row.tax).toBe(row.id < "retail-015" ? "1" : "0");
      expect(row.gross).toBe(row.id < "retail-015" ? "2" : "1");
    }
    expectCalculationError(quoteInput([...entries, item("retail-extra", "1")], "101"), "VALIDATION");
  });

  it("handles an all-zero denominator and exact JPY/KWD integer minor units above the Number safe range", () => {
    const zero = calculateManagedQuote(quoteInput([item("zero-a", "0"), item("zero-b", "0")], "0"));
    expect(zero).toEqual({
      currencyCode: "SAR", net: "0", tax: "0", gross: "0", treatment: reviewedTax,
      items: [
        { id: "zero-a", net: "0", tax: "0", gross: "0", cancellation: cancellation("0") },
        { id: "zero-b", net: "0", tax: "0", gross: "0", cancellation: cancellation("0") },
      ],
      cancellationTotals: cancellation("0"),
    });
    for (const currencyCode of ["JPY", "KWD"]) {
      const result = calculateManagedQuote(quoteInput([item("large-retail", "9007199254740993")], "9007199254740993", currencyCode));
      expect(result).toMatchObject({ currencyCode, net: "9007199254740993", tax: "1351079888211149", gross: "10358279142952142" });
      expect(result.items).toEqual([{
        id: "large-retail", net: "9007199254740993", tax: "1351079888211149", gross: "10358279142952142",
        cancellation: cancellation("9007199254740993"),
      }]);
      expect(result.cancellationTotals).toEqual(cancellation("9007199254740993"));
    }
  });

  it("checks canonical input and aggregate bounds without rejecting valid BIGINT intermediates", () => {
    const maximum = MAX_MINOR_UNITS.toString();
    const aboveMaximum = "9223372036854775808";
    const atBoundary = calculateManagedQuote(quoteInput([item("maximum", maximum)], maximum, "SAR", exemptTax));
    expect(atBoundary).toMatchObject({ net: maximum, tax: "0", gross: maximum, cancellationTotals: cancellation(maximum) });
    const nearBoundary = calculateManagedQuote(quoteInput(
      [item("large-valid-tax", "4611686018427387903")], "4611686018427387903", "SAR", { ...reviewedTax, rateBasisPoints: 10000 },
    ));
    expect(nearBoundary).toMatchObject({ net: "4611686018427387903", tax: "4611686018427387903", gross: "9223372036854775806" });
    expectCalculationError(quoteInput([item("maximum", maximum), item("extra", "1")], maximum, "SAR", exemptTax), "AMOUNT_OVERFLOW");
    expectCalculationError(quoteInput([item("maximum", maximum)], maximum), "AMOUNT_OVERFLOW");
    expectCalculationError(quoteInput([item("too-large", aboveMaximum)], "0", "SAR", exemptTax), "AMOUNT_OVERFLOW");
    expectCalculationError(quoteInput([item("retail-item", "10")], aboveMaximum), "AMOUNT_OVERFLOW");
    expectCalculationError(quoteInput([item("retail-item", "10", { ...cancellation("10"), PUBLISHED_COMPLETED: aboveMaximum })]), "AMOUNT_OVERFLOW");
  });

  it("requires the retail allocation sum to match the declared accepted net exactly", () => {
    const entries = [item("production", "7"), item("review", "3")];
    for (const declaredNet of ["9", "11"]) expectCalculationError(quoteInput(entries, declaredNet), "TOTAL_MISMATCH");
    expect(calculateManagedQuote(quoteInput(entries))).toMatchObject({ net: "10", tax: "2", gross: "12" });
  });

  it("retains explicit noncumulative stage totals and rejects incomplete, extra, decreasing or over-cap liabilities", () => {
    const first = cancellation("100", "20", "50", "75", "80");
    const second = cancellation("200", "30", "90", "100", "150");
    const result = calculateManagedQuote(quoteInput([item("first", "100", first), item("second", "200", second)], "300", "SAR", exemptTax));
    expect(result.items.map(row => row.cancellation)).toEqual([first, second]);
    expect(result.cancellationTotals).toEqual({ BEFORE_COMMITMENT: "0", BOOKED: "50", DRAFT: "140", APPROVED: "175", PUBLISHED_COMPLETED: "230" });
    const missingDraft = { BEFORE_COMMITMENT: "0", BOOKED: "20", APPROVED: "75", PUBLISHED_COMPLETED: "80" };
    for (const stages of [
      missingDraft, { ...first, REVIEWED: "75" }, { ...first, BEFORE_COMMITMENT: "1" },
      { ...first, DRAFT: "19" }, { ...first, PUBLISHED_COMPLETED: "101" },
    ]) expectCalculationError({ ...quoteInput([item("first", "100")], "100"), items: [{ id: "first", netMinor: "100", cancellation: stages }] }, "VALIDATION");
  });

  it("rejects duplicate or malformed item identities, noncanonical money and hidden supplier fields at every input level", () => {
    expect(calculateManagedQuote(quoteInput([item("a".repeat(200), "10")])).items[0].id).toBe("a".repeat(200));
    for (const id of ["", " ", "two words", "line\nbreak", "إنفيم", "a".repeat(201)]) {
      expectCalculationError(quoteInput([item(id, "10")]), "VALIDATION");
    }
    expectCalculationError(quoteInput([item("duplicate", "5"), item("duplicate", "5")]), "VALIDATION");
    for (const netMinor of [10, "01", "10.0", "1e1", "-1", "+10", ""]) {
      expectCalculationError({ ...quoteInput(), items: [{ ...item("retail-item", "10"), netMinor }] }, "VALIDATION");
    }
    for (const hidden of [
      { ...quoteInput(), supplierCostMinor: "1" },
      { ...quoteInput(), items: [{ ...item("retail-item", "10"), supplierCostMinor: "1" }] },
      { ...quoteInput(), items: [{ ...item("retail-item", "10"), currencyCode: "USD" }] },
      { ...quoteInput(), items: [{ ...item("retail-item", "10"), cancellation: { ...cancellation("10"), supplierCostMinor: "1" } }] },
      { ...quoteInput(), taxTreatment: { ...reviewedTax, supplierCostMinor: "1" } },
    ]) expectCalculationError(hidden, "VALIDATION");
  });

  it("requires the explicit reviewed tax treatment and ISO currency, with half-up rounding and no inferred VAT", () => {
    const halfRate = { ...reviewedTax, rateBasisPoints: 5000 };
    expect(calculateManagedQuote(quoteInput([item("half-unit", "1")], "1", "JPY", halfRate))).toMatchObject({ net: "1", tax: "1", gross: "2", treatment: halfRate });
    for (const treatment of ["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"] as const) {
      const explicit = { ...reviewedTax, treatment, rateBasisPoints: 0 };
      expect(calculateManagedQuote(quoteInput(undefined, "10", "SAR", explicit))).toMatchObject({ net: "10", tax: "0", gross: "10", treatment: explicit });
    }
    for (const taxTreatment of [
      undefined, null, {}, { ...reviewedTax, policyVersionId: "" }, { ...reviewedTax, reviewedAt: "yesterday" },
      { ...reviewedTax, reviewedAt: undefined }, { ...reviewedTax, rateBasisPoints: "1500" },
      { ...reviewedTax, treatment: "STANDARD_RATE", rateBasisPoints: 0 }, { ...reviewedTax, treatment: "EXEMPT" },
    ]) expectCalculationError({ ...quoteInput(), taxTreatment }, "VALIDATION");
    for (const currencyCode of ["sar", "XXX", "XAU", "ZZZ", 682]) {
      expectCalculationError({ ...quoteInput(), currencyCode }, "VALIDATION");
    }
  });
});
