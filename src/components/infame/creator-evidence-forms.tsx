"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { countryLabel } from "@/lib/contracts/country-labels";
import { AudienceAgeBucketSchema, AudienceGenderSchema, COUNTRY_CODES, PLATFORM_FORMATS, type DealFormat } from "@/lib/contracts/vocabulary";
import type { CreatorEvidence } from "@/lib/evidence/client-contracts";
import { useI18n } from "@/lib/i18n";
import { evidenceErrorMessage, type useEvidenceOperation } from "./evidence-client";
import styles from "./evidence-owner.module.css";

export type EvidenceOperation = ReturnType<typeof useEvidenceOperation>;
export type EvidenceAsset = CreatorEvidence["assets"][number];
export type EvidenceAccount = CreatorEvidence["accounts"][number];
export type Copy = (ar: string, en: string) => string;
export type Visibility = "PRIVATE" | "BRAND_ONLY" | "PUBLIC";
export function evidenceObject(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function evidenceText(value: unknown) { return typeof value === "string" ? value : null; }
export function evidenceDate(value: unknown) { return typeof value === "string" ? <bdi dir="ltr">{value} UTC</bdi> : "—"; }

export function EvidenceField({ label, value, onChange, type = "text", required = false, maxLength = 500, hint, disabled = false, pattern, multiline = false, ltr = false }: {
  label: string; value: string; onChange: (value: string) => void; type?: "text" | "datetime-local"; required?: boolean; maxLength?: number; hint?: string; disabled?: boolean; pattern?: string; multiline?: boolean; ltr?: boolean;
}) {
  const id = useId();
  const common = { id, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), required, maxLength, disabled,
    dir: ltr || type === "datetime-local" ? "ltr" : "auto", "aria-describedby": hint ? `${id}-hint` : undefined, className: styles.control };
  return <div className={styles.field}><label className={styles.label} htmlFor={id}>{label}</label>
    {multiline ? <textarea {...common} rows={3} /> : <input {...common} type={type} step={type === "datetime-local" ? 1 : undefined} pattern={pattern} />}
    {hint && <p id={`${id}-hint`} className={styles.fileNote}>{hint}</p>}</div>;
}
export function EvidenceSelect({ label, value, onChange, options, disabled = false, required = false, ltr = false }: {
  label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[]; disabled?: boolean; required?: boolean; ltr?: boolean;
}) {
  const id = useId();
  return <div className={styles.field}><label className={styles.label} htmlFor={id}>{label}</label><select id={id} className={styles.control} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required={required} dir={ltr ? "ltr" : undefined}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></div>;
}
export function VisibilitySelect({ label, value, onChange, disabled }: { label: string; value: Visibility; onChange: (value: Visibility) => void; disabled?: boolean }) {
  const { isAr } = useI18n();
  return <EvidenceSelect label={label} value={value} onChange={value => onChange(value as Visibility)} disabled={disabled} options={[
    { value: "PRIVATE", label: isAr ? "خاص" : "Private" }, { value: "BRAND_ONLY", label: isAr ? "للشركات" : "Brands only" }, { value: "PUBLIC", label: isAr ? "عام" : "Public" },
  ]} />;
}
export function EvidenceFeedback({ operation, initialError, isAr }: { operation: EvidenceOperation; initialError?: string | null; isAr: boolean }) {
  const copy: Copy = (ar, en) => isAr ? ar : en;
  const code = operation.error ?? initialError;
  return <div aria-live="polite" aria-atomic="true">
    {(code || operation.busy || operation.pending || operation.notice) && <div className={`${styles.feedback} ${code ? styles.error : ""}`}>
      {operation.busy && <p role="status">{copy("جارٍ تنفيذ طلبك…", "Processing your request…")}</p>}
      {code && <p role="alert">{evidenceErrorMessage(code, isAr)}</p>}
      {operation.notice && <p role="status">{copy("اكتمل الطلب وتم تحميل البيانات الحالية.", "The request completed and current data was loaded.")}</p>}
      {operation.pending && !operation.busy && <p>{copy("إعادة المحاولة ترسل نفس الطلب المحفوظ دون تغيير.", "Retry sends the same captured request unchanged.")}</p>}
      <div className={styles.actions}>
        {operation.pending && <Button variant="outline" disabled={operation.busy} onClick={() => void operation.retry()}>{copy("إعادة نفس الطلب", "Retry same request")}</Button>}
        {(code || operation.refreshRequired) && <Button variant="outline" disabled={operation.busy} onClick={() => void operation.refresh()}>{copy("تحديث بيانات الإثبات", "Refresh evidence")}</Button>}
        {code === "UNAUTHENTICATED" && <Link href="/login" className={styles.link}>{copy("تسجيل الدخول", "Sign in")}</Link>}
        {code === "ACCOUNT_CONSENT_REQUIRED" && <Link href="/creator/onboarding" className={styles.link}>{copy("إعداد الحساب والإذن", "Set up account and permission")}</Link>}
      </div>
    </div>}
  </div>;
}
export function ReviewNote({ note, copy }: { note: { text: string; language: string | null } | null; copy: Copy }) {
  return note ? <div className={styles.spaced}><p className={styles.muted}>{copy("سبب المراجعة المحفوظ", "Saved review reason")}</p><p className={styles.itemText} dir="auto" lang={note.language ?? undefined}>{note.text}</p></div> : null;
}
export function Attachment({ id, copy }: { id: string | null; copy: Copy }) {
  return id ? <a className={styles.link} href={`/api/evidence/assets/${encodeURIComponent(id)}`}>{copy("تنزيل الإثبات الخاص", "Download private evidence")}</a> : null;
}

export function EvidenceAssetInput({ assets, purpose, value, onChange, operation, label }: {
  assets: EvidenceAsset[]; purpose: string; value: string; onChange: (id: string) => void; operation: EvidenceOperation; label: string;
}) {
  const { isAr } = useI18n();
  const copy: Copy = (ar, en) => isAr ? ar : en;
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null), id = useId();
  const available = assets.filter(asset => asset.purpose === purpose && !asset.deletedAt);
  return <fieldset className={styles.fieldset}><legend className={styles.legend}>{label}</legend><div className={styles.form}>
    <div className={styles.field}><label className={styles.label} htmlFor={id}>{copy("ملف إثبات جديد", "New evidence file")}</label>
      <input ref={input} id={id} type="file" className={styles.control} accept="image/png,image/jpeg,image/webp,application/pdf" disabled={operation.blocked} onChange={event => setFile(event.target.files?.[0] ?? null)} aria-describedby={`${id}-note`} />
      <p id={`${id}-note`} className={styles.fileNote}>{copy("PNG أو JPEG أو WEBP أو PDF، بحد أقصى 10 MiB. الملف خاص؛ راجع المعلومات الحساسة قبل رفعه.", "PNG, JPEG, WEBP or PDF, up to 10 MiB. The file is private; check sensitive information before uploading.")}</p>
    </div>
    <div><Button type="button" variant="outline" disabled={operation.blocked || !file} onClick={() => { if (file) void operation.upload(file, purpose, result => { onChange(result.asset.id); setFile(null); if (input.current) input.current.value = ""; }); }}>{copy("رفع الملف الخاص", "Upload private file")}</Button></div>
    <EvidenceSelect label={copy("الإثبات المرفوع المحدد", "Selected uploaded evidence")} value={value} onChange={onChange} disabled={operation.blocked} required options={[
      { value: "", label: copy("اختر إثباتًا لهذا الغرض", "Choose evidence for this purpose") }, ...available.map(asset => ({ value: asset.id, label: `${asset.contentType} · ${asset.size} bytes · ${asset.createdAt}` })),
    ]} />
    <p className={styles.fileNote}>{copy("الرفع يحفظ الملف فقط. أكمل النموذج لإرساله للمراجعة.", "Uploading saves the file only. Complete the form to submit it for review.")}</p>
  </div></fieldset>;
}

function utc(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error("DATE");
  const date = new Date(value + "Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== (value.length === 16 ? value + ":00" : value)) throw new Error("DATE");
  return date.toISOString();
}
export function evidenceUtc(value: string) { return utc(value); }
function number(value: string, maximum = Number.MAX_SAFE_INTEGER, integer = false) {
  if (!value.trim() || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value.trim())) throw new Error("NUMBER");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed > maximum || integer && !Number.isSafeInteger(parsed)) throw new Error("NUMBER");
  return parsed;
}
type WindowDraft = { startsAt: string; endsAt: string; timeZone: string; definition: string; visibility: Visibility };
const emptyWindow = (): WindowDraft => ({ startsAt: "", endsAt: "", timeZone: "", definition: "", visibility: "PRIVATE" });
function windowContext(draft: WindowDraft, unit: "PERCENT" | "VIEWS" | "IMPRESSIONS", observedAt: string) {
  const startsAt = utc(draft.startsAt), endsAt = utc(draft.endsAt);
  if (startsAt >= endsAt || endsAt > observedAt || !draft.timeZone.trim() || !draft.definition.trim()) throw new Error("CONTEXT");
  try { new Intl.DateTimeFormat("en", { timeZone: draft.timeZone.trim() }); } catch { throw new Error("CONTEXT"); }
  return { unit, window: { startsAt, endsAt, timeZone: draft.timeZone.trim() }, definition: draft.definition, visibility: draft.visibility };
}
function ContextFields({ value, onChange, disabled, prefix, sharing = true }: { value: WindowDraft; onChange: (value: WindowDraft) => void; disabled: boolean; prefix: string; sharing?: boolean }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  return <div className={styles.form}><div className={styles.fields}>
    <EvidenceField label={`${prefix} · ${copy("بداية الفترة (UTC)", "Window start (UTC)")}`} value={value.startsAt} onChange={startsAt => onChange({ ...value, startsAt })} type="datetime-local" required disabled={disabled} />
    <EvidenceField label={`${prefix} · ${copy("نهاية الفترة (UTC)", "Window end (UTC)")}`} value={value.endsAt} onChange={endsAt => onChange({ ...value, endsAt })} type="datetime-local" required disabled={disabled} />
  </div>
    <EvidenceField label={`${prefix} · ${copy("المنطقة الزمنية الأصلية", "Original timezone")}`} value={value.timeZone} onChange={timeZone => onChange({ ...value, timeZone })} required maxLength={100} ltr disabled={disabled} hint={copy("أدخل منطقة IANA كما وردت في المصدر، مثل Asia/Riyadh. الأوقات أعلاه بتوقيت UTC.", "Enter the source IANA timezone, such as Asia/Riyadh. The times above are UTC.")} />
    <EvidenceField label={`${prefix} · ${copy("تعريف القياس", "Metric definition")}`} value={value.definition} onChange={definition => onChange({ ...value, definition })} required multiline disabled={disabled} />
    {sharing && <VisibilitySelect label={`${prefix} · ${copy("مشاركة السياق", "Context sharing")}`} value={value.visibility} onChange={visibility => onChange({ ...value, visibility })} disabled={disabled} />}
  </div>;
}
type Dimension = "age" | "gender" | "countries" | "cities";
type DimensionDraft = { enabled: boolean; rows: { key: string; percent: string }[]; visibility: Visibility; rounding: boolean };
const emptyDimension = (): DimensionDraft => ({ enabled: false, rows: [{ key: "", percent: "" }], visibility: "PRIVATE", rounding: false });
const dimensionNames: Record<Dimension, [string, string]> = { age: ["أعمار الجمهور", "Audience ages"], gender: ["جنس الجمهور", "Audience genders"], countries: ["بلدان الجمهور", "Audience countries"], cities: ["مدن الجمهور", "Audience cities"] };
function parseDimension(draft: DimensionDraft) {
  const value = draft.rows.filter(row => row.key.trim() || row.percent.trim()).map(row => {
    if (!row.key.trim()) throw new Error("DIMENSION");
    return { key: row.key.trim(), percent: number(row.percent, 100) };
  });
  if (!value.length || new Set(value.map(row => row.key)).size !== value.length || value.reduce((sum, row) => sum + row.percent, 0) > 100 + (draft.rounding ? .01 + 1e-9 : 1e-9)) throw new Error("DIMENSION");
  return { value, visibility: draft.visibility, ...(draft.rounding ? { roundingToleranceDocumented: true } : {}) };
}
function DimensionFields({ dimension, value, onChange, disabled, optional = true, sharing = true }: { dimension: Dimension; value: DimensionDraft; onChange: (value: DimensionDraft) => void; disabled: boolean; optional?: boolean; sharing?: boolean }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const title = dimensionNames[dimension][isAr ? 0 : 1];
  const keys = dimension === "age" ? AudienceAgeBucketSchema.options.map(key => ({ value: key, label: key }))
    : dimension === "gender" ? AudienceGenderSchema.options.map(key => ({ value: key, label: ({ FEMALE: copy("إناث", "Female"), MALE: copy("ذكور", "Male"), OTHER: copy("آخر", "Other"), UNKNOWN: copy("غير معروف", "Unknown") })[key] }))
      : dimension === "countries" ? COUNTRY_CODES.map(key => ({ value: key, label: countryLabel(key, isAr ? "ar" : "en") })) : null;
  return <fieldset className={styles.fieldset}><legend className={styles.legend}>{title}</legend>
    {optional && <label className={styles.check}><input type="checkbox" checked={value.enabled} disabled={disabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} />{copy("لدي بيانات معروفة لهذا البعد", "I have known data for this dimension")}</label>}
    {(!optional || value.enabled) && <div className={styles.form}>
      <p className={styles.fileNote}>{copy("أدخل النسب المعروفة فقط. الجزء غير المسجل يظل غير معروف، ولا يلزم أن يكون المجموع 100%.", "Enter only known percentages. The unrecorded portion stays unknown; the total need not be 100%.")}</p>
      {value.rows.map((row, index) => <div key={index} className={styles.item}><div className={styles.row}>
        {keys ? <EvidenceSelect label={`${title} · ${copy("الفئة", "Category")} ${index + 1}`} value={row.key} onChange={key => onChange({ ...value, rows: value.rows.map((item, i) => i === index ? { ...item, key } : item) })} disabled={disabled} options={[{ value: "", label: copy("اختر الفئة", "Choose category") }, ...keys]} />
          : <EvidenceField label={`${title} · ${copy("مفتاح المدينة", "City key")} ${index + 1}`} value={row.key} onChange={key => onChange({ ...value, rows: value.rows.map((item, i) => i === index ? { ...item, key } : item) })} disabled={disabled} ltr hint={copy("رمز البلد ومفتاح المدينة، مثل SA:riyadh. لا تُستنتج المدينة من الإقامة.", "Country code and city key, such as SA:riyadh. City is not inferred from residence.")} />}
        <EvidenceField label={`${title} · ${copy("النسبة %", "Percent %")} ${index + 1}`} value={row.percent} onChange={percent => onChange({ ...value, rows: value.rows.map((item, i) => i === index ? { ...item, percent } : item) })} disabled={disabled} ltr />
      </div>{value.rows.length > 1 && <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange({ ...value, rows: value.rows.filter((_, i) => i !== index) })}>{copy("حذف الصف", "Remove row")} {index + 1}</Button>}</div>)}
      <div><Button type="button" variant="outline" disabled={disabled || value.rows.length >= 20} onClick={() => onChange({ ...value, rows: [...value.rows, { key: "", percent: "" }] })}>{copy("إضافة فئة", "Add category")}</Button></div>
      <label className={styles.check}><input type="checkbox" checked={value.rounding} disabled={disabled} onChange={event => onChange({ ...value, rounding: event.target.checked })} />{copy("المصدر يوثق تقريب النسب (سماح حتى 0.01%)", "The source documents rounding (up to 0.01% tolerance)")}</label>
      {sharing && <VisibilitySelect label={`${title} · ${copy("المشاركة", "Sharing")}`} value={value.visibility} onChange={visibility => onChange({ ...value, visibility })} disabled={disabled} />}
    </div>}
  </fieldset>;
}
type ViewDraft = WindowDraft & { format: string; value: string; unit: "VIEWS" | "IMPRESSIONS" };
const emptyView = (): ViewDraft => ({ ...emptyWindow(), format: "", value: "", unit: "VIEWS" });
const formatNames: Record<string, [string, string]> = { STORY: ["ستوري", "Story"], POST: ["منشور", "Post"], REEL: ["ريل", "Reel"], LIVE: ["بث مباشر", "Live"], CAMPAIGN: ["باقة حملة", "Campaign package"], VIDEO: ["فيديو", "Video"], SHORT: ["فيديو قصير", "Short"] };
export function formatLabel(format: string, isAr: boolean) { return formatNames[format]?.[isAr ? 0 : 1] ?? format; }
function validationMessage(copy: Copy) { return copy("راجع القيم والتواريخ والسياق. الخانة الفارغة غير معروفة؛ سجّل قيمة أو اختر البيانات المعروفة فقط.", "Check values, dates and context. A blank field is unknown; enter a value or select only known data."); }

export function ScreenshotForm({ account, assets, operation }: { account: EvidenceAccount; assets: EvidenceAsset[]; operation: EvidenceOperation }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [assetId, setAssetId] = useState(""), [observedAt, setObservedAt] = useState(""), [followers, setFollowers] = useState(""), [averageViews, setAverageViews] = useState(""), [engagement, setEngagement] = useState("");
  const [engagementContext, setEngagementContext] = useState(emptyWindow), [views, setViews] = useState<ViewDraft[]>([]), [error, setError] = useState<string | null>(null);
  const [demographics, setDemographics] = useState<Record<Dimension, DimensionDraft>>({ age: emptyDimension(), gender: emptyDimension(), countries: emptyDimension(), cities: emptyDimension() });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    try {
      const observed = utc(observedAt);
      const metrics: Record<string, unknown> = {};
      if (followers.trim()) { number(followers, Number.MAX_SAFE_INTEGER, true); metrics.followers = followers.trim(); }
      if (averageViews.trim()) { number(averageViews, Number.MAX_SAFE_INTEGER, true); metrics.averageViews = averageViews.trim(); }
      if (engagement.trim()) { number(engagement, 100); metrics.engagementRate = engagement.trim(); metrics.engagementContext = windowContext(engagementContext, "PERCENT", observed); }
      const dimensions: Record<string, unknown> = {};
      for (const dimension of ["age", "gender", "countries", "cities"] as const) if (demographics[dimension].enabled) dimensions[dimension] = parseDimension(demographics[dimension]);
      if (Object.keys(dimensions).length) metrics.demographics = dimensions;
      if (views.length) {
        if (new Set(views.map(view => view.format)).size !== views.length) throw new Error("FORMAT");
        metrics.formatMetrics = views.map(view => { if (!PLATFORM_FORMATS[account.platform].includes(view.format as DealFormat)) throw new Error("FORMAT"); return { format: view.format, value: number(view.value), ...windowContext(view, view.unit, observed) }; });
      }
      if (!Object.keys(metrics).length || !assetId || !assets.some(asset => asset.id === assetId && asset.purpose === "SCREENSHOT")) throw new Error("EMPTY");
      void operation.command("SCREENSHOT_SUBMIT", { accountId: account.id, expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision, evidenceAssetId: assetId, observedAt: observed, ...metrics }, undefined, () => {
        setAssetId(""); setObservedAt(""); setFollowers(""); setAverageViews(""); setEngagement(""); setEngagementContext(emptyWindow()); setViews([]); setDemographics({ age: emptyDimension(), gender: emptyDimension(), countries: emptyDimension(), cities: emptyDimension() });
      });
    } catch { setError(validationMessage(copy)); }
  }
  return <section className={styles.panel} aria-labelledby="evidence-screenshot-title"><div className={styles.panelHeader}><h2 id="evidence-screenshot-title" className={styles.panelTitle}>{copy("إحصاءات من لقطة شاشة", "Screenshot metrics")}</h2></div>
    <p className={`${styles.muted} ${styles.description}`}>{copy("سجّل ما يظهر في الإثبات فقط. الحفظ يبدأ بمصدر مُدخل ذاتيًا (SELF_REPORTED) وحقول خاصة. اختر مشاركة كل حقل بعد الحفظ من سجل الإحصاءات؛ مراجعة الإثبات خطوة منفصلة.", "Record only what the evidence shows. The saved source starts as SELF_REPORTED with private fields. Choose each field’s sharing after saving in metrics history; evidence review is separate.")}</p>
    <form className={styles.form} onSubmit={submit}>
      <EvidenceAssetInput assets={assets} purpose="SCREENSHOT" value={assetId} onChange={setAssetId} operation={operation} label={copy("إثبات الإحصاءات", "Metrics evidence")} />
      <EvidenceField label={copy("تاريخ رصد اللقطة (UTC)", "Screenshot observed at (UTC)")} value={observedAt} onChange={setObservedAt} type="datetime-local" required disabled={operation.blocked} hint={copy("أدخل الوقت الأصلي بعد تحويله إلى UTC؛ ليس وقت الرفع.", "Enter the original observation time converted to UTC; this is not the upload time.")} />
      <div className={styles.fields}><EvidenceField label={copy("المتابعون المعروفون", "Known followers")} value={followers} onChange={setFollowers} pattern="(0|[1-9][0-9]*)" ltr disabled={operation.blocked} /><EvidenceField label={copy("متوسط المشاهدات المعروف", "Known average views")} value={averageViews} onChange={setAverageViews} pattern="(0|[1-9][0-9]*)" ltr disabled={operation.blocked} /></div>
      <EvidenceField label={copy("نسبة التفاعل المعروفة %", "Known engagement rate %")} value={engagement} onChange={setEngagement} ltr disabled={operation.blocked} hint={copy("اترك أي قيمة غير معروفة فارغة. الصفر يعني صفرًا معروفًا.", "Leave unknown values blank. Zero means a known zero.")} />
      {!!engagement.trim() && <ContextFields prefix={copy("التفاعل", "Engagement")} value={engagementContext} onChange={setEngagementContext} disabled={operation.blocked} sharing={false} />}
      <details className={styles.disclosure}><summary>{copy("بيانات الجمهور المعروفة (اختياري)", "Known audience data (optional)")}</summary>{(["age", "gender", "countries", "cities"] as const).map(dimension => <DimensionFields key={dimension} dimension={dimension} value={demographics[dimension]} onChange={value => setDemographics(previous => ({ ...previous, [dimension]: value }))} disabled={operation.blocked} sharing={false} />)}</details>
      <fieldset className={styles.fieldset}><legend className={styles.legend}>{copy("قياسات حسب التنسيق (اختياري)", "Metrics by format (optional)")}</legend><div className={styles.form}>
        {views.map((view, index) => <div key={index} className={styles.item}><div className={styles.form}>
          <EvidenceSelect label={`${copy("تنسيق القياس", "Metric format")} ${index + 1}`} value={view.format} onChange={format => setViews(previous => previous.map((row, i) => i === index ? { ...row, format } : row))} required disabled={operation.blocked} options={[{ value: "", label: copy("اختر التنسيق", "Choose format") }, ...PLATFORM_FORMATS[account.platform].map(format => ({ value: format, label: formatLabel(format, isAr) }))]} />
          <EvidenceField label={`${copy("قيمة التنسيق", "Format value")} ${index + 1}`} value={view.value} onChange={value => setViews(previous => previous.map((row, i) => i === index ? { ...row, value } : row))} required disabled={operation.blocked} ltr />
          <EvidenceSelect label={`${copy("وحدة التنسيق", "Format unit")} ${index + 1}`} value={view.unit} onChange={unit => setViews(previous => previous.map((row, i) => i === index ? { ...row, unit: unit as ViewDraft["unit"] } : row))} disabled={operation.blocked} options={[{ value: "VIEWS", label: copy("مشاهدات", "Views") }, { value: "IMPRESSIONS", label: copy("مرات ظهور", "Impressions") }]} />
          <ContextFields prefix={`${copy("التنسيق", "Format")} ${index + 1}`} value={view} onChange={value => setViews(previous => previous.map((row, i) => i === index ? { ...row, ...value } : row))} disabled={operation.blocked} sharing={false} />
          <Button type="button" variant="ghost" disabled={operation.blocked} onClick={() => setViews(previous => previous.filter((_, i) => i !== index))}>{copy("حذف القياس", "Remove metric")} {index + 1}</Button>
        </div></div>)}
        <div><Button type="button" variant="outline" disabled={operation.blocked || views.length >= PLATFORM_FORMATS[account.platform].length} onClick={() => setViews(previous => [...previous, emptyView()])}>{copy("إضافة قياس تنسيق", "Add format metric")}</Button></div>
      </div></fieldset>
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <div><Button type="submit" disabled={operation.blocked || !assetId}>{copy("حفظ الإحصاءات للمراجعة", "Save metrics for review")}</Button></div>
    </form>
  </section>;
}

export function CorrectionForm({ account, operation }: { account: EvidenceAccount; operation: EvidenceOperation }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [field, setField] = useState("followers"), [value, setValue] = useState(""), [evidenceAt, setEvidenceAt] = useState(""), [context, setContext] = useState(emptyWindow), [unit, setUnit] = useState<"VIEWS" | "IMPRESSIONS">("VIEWS"), [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<Record<Dimension, DimensionDraft>>({ age: emptyDimension(), gender: emptyDimension(), countries: emptyDimension(), cities: emptyDimension() });
  const dimension = field.startsWith("demographics.") ? field.slice(13) as Dimension : null;
  const hasContext = field === "engagementRate" || field.startsWith("formatMetrics.");
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    try {
      const at = utc(evidenceAt), command: Record<string, unknown> = { accountId: account.id, expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision, field, evidenceAt: at };
      if (dimension) { const parsed = parseDimension(dimensions[dimension]); command.value = parsed.value; if (parsed.roundingToleranceDocumented) command.roundingToleranceDocumented = true; }
      else command.value = number(value, field === "engagementRate" ? 100 : Number.MAX_SAFE_INTEGER, field === "followers");
      if (hasContext) command.context = windowContext({ ...context, visibility: "PRIVATE" }, field === "engagementRate" ? "PERCENT" : unit, at);
      void operation.command("CORRECTION_SUBMIT", command, undefined, () => { setValue(""); setEvidenceAt(""); setContext(emptyWindow()); setDimensions({ age: emptyDimension(), gender: emptyDimension(), countries: emptyDimension(), cities: emptyDimension() }); });
    } catch { setError(validationMessage(copy)); }
  }
  return <section className={styles.panel} aria-labelledby="evidence-correction-title"><div className={styles.panelHeader}><h2 id="evidence-correction-title" className={styles.panelTitle}>{copy("تصحيح مُدخل ذاتيًا", "Self-reported correction")}</h2></div>
    <p className={`${styles.muted} ${styles.description}`}>{copy("التصحيح سجل منفصل بمصدر SELF_REPORTED ويبدأ خاصًا. لا يغيّر أصل اللقطة أو مراجعتها؛ راجعه واختر مشاركته من السجل المحفوظ.", "A correction is a separate SELF_REPORTED record and starts private. It does not change the original screenshot or its review; approve its sharing in saved history.")}</p>
    <form className={styles.form} onSubmit={submit}>
      <EvidenceSelect label={copy("حقل التصحيح", "Correction field")} value={field} onChange={setField} disabled={operation.blocked} options={[
        { value: "followers", label: copy("المتابعون", "Followers") }, { value: "engagementRate", label: copy("نسبة التفاعل", "Engagement rate") },
        ...(["age", "gender", "countries", "cities"] as const).map(dimension => ({ value: `demographics.${dimension}`, label: dimensionNames[dimension][isAr ? 0 : 1] })),
        ...PLATFORM_FORMATS[account.platform].map(format => ({ value: `formatMetrics.${format}`, label: `${copy("قياس", "Metric")} · ${formatLabel(format, isAr)}` })),
      ]} />
      <EvidenceField label={copy("تاريخ التصحيح المرصود (UTC)", "Correction observed at (UTC)")} value={evidenceAt} onChange={setEvidenceAt} type="datetime-local" required disabled={operation.blocked} />
      {dimension ? <DimensionFields dimension={dimension} value={dimensions[dimension]} onChange={value => setDimensions(previous => ({ ...previous, [dimension]: value }))} optional={false} sharing={false} disabled={operation.blocked} />
        : <EvidenceField label={copy("قيمة التصحيح المعروفة", "Known correction value")} value={value} onChange={setValue} required ltr disabled={operation.blocked} />}
      {field.startsWith("formatMetrics.") && <EvidenceSelect label={copy("وحدة التصحيح", "Correction unit")} value={unit} onChange={value => setUnit(value as typeof unit)} disabled={operation.blocked} options={[{ value: "VIEWS", label: copy("مشاهدات", "Views") }, { value: "IMPRESSIONS", label: copy("مرات ظهور", "Impressions") }]} />}
      {hasContext && <ContextFields prefix={copy("سياق التصحيح", "Correction context")} value={context} onChange={setContext} disabled={operation.blocked} sharing={false} />}
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <div><Button type="submit" disabled={operation.blocked}>{copy("حفظ التصحيح الخاص", "Save private correction")}</Button></div>
    </form>
  </section>;
}

export function LicenceForm({ data, operation, countryCode }: { data: CreatorEvidence; operation: EvidenceOperation; countryCode: string | null }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [jurisdiction, setJurisdiction] = useState(""), [issuer, setIssuer] = useState(""), [holder, setHolder] = useState(""), [licenceNumber, setLicenceNumber] = useState(""), [type, setType] = useState(""), [scope, setScope] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [assetId, setAssetId] = useState(""), [validFrom, setValidFrom] = useState(""), [expiresAt, setExpiresAt] = useState(""), [error, setError] = useState<string | null>(null);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    try {
      const starts = utc(validFrom), ends = utc(expiresAt), accounts = data.accounts.filter(account => selected.includes(account.id));
      if (starts >= ends || !accounts.length || accounts.length !== selected.length || accounts.length > 20 || !jurisdiction || !data.assets.some(asset => asset.id === assetId && asset.purpose === "ADVERTISING_LICENCE")) throw new Error("SCOPE");
      void operation.command("LICENCE_SUBMIT", { creatorId: data.creatorId, jurisdiction, issuer, holderName: holder, licenceNumber, type, scope,
        accountBindings: accounts.map(account => ({ accountId: account.id, mappingRevision: account.mappingRevision })), platformScope: [...new Set(accounts.map(account => account.platform))], evidenceAssetId: assetId, validFrom: starts, expiresAt: ends }, undefined,
      () => { setJurisdiction(""); setIssuer(""); setHolder(""); setLicenceNumber(""); setType(""); setScope(""); setSelected([]); setAssetId(""); setValidFrom(""); setExpiresAt(""); });
    } catch { setError(copy("راجع بلد الترخيص والحسابات والإثبات وفترة الصلاحية.", "Check licence jurisdiction, accounts, evidence and validity dates.")); }
  }
  return <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="evidence-licence-title"><div className={styles.panelHeader}><h2 id="evidence-licence-title" className={styles.panelTitle}>{copy("ترخيص الإعلان", "Advertising licence")}</h2></div>
    <p className={`${styles.muted} ${styles.description}`}>{copy("حدد بلد الترخيص ونطاقه كما في الوثيقة. بلد الإقامة منفصل؛ إرسال الوثيقة لا يؤكد صلاحيتها القانونية أو جاهزيتك الحالية.", "Select the document’s jurisdiction and scope. Residence is separate; submitting the document does not confirm legal validity or current readiness.")}{countryCode && <> {copy("بلد الإقامة المحفوظ:", "Saved residence:")} {countryLabel(countryCode, isAr ? "ar" : "en")}.</>}</p>
    <form className={styles.form} onSubmit={submit}><div className={styles.fields}>
      <EvidenceSelect label={copy("بلد الترخيص", "Licence jurisdiction")} value={jurisdiction} onChange={setJurisdiction} required disabled={operation.blocked} options={[{ value: "", label: copy("اختر البلد المذكور", "Choose documented country") }, ...COUNTRY_CODES.map(value => ({ value, label: countryLabel(value, isAr ? "ar" : "en") }))]} />
      <EvidenceField label={copy("الجهة المصدرة", "Issuing authority")} value={issuer} onChange={setIssuer} required disabled={operation.blocked} />
      <EvidenceField label={copy("اسم حامل الترخيص", "Licence holder name")} value={holder} onChange={setHolder} required disabled={operation.blocked} />
      <EvidenceField label={copy("رقم الترخيص", "Licence number")} value={licenceNumber} onChange={setLicenceNumber} required disabled={operation.blocked} />
      <EvidenceField label={copy("نوع الترخيص", "Licence type")} value={type} onChange={setType} required disabled={operation.blocked} />
      <EvidenceField label={copy("نطاق الترخيص الأصلي", "Original licence scope")} value={scope} onChange={setScope} required multiline disabled={operation.blocked} />
      <EvidenceField label={copy("بداية صلاحية الترخيص (UTC)", "Licence valid from (UTC)")} value={validFrom} onChange={setValidFrom} type="datetime-local" required disabled={operation.blocked} />
      <EvidenceField label={copy("انتهاء صلاحية الترخيص (UTC)", "Licence expires at (UTC)")} value={expiresAt} onChange={setExpiresAt} type="datetime-local" required disabled={operation.blocked} />
    </div>
      <fieldset className={styles.fieldset}><legend className={styles.legend}>{copy("الحسابات المشمولة بالوثيقة", "Accounts covered by the document")}</legend>
        {data.accounts.length ? data.accounts.map(account => <label key={account.id} className={styles.check}><input type="checkbox" checked={selected.includes(account.id)} disabled={operation.blocked} onChange={event => setSelected(previous => event.target.checked ? [...previous, account.id] : previous.filter(id => id !== account.id))} /><bdi dir="ltr">{account.platform} · @{account.handle}</bdi></label>) : <p className={styles.muted}>{copy("أضف حساباتك في إعداد الملف أولًا.", "Add your accounts in profile setup first.")}</p>}
        <p className={styles.fileNote}>{copy("نطاق المنصات يقتصر على الحسابات التي اخترتها صراحةً.", "Platform scope is limited to the accounts you explicitly select.")}</p>
      </fieldset>
      <EvidenceAssetInput assets={data.assets} purpose="ADVERTISING_LICENCE" value={assetId} onChange={setAssetId} operation={operation} label={copy("وثيقة الترخيص الخاصة", "Private licence document")} />
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <div><Button type="submit" disabled={operation.blocked || !assetId || !selected.length}>{copy("إرسال الترخيص للمراجعة", "Submit licence for review")}</Button></div>
    </form>
  </section>;
}

export function SavedMetricValue({ value, copy }: { value: unknown; copy: Copy }) {
  if (value === null || value === undefined) return <>{copy("غير معروف", "Unknown")}</>;
  if (typeof value === "boolean") return <>{value ? copy("نعم", "Yes") : copy("لا", "No")}</>;
  if (typeof value === "string" || typeof value === "number") return <bdi dir="auto">{String(value)}</bdi>;
  if (Array.isArray(value)) return value.length ? <ul className={styles.list}>{value.map((item, index) => <li key={index}><SavedMetricValue value={item} copy={copy} /></li>)}</ul> : <>{copy("غير معروف", "Unknown")}</>;
  const row = evidenceObject(value);
  const labels: Record<string, string> = {
    age: copy("الأعمار", "Ages"), gender: copy("الجنس", "Genders"), countries: copy("البلدان", "Countries"), cities: copy("المدن", "Cities"),
    key: copy("الفئة الأصلية", "Original category"), percent: copy("النسبة %", "Percent %"), value: copy("القيمة", "Value"),
    visibility: copy("حد ظهور الملاحظة", "Observation visibility limit"), roundingToleranceDocumented: copy("تقريب النسب موثق", "Documented rounding"),
    unit: copy("الوحدة", "Unit"), window: copy("فترة القياس", "Measurement window"), startsAt: copy("بداية الفترة (UTC)", "Window start (UTC)"), endsAt: copy("نهاية الفترة (UTC)", "Window end (UTC)"),
    timeZone: copy("المنطقة الزمنية الأصلية", "Original timezone"), definition: copy("تعريف القياس الأصلي", "Original metric definition"), format: copy("التنسيق", "Format"),
    platform: copy("المنصة", "Platform"), normalizedHandle: copy("معرّف الحساب المحفوظ", "Saved account handle"), providerAccountId: copy("هوية الحساب لدى المنصة", "Provider account identity"), confirmedOrigin: copy("المصدر المؤكد", "Confirmed origin"),
  };
  return Object.keys(row).length ? <dl className={styles.facts}>{Object.entries(row).map(([key, item]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd><SavedMetricValue value={item} copy={copy} /></dd></div>)}</dl> : <>{copy("غير معروف", "Unknown")}</>;
}
export function EvidenceFact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
