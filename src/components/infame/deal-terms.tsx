"use client";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import type { OfferTerms } from "@/lib/contracts/offers";
import { useDealCopy } from "./deal-copy";

export function DealTerms({ terms }: { terms: OfferTerms }) {
  const { isAr, copy } = useDealCopy();
  const formats: Record<string, [string, string]> = {
    STORY: ["ستوري", "Story"],
    POST: ["منشور", "Post"],
    REEL: ["ريل", "Reel"],
    LIVE: ["بث مباشر", "Live"],
    CAMPAIGN: ["حزمة حملة", "Campaign package"],
    VIDEO: ["فيديو", "Video"],
    SHORT: ["فيديو قصير", "Short"],
  };
  return (
    <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
      <div>
        <dt className="text-sm text-muted-foreground">
          {copy("المقابل", "Payment")}
        </dt>
        <dd className="mt-2 text-xl font-semibold">
          <bdi dir="ltr">
            {formatMoneyDecimal(terms.amount)} {terms.amount.currencyCode}
          </bdi>
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">
          {copy("المخرجات", "Deliverables")}
        </dt>
        <dd className="mt-2">
          <ul className="space-y-2">
            {terms.deliverables.map((row) => (
              <li key={`${row.platform}:${row.format}`}>
                <bdi dir="ltr">{row.platform}</bdi> ·{" "}
                {formats[row.format]?.[isAr ? 0 : 1] ?? row.format} ·{" "}
                {row.count}
              </li>
            ))}
          </ul>
        </dd>
      </div>
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-sm text-muted-foreground">
          {copy("فترة التنفيذ — أوقات UTC", "Delivery period — UTC times")}
        </dt>
        <dd className="mt-2 space-y-2 text-sm">
          <p className="break-all" dir="ltr">
            <time dateTime={terms.period.startsAt}>
              {terms.period.startsAt}
            </time>{" "}
            → <time dateTime={terms.period.endsAt}>{terms.period.endsAt}</time>
          </p>
          <p>
            {copy("منطقة جدول الحملة", "Campaign schedule timezone")}:{" "}
            <bdi dir="ltr">{terms.period.timeZone}</bdi>
          </p>
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-sm text-muted-foreground">
          {copy("حقوق الاستخدام", "Usage rights")}
        </dt>
        <dd className="mt-2 whitespace-pre-wrap break-words" dir="auto">
          {terms.usageRights}
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-sm text-muted-foreground">
          {copy("ملاحظة العرض — النص الأصلي", "Offer note — original text")}
        </dt>
        <dd
          className="mt-2 whitespace-pre-wrap break-words"
          dir="auto"
          lang={terms.note.language ?? undefined}
        >
          {terms.note.text || copy("بدون ملاحظة", "No note")}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-sm text-muted-foreground">
          {copy("نسخة الشروط", "Terms version")}
        </dt>
        <dd className="mt-2 break-all text-sm" dir="ltr">
          {terms.governingTermsVersionId}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-sm text-muted-foreground">
          {copy("نسخ سياسات السوق", "Market policy versions")}
        </dt>
        <dd className="mt-2 break-all text-sm" dir="ltr">
          {terms.licencePolicyVersionIds.join(" · ") ||
            copy("لم تحدد", "Not specified")}
        </dd>
      </div>
    </dl>
  );
}
