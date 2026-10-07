import { z } from "zod";
import { CancellationStageSchema, TaxTreatmentSchema, type TaxTreatment } from "@/lib/commercial/contracts";
import { totalWithTax } from "@/lib/commercial/policies";
import { CurrencyCodeSchema, MAX_MINOR_UNITS, MoneySchema } from "@/lib/contracts/money";

export const RETAIL_TAX_ALLOCATION_VERSION = "infame-retail-vat-v1" as const;
const minor = MoneySchema.shape.amountMinor;
const stages = z.object({ BEFORE_COMMITMENT: minor, BOOKED: minor, DRAFT: minor, APPROVED: minor, PUBLISHED_COMPLETED: minor }).strict();
const inputSchema = z.object({ currencyCode: CurrencyCodeSchema, expectedNetMinor: minor, taxTreatment: TaxTreatmentSchema,
  items: z.array(z.object({ id: z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/), netMinor: minor, cancellation: stages }).strict()).min(1).max(100),
}).strict();

export type ManagedQuoteStage = "BEFORE_COMMITMENT" | "BOOKED" | "DRAFT" | "APPROVED" | "PUBLISHED_COMPLETED";
export type ManagedQuoteCalculation = {
  currencyCode: string; net: string; tax: string; gross: string;
  items: Array<{ id: string; net: string; tax: string; gross: string; cancellation: Record<ManagedQuoteStage, string> }>;
  cancellationTotals: Record<ManagedQuoteStage, string>; treatment: TaxTreatment;
};
export class ManagedQuoteCalculationError extends Error {
  constructor(public readonly code: "VALIDATION" | "AMOUNT_OVERFLOW" | "TOTAL_MISMATCH", public readonly status = 422) {
    super(code); this.name = "ManagedQuoteCalculationError";
  }
}
export function calculateManagedQuote(input: unknown): ManagedQuoteCalculation {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const overflow = parsed.error.issues.some(issue => {
      if (issue.message !== "Amount exceeds PostgreSQL BIGINT range") return false;
      let value: unknown = input;
      for (const key of issue.path) {
        if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return false;
        value = (value as Record<PropertyKey, unknown>)[key];
      }
      return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
        && (value.length > 19 || BigInt(value) > MAX_MINOR_UNITS);
    });
    throw new ManagedQuoteCalculationError(overflow ? "AMOUNT_OVERFLOW" : "VALIDATION");
  }
  const quote = parsed.data;
  if (new Set(quote.items.map(item => item.id)).size !== quote.items.length) throw new ManagedQuoteCalculationError("VALIDATION");
  const checked = (value: bigint): bigint => {
    if (value < BigInt(0) || value > MAX_MINOR_UNITS) throw new ManagedQuoteCalculationError("AMOUNT_OVERFLOW");
    return value;
  };
  let net = BigInt(0);
  for (const item of quote.items) {
    net = checked(net + BigInt(item.netMinor));
    let previous = BigInt(0);
    for (const stage of CancellationStageSchema.options) {
      const liability = BigInt(item.cancellation[stage]);
      if (liability < previous || liability > BigInt(item.netMinor) || stage === "BEFORE_COMMITMENT" && liability !== BigInt(0)) {
        throw new ManagedQuoteCalculationError("VALIDATION");
      }
      previous = liability;
    }
  }
  if (net.toString() !== quote.expectedNetMinor) throw new ManagedQuoteCalculationError("TOTAL_MISMATCH");
  let tax: bigint;
  try { tax = BigInt(totalWithTax({ amountMinor: net.toString(), currencyCode: quote.currencyCode }, quote.taxTreatment).tax.amountMinor); }
  catch { throw new ManagedQuoteCalculationError("AMOUNT_OVERFLOW"); }
  const gross = checked(net + tax);
  // Prorate the recorded, rounded quote subtotal. Rounding every item at the
  // tax rate independently can lose or add a minor unit. Ties use fixed ASCII
  // identity, so sorting the customer's displayed rows cannot change their tax.
  const allocations = quote.items.map(item => {
    const numerator = tax * BigInt(item.netMinor);
    return { id: item.id, amount: net === BigInt(0) ? BigInt(0) : numerator / net,
      remainder: net === BigInt(0) ? BigInt(0) : numerator % net };
  });
  const ranking = [...allocations].sort((a, b) => a.remainder === b.remainder
    ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0 : a.remainder > b.remainder ? -1 : 1);
  let remaining = tax - allocations.reduce((sum, item) => sum + item.amount, BigInt(0));
  for (const item of ranking) { if (remaining === BigInt(0)) break; item.amount++; remaining--; }
  if (remaining !== BigInt(0)) throw new ManagedQuoteCalculationError("AMOUNT_OVERFLOW");
  const totals: Record<ManagedQuoteStage, string> = { BEFORE_COMMITMENT: "0", BOOKED: "0", DRAFT: "0", APPROVED: "0", PUBLISHED_COMPLETED: "0" };
  const items = quote.items.map((item, index) => {
    for (const stage of CancellationStageSchema.options) totals[stage] = checked(BigInt(totals[stage]) + BigInt(item.cancellation[stage])).toString();
    const itemTax = checked(allocations[index]!.amount);
    return { id: item.id, net: item.netMinor, tax: itemTax.toString(), gross: checked(BigInt(item.netMinor) + itemTax).toString(),
      cancellation: { ...item.cancellation } };
  });
  return { currencyCode: quote.currencyCode, net: net.toString(), tax: tax.toString(), gross: gross.toString(),
    items, cancellationTotals: totals, treatment: { ...quote.taxTreatment } };
}
