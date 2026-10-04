import { z } from "zod";
import { CurrencyCodeSchema, MoneySchema } from "./money";
import { DateRangeSchema, DeliverablesSchema, OriginalTextSchema, type Deliverable } from "./vocabulary";

export const OfferTermsSchema = z.object({
  deliverables: DeliverablesSchema,
  amount: MoneySchema.refine((money) => MoneySchema.safeParse(money).success && BigInt(money.amountMinor) > BigInt(0), "Offer amount must be positive"),
  period: DateRangeSchema,
  usageRights: z.string().trim().min(1).max(10000),
  note: OriginalTextSchema,
  governingTermsVersionId: z.string().trim().min(1).max(200),
  licencePolicyVersionIds: z.array(z.string().trim().min(1).max(200)).max(100).refine((ids) => new Set(ids).size === ids.length, "Duplicate policy version"),
}).strict();
export type OfferTerms = z.infer<typeof OfferTermsSchema>;
export type OfferValidationContext = { currencyCode: string; supportedDeliverables?: Deliverable[] };

// Context is loaded/authorized server-side by the owning domain service. This parser does not
// assert actor/ownership/availability/policy eligibility or existence/review of referenced IDs.
export function validateOfferTerms(input: unknown, context: OfferValidationContext): OfferTerms {
  const terms = OfferTermsSchema.parse(input);
  const currency = CurrencyCodeSchema.parse(context.currencyCode);
  if (terms.amount.currencyCode !== currency) throw new Error("Offer currency must match campaign currency");
  if (context.supportedDeliverables) {
    const supported = DeliverablesSchema.parse(context.supportedDeliverables);
    const supportedByKey = new Map(supported.map((row) => [`${row.platform}:${row.format}`, row.count]));
    for (const row of terms.deliverables) {
      const count = supportedByKey.get(`${row.platform}:${row.format}`);
      if (count === undefined) throw new Error("Offer includes unsupported creator deliverable");
      if (row.count > count) throw new Error("Offer count exceeds supported basket");
    }
  }
  return terms;
}
