import { CurrencyCodeSchema, MoneySchema, addMoney, multiplyMoney, type Money } from "../contracts/money";
import { DeliverablesSchema, PLATFORM_FORMATS, type Deliverable } from "../contracts/vocabulary";
import type { BasketQuote, CreatorInput, MatchingAccount } from "./types";

export function quoteBasket(creator: CreatorInput, requested: Deliverable[], accounts: readonly MatchingAccount[], currencyInput: string): BasketQuote {
  const currencyCode = CurrencyCodeSchema.parse(currencyInput);
  const deliverables = DeliverablesSchema.parse(requested);
  const supported = deliverables.filter((row) => accounts.some((account) => account.platform === row.platform && account.supportedFormats.includes(row.format)));
  const unsupported = deliverables.filter((row) => !supported.includes(row));
  const rateByKey = new Map<string, Money>();
  for (const rate of creator.rates) {
    if (rate.creatorId !== creator.id) throw new Error("Rate must belong to this creator");
    if (!PLATFORM_FORMATS[rate.platform]?.includes(rate.format)) throw new Error("Invalid rate platform format");
    const amount = MoneySchema.parse(rate.amount);
    if (BigInt(amount.amountMinor) <= BigInt(0)) throw new Error("Rate must be positive");
    const key = `${rate.platform}:${rate.format}:${amount.currencyCode}`;
    if (rateByKey.has(key)) throw new Error("Duplicate creator/platform/format/currency rate");
    rateByKey.set(key, amount);
  }
  const minimumInput = creator.minimumDeal === null ? null : MoneySchema.parse(creator.minimumDeal);
  if (creator.minimumDealKnown !== undefined && typeof creator.minimumDealKnown !== "boolean") throw new Error("Invalid minimum knowledge flag");
  const minimumKnown = creator.minimumDealKnown !== false && (minimumInput === null || minimumInput.currencyCode === currencyCode);
  const minimum = minimumKnown && minimumInput?.currencyCode === currencyCode ? minimumInput : null;
  const rows = supported.map((deliverable) => {
    const rate = rateByKey.get(`${deliverable.platform}:${deliverable.format}:${currencyCode}`);
    return { deliverable, amount: rate ? multiplyMoney(rate, deliverable.count) : null, missingReason: rate ? null : "NO_MATCHING_CURRENCY_RATE" as const };
  });
  const priced = rows.filter((row) => row.amount !== null);
  const subtotal = priced.length ? priced.reduce((total, row) => addMoney(total, row.amount!), { amountMinor: "0", currencyCode }) : null;
  const coverage = !priced.length ? "MISSING" : priced.length === rows.length && minimumKnown ? "FULL" : "PARTIAL";
  const total = coverage === "FULL" ? subtotal : null;
  const comparisonAmount = total ? { amountMinor: (BigInt(total.amountMinor) > BigInt(minimum?.amountMinor ?? "0") ? BigInt(total.amountMinor) : BigInt(minimum?.amountMinor ?? "0")).toString(), currencyCode } : null;
  return { coverage, currencyCode, supported, unsupported, rows, subtotal, total, minimum, minimumKnown, comparisonAmount };
}
export function budgetFit(quote: BasketQuote, allocationInput: Money): number | null {
  const allocation = MoneySchema.parse(allocationInput);
  if (quote.coverage !== "FULL" || !quote.comparisonAmount || quote.currencyCode !== allocation.currencyCode) return null;
  const price = BigInt(MoneySchema.parse(quote.comparisonAmount).amountMinor);
  const budget = BigInt(allocation.amountMinor);
  if (budget === BigInt(0)) return null;
  if (price <= budget) return 1;
  if (price * BigInt(2) >= budget * BigInt(3)) return 0;
  // Exact comparisons and subtraction precede the final dimensionless float conversion.
  return Number(budget * BigInt(3) - price * BigInt(2)) / Number(budget);
}
