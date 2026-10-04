import { describe, expect, it } from "vitest";
import { OfferTermsSchema, validateOfferTerms } from "../src/lib/contracts/offers";

const offer = {
  deliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 1 }],
  amount: { amountMinor: "10000", currencyCode: "SAR" },
  period: { startsAt: "2026-10-02T10:00:00.000Z", endsAt: "2026-10-03T10:00:00.000Z", timeZone: "Asia/Riyadh" },
  usageRights: "إعادة نشر لمدة شهر", note: { text: "عرضنا الأصلي", language: "ar" },
  governingTermsVersionId: "terms-reviewed-sa-v1", licencePolicyVersionIds: [],
};

describe("shared creator-specific offer terms", () => {
  it("preserves original text, exact amount and explicit reviewed-terms reference", () => {
    expect(OfferTermsSchema.parse(offer)).toEqual(offer);
    expect(OfferTermsSchema.safeParse({ ...offer, governingTermsVersionId: "" }).success).toBe(false);
    expect(OfferTermsSchema.safeParse({ ...offer, amount: { amountMinor: "0", currencyCode: "SAR" } }).success).toBe(false);
    expect(OfferTermsSchema.safeParse({ ...offer, amount: { amountMinor: "1.0", currencyCode: "SAR" } }).success).toBe(false);
  });

  it("validates campaign currency and supported count subset without extrapolation", () => {
    expect(validateOfferTerms(offer, { currencyCode: "SAR", supportedDeliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 2 }] })).toEqual(offer);
    expect(() => validateOfferTerms(offer, { currencyCode: "USD" })).toThrow(/currency/i);
    expect(() => validateOfferTerms(offer, { currencyCode: "SAR", supportedDeliverables: [{ platform: "INSTAGRAM", format: "STORY", count: 3 }] })).toThrow(/supported/i);
    expect(() => validateOfferTerms({ ...offer, deliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 3 }] }, { currencyCode: "SAR", supportedDeliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 2 }] })).toThrow(/count/i);
  });
});
