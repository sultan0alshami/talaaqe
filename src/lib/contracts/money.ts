import { z } from "zod";

// SIX ISO4217 current list, published2026-09-17, checked2026-10-01.
// https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
// Numeric minor units only; CcyNm IsFund=true and N/A commodity/test codes excluded.
export const CURRENCY_SOURCE = { publishedAt: "2026-09-17", checkedAt: "2026-10-01", version: "iso4217-six-2026-09-17-tender" } as const;
export const MAX_MINOR_UNITS = BigInt("9223372036854775807");
const currencyGroups: Record<number, string> = {
  0: "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF",
  2: "AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY COP CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG",
  3: "BHD IQD JOD KWD LYD OMR TND",
};
export const CURRENCY_PRECISION: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(
  Object.entries(currencyGroups).flatMap(([precision, codes]) => codes.split(" ").map((code) => [code, Number(precision)])),
));
export const SUPPORTED_CURRENCIES: readonly string[] = Object.freeze(Object.keys(CURRENCY_PRECISION).sort());
// ICU is useful for labels/presentation; it does not define the current ISO vocabulary/precision.
export const INTL_CURRENCY_CODES: readonly string[] = Object.freeze(Intl.supportedValuesOf("currency"));
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/).refine((code) => Object.hasOwn(CURRENCY_PRECISION, code), "Unsupported current ISO currency");
const MinorAmountSchema = z.string().max(19).regex(/^(0|[1-9][0-9]*)$/).refine((amount) => amount.length <= 19 && /^(0|[1-9][0-9]*)$/.test(amount) && BigInt(amount) <= MAX_MINOR_UNITS, "Amount exceeds PostgreSQL BIGINT range");
export const MoneySchema = z.object({ amountMinor: MinorAmountSchema, currencyCode: CurrencyCodeSchema }).strict();
export type Money = z.infer<typeof MoneySchema>;

export function currencyPrecision(currencyCode: string): number {
  return CURRENCY_PRECISION[CurrencyCodeSchema.parse(currencyCode)];
}

export function parseMoney(decimal: string, currencyCode: string): Money {
  const precision = currencyPrecision(currencyCode);
  if (typeof decimal !== "string" || decimal.length > 40 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(decimal)) throw new Error("Amount must be ungrouped nonnegative decimal text");
  const [whole, fraction = ""] = decimal.split(".");
  if (fraction.length > precision) throw new Error("Amount exceeds currency precision");
  const minor = BigInt(whole) * BigInt(10) ** BigInt(precision) + BigInt(fraction.padEnd(precision, "0") || "0");
  return MoneySchema.parse({ amountMinor: minor.toString(), currencyCode });
}

export function formatMoneyDecimal(input: Money): string {
  const money = MoneySchema.parse(input);
  const precision = currencyPrecision(money.currencyCode);
  if (precision === 0) return money.amountMinor;
  const digits = money.amountMinor.padStart(precision + 1, "0");
  return `${digits.slice(0, -precision)}.${digits.slice(-precision)}`;
}

export function addMoney(leftInput: Money, rightInput: Money): Money {
  const left = MoneySchema.parse(leftInput);
  const right = MoneySchema.parse(rightInput);
  if (left.currencyCode !== right.currencyCode) throw new Error("Currency mismatch; automatic FX is unavailable");
  return MoneySchema.parse({ amountMinor: (BigInt(left.amountMinor) + BigInt(right.amountMinor)).toString(), currencyCode: left.currencyCode });
}

export function multiplyMoney(input: Money, count: number): Money {
  const money = MoneySchema.parse(input);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Count must be a nonnegative safe integer");
  return MoneySchema.parse({ amountMinor: (BigInt(money.amountMinor) * BigInt(count)).toString(), currencyCode: money.currencyCode });
}

function validateSlots(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("Planned creator count must be1–12");
}

export function allocateMoney(input: Money, count: number): Money[] {
  const money = MoneySchema.parse(input);
  validateSlots(count);
  const amount = BigInt(money.amountMinor);
  const divisor = BigInt(count);
  const quotient = amount / divisor;
  const remainder = amount % divisor;
  return Array.from({ length: count }, (_, ordinal) => ({ amountMinor: (quotient + (BigInt(ordinal) < remainder ? BigInt(1) : BigInt(0))).toString(), currencyCode: money.currencyCode }));
}

export function allocateIntegerTarget(target: number, count: number): number[] {
  validateSlots(count);
  if (!Number.isSafeInteger(target) || target < 0) throw new Error("Impressions target must be a nonnegative safe integer");
  const quotient = Math.floor(target / count);
  const remainder = target % count;
  return Array.from({ length: count }, (_, ordinal) => quotient + (ordinal < remainder ? 1 : 0));
}
