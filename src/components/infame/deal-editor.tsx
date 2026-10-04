"use client";
import styles from "./deal-layout.module.css";
import { useId, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MoneySchema,
  SUPPORTED_CURRENCIES,
  formatMoneyDecimal,
  parseMoney,
} from "@/lib/contracts/money";
import { OfferTermsSchema, type OfferTerms } from "@/lib/contracts/offers";
import {
  PLATFORM_FORMATS,
  PlatformSchema,
  TimeZoneSchema,
  UtcDateTimeSchema,
  type Deliverable,
  type OriginalText,
} from "@/lib/contracts/vocabulary";
import { TIMEZONE_SUGGESTIONS } from "@/lib/contracts/timezone-suggestions";
import type { OfferDraftDTO } from "@/lib/deals/drafts";
import { useDealCopy } from "./deal-copy";

export type ReviewedTermsOption = {
  id: string;
  translations: { ar: string; en?: string };
};
export type DraftTerms = OfferDraftDTO["terms"];
const PartialTerms = OfferTermsSchema.partial()
  .extend({
    amount: MoneySchema.partial().optional(),
    period: z
      .object({
        startsAt: UtcDateTimeSchema.optional(),
        endsAt: UtcDateTimeSchema.optional(),
        timeZone: TimeZoneSchema.optional(),
      })
      .strict()
      .refine(
        (period) =>
          !period.startsAt ||
          !period.endsAt ||
          Date.parse(period.startsAt) < Date.parse(period.endsAt),
      )
      .optional(),
  })
  .strict();
const selectClass =
  "min-h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60";
const formats: Record<string, [string, string]> = {
  STORY: ["ستوري", "Story"],
  POST: ["منشور", "Post"],
  REEL: ["ريل", "Reel"],
  LIVE: ["بث مباشر", "Live"],
  CAMPAIGN: ["حزمة حملة", "Campaign package"],
  VIDEO: ["فيديو", "Video"],
  SHORT: ["فيديو قصير", "Short"],
};
function utcValue(value: string) {
  const seconds = value.length === 16 ? `${value}:00` : value;
  const normalized = `${seconds.includes(".") ? seconds.replace(/\.(\d{1,3})$/, (_match, digits: string) => `.${digits.padEnd(3, "0")}`) : `${seconds}.000`}Z`;
  return UtcDateTimeSchema.parse(normalized);
}

export function DealEditor({
  initialTerms,
  templates,
  mandatoryPolicyVersionIds,
  busy,
  blockedReasons = [],
  submitLabel,
  onSave,
  onSubmit,
  onDirty,
}: {
  initialTerms: DraftTerms;
  templates: ReviewedTermsOption[];
  mandatoryPolicyVersionIds: string[];
  busy: boolean;
  blockedReasons?: string[];
  submitLabel: string;
  onSave: (patch: DraftTerms) => Promise<void>;
  onSubmit: (terms: OfferTerms) => Promise<void>;
  onDirty?: () => void;
}) {
  const { isAr, copy, errorCopy } = useDealCopy(),
    prefix = useId();
  const [currency, setCurrency] = useState(
      initialTerms.amount?.currencyCode ?? "",
    ),
    [amount, setAmount] = useState(() =>
      initialTerms.amount?.amountMinor && initialTerms.amount.currencyCode
        ? formatMoneyDecimal(
            initialTerms.amount as {
              amountMinor: string;
              currencyCode: string;
            },
          )
        : "",
    );
  const [rows, setRows] = useState<Deliverable[]>(
    initialTerms.deliverables ?? [],
  );
  const [starts, setStarts] = useState(
      initialTerms.period?.startsAt?.replace(/Z$/, "") ?? "",
    ),
    [ends, setEnds] = useState(
      initialTerms.period?.endsAt?.replace(/Z$/, "") ?? "",
    ),
    [zone, setZone] = useState(initialTerms.period?.timeZone ?? "");
  const [rights, setRights] = useState(initialTerms.usageRights ?? ""),
    [note, setNote] = useState<OriginalText>(
      initialTerms.note ?? { text: "", language: null },
    );
  const [termsId, setTermsId] = useState(
      initialTerms.governingTermsVersionId ?? "",
    ),
    [policyIds, setPolicyIds] = useState(
      initialTerms.licencePolicyVersionIds ?? [],
    );
  const [error, setError] = useState<string | null>(null);
  const selectedTemplate = templates.find(
    (template) => template.id === termsId,
  );
  function dirty(action: () => void) {
    action();
    setError(null);
    onDirty?.();
  }
  function patch(): DraftTerms {
    const result: Record<string, unknown> = {
      note,
      licencePolicyVersionIds: policyIds,
    };
    if (rows.length) result.deliverables = rows;
    if (amount.trim()) result.amount = parseMoney(amount.trim(), currency);
    else if (currency) result.amount = { currencyCode: currency };
    if (starts || ends || zone)
      result.period = {
        ...(starts ? { startsAt: utcValue(starts) } : {}),
        ...(ends ? { endsAt: utcValue(ends) } : {}),
        ...(zone ? { timeZone: zone } : {}),
      };
    if (rights.trim()) result.usageRights = rights.trim();
    if (termsId) result.governingTermsVersionId = termsId;
    return PartialTerms.parse(result);
  }
  async function save() {
    try {
      setError(null);
      await onSave(patch());
    } catch {
      setError("VALIDATION");
    }
  }
  async function submit() {
    try {
      setError(null);
      const terms = OfferTermsSchema.parse(patch());
      if (!selectedTemplate) {
        setError("POLICY_UNAVAILABLE");
        return;
      }
      await onSubmit(terms);
    } catch {
      setError("VALIDATION");
    }
  }
  const field = (name: string) => `${prefix}-${name}`;
  return (
    <fieldset className={styles.editor} disabled={busy}>
      <legend className="sr-only">{copy("شروط العرض", "Offer terms")}</legend>
      <Card>
        <CardHeader>
          <CardTitle><h2>
            {copy("المخرجات والمقابل", "Deliverables and payment")}
          </h2></CardTitle>
          <CardDescription>
            {copy(
              "حدد المخرجات الفعلية، والمبلغ بعملة العرض. لا يتم تحويل العملات تلقائيًا.",
              "Choose the actual deliverables and the offer currency. Currency conversion is unavailable.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label
              htmlFor={field("currency")}
              className="grid gap-2 text-sm font-medium"
            >
              {copy("عملة العرض", "Offer currency")}
              <select
                aria-label={copy("عملة العرض", "Offer currency")}
                id={field("currency")}
                value={currency}
                onChange={(event) =>
                  dirty(() => setCurrency(event.target.value))
                }
                className={selectClass}
                dir="ltr"
              >
                <option value="">
                  {copy("اختر العملة", "Choose currency")}
                </option>
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label
              htmlFor={field("amount")}
              className="grid gap-2 text-sm font-medium"
            >
              {copy("المبلغ", "Amount")}
              <Input
                id={field("amount")}
                inputMode="decimal"
                value={amount}
                onChange={(event) => dirty(() => setAmount(event.target.value))}
                placeholder={currency ? "0" : ""}
                dir="ltr"
                autoComplete="off"
              />
            </label>
          </div>
          <fieldset className="space-y-4">
            <legend className="mb-3 text-sm font-medium">
              {copy("المخرجات", "Deliverables")}
            </legend>
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {copy("ما أضفت مخرجات بعد.", "No deliverables added yet.")}
              </p>
            )}
            {rows.map((row, index) => (
              <div
                key={index}
                className={styles.deliverable}
              >
                <label className="grid gap-2 text-sm">
                  {copy("المنصة", "Platform")}
                  <select
                    aria-label={copy("المنصة", "Platform")}
                    className={selectClass}
                    value={row.platform}
                    onChange={(event) =>
                      dirty(() => {
                        const platform = PlatformSchema.parse(
                          event.target.value,
                        );
                        setRows((previous) =>
                          previous.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  platform,
                                  format: PLATFORM_FORMATS[platform][0],
                                }
                              : item,
                          ),
                        );
                      })
                    }
                  >
                    {PlatformSchema.options.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  {copy("الصيغة", "Format")}
                  <select
                    aria-label={copy("الصيغة", "Format")}
                    className={selectClass}
                    value={row.format}
                    onChange={(event) =>
                      dirty(() =>
                        setRows((previous) =>
                          previous.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  format: event.target
                                    .value as Deliverable["format"],
                                }
                              : item,
                          ),
                        ),
                      )
                    }
                  >
                    {PLATFORM_FORMATS[row.platform].map((format) => (
                      <option key={format} value={format}>
                        {formats[format]?.[isAr ? 0 : 1] ?? format}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  {copy("العدد", "Count")}
                  <Input
                    aria-label={copy("العدد", "Count")}
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    value={row.count || ""}
                    dir="ltr"
                    onChange={(event) =>
                      dirty(() =>
                        setRows((previous) =>
                          previous.map((item, i) =>
                            i === index
                              ? { ...item, count: Number(event.target.value) }
                              : item,
                          ),
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  variant="outline"
                  className="self-end"
                  onClick={() =>
                    dirty(() =>
                      setRows((previous) =>
                        previous.filter((_, i) => i !== index),
                      ),
                    )
                  }
                  aria-label={copy(
                    `احذف المخرج ${index + 1}`,
                    `Remove deliverable ${index + 1}`,
                  )}
                >
                  {copy("احذف", "Remove")}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                dirty(() =>
                  setRows((previous) => [
                    ...previous,
                    { platform: "INSTAGRAM", format: "STORY", count: 1 },
                  ]),
                )
              }
              disabled={rows.length >= 100}
            >
              {copy("أضف مخرجًا", "Add deliverable")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {copy(
                "راجع المنصة والصيغة والعدد لكل مخرج قبل الإرسال.",
                "Review every deliverable's platform, format and count before sending.",
              )}
            </p>
          </fieldset>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><h2>{copy("فترة التنفيذ", "Delivery period")}</h2></CardTitle>
          <CardDescription>
            {copy(
              "أدخل الأوقات بتوقيت UTC، واختر منطقة IANA للحملة صراحةً. لا تؤخذ من البلد أو إعدادات جهازك.",
              "Enter times in UTC and explicitly choose the campaign's IANA timezone. These are never inferred from your country or device.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <label
            htmlFor={field("starts")}
            className="grid gap-2 text-sm font-medium"
          >
            {copy("البداية (UTC)", "Starts at (UTC)")}
            <Input
              id={field("starts")}
              type="datetime-local"
              step="0.001"
              value={starts}
              dir="ltr"
              onChange={(event) => dirty(() => setStarts(event.target.value))}
            />
          </label>
          <label
            htmlFor={field("ends")}
            className="grid gap-2 text-sm font-medium"
          >
            {copy("النهاية (UTC)", "Ends at (UTC)")}
            <Input
              id={field("ends")}
              type="datetime-local"
              step="0.001"
              value={ends}
              dir="ltr"
              onChange={(event) => dirty(() => setEnds(event.target.value))}
            />
          </label>
          <label
            htmlFor={field("zone")}
            className="grid gap-2 text-sm font-medium sm:col-span-2"
          >
            {copy("المنطقة الزمنية (IANA)", "Timezone (IANA)")}
            <Input
              aria-label={copy("المنطقة الزمنية (IANA)", "Timezone (IANA)")}
              id={field("zone")}
              list={field("zones")}
              value={zone}
              dir="ltr"
              autoComplete="off"
              onChange={(event) => dirty(() => setZone(event.target.value))}
            />
            <datalist id={field("zones")}>
              {TIMEZONE_SUGGESTIONS.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <span className="text-xs font-normal text-muted-foreground">
              {copy(
                "خانة المنطقة تسجل سياق الجدول؛ لا تحول أوقات UTC المدخلة.",
                "The timezone records the schedule's context; it does not convert the entered UTC times.",
              )}
            </span>
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><h2>
            {copy("حقوق الاستخدام والملاحظات", "Usage rights and notes")}
          </h2></CardTitle>
          <CardDescription>
            {copy(
              "النص الذي تكتبه يبقى بلغته الأصلية عند تغيير لغة الواجهة.",
              "Your text keeps its original language when the interface language changes.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label
            htmlFor={field("rights")}
            className="grid gap-2 text-sm font-medium"
          >
            {copy("حقوق الاستخدام", "Usage rights")}
            <Textarea
              aria-label={copy("حقوق الاستخدام", "Usage rights")}
              id={field("rights")}
              rows={4}
              maxLength={10000}
              value={rights}
              dir="auto"
              onChange={(event) => dirty(() => setRights(event.target.value))}
            />
          </label>
          <label
            htmlFor={field("note")}
            className="grid gap-2 text-sm font-medium"
          >
            {copy("ملاحظة العرض", "Offer note")}
            <Textarea
              aria-label={copy("ملاحظة العرض", "Offer note")}
              id={field("note")}
              rows={4}
              maxLength={20000}
              value={note.text}
              dir="auto"
              onChange={(event) =>
                dirty(() =>
                  setNote((previous) => ({
                    ...previous,
                    text: event.target.value,
                  })),
                )
              }
            />
          </label>
          <label
            htmlFor={field("language")}
            className="grid gap-2 text-sm font-medium"
          >
            {copy(
              "لغة الملاحظة (اختيارية، BCP47)",
              "Note language (optional, BCP47)",
            )}
            <Input
              aria-label={copy(
                "لغة الملاحظة (اختيارية، BCP47)",
                "Note language (optional, BCP47)",
              )}
              id={field("language")}
              value={note.language ?? ""}
              dir="ltr"
              autoComplete="off"
              onChange={(event) =>
                dirty(() =>
                  setNote((previous) => ({
                    ...previous,
                    language: event.target.value || null,
                  })),
                )
              }
            />
            <span className="text-xs font-normal text-muted-foreground">
              {copy(
                "مثل ar أو en. اتركها فارغة إذا لم تحدد لغة النص.",
                "For example, ar or en. Leave blank if the text language is undeclared.",
              )}
            </span>
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><h2>
            {copy("الشروط والسياسات المراجعة", "Reviewed terms and policies")}
          </h2></CardTitle>
          <CardDescription>
            {copy(
              "اختر نسخة مراجعة مناسبة للطرفين والأسواق الفعلية. حفظ المسودة لا يعتمد الشروط ولا يؤكد أهلية الصفقة.",
              "Choose a reviewed version for the actual parties and markets. Saving a draft does not approve terms or establish eligibility.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label
            htmlFor={field("template")}
            className="grid gap-2 text-sm font-medium"
          >
            {copy("نسخة الشروط", "Terms version")}
            <select
              aria-label={copy("نسخة الشروط", "Terms version")}
              id={field("template")}
              className={selectClass}
              value={termsId}
              onChange={(event) => dirty(() => setTermsId(event.target.value))}
              disabled={!templates.length}
            >
              <option value="">
                {templates.length
                  ? copy("اختر الشروط المراجعة", "Choose reviewed terms")
                  : copy(
                      "لا توجد شروط مراجعة متاحة",
                      "No reviewed terms available",
                    )}
              </option>
              {termsId && !selectedTemplate && (
                <option value={termsId}>
                  {copy(
                    "النسخة المحفوظة غير متاحة حاليًا",
                    "Saved version is currently unavailable",
                  )}
                </option>
              )}
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.id}
                </option>
              ))}
            </select>
          </label>
          {selectedTemplate && (
            <details className="rounded-2xl border border-border p-4">
              <summary className="min-h-12 cursor-pointer py-3 font-medium">
                {copy("اقرأ نص الشروط المراجعة", "Read the reviewed terms")}
              </summary>
              <div className="space-y-6 py-4">
                {(["ar", "en"] as const)
                  .filter((language) => selectedTemplate.translations[language])
                  .map((language) => (
                    <section
                      key={language}
                      lang={language}
                      dir={language === "ar" ? "rtl" : "ltr"}
                    >
                      <h3 className="mb-3 font-semibold">
                        {language === "ar" ? "العربية" : "English"}
                      </h3>
                      <p className="whitespace-pre-wrap break-words">
                        {selectedTemplate.translations[language]}
                      </p>
                    </section>
                  ))}
              </div>
            </details>
          )}
          {mandatoryPolicyVersionIds.length > 0 ? (
            <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
              <Checkbox
                checked={
                  mandatoryPolicyVersionIds.every((id) =>
                    policyIds.includes(id),
                  ) && policyIds.length === mandatoryPolicyVersionIds.length
                }
                onCheckedChange={(checked) =>
                  dirty(() =>
                    setPolicyIds(
                      checked === true ? [...mandatoryPolicyVersionIds] : [],
                    ),
                  )
                }
              />
              <span className="space-y-2">
                <span className="block text-sm font-medium">
                  {copy(
                    "أدرج نسخ سياسات السوق المراجعة المطلوبة في العرض",
                    "Include the required reviewed market policy versions in this offer",
                  )}
                </span>
                <span
                  className="block break-all text-xs text-muted-foreground"
                  dir="ltr"
                >
                  {mandatoryPolicyVersionIds.join(" · ")}
                </span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              {copy(
                "نسخ سياسات السوق المطلوبة غير متاحة لهذا العرض حاليًا.",
                "Required market policy versions are currently unavailable for this offer.",
              )}
            </p>
          )}
        </CardContent>
      </Card>
      {blockedReasons.length > 0 && (
        <div
          role="status"
          className="space-y-3 rounded-2xl border border-border bg-muted p-5"
        >
          <p className="font-semibold">
            {copy(
              "احفظ مسودتك واستكمل المتطلبات",
              "Save your draft and complete the requirements",
            )}
          </p>
          <ul className="list-inside list-disc space-y-2 text-sm">
            {blockedReasons.map((reason) => (
              <li key={reason}>{errorCopy(reason)}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive p-4 text-destructive"
        >
          {errorCopy(error)}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {copy(
          "الحقول الفارغة لا تمسح قيمًا محفوظة سابقًا؛ أدخل قيمة بديلة لتعديلها. راجع كل الشروط قبل إرسالها للطرف الآخر.",
          "Blank fields do not erase previously saved values; enter a replacement to change them. Review every term before sending it to the other party.",
        )}
      </p>
      <div className={styles.editorActions}>
        <Button variant="outline" onClick={save} disabled={busy}>
          {busy
            ? copy("جاري الحفظ…", "Saving…")
            : copy("احفظ مسودة العرض الخاصة", "Save private offer draft")}
        </Button>
        <Button
          onClick={submit}
          disabled={busy || blockedReasons.length > 0 || !templates.length}
        >
          {submitLabel}
        </Button>
      </div>
    </fieldset>
  );
}
