"use client";

// Reuses the existing campaign form's six Card groups and native codecs.
import Link from "next/link";
import type { z } from "zod";
import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useNavigationGuardRegistrar } from "@/components/shells/navigation-guard";
import { CampaignBrief } from "@/components/infame/campaign-brief";
import { ContextReferenceVersionFiles, OwnerReviewReferenceFiles } from "@/components/infame/context-reference-files";
import workflow from "@/components/infame/workflow-layout.module.css";
import briefStyles from "@/components/infame/campaign-brief.module.css";
import { campaignFieldLabels, campaignValueLabels, campaignWallTime, campaignFieldValue } from "@/components/infame/campaign-field-display";
import { CampaignDraftFieldsSchema, CampaignFieldsSchema, type CampaignDraftFields } from "@/lib/campaigns/contracts";
import { ClientAuthoritySchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { PlanningScopeSchema, BrandContextListSchema, BrandContextDetailResponseSchema,
  type PlanningScope } from "@/lib/brand-context/contracts";
import { CampaignPlanningCommandSchema, CampaignPlanningResultSchema, PlanningCampaignSchema, PlanningCampaignListSchema,
  CampaignOwnerReviewsSchema, CampaignOwnerReviewSchema, CampaignOwnerReviewCommandSchema, CampaignOwnerReviewResultSchema,
  ManualNarrativeSchema, type CampaignPlanningCommand, type CampaignPlanningResult, type PlanningCampaign,
  type CampaignOwnerReviews, type CampaignOwnerReview, type CampaignOwnerReviewResult } from "@/lib/campaign-planning/contracts";
import type { CampaignPlanningScreenProps, PlanningCampaignListScreenProps, CampaignPlanningOwnerReviewsScreenProps } from "@/lib/campaign-planning/ui-contract";
export type { CampaignPlanningScreenProps, PlanningCampaignListScreenProps, CampaignPlanningOwnerReviewsScreenProps } from "@/lib/campaign-planning/ui-contract";
import { ArabicDialectSchema, AudienceAgeBucketSchema, AudienceGenderSchema, CampaignGoalSchema, COUNTRY_CODES,
  CreatorTierSchema, CURATED_CITIES, PLATFORM_FORMATS, PlatformSchema, resolveLocalDateTime,
  type Deliverable, type Platform } from "@/lib/contracts/vocabulary";
import { NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";
import { currencyPrecision, formatMoneyDecimal, parseMoney, SUPPORTED_CURRENCIES } from "@/lib/contracts/money";
import { countryLabel } from "@/lib/contracts/country-labels";
import { TIMEZONE_SUGGESTIONS } from "@/lib/contracts/timezone-suggestions";

type Copy = (ar: string, en: string) => string;
const planningLabels: Record<string, [string, string]> = campaignFieldLabels;
const selectClass = "h-12 w-full min-w-0 rounded-[10px] border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export type PlanningFormState = {
  title: string; productService: string; goal: string; summary: string; originalLanguage: string;
  marketCountryCodes: string[]; targetAgeBuckets: string[]; targetGenders: string[]; targetCountryCodes: string[]; targetCityKeys: string[];
  contentLanguages: string; dialects: string[]; nicheSlugs: string[]; deliverables: Deliverable[];
  budgetDecimal: string; currencyCode: string; desiredCreatorCount: string; impressionsTarget: string;
  startsLocal: string; endsLocal: string; timeZone: string; startOffset: string; endOffset: string;
  physicalPresenceRequired: boolean; presenceCountryCodes: string[]; travelAllowed: boolean; tone: string; noGoTopics: string;
  preferredTiers: string[]; dataVerificationRequired: boolean; preferredLicencePolicyIds: string; usageRights: string;
  kpis: { name: string; target: string }[]; assumptions: string; openQuestions: string;
};
export function planningToForm(fields: CampaignDraftFields): PlanningFormState {
  const period = fields.period, startsLocal = period ? campaignWallTime(period.startsAt, period.timeZone) : "",
    endsLocal = period ? campaignWallTime(period.endsAt, period.timeZone) : "";
  const offset = (local: string, instant: string) => String((Date.parse(local + "Z") - Date.parse(instant)) / 60000);
  return { title: fields.title ?? "", productService: fields.productService ?? "", goal: fields.goal ?? "", summary: fields.summary ?? "",
    originalLanguage: fields.originalLanguage ?? "", marketCountryCodes: fields.marketCountryCodes ?? [], targetAgeBuckets: fields.targetAgeBuckets ?? [],
    targetGenders: fields.targetGenders ?? [], targetCountryCodes: fields.targetCountryCodes ?? [], targetCityKeys: fields.targetCityKeys ?? [],
    contentLanguages: (fields.contentLanguages ?? []).join(", "), dialects: fields.dialects ?? [], nicheSlugs: fields.nicheSlugs ?? [],
    deliverables: fields.deliverables ?? [], budgetDecimal: fields.budget ? formatMoneyDecimal(fields.budget) : "", currencyCode: fields.budget?.currencyCode ?? "",
    desiredCreatorCount: String(fields.desiredCreatorCount ?? 1), impressionsTarget: fields.impressionsTarget == null ? "" : String(fields.impressionsTarget),
    startsLocal, endsLocal, timeZone: period?.timeZone ?? "", startOffset: period ? offset(startsLocal, period.startsAt) : "",
    endOffset: period ? offset(endsLocal, period.endsAt) : "", physicalPresenceRequired: fields.physicalPresenceRequired ?? false,
    presenceCountryCodes: fields.presenceCountryCodes ?? [], travelAllowed: fields.travelAllowed ?? false, tone: fields.tone ?? "",
    noGoTopics: (fields.noGoTopics ?? []).join("\n"), preferredTiers: fields.preferredTiers ?? [], dataVerificationRequired: fields.dataVerificationRequired ?? false,
    preferredLicencePolicyIds: (fields.preferredLicencePolicyIds ?? []).join("\n"), usageRights: fields.usageRights ?? "", kpis: fields.kpis ?? [],
    assumptions: (fields.assumptions ?? []).join("\n"), openQuestions: (fields.openQuestions ?? []).join("\n") };
}
class PlanningUiError extends Error { constructor(readonly code: string, readonly field?: string, readonly status?: number) { super(code); } }
function integer(value: string, field: string) { if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new PlanningUiError("INVALID_NUMBER", field); return Number(value); }
const identifierLines = (value: string) => [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
// Original business words stay literal; technical identifiers may be normalized.
const originalLines = (value: string) => value.split(/\r?\n/).filter(line => line.trim().length > 0);
export function planningFormPatch(form: PlanningFormState, stored: CampaignDraftFields): CampaignDraftFields {
  const original = planningToForm(stored);
  const words = (key: "noGoTopics" | "assumptions" | "openQuestions") => form[key] === original[key] && stored[key] !== undefined
    ? stored[key] : originalLines(form[key]);
  const patch: Record<string, unknown> = { originalLanguage: form.originalLanguage.trim() || null,
    targetAgeBuckets: form.targetAgeBuckets, targetGenders: form.targetGenders, targetCountryCodes: form.targetCountryCodes, targetCityKeys: form.targetCityKeys,
    dialects: form.dialects, nicheSlugs: form.nicheSlugs, physicalPresenceRequired: form.physicalPresenceRequired,
    presenceCountryCodes: form.presenceCountryCodes, travelAllowed: form.travelAllowed, noGoTopics: words("noGoTopics"),
    preferredTiers: form.preferredTiers, dataVerificationRequired: form.dataVerificationRequired,
    preferredLicencePolicyIds: identifierLines(form.preferredLicencePolicyIds), kpis: form.kpis.filter(row => row.name.trim() || row.target.trim()),
    assumptions: words("assumptions"), openQuestions: words("openQuestions"),
    impressionsTarget: form.impressionsTarget === "" ? null : integer(form.impressionsTarget, "impressionsTarget"),
    desiredCreatorCount: integer(form.desiredCreatorCount, "desiredCreatorCount") };
  for (const field of ["title", "productService", "summary", "tone", "usageRights", "goal"] as const) {
    if (form[field].trim()) patch[field] = form[field]; else if (stored[field] !== undefined) throw new PlanningUiError("REQUIRED_FIELD", field);
  }
  for (const field of ["marketCountryCodes", "deliverables"] as const) {
    if (form[field].length) patch[field] = form[field]; else if (stored[field] !== undefined) throw new PlanningUiError("REQUIRED_FIELD", field);
  }
  const languages = [...new Set(form.contentLanguages.split(/[,،]/).map(value => value.trim()).filter(Boolean))];
  if (languages.length) patch.contentLanguages = languages; else if (stored.contentLanguages !== undefined) throw new PlanningUiError("REQUIRED_FIELD", "contentLanguages");
  if (form.budgetDecimal || form.currencyCode) { try { patch.budget = parseMoney(form.budgetDecimal, form.currencyCode); } catch { throw new PlanningUiError("INVALID_MONEY", "budget"); } }
  else if (stored.budget) throw new PlanningUiError("REQUIRED_FIELD", "budget");
  if (form.startsLocal || form.endsLocal || form.timeZone) {
    try {
      const seconds = (value: string) => value.length === 16 ? value + ":00" : value;
      const offset = (value: string) => value === "" ? undefined : /^-?[0-9]+$/.test(value) ? Number(value) : NaN;
      patch.period = { startsAt: resolveLocalDateTime(seconds(form.startsLocal), form.timeZone, offset(form.startOffset)),
        endsAt: resolveLocalDateTime(seconds(form.endsLocal), form.timeZone, offset(form.endOffset)), timeZone: form.timeZone };
      if (stored.period && (["startsLocal", "endsLocal", "timeZone", "startOffset", "endOffset"] as const).every(key => form[key] === original[key])) patch.period = stored.period;
    } catch { throw new PlanningUiError("INVALID_PERIOD", "period"); }
  } else if (stored.period) throw new PlanningUiError("REQUIRED_FIELD", "period");
  const result = CampaignDraftFieldsSchema.safeParse(patch);
  if (!result.success) throw new PlanningUiError("INVALID_FIELD", String(result.error.issues[0]?.path[0] ?? ""));
  return result.data;
}

function PlanningChoice({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  const id = useId(); return <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 text-base">
    <Checkbox id={id} checked={checked} onCheckedChange={value => onChange(value === true)} />{children}</label>;
}
function PlanningMultipleChoice({ label, options, selected, onChange }: { label: string; options: { value: string; label: string }[];
  selected: string[]; onChange: (selected: string[]) => void }) {
  const [next, setNext] = useState(""), id = useId();
  return <fieldset className="min-w-0 space-y-3"><legend className="mb-2 text-base font-medium">{label}</legend>
    <div className="flex items-center gap-2"><select id={id} aria-label={label} className={selectClass} value={next} onChange={event => setNext(event.target.value)}>
      <option value="">—</option>{options.filter(option => !selected.includes(option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <Button type="button" variant="outline" size="icon" aria-label={label + " +"} disabled={!next} onClick={() => { onChange([...selected, next]); setNext(""); }}><Plus aria-hidden="true" /></Button></div>
    <ul className="flex flex-wrap gap-2">{selected.map(value => <li key={value} className="flex max-w-full items-center gap-1 rounded-md border ps-3">
      <span className="min-w-0 break-words text-base">{options.find(option => option.value === value)?.label ?? value}</span>
      <Button type="button" variant="ghost" size="icon" aria-label={label + " − " + value} onClick={() => { onChange(selected.filter(item => item !== value)); document.getElementById(id)?.focus(); }}><X aria-hidden="true" /></Button>
    </li>)}</ul></fieldset>;
}
export function CampaignPlanningManualForm({ form, onChange, disabled, onSubmit, errorField }: { form: PlanningFormState;
  onChange: (update: (previous: PlanningFormState) => PlanningFormState) => void; disabled: boolean; onSubmit: (event: FormEvent) => void; errorField?: string }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const label = (key: string) => planningLabels[key]?.[isAr ? 0 : 1] ?? key;
  const valueLabel = (key: string) => campaignValueLabels[key]?.[isAr ? 0 : 1] ?? key;
  const zonesId = useId();
  const countryOptions = COUNTRY_CODES.map(code => ({ value: code, label: countryLabel(code, isAr ? "ar" : "en") + " (" + code + ")" }));
  function update<K extends keyof PlanningFormState>(key: K, value: PlanningFormState[K]) { onChange(previous => ({ ...previous, [key]: value })); }
  function field(key: string, child: ReactNode, hint?: string) { return <div id={"planning-" + key} className="min-w-0 scroll-mt-4 space-y-2">
    {child}{hint && <p className="text-sm leading-6 text-muted-foreground">{hint}</p>}
    {errorField === key && <p role="alert" className="text-base text-destructive">{copy("راجع هذا الحقل وحدوده؛ كلماتك باقية.", "Review this field and its limits; your words remain.")}</p>}</div>; }
  function text(key: "title" | "productService" | "summary" | "tone" | "usageRights", maxLength: number, multiline = false) {
    return field(key, <label htmlFor={zonesId + "-" + key} className="block space-y-2"><span className="text-base font-medium">{label(key)}</span>
      {multiline ? <Textarea id={zonesId + "-" + key} aria-label={label(key)} dir="auto" className="text-base" rows={key === "summary" || key === "usageRights" ? 4 : 3} maxLength={maxLength}
        value={form[key]} onChange={event => update(key, event.target.value)} />
        : <Input id={zonesId + "-" + key} dir="auto" className="text-base" maxLength={maxLength} value={form[key]} onChange={event => update(key, event.target.value)} />}</label>); }
  function multi(key: "marketCountryCodes" | "targetCountryCodes" | "presenceCountryCodes" | "targetCityKeys" | "nicheSlugs", options: { value: string; label: string }[]) {
    return field(key, <PlanningMultipleChoice label={label(key)} options={options} selected={form[key]} onChange={selected => onChange(previous => ({ ...previous,
      [key]: selected, ...(key === "targetCountryCodes" ? { targetCityKeys: previous.targetCityKeys.filter(city => selected.includes(city.slice(0, 2))) } : {}) }))} />); }
  function choices(key: "targetAgeBuckets" | "targetGenders" | "dialects" | "preferredTiers", values: readonly string[]) {
    return field(key, <fieldset><legend className="mb-2 text-base font-medium">{label(key)}</legend><div className="grid gap-1 sm:grid-cols-2">{values.map(value =>
      <PlanningChoice key={value} checked={form[key].includes(value)} onChange={checked => onChange(previous => ({ ...previous,
        [key]: checked ? [...previous[key], value] : previous[key].filter(item => item !== value) }))}>{valueLabel(value)}</PlanningChoice>)}</div></fieldset>); }
  return <form onSubmit={onSubmit} className="space-y-6" aria-label={copy("تفاصيل الحملة", "Campaign details")}><fieldset disabled={disabled} className="min-w-0 space-y-6">
    <Card><CardHeader><CardTitle>{copy("١. الفكرة والهدف", "1. Idea and goal")}</CardTitle><CardDescription className="text-base">{copy("تظل كلماتك الأصلية كما كتبتها عند تغيير لغة الواجهة.", "Your original words remain as entered when the interface language changes.")}</CardDescription></CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">{text("title", 200)}{field("goal", <label htmlFor={zonesId + "-goal"} className="block space-y-2"><span className="text-base font-medium">{label("goal")}</span>
        <select id={zonesId + "-goal"} aria-label={label("goal")} className={selectClass} value={form.goal} onChange={event => update("goal", event.target.value)}><option value="">{copy("اختر الهدف", "Choose a goal")}</option>{CampaignGoalSchema.options.map(goal => <option key={goal} value={goal}>{valueLabel(goal)}</option>)}</select></label>)}
        <div className="sm:col-span-2">{text("productService", 5000, true)}</div><div className="sm:col-span-2">{text("summary", 5000, true)}</div>
        {field("originalLanguage", <label className="block space-y-2"><span className="text-base font-medium">{label("originalLanguage")}</span><Input dir="ltr" className="text-base" maxLength={100}
          value={form.originalLanguage} placeholder="ar / en" onChange={event => update("originalLanguage", event.target.value)} /></label>, copy("لغة مصرح بها واختيارية؛ لا تُستنتج من لغة الواجهة.", "Optional declared language; it is not inferred from interface language."))}
      </CardContent></Card>
    <Card><CardHeader><CardTitle>{copy("٢. الأسواق والجمهور", "2. Markets and audience")}</CardTitle><CardDescription className="text-base">{copy("اختر الأسواق صراحةً؛ التفضيلات الفارغة تعني بدون تفضيل.", "Choose markets explicitly; empty preferences mean no preference.")}</CardDescription></CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">{multi("marketCountryCodes", countryOptions)}{multi("targetCountryCodes", countryOptions)}
        {multi("targetCityKeys", CURATED_CITIES.filter(city => form.targetCountryCodes.includes(city.countryCode)).map(city => ({ value: city.key, label: isAr ? city.ar : city.en })))}
        {choices("targetAgeBuckets", AudienceAgeBucketSchema.options)}{choices("targetGenders", AudienceGenderSchema.options)}
        {field("contentLanguages", <label className="block space-y-2"><span className="text-base font-medium">{label("contentLanguages")}</span><Input dir="ltr" className="text-base" value={form.contentLanguages}
          maxLength={2000} placeholder="ar, en" onChange={event => update("contentLanguages", event.target.value)} /></label>, copy("رموز BCP47 مفصولة بفاصلة.", "Comma-separated BCP47 codes."))}
        {choices("dialects", ArabicDialectSchema.options)}{multi("nicheSlugs", NICHE_TAXONOMY.map(niche => ({ value: niche.slug, label: (niche.parentSlug ? "↳ " : "") + (isAr ? niche.labelAr : niche.labelEn) })))}
      </CardContent></Card>
    <Card><CardHeader><CardTitle>{copy("٣. المحتوى والميزانية", "3. Deliverables and budget")}</CardTitle></CardHeader><CardContent className="space-y-5">
      {field("deliverables", <fieldset className="space-y-4"><legend className="mb-2 text-base font-medium">{label("deliverables")}</legend>
        {form.deliverables.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
          <label htmlFor={`${zonesId}-deliverable-${index}-platform`} className="space-y-2"><span className="text-base">{copy("المنصة", "Platform")}</span><select id={`${zonesId}-deliverable-${index}-platform`} aria-label={copy("المنصة", "Platform")} className={selectClass} dir="ltr" value={row.platform} onChange={event => {
            const platform = event.target.value as Platform; onChange(previous => ({ ...previous, deliverables: previous.deliverables.map((item, at) => at === index ? { platform, format: PLATFORM_FORMATS[platform][0], count: item.count } : item) }));
          }}>{PlatformSchema.options.map(platform => <option key={platform}>{platform}</option>)}</select></label>
          <label htmlFor={`${zonesId}-deliverable-${index}-format`} className="space-y-2"><span className="text-base">{copy("صيغة المحتوى", "Content format")}</span><select id={`${zonesId}-deliverable-${index}-format`} aria-label={copy("صيغة المحتوى", "Content format")} className={selectClass} value={row.format}
            onChange={event => onChange(previous => ({ ...previous, deliverables: previous.deliverables.map((item, at) => at === index ? { ...item, format: event.target.value as Deliverable["format"] } : item) }))}>
            {PLATFORM_FORMATS[row.platform].map(format => <option key={format} value={format}>{valueLabel(format)}</option>)}</select></label>
          <label className="space-y-2"><span className="text-base">{copy("العدد (١–١٠٠٠)", "Count (1–1000)")}</span><Input dir="ltr" className="text-base" type="number" min={1} max={1000} step={1}
            value={Number.isFinite(row.count) ? row.count : ""} onChange={event => onChange(previous => ({ ...previous, deliverables: previous.deliverables.map((item, at) => at === index
              ? { ...item, count: event.target.value === "" ? NaN : Number(event.target.value) } : item) }))} /></label>
          <Button type="button" variant="outline" onClick={() => onChange(previous => ({ ...previous, deliverables: previous.deliverables.filter((_, at) => at !== index) }))}>{copy("احذف هذا المحتوى", "Remove this deliverable")}</Button>
        </div>)}<Button type="button" variant="outline" disabled={form.deliverables.length >= 100} onClick={() => onChange(previous => ({ ...previous, deliverables: [...previous.deliverables,
          { platform: "INSTAGRAM", format: "REEL", count: 1 }] }))}><Plus aria-hidden="true" />{copy("أضف محتوى وحدد منصته", "Add a deliverable and choose its platform")}</Button></fieldset>)}
      <div className="grid gap-5 sm:grid-cols-2">{field("budget", <div className="space-y-4"><label htmlFor={zonesId + "-currency"} className="block space-y-2"><span className="text-base font-medium">{copy("عملة الحملة", "Campaign currency")}</span>
        <select id={zonesId + "-currency"} aria-label={copy("عملة الحملة", "Campaign currency")} className={selectClass} dir="ltr" value={form.currencyCode} onChange={event => update("currencyCode", event.target.value)}><option value="">{copy("اختر العملة", "Choose currency")}</option>{SUPPORTED_CURRENCIES.map(code => <option key={code}>{code}</option>)}</select></label>
        <label className="block space-y-2"><span className="text-base font-medium">{label("budget")}</span><Input dir="ltr" className="text-base" inputMode="decimal" value={form.budgetDecimal} maxLength={40} onChange={event => update("budgetDecimal", event.target.value)} /></label></div>,
        form.currencyCode ? copy(`الدقة المسموحة: ${currencyPrecision(form.currencyCode)} منازل عشرية.`, `Allowed precision: ${currencyPrecision(form.currencyCode)} decimal places.`) : copy("العملة مستقلة عن البلد ولغة الواجهة.", "Currency is independent of country and interface language."))}
        {field("desiredCreatorCount", <label className="block space-y-2"><span className="text-base font-medium">{label("desiredCreatorCount")} (1–12)</span><Input dir="ltr" className="text-base" inputMode="numeric" value={form.desiredCreatorCount} maxLength={2} onChange={event => update("desiredCreatorCount", event.target.value)} /></label>)}
        {field("impressionsTarget", <label className="block space-y-2"><span className="text-base font-medium">{label("impressionsTarget")} {copy("(اختياري)", "(optional)")}</span><Input dir="ltr" className="text-base" inputMode="numeric" value={form.impressionsTarget} maxLength={16} onChange={event => update("impressionsTarget", event.target.value)} /></label>)}
      </div></CardContent></Card>
    <Card><CardHeader><CardTitle>{copy("٤. الفترة والحضور", "4. Period and presence")}</CardTitle></CardHeader><CardContent className="space-y-5">
      {field("period", <div className="grid gap-5 sm:grid-cols-2">{(["startsLocal", "endsLocal"] as const).map(key => <label key={key} className="block space-y-2"><span className="text-base font-medium">{key === "startsLocal"
        ? copy("تاريخ البداية بالتوقيت المحدد", "Start in the selected timezone") : copy("تاريخ النهاية بالتوقيت المحدد", "End in the selected timezone")}</span><Input dir="ltr" className="text-base" type="datetime-local" step={1} value={form[key]}
          onChange={event => onChange(previous => ({ ...previous, [key]: event.target.value, [key === "startsLocal" ? "startOffset" : "endOffset"]: "" }))} /></label>)}
        <label className="block space-y-2 sm:col-span-2"><span className="text-base font-medium">{copy("المنطقة الزمنية (IANA)", "Timezone (IANA)")}</span><Input dir="ltr" className="text-base" list={zonesId} value={form.timeZone} maxLength={100}
          placeholder="Europe/London" onChange={event => onChange(previous => ({ ...previous, timeZone: event.target.value, startOffset: "", endOffset: "" }))} /><datalist id={zonesId}>{TIMEZONE_SUGGESTIONS.map(zone => <option key={zone} value={zone} />)}</datalist></label>
        <details className="sm:col-span-2"><summary className="min-h-12 cursor-pointer py-3 text-base">{copy("إزاحة UTC للوقت المكرر (اختياري)", "UTC offset for repeated local times (optional)")}</summary>
          <p className="mb-3 text-sm leading-6 text-muted-foreground">{copy("دقائق شرق UTC؛ يجب أن تطابق المنطقة الزمنية.", "Minutes east of UTC; must match the selected timezone.")}</p><div className="grid gap-4 sm:grid-cols-2">
            {(["startOffset", "endOffset"] as const).map(key => <label key={key} className="space-y-2"><span className="text-base">{key === "startOffset" ? copy("إزاحة البداية", "Start offset") : copy("إزاحة النهاية", "End offset")}</span>
              <Input dir="ltr" className="text-base" value={form[key]} maxLength={5} onChange={event => update(key, event.target.value)} /></label>)}
          </div></details></div>, copy("تُحفظ تواريخ UTC مع منطقتك المختارة، دون تخمين منطقة المتصفح.", "UTC instants retain your selected timezone; browser timezone is not assumed."))}
      <div className="grid gap-5 sm:grid-cols-2">{(["physicalPresenceRequired", "travelAllowed"] as const).map(key => <div key={key}>{field(key, <PlanningChoice checked={form[key]} onChange={value => update(key, value)}>{label(key)}</PlanningChoice>)}</div>)}
        {multi("presenceCountryCodes", countryOptions)}</div></CardContent></Card>
    <Card><CardHeader><CardTitle>{copy("٥. الإبداع والحقوق والثقة", "5. Creative direction, rights and trust")}</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2">
      {text("tone", 500, true)}{field("noGoTopics", <label htmlFor={zonesId + "-noGoTopics"} className="block space-y-2"><span className="text-base font-medium">{label("noGoTopics")}</span><Textarea id={zonesId + "-noGoTopics"} aria-label={label("noGoTopics")} dir="auto" className="text-base" rows={3} maxLength={12000} value={form.noGoTopics} onChange={event => update("noGoTopics", event.target.value)} /></label>, copy("موضوع أصلي واحد في كل سطر.", "One original topic per line."))}
      {choices("preferredTiers", CreatorTierSchema.options)}{field("dataVerificationRequired", <PlanningChoice checked={form.dataVerificationRequired} onChange={value => update("dataVerificationRequired", value)}>{label("dataVerificationRequired")}</PlanningChoice>)}
      <div className="sm:col-span-2">{text("usageRights", 10000, true)}</div>{field("preferredLicencePolicyIds", <label htmlFor={zonesId + "-preferredLicencePolicyIds"} className="block space-y-2"><span className="text-base font-medium">{label("preferredLicencePolicyIds")}</span>
        <Textarea id={zonesId + "-preferredLicencePolicyIds"} aria-label={label("preferredLicencePolicyIds")} dir="ltr" rows={3} className="text-base" maxLength={12000} value={form.preferredLicencePolicyIds} onChange={event => update("preferredLicencePolicyIds", event.target.value)} /></label>, copy("معرّف سياسة واحد في كل سطر. التفضيل ليس إثبات ترخيص.", "One policy ID per line. A preference is not proof of a licence."))}
      </CardContent></Card>
    <Card><CardHeader><CardTitle>{copy("٦. القياس والملاحظات", "6. Measurement and notes")}</CardTitle></CardHeader><CardContent className="space-y-5">
      {field("kpis", <fieldset className="space-y-4"><legend className="mb-2 text-base font-medium">{label("kpis")}</legend>{form.kpis.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        {(["name", "target"] as const).map(key => <label key={key} className="space-y-2"><span className="text-base">{key === "name" ? copy("المؤشر", "Indicator") : copy("النتيجة المستهدفة", "Target outcome")}</span><Input dir="auto" className="text-base" maxLength={key === "name" ? 200 : 1000}
          value={row[key]} onChange={event => onChange(previous => ({ ...previous, kpis: previous.kpis.map((item, at) => at === index ? { ...item, [key]: event.target.value } : item) }))} /></label>)}
        <Button type="button" variant="outline" onClick={() => onChange(previous => ({ ...previous, kpis: previous.kpis.filter((_, at) => at !== index) }))}>{copy("احذف المؤشر", "Remove indicator")}</Button></div>)}
        <Button type="button" variant="outline" disabled={form.kpis.length >= 30} onClick={() => onChange(previous => ({ ...previous, kpis: [...previous.kpis, { name: "", target: "" }] }))}><Plus aria-hidden="true" />{copy("أضف مؤشرًا", "Add an indicator")}</Button></fieldset>)}
      <div className="grid gap-5 sm:grid-cols-2">{(["assumptions", "openQuestions"] as const).map(key => <div key={key}>{field(key, <label htmlFor={zonesId + "-" + key} className="block space-y-2"><span className="text-base font-medium">{label(key)}</span>
        <Textarea id={zonesId + "-" + key} aria-label={label(key)} dir="auto" className="text-base" rows={4} maxLength={16000} value={form[key]} onChange={event => update(key, event.target.value)} /></label>, copy("عنصر أصلي واحد في كل سطر.", "One original item per line."))}</div>)}</div>
      </CardContent></Card>
    <p className="text-base leading-7 text-muted-foreground">{copy("احفظ ما جهزته وكمل الباقي لاحقًا. لا تُستنتج الخيارات من بلدك أو لغة الواجهة.", "Save what you have and complete the rest later. Choices are not inferred from your country or interface language.")}</p>
    <Button type="submit" size="lg">{copy("راجع واحفظ التفاصيل", "Review and save details")}</Button>
  </fieldset></form>;
}

type UiFlight = { abort: AbortController; generation: number; denied: boolean; timedOut: boolean };
type PlanningPending = { command: CampaignPlanningCommand; body: string; phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT";
  receipt: CampaignPlanningResult | null; reviewed: boolean; expectedInputRevision: number; expectedMaterial: PlanningMaterial };
type ContextVersion = NonNullable<PlanningCampaign["planning"]["selectedContext"]>;
type ContextChoice = Extract<CampaignPlanningCommand, { action: "CREATE" }>["payload"]["selection"];
type PlanningMaterial = { fields: CampaignDraftFields; choice: ContextChoice; narrative: PlanningCampaign["planning"]["narrative"] };
function normalizedFields(value: unknown): CampaignDraftFields {
  const parsed = CampaignDraftFieldsSchema.safeParse(value);
  if (!parsed.success) throw new PlanningUiError("INVALID_RESPONSE");
  return parsed.data;
}
function contextChoice(selection: PlanningCampaign["planning"]["selection"]): ContextChoice {
  return selection.kind === "NONE" ? { kind: "NONE" } : { kind: "APPROVED_CONTEXT", versionId: selection.versionId!, contentHash: selection.contentHash! };
}
function normalizedNarrative(value: PlanningCampaign["planning"]["narrative"]) {
  if (value === null) return null;
  const parsed = ManualNarrativeSchema.safeParse(value);
  if (!parsed.success) throw new PlanningUiError("INVALID_RESPONSE");
  return parsed.data;
}
function capturedMaterial(command: CampaignPlanningCommand, source: PlanningCampaign | null): PlanningMaterial {
  if (command.action === "CREATE") return { fields: normalizedFields({ desiredCreatorCount: 1, ...command.payload.fields }),
    choice: command.payload.selection, narrative: null };
  if (!source) throw new PlanningUiError("INVALID_FIELD");
  let fields = normalizedFields(source.campaign.fields);
  if (command.action === "UPDATE_FIELDS") fields = normalizedFields({ ...fields, ...command.payload.patch });
  if (command.action === "APPLY_PROPOSAL") {
    const proposalId = command.payload.proposalId, proposal = source.proposals.find(row => row.id === proposalId);
    if (!proposal) throw new PlanningUiError("INVALID_FIELD");
    if (command.payload.toneDecision !== "KEEP") fields = normalizedFields({ ...fields, ...proposal.patch });
  }
  return { fields, choice: command.action === "SET_SELECTION" || command.action === "BIND_OWN" ? command.payload.selection : contextChoice(source.planning.selection),
    narrative: normalizedNarrative(command.action === "SAVE_NARRATIVE" ? command.payload.narrative : source.planning.narrative) };
}
function matchesCapturedMaterial(expected: PlanningMaterial, current: PlanningCampaign) {
  // Schema parsing gives stable key order, without trimming original words or
  // conflating a null literal with a saved empty string. No browser Node hash.
  return JSON.stringify(expected.fields) === JSON.stringify(normalizedFields(current.campaign.fields))
    && JSON.stringify(expected.choice) === JSON.stringify(contextChoice(current.planning.selection))
    && JSON.stringify(expected.narrative) === JSON.stringify(normalizedNarrative(current.planning.narrative));
}
type PagePosition = { after: string | null; history: (string | null)[] };
const capturedPosition = (position: PagePosition): PagePosition => ({ after: position.after, history: [...position.history] });
type VersionBoundary = { after: null; cursorVersion: null } | { after: string; cursorVersion: number };
type VersionPosition = VersionBoundary & { history: VersionBoundary[] };
const emptyVersionPosition = (): VersionPosition => ({ after: null, cursorVersion: null, history: [] });
const capturedVersionPosition = (position: VersionPosition): VersionPosition => ({ ...position, history: position.history.map(boundary => ({ ...boundary })) });
function previousVersionPosition(position: VersionPosition): VersionPosition | null {
  const previous = position.history.at(-1);
  return previous ? { ...previous, history: position.history.slice(0, -1).map(boundary => ({ ...boundary })) } : null;
}
function nextVersionPosition(position: VersionPosition, after: string | null, last: { id: string; version: number } | undefined): VersionPosition | null {
  if (!after || !last || last.id !== after) return null;
  const previous: VersionBoundary = position.after === null ? { after: null, cursorVersion: null } : { after: position.after, cursorVersion: position.cursorVersion };
  return { after, cursorVersion: last.version, history: [...position.history.map(boundary => ({ ...boundary })), previous] };
}
type EditorRead =
  | { kind: "CURRENT"; path: string; campaignId: string | null; planPath: string | null; receipt: CampaignPlanningResult | null }
  | { kind: "BRIEFS"; path: string; campaignId: string; position: VersionPosition }
  | { kind: "CONTEXTS"; path: string; position: PagePosition }
  | { kind: "CONTEXT_VERSIONS"; path: string; contextId: string; position: VersionPosition };
type ListRead = { path: string; planPath: string | null; position: PagePosition };
type OwnerRead =
  | { kind: "CURRENT"; listPath: string; after: string | null; detailPath: string | null; source: CampaignOwnerReview["review"] | null }
  | { kind: "LIST"; listPath: string; position: PagePosition }
  | { kind: "DETAIL"; detailPath: string; source: CampaignOwnerReviews["reviews"][number] };

// Root's shared shell must register this leaf through its own navigation boundary.
// The registrar intercepts shell links AND browser-back before navigation begins;
// it calls requestLeave once and proceeds only through the supplied continuation.
// No Next history mutation or shared-shell implementation belongs to this draft.
export type CampaignPlanningNavigationGuard = {
  isBlocked: () => boolean;
  requestLeave: (continueNavigation: () => void, opener: HTMLElement | null) => void;
};
export type CampaignPlanningNavigationGuardRegistrar = (guard: CampaignPlanningNavigationGuard) => () => void;
export function useCampaignPlanningNavigationRegistration(register: CampaignPlanningNavigationGuardRegistrar | undefined,
  guard: CampaignPlanningNavigationGuard) {
  const current = useRef(guard);
  useEffect(() => { current.current = guard; }, [guard]);
  useEffect(() => register?.({ isBlocked: () => current.current.isBlocked(),
    requestLeave: (continueNavigation, opener) => current.current.requestLeave(continueNavigation, opener) }), [register]);
}
function PlanningContextPreview({ version, fileScope, onFileDeny }: { version: ContextVersion; fileScope?: PlanningScope; onFileDeny?: () => void }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  function original(value: { text: string | null; language: string | null }) {
    return <div className="min-w-0 space-y-1"><p dir="auto" lang={value.language ?? undefined} className="whitespace-pre-wrap break-words text-base [overflow-wrap:anywhere]">
      {value.text === null ? copy("غير محدد", "Not specified") : value.text === "" ? copy("نص فارغ محفوظ", "Saved empty text") : value.text}</p>
      {value.language && <p className="text-sm text-muted-foreground">{copy("اللغة المصرح بها", "Declared language")}: <bdi>{value.language}</bdi></p>}</div>;
  }
  return <div className="min-w-0 space-y-5 rounded-lg border p-4" aria-label={copy("تفاصيل نسخة السياق", "Context version details")}>
    <header className="space-y-2">{original(version.nameOriginal)}<p className="text-sm text-muted-foreground">{copy("نسخة", "Version")} {version.version}</p>
      <p className="text-sm leading-6 text-muted-foreground">{copy("محتوى أصلي محفوظ للمراجعة؛ ليس إثباتًا قانونيًا أو واقعيًا.", "Saved original content for review; it is not legal or factual verification.")}</p></header>
    <dl className="min-w-0 space-y-5"><div><dt className="mb-2 font-medium">{copy("التموضع", "Positioning")}</dt><dd>{original(version.content.positioning)}</dd></div>
      <div><dt className="mb-2 font-medium">{copy("النبرة", "Tone")}</dt><dd>{original(version.content.tone)}</dd></div>
      <div><dt className="mb-2 font-medium">{copy("القيم", "Values")}</dt><dd>{version.content.values.length ? <ul className="space-y-3">{version.content.values.map((value, index) => <li key={index}>{original(value)}</li>)}</ul> : <p className="text-base text-muted-foreground">{copy("لم تُضف قيم", "No values added")}</p>}</dd></div>
      <div><dt className="mb-2 font-medium">{copy("المراجع", "References")}</dt><dd>{version.content.references.length ? <ul className="space-y-4">{version.content.references.map((reference, index) => <li key={index} className="min-w-0 space-y-3 rounded-lg border p-3">
        {original(reference.label)}{reference.url && <a href={reference.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="block min-h-12 break-words py-3 text-base underline [overflow-wrap:anywhere]">{reference.url}</a>}
        <div><p className="mb-1 text-sm font-medium">{copy("الملاحظات", "Notes")}</p>{original(reference.notes)}</div></li>)}</ul> : <p className="text-base text-muted-foreground">{copy("لم تُضف مراجع", "No references added")}</p>}</dd></div>
      <div><dt className="mb-2 font-medium">{copy("المنافسون", "Competitors")}</dt><dd>{version.content.competitors.length ? <ul className="space-y-4">{version.content.competitors.map((competitor, index) => <li key={index} className="min-w-0 space-y-3 rounded-lg border p-3">
        {original(competitor.name)}{competitor.url && <a href={competitor.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="block min-h-12 break-words py-3 text-base underline [overflow-wrap:anywhere]">{competitor.url}</a>}
        <div><p className="mb-1 text-sm font-medium">{copy("الملاحظات", "Notes")}</p>{original(competitor.notes)}</div></li>)}</ul> : <p className="text-base text-muted-foreground">{copy("لم تُضف منافسين", "No competitors added")}</p>}</dd></div>
    </dl>
    {fileScope && onFileDeny && <ContextReferenceVersionFiles scope={fileScope} contextId={version.contextId}
      versionId={version.id} onDeny={onFileDeny} />}
  </div>;
}
function samePlanningScope(a: PlanningScope | null, b: PlanningScope | null) { return a !== null && b !== null && a.kind === b.kind
  && (a.kind === "OWN_BRAND" ? b.kind === "OWN_BRAND" && a.brandId === b.brandId : b.kind === "CLIENT" && a.clientId === b.clientId); }
function scopeQuery(scope: PlanningScope) { return new URLSearchParams(scope.kind === "OWN_BRAND" ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId }); }
function responseData(body: unknown) { return body && typeof body === "object" && "data" in body ? body.data : null; }
function matchingAuthority(plan: ClientAuthorityDTO, current: ClientAuthorityDTO | null) { return current !== null
  && (["organizationId", "clientId", "brandId", "membershipId", "grantId", "organizationRevision", "membershipRevision", "clientRevision", "grantRevision"] as const).every(key => plan[key] === current[key]); }
const absentPlan = Symbol("ABSENT_PLAN");
function invalidateFlight(refs: { mounted: { current: boolean }; active: { current: UiFlight | null }; generation: { current: number } }) {
  refs.mounted.current = false; refs.generation.current++; refs.active.current?.abort.abort(); refs.active.current = null;
}
function usePlanningTransport(clearPrivate: () => void) {
  const active = useRef<UiFlight | null>(null), generation = useRef(0), mounted = useRef(true), clear = useRef(clearPrivate);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { clear.current = clearPrivate; }, [clearPrivate]);
  useEffect(() => { mounted.current = true; const refs = { mounted, active, generation }; return () => invalidateFlight(refs); }, []);
  function same(flight: UiFlight) { return mounted.current && active.current === flight && generation.current === flight.generation; }
  function ensure(flight: UiFlight) { if (!same(flight) || flight.abort.signal.aborted || flight.denied) throw new PlanningUiError("CANCELLED"); }
  async function request(path: string, flight: UiFlight, body?: string, optionalPlan = false) {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: flight.abort.signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body }) });
    if (!same(flight)) throw new PlanningUiError("CANCELLED");
    if ([401, 403, 404].includes(response.status)) {
      if (optionalPlan && response.status === 404) return absentPlan;
      flight.denied = true; setError(response.status === 401 ? "UNAUTHENTICATED" : "NOT_FOUND"); clear.current();
      throw new PlanningUiError("DENIED", undefined, response.status);
    }
    ensure(flight);
    if (!response.ok) {
      let code = response.status === 503 ? "RETRY_REQUIRED" : "REQUEST_FAILED";
      try { const payload: unknown = await response.json();
        if (payload && typeof payload === "object" && "error" in payload && payload.error && typeof payload.error === "object"
          && "code" in payload.error && typeof payload.error.code === "string" && /^(STALE_VERSION|STALE_PROPOSAL|STALE_BRIEF|STALE_REVIEW|ARCHIVED|VALIDATION|INVALID_STATE|RETRY_REQUIRED|OPERATION_KEY_REUSED|SNAPSHOT_TOO_LARGE|REVISION_EXHAUSTED)$/.test(payload.error.code)) code = payload.error.code;
      } catch { /* A status is not replaced by arbitrary response text. */ }
      ensure(flight); throw new PlanningUiError(code, undefined, response.status);
    }
    const payload: unknown = await response.json(); ensure(flight); return responseData(payload);
  }
  async function run(operation: (flight: UiFlight) => Promise<void>) {
    if (active.current || !mounted.current) return;
    const flight: UiFlight = { abort: new AbortController(), generation: ++generation.current, denied: false, timedOut: false };
    active.current = flight; setBusy(true); setError(null);
    const timeout = setTimeout(() => { flight.timedOut = true; flight.abort.abort(); }, 30000);
    try { await operation(flight); ensure(flight); }
    catch (failure) { if (same(flight) && !flight.denied) setError(flight.timedOut ? "TIMEOUT" : flight.abort.signal.aborted ? "CANCELLED"
      : failure instanceof PlanningUiError ? failure.code : "NETWORK"); }
    finally { clearTimeout(timeout); if (same(flight)) { active.current = null; setBusy(false); } }
  }
  return { busy, error, setError, run, request, ensure, same, cancel: () => active.current?.abort.abort() };
}
function validPlanningReceipt(captured: PlanningPending, value: unknown) {
  const command = captured.command;
  const parsed = CampaignPlanningResultSchema.safeParse(value); if (!parsed.success) throw new PlanningUiError("INVALID_RESPONSE");
  const receipt = parsed.data, selectionRevision = command.action === "CREATE" || command.action === "BIND_OWN" ? 1
    : command.expectedSelectionRevision + (command.action === "SET_SELECTION" ? 1 : 0);
  if (receipt.action !== command.action || receipt.campaignRevision !== command.expectedCampaignRevision + 1
    || receipt.planningRevision !== command.expectedPlanningRevision + 1 || receipt.selectionRevision !== selectionRevision || receipt.inputRevision !== captured.expectedInputRevision
    || command.action !== "CREATE" && receipt.campaignId !== command.campaignId
    || command.action === "APPLY_PROPOSAL" && receipt.proposalId !== command.payload.proposalId
    || command.action === "SUBMIT_BRIEF" && (receipt.briefId !== command.payload.briefId || receipt.version !== command.payload.expectedBriefVersion)) throw new PlanningUiError("INVALID_RESPONSE");
  return receipt;
}
export function CampaignPlanningScreen({ scope, campaignId, initialCampaign, initialList = null, planAuthority, initialError = null }: CampaignPlanningScreenProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const navigationRegistrar = useNavigationGuardRegistrar();
  const fieldIds = useId();
  const [fixed] = useState(() => { const parsed = PlanningScopeSchema.safeParse(scope); return { scope: parsed.success ? parsed.data : null, routeId: campaignId }; });
  const [initial] = useState(() => {
    const detail = PlanningCampaignSchema.safeParse(initialCampaign), list = PlanningCampaignListSchema.safeParse(initialList);
    const current = detail.success && samePlanningScope(fixed.scope, detail.data.scope) && fixed.routeId === detail.data.campaign.id ? detail.data : null;
    const view = current?.currentAuthority ?? (list.success && samePlanningScope(fixed.scope, list.data.scope) ? list.data.currentAuthority : null);
    const authority = ClientAuthoritySchema.safeParse(planAuthority);
    return { current, viewAvailable: current !== null || list.success && samePlanningScope(fixed.scope, list.data.scope), plan: authority.success && authority.data.capability === "plan" && fixed.scope?.kind === "CLIENT"
      && authority.data.clientId === fixed.scope.clientId && matchingAuthority(authority.data, view) ? authority.data : null };
  });
  const [current, setCurrent] = useState<PlanningCampaign | null>(initial.current), currentRef = useRef(initial.current);
  const [base, setBase] = useState<PlanningCampaign | null>(initial.current), [latest, setLatest] = useState<PlanningCampaign | null>(null);
  const [form, setForm] = useState(() => planningToForm(initial.current?.campaign.fields ?? {})), [formDirty, setFormDirty] = useState(false);
  const [literal, setLiteral] = useState({ mode: initial.current?.planning.narrative?.mode ?? "CHAT" as "CHAT" | "PARAGRAPH",
    text: initial.current?.planning.narrative?.originalText.text ?? "", language: initial.current?.planning.narrative?.originalText.language ?? "" }), [literalDirty, setLiteralDirty] = useState(false);
  const [choice, setChoice] = useState<ContextChoice | null>(initial.current ? initial.current.planning.selection.kind === "NONE" ? { kind: "NONE" }
    : { kind: "APPROVED_CONTEXT", versionId: initial.current.planning.selection.versionId!, contentHash: initial.current.planning.selection.contentHash! } : null);
  const [choiceDirty, setChoiceDirty] = useState(false);
  const [versions, setVersions] = useState<ContextVersion[]>([]), [preview, setPreview] = useState<ContextVersion | null>(initial.current?.planning.selectedContext ?? null);
  const [contexts, setContexts] = useState<z.infer<typeof BrandContextListSchema> | null>(null), [contextId, setContextId] = useState<string | null>(null);
  const [contextPosition, setContextPosition] = useState({ after: null as string | null, history: [] as (string | null)[] });
  const [contextDetail, setContextDetail] = useState<z.infer<typeof BrandContextDetailResponseSchema> | null>(null);
  const [versionPosition, setVersionPosition] = useState<VersionPosition>(emptyVersionPosition);
  const [briefPosition, setBriefPosition] = useState<VersionPosition>(emptyVersionPosition);
  const [authority, setAuthority] = useState(initial.plan), [pending, setPending] = useState<PlanningPending | null>(null), pendingRef = useRef<PlanningPending | null>(null);
  const [viewAvailable, setViewAvailable] = useState(initial.viewAvailable), [readRetry, setReadRetry] = useState<EditorRead | null>(null);
  const [denied, setDenied] = useState(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(initialError ?? "")), [historical, setHistorical] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(), [confirmNavigation, setConfirmNavigation] = useState(false);
  const [leaveHref, setLeaveHref] = useState<string | null>(null), navigationOpener = useRef<HTMLElement | null>(null);
  const [leaveContinuation, setLeaveContinuation] = useState<(() => void) | null>(null), [bootError, setBootError] = useState(initialError);
  const heading = useRef<HTMLHeadingElement>(null), [focusSequence, setFocusSequence] = useState(0);
  const scopeDrift = !samePlanningScope(fixed.scope, scope) && (fixed.scope !== null || scope !== null) || fixed.routeId !== campaignId;
  function setCapture(value: PlanningPending | null) { pendingRef.current = value; setPending(value); }
  function clearPrivate() {
    setCurrent(null); currentRef.current = null; setBase(null); setLatest(null); setForm(planningToForm({})); setFormDirty(false);
    setLiteral({ mode: "CHAT", text: "", language: "" }); setLiteralDirty(false); setChoice(null); setChoiceDirty(false); setVersions([]); setPreview(null);
    setContexts(null); setContextId(null); setContextDetail(null); setContextPosition({ after: null, history: [] }); setVersionPosition(emptyVersionPosition());
    setBriefPosition(emptyVersionPosition());
    setAuthority(null); setViewAvailable(false); setReadRetry(null); setCapture(null); setFieldError(undefined); setConfirmNavigation(false); setLeaveHref(null); setLeaveContinuation(null); setBootError(null); setHistorical(false); setDenied(true); setFocusSequence(value => value + 1);
  }
  const net = usePlanningTransport(clearPrivate), protectedDenied = denied || scopeDrift;
  const canWrite = !protectedDenied && viewAvailable && (fixed.routeId === null || current !== null)
    && (fixed.scope?.kind === "OWN_BRAND" || authority?.capability === "plan"), terminal = current?.campaign.status === "CANCELLED" || current?.campaign.status === "COMPLETED";
  const disabled = net.busy || pending !== null || protectedDenied || !canWrite || terminal;
  function requestNavigation(continueNavigation: () => void, opener: HTMLElement | null) {
    if (pendingRef.current || net.busy) { net.setError("UNRESOLVED_REQUEST"); return; }
    if (!protectedDenied && (formDirty || literalDirty || choiceDirty)) {
      navigationOpener.current = opener; setLeaveHref(null); setLeaveContinuation(() => continueNavigation); setConfirmNavigation(true);
    } else continueNavigation();
  }
  useCampaignPlanningNavigationRegistration(navigationRegistrar, { isBlocked: () => !protectedDenied && (formDirty || literalDirty || choiceDirty || pendingRef.current !== null || net.busy), requestLeave: requestNavigation });
  useEffect(() => { if (focusSequence) heading.current?.focus(); }, [focusSequence]);
  useEffect(() => {
    if (!formDirty && !literalDirty && !choiceDirty && !pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [formDirty, literalDirty, choiceDirty, pending]);
  function detailPath(id: string, briefsAfter?: string | null) {
    if (!fixed.scope) throw new PlanningUiError("VALIDATION");
    const query = scopeQuery(fixed.scope); query.set("campaignId", id);
    if (briefsAfter) query.set("briefsAfter", briefsAfter);
    return "/api/planning-campaigns/detail?" + query;
  }
  async function readDetail(flight: UiFlight, id: string, path: string, cursorVersion: number | null = null) {
    const parsed = PlanningCampaignSchema.safeParse(await net.request(path, flight));
    if (!parsed.success || !samePlanningScope(fixed.scope, parsed.data.scope) || parsed.data.campaign.id !== id
      || new Set(parsed.data.briefs.map(brief => brief.id)).size !== parsed.data.briefs.length
      || parsed.data.briefs.some((brief, index, rows) => cursorVersion !== null && brief.version >= cursorVersion || index > 0 && brief.version >= rows[index - 1]!.version)
      || parsed.data.briefsAfter !== null && parsed.data.briefsAfter !== parsed.data.briefs.at(-1)?.id) throw new PlanningUiError("INVALID_RESPONSE");
    return parsed.data;
  }
  async function plan(flight: UiFlight, path?: string) {
    if (fixed.scope?.kind !== "CLIENT") return null;
    const value = await net.request(path ?? "/api/organization-clients/" + encodeURIComponent(fixed.scope.clientId) + "/authority?capability=plan", flight, undefined, true);
    if (value === absentPlan) { setAuthority(null); return null; }
    const parsed = ClientAuthoritySchema.safeParse(value);
    if (!parsed.success || parsed.data.capability !== "plan" || parsed.data.clientId !== fixed.scope.clientId) throw new PlanningUiError("INVALID_RESPONSE");
    return parsed.data;
  }
  function install(next: PlanningCampaign, receipt?: CampaignPlanningResult) {
    if (receipt && (next.campaign.revision < receipt.campaignRevision || next.planning.revision < receipt.planningRevision
      || next.planning.selection.revision < receipt.selectionRevision)) throw new PlanningUiError("INVALID_RESPONSE");
    currentRef.current = next; setCurrent(next); setViewAvailable(true); setBootError(null); setHistorical(false);
    if (fixed.scope?.kind === "CLIENT") setAuthority(value => value && matchingAuthority(value, next.currentAuthority) ? value : null);
    const exactOwnRevision = receipt && next.campaign.revision === receipt.campaignRevision && next.planning.revision === receipt.planningRevision;
    if (!choiceDirty || exactOwnRevision && (receipt.action === "CREATE" || receipt.action === "SET_SELECTION")) {
      setChoice(next.planning.selection.kind === "NONE" ? { kind: "NONE" } : { kind: "APPROVED_CONTEXT", versionId: next.planning.selection.versionId!, contentHash: next.planning.selection.contentHash! });
      setPreview(next.planning.selectedContext);
    }
    if (exactOwnRevision) {
      setBase(next);
      if (receipt.action === "CREATE" || receipt.action === "UPDATE_FIELDS" || receipt.action === "APPLY_PROPOSAL") { setForm(planningToForm(next.campaign.fields)); setFormDirty(false); }
      if (receipt.action === "SAVE_NARRATIVE") { setLiteral({ mode: next.planning.narrative?.mode ?? literal.mode, text: next.planning.narrative?.originalText.text ?? "",
        language: next.planning.narrative?.originalText.language ?? "" }); setLiteralDirty(false); }
      if (receipt.action === "SET_SELECTION") { setPreview(next.planning.selectedContext); }
      if (receipt.action === "SET_SELECTION" || receipt.action === "CREATE") setChoiceDirty(false);
      setBriefPosition(emptyVersionPosition());
    } else if (formDirty || literalDirty || receipt) setLatest(next);
    else { setBase(next); setForm(planningToForm(next.campaign.fields)); setLatest(null); setLiteral({ mode: next.planning.narrative?.mode ?? literal.mode,
      text: next.planning.narrative?.originalText.text ?? "", language: next.planning.narrative?.originalText.language ?? "" }); }
  }
  function captureCurrentRead(receipt?: CampaignPlanningResult, renewPermission = false): Extract<EditorRead, { kind: "CURRENT" }> {
    if (!fixed.scope) throw new PlanningUiError("VALIDATION");
    const captured = pendingRef.current;
    const id = receipt?.campaignId ?? (captured && captured.command.action !== "CREATE" ? captured.command.campaignId : currentRef.current?.campaign.id) ?? fixed.routeId;
    return { kind: "CURRENT", campaignId: id, path: id ? detailPath(id) : "/api/planning-campaigns?" + scopeQuery(fixed.scope), receipt: receipt ?? null,
      planPath: renewPermission && fixed.scope.kind === "CLIENT" ? "/api/organization-clients/" + encodeURIComponent(fixed.scope.clientId) + "/authority?capability=plan" : null };
  }
  async function performCurrentRead(flight: UiFlight, intent: Extract<EditorRead, { kind: "CURRENT" }>) {
    const receipt = intent.receipt ?? undefined;
    let candidate: ClientAuthorityDTO | null | undefined;
    let permissionFailure: unknown;
    if (intent.planPath) {
      try { candidate = await plan(flight, intent.planPath); } catch (failure) { permissionFailure = failure; candidate = null; }
    }
    net.ensure(flight);
    const id = intent.campaignId;
    if (!id) {
      const value = PlanningCampaignListSchema.safeParse(await net.request(intent.path, flight));
      if (!value.success || !samePlanningScope(fixed.scope, value.data.scope)) throw new PlanningUiError("INVALID_RESPONSE");
      net.ensure(flight); setViewAvailable(true); setBootError(null); setHistorical(false);
      if (candidate !== undefined) setAuthority(candidate && matchingAuthority(candidate, value.data.currentAuthority) ? candidate : null);
      const captured = pendingRef.current; if (captured?.phase === "CONFLICT") setCapture({ ...captured, reviewed: true });
      if (permissionFailure) throw permissionFailure; return;
    }
    const next = await readDetail(flight, id, intent.path); net.ensure(flight);
    if (receipt && (next.campaign.revision < receipt.campaignRevision || next.planning.revision < receipt.planningRevision || next.planning.selection.revision < receipt.selectionRevision)) throw new PlanningUiError("INVALID_RESPONSE");
    if (receipt && next.campaign.revision === receipt.campaignRevision && (next.campaign.fieldsRevision !== receipt.inputRevision
      || next.planning.selection.revision !== receipt.selectionRevision || next.planning.revision !== receipt.planningRevision)) throw new PlanningUiError("INVALID_RESPONSE");
    const captured = pendingRef.current;
    const exactAcknowledgement = receipt !== undefined && next.campaign.revision === receipt.campaignRevision && next.planning.revision === receipt.planningRevision;
    if (exactAcknowledgement && captured && !matchesCapturedMaterial(captured.expectedMaterial, next)) {
      // A concrete contradiction invalidates the acknowledgement, rather than
      // rewriting the user's words or locking recovery to the wrong resource.
      setCapture({ ...captured, phase: "UNKNOWN", receipt: null, reviewed: false }); setReadRetry(null);
      throw new PlanningUiError("INVALID_ACKNOWLEDGEMENT");
    }
    if (candidate !== undefined) setAuthority(candidate && matchingAuthority(candidate, next.currentAuthority) ? candidate : null);
    install(next, receipt);
    // This URI is the first brief page; its displayed rows and history must
    // share that boundary even when a normal refresh follows older paging.
    setBriefPosition(emptyVersionPosition());
    if (captured?.phase === "CONFIRMED") {
      if (exactAcknowledgement) setCapture(null);
      else setCapture({ ...captured, reviewed: true });
    } else if (captured?.phase === "CONFLICT") setCapture({ ...captured, reviewed: true });
    if (permissionFailure) throw permissionFailure;
  }
  async function performRead(flight: UiFlight, intent: EditorRead) {
    if (intent.kind === "CURRENT") await performCurrentRead(flight, intent);
    else if (intent.kind === "BRIEFS") {
      const value = await readDetail(flight, intent.campaignId, intent.path, intent.position.cursorVersion); net.ensure(flight);
      install(value); setBriefPosition(intent.position);
    } else if (intent.kind === "CONTEXTS") {
      const result = BrandContextListSchema.safeParse(await net.request(intent.path, flight));
      if (!result.success || !samePlanningScope(fixed.scope, result.data.scope) || result.data.contexts.some((row, index, rows) => row.archived
        || intent.position.after !== null && row.id <= intent.position.after || index > 0 && row.id <= rows[index - 1]!.id)
        || result.data.nextCursor !== null && result.data.nextCursor !== result.data.contexts.at(-1)?.id) throw new PlanningUiError("INVALID_RESPONSE");
      net.ensure(flight); setContexts(result.data); setContextPosition(intent.position);
    } else {
      const result = BrandContextDetailResponseSchema.safeParse(await net.request(intent.path, flight));
      if (!result.success || !samePlanningScope(fixed.scope, result.data.scope) || result.data.context.id !== intent.contextId
        || result.data.context.versions.some((version, index, rows) => version.contextId !== intent.contextId || intent.position.cursorVersion !== null && version.version >= intent.position.cursorVersion
          || index > 0 && version.version >= rows[index - 1]!.version)
        || result.data.context.versionsAfter !== null && result.data.context.versionsAfter !== result.data.context.versions.at(-1)?.id) throw new PlanningUiError("INVALID_RESPONSE");
      net.ensure(flight); setContextId(intent.contextId); setContextDetail(result.data); setVersions(result.data.context.versions); setVersionPosition(intent.position);
    }
  }
  async function capturedRead(flight: UiFlight, intent: EditorRead) {
    setReadRetry(intent); await performRead(flight, intent); net.ensure(flight); setReadRetry(null); setFocusSequence(value => value + 1);
  }
  async function currentRead(flight: UiFlight, receipt?: CampaignPlanningResult, renewPermission = false) {
    await capturedRead(flight, captureCurrentRead(receipt, renewPermission));
  }
  function startRead(intent: EditorRead) {
    if (protectedDenied || net.busy) return;
    if (intent.kind === "CURRENT" || intent.kind === "BRIEFS") setHistorical(true);
    void net.run(flight => capturedRead(flight, intent));
  }
  async function send(flight: UiFlight, captured: PlanningPending) {
    try { const receipt = validPlanningReceipt(captured, await net.request("/api/planning-campaigns/commands", flight, captured.body));
      net.ensure(flight); setCapture({ ...captured, receipt, phase: "CONFIRMED" }); await currentRead(flight, receipt);
    } catch (failure) {
      if (net.same(flight) && !flight.denied && pendingRef.current?.phase === "UNKNOWN" && failure instanceof PlanningUiError && [400, 409, 422].includes(failure.status ?? 0)) setCapture({ ...pendingRef.current, phase: "CONFLICT", reviewed: false });
      throw failure;
    }
  }
  function command(action: CampaignPlanningCommand["action"], payload: unknown) {
    if (!fixed.scope || disabled || latest) return;
    setHistorical(true); void net.run(async flight => {
      const expectedAuthority = await plan(flight);
      if (fixed.scope?.kind === "CLIENT" && !expectedAuthority) { await currentRead(flight); throw new PlanningUiError("NOT_ALLOWED"); }
      const snapshot = base, input = action === "CREATE" ? { action, expectedCampaignRevision: 0, expectedPlanningRevision: 0, expectedSelectionId: null, expectedSelectionRevision: 0 }
        : { action, campaignId: snapshot?.campaign.id, expectedCampaignRevision: snapshot?.campaign.revision, expectedPlanningRevision: snapshot?.planning.revision,
          expectedSelectionId: snapshot?.planning.selection.id, expectedSelectionRevision: snapshot?.planning.selection.revision };
      const parsed = CampaignPlanningCommandSchema.safeParse({ operationKey: crypto.randomUUID(), scope: fixed.scope, ...(expectedAuthority ? { expectedAuthority } : {}), ...input, payload });
      if (!parsed.success) throw new PlanningUiError("INVALID_FIELD");
      const expectedMaterial = capturedMaterial(parsed.data, snapshot);
      let expectedInputRevision = snapshot?.campaign.fieldsRevision ?? 1;
      if (snapshot && (parsed.data.action === "UPDATE_FIELDS" || parsed.data.action === "APPLY_PROPOSAL")) {
        if (JSON.stringify(expectedMaterial.fields) !== JSON.stringify(normalizedFields(snapshot.campaign.fields))) expectedInputRevision = snapshot.campaign.revision + 1;
      }
      const captured: PlanningPending = { command: parsed.data, body: JSON.stringify(parsed.data), phase: "UNKNOWN", receipt: null, reviewed: false, expectedInputRevision, expectedMaterial };
      setCapture(captured); await send(flight, captured);
    });
  }
  function save(event: FormEvent) { event.preventDefault(); try {
    const patch = planningFormPatch(form, base?.campaign.fields ?? {});
    if (!current) { if (!choice) throw new PlanningUiError("CONTEXT_CHOICE_REQUIRED"); command("CREATE", { fields: patch, selection: choice, narrative: null }); }
    else command("UPDATE_FIELDS", { patch });
  } catch (failure) { const problem = failure instanceof PlanningUiError ? failure : new PlanningUiError("INVALID_FIELD"); setFieldError(problem.field); net.setError(problem.code); } }
  function refresh() { if (protectedDenied || net.busy) return; startRead(captureCurrentRead(pendingRef.current?.receipt ?? undefined, true)); }
  function readBriefHistory(next: typeof briefPosition) {
    const id = currentRef.current?.campaign.id;
    if (!id || protectedDenied || net.busy || pendingRef.current) return;
    startRead({ kind: "BRIEFS", path: detailPath(id, next.after), campaignId: id, position: capturedVersionPosition(next) });
  }
  function loadContexts(next = { after: null as string | null, history: [] as (string | null)[] }) {
    if (!fixed.scope || protectedDenied || net.busy) return;
    const query = scopeQuery(fixed.scope); query.set("limit", "20"); if (next.after) query.set("after", next.after);
    startRead({ kind: "CONTEXTS", path: "/api/brand-contexts?" + query, position: capturedPosition(next) });
  }
  function loadContextVersions(id: string, next: VersionPosition = emptyVersionPosition()) {
    if (!fixed.scope || protectedDenied || net.busy) return;
    const query = scopeQuery(fixed.scope); query.set("contextId", id); if (next.after) query.set("versionsAfter", next.after);
    startRead({ kind: "CONTEXT_VERSIONS", path: "/api/brand-contexts/detail?" + query, contextId: id, position: capturedVersionPosition(next) });
  }
  function guardNavigation(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (pendingRef.current || net.busy) { event.preventDefault(); net.setError("UNRESOLVED_REQUEST"); return; }
    if (formDirty || literalDirty || choiceDirty) { event.preventDefault(); navigationOpener.current = event.currentTarget; setLeaveHref(href); setLeaveContinuation(null); setConfirmNavigation(true); }
  }
  const contextHref = fixed.scope?.kind === "CLIENT" ? "/brand/context?clientId=" + encodeURIComponent(fixed.scope.clientId) : "/brand/context";
  const allCampaignsHref = fixed.scope?.kind === "CLIENT" ? "/brand/campaigns?clientId=" + encodeURIComponent(fixed.scope.clientId) : "/brand/campaigns";
  const displayed = protectedDenied ? null : current, label = (key: string) => planningLabels[key]?.[isAr ? 0 : 1] ?? key;
  const topBrief = displayed?.briefs[0];
  return <section className={`${workflow.page} space-y-[22px]`}>
    <header className="space-y-3"><h1 ref={heading} tabIndex={-1} className="text-2xl font-bold">{displayed ? copy("رتّب تفاصيل حملتك", "Shape your campaign") : copy("ابدأ حملة مُدارة", "Start a managed campaign")}</h1>
      <p className="text-base leading-7 text-muted-foreground">{copy("احفظ الحقول وكلماتك اليدوية دون استخراج تلقائي، ثم راجع موجزًا مثبت السياق وأرسله للمالك الفعلي.", "Save fields and manual words without automatic extraction, then review the brief's pinned context and submit it to the actual owner.")}</p>
      <nav className="flex flex-wrap gap-3"><Button asChild variant="ghost"><Link href={allCampaignsHref} onClick={event => guardNavigation(event, allCampaignsHref)}>{copy("كل الحملات", "All campaigns")}</Link></Button>
        <Button asChild variant="ghost"><Link href={contextHref} onClick={event => guardNavigation(event, contextHref)}>{copy("سياقات العلامة التجارية", "Brand contexts")}</Link></Button>
        <Button asChild variant="ghost"><Link href="/brand/campaigns/reviews" onClick={event => guardNavigation(event, "/brand/campaigns/reviews")}>{copy("مراجعات المالك", "Owner reviews")}</Link></Button></nav>
      {!protectedDenied && <Button variant="outline" disabled={net.busy} onClick={refresh}>{copy("حدّث النسخة الحالية للمقارنة", "Refresh current version to compare")}</Button>}
    </header>
    {net.busy && <p role="status" className="space-y-3">{copy("جارٍ انتظار الرد الفعلي…", "Waiting for the actual response…")}<Button variant="outline" onClick={() => { net.cancel(); setFocusSequence(value => value + 1); }}>{copy("إلغاء الانتظار", "Cancel request")}</Button></p>}
    {(net.error || bootError) && <p role="alert" className="rounded-lg border border-destructive p-4 text-base">{copy("تعذر تأكيد الإجراء. راجع الحالة الحالية؛ الكلمات والطلب غير المؤكد يبقيان دون تغيير ما دام العرض متاحًا.", "The action could not be confirmed. Review current state; words and an uncertain request remain unchanged while access is available.")}</p>}
    {!protectedDenied && readRetry && !net.busy && <div className="space-y-3 rounded-lg border p-4"><p className="text-base">{copy("لم تتأكد القراءة؛ أعد نفس المورد والمؤشر دون تغيير كلماتك أو طلب الحفظ.", "The read is unconfirmed; retry the same resource and cursor without changing your words or saved request.")}</p>
      <Button variant="outline" onClick={() => startRead(readRetry)}>{copy("أعد القراءة", "Retry read")}</Button></div>}
    {historical && displayed && <p className="text-sm text-muted-foreground">{copy("آخر عرض صالح؛ لم يتأكد تحديثه الحالي.", "Last valid view; current refresh is unconfirmed.")}</p>}
    {!protectedDenied && pending && !net.busy && <Card><CardContent className="space-y-4"><p className="text-base">{pending.phase === "UNKNOWN" ? copy("الرد غير مؤكد؛ أعد الطلب نفسه دون مفتاح جديد.", "The reply is uncertain; retry the same request without a new key.")
      : pending.phase === "CONFIRMED" ? copy("إيصال تاريخي مؤكد؛ التعافي يقرأ الحالة فقط.", "Historical receipt confirmed; recovery reads current state only.") : copy("أعد القراءة وراجع الحالة قبل طلب جديد.", "Reload and review state before a new request.")}</p>
      <div className="flex flex-wrap gap-3">{pending.phase === "UNKNOWN" && <Button onClick={() => { const capture = pendingRef.current; if (capture) void net.run(flight => send(flight, capture)); }}>{copy("أعد الطلب نفسه", "Retry same request")}</Button>}
        <Button variant="outline" onClick={refresh}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>{pending.phase !== "UNKNOWN" && pending.reviewed && <Button onClick={() => { setCapture(null); if (currentRef.current) { setBase(currentRef.current); setLatest(null); } }}>{copy("راجعت الحالة وأحتفظ بكلماتي", "I reviewed state and keep my words")}</Button>}</div>
    </CardContent></Card>}
    {!protectedDenied && <>
      <Card><CardHeader><CardTitle>{copy("السياق الاختياري", "Optional context")}</CardTitle><CardDescription className="text-base">{copy("اختيار نسخة لا يستبدل حقولك؛ يمكن اختيار بلا سياق صراحةً.", "Choosing a version does not replace your fields; explicitly choose no context if preferred.")}</CardDescription></CardHeader>
        <CardContent className="space-y-4"><Button variant="outline" disabled={net.busy || !!pending} onClick={() => loadContexts()}>{copy("تحميل السياقات المتاحة", "Load available contexts")}</Button>
          {contexts && <><label htmlFor={fieldIds + "-context"} className="block space-y-2"><span className="text-base">{copy("سياق محفوظ لعرض نسخه", "Saved context to inspect")}</span><select id={fieldIds + "-context"} aria-label={copy("سياق محفوظ لعرض نسخه", "Saved context to inspect")} className={selectClass} value={contextId ?? ""} disabled={net.busy || !!pending}
            onChange={event => { if (event.target.value) loadContextVersions(event.target.value); }}><option value="">{copy("اختر سياقًا بنفسك", "Choose a context yourself")}</option>
            {contexts.contexts.map(context => <option key={context.id} value={context.id}>{context.nameOriginal.text}</option>)}</select></label>
            <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={net.busy || !contextPosition.history.length} onClick={() => loadContexts({ after: contextPosition.history.at(-1)!, history: contextPosition.history.slice(0, -1) })}>{copy("السياقات السابقة", "Previous contexts")}</Button>
              <Button variant="outline" disabled={net.busy || !contexts.nextCursor} onClick={() => loadContexts({ after: contexts.nextCursor, history: [...contextPosition.history, contextPosition.after] })}>{copy("السياقات التالية", "Next contexts")}</Button></div>
          </>}
          <label htmlFor={fieldIds + "-version"} className="block space-y-2"><span className="text-base">{copy("نسخة السياق", "Context version")}</span><select id={fieldIds + "-version"} aria-label={copy("نسخة السياق", "Context version")} className={selectClass} disabled={disabled} value={choice?.kind === "NONE" ? "NONE" : choice?.versionId ?? ""}
          onChange={event => { if (event.target.value === "NONE") { setChoice({ kind: "NONE" }); setPreview(null); setChoiceDirty(true); } else { const version = versions.find(row => row.id === event.target.value); if (version) { setChoice({ kind: "APPROVED_CONTEXT", versionId: version.id, contentHash: version.contentHash }); setPreview(version); setChoiceDirty(true); } } }}>
          <option value="">{copy("اختر صراحةً", "Choose explicitly")}</option><option value="NONE">{copy("بلا سياق", "No context")}</option>
          {choice?.kind === "APPROVED_CONTEXT" && !versions.some(version => version.id === choice.versionId) && preview && <option value={choice.versionId} disabled>{preview.nameOriginal.text} · {copy("اختيار محفوظ", "Saved choice")}</option>}
          {versions.map(version => <option key={version.id} value={version.id}>{version.nameOriginal.text} · {copy("نسخة", "Version")} {version.version}</option>)}</select></label>
          {contextDetail && contextId && <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={net.busy || !versionPosition.history.length} onClick={() => { const next = previousVersionPosition(versionPosition); if (next) loadContextVersions(contextId, next); }}>{copy("نسخ أحدث", "Newer versions")}</Button>
            <Button variant="outline" disabled={net.busy || !contextDetail.context.versionsAfter} onClick={() => { const next = nextVersionPosition(versionPosition, contextDetail.context.versionsAfter, contextDetail.context.versions.at(-1)); if (next) loadContextVersions(contextId, next); }}>{copy("نسخ أقدم", "Older versions")}</Button></div>}
          {preview && <PlanningContextPreview version={preview} fileScope={fixed.scope ?? undefined} onFileDeny={clearPrivate} />}
          {choiceDirty && <p className="text-sm text-muted-foreground">{copy("هذا الاختيار لم يُحفظ بعد؛ لا يغيّر السياق المثبت في النسخ المحفوظة.", "This choice has not been saved yet; stored versions retain their pinned context.")}</p>}
          {displayed && <Button disabled={disabled || !choice || !choiceDirty} onClick={() => choice && command("SET_SELECTION", { selection: choice })}>{copy("احفظ اختيار السياق", "Save context choice")}</Button>}
        </CardContent></Card>
      {latest && <Card><CardHeader><CardTitle>{copy("قارن النسخة الحالية", "Compare current version")}</CardTitle></CardHeader><CardContent className="space-y-4">
        <dl className="space-y-3">{Object.entries(latest.campaign.fields).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{campaignFieldValue(key, value, isAr)}</dd></div>)}</dl>
        <div className="space-y-3"><h3 className="font-medium">{copy("اختيار السياق المحفوظ حاليًا", "Currently saved context choice")}</h3>
          {latest.planning.selectedContext ? <PlanningContextPreview version={latest.planning.selectedContext} fileScope={fixed.scope ?? undefined} onFileDeny={clearPrivate} /> : <p>{copy("بلا سياق", "No context")}</p>}</div>
        <div className="space-y-3"><h3 className="font-medium">{copy("الكلمات اليدوية المحفوظة حاليًا", "Currently saved manual words")}</h3>
          {latest.planning.narrative ? <><p>{latest.planning.narrative.mode === "CHAT" ? copy("محادثة يدوية غير معالجة", "Unprocessed manual chat") : copy("فقرة غير معالجة", "Unprocessed paragraph")}</p>
            <p dir="auto" lang={latest.planning.narrative.originalText.language ?? undefined} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{latest.planning.narrative.originalText.text === "" ? copy("نص فارغ محفوظ", "Saved empty text") : latest.planning.narrative.originalText.text}</p>
            {latest.planning.narrative.originalText.language && <p className="text-sm text-muted-foreground">{copy("اللغة المصرح بها", "Declared language")}: <bdi>{latest.planning.narrative.originalText.language}</bdi></p>}</>
            : <p>{copy("لا يوجد نص يدوي محفوظ", "No saved manual text")}</p>}</div>
        <div className="flex flex-wrap gap-3"><Button disabled={!!pending} onClick={() => { setBase(latest); setLatest(null); }}>{copy("أحتفظ بمدخلاتي وأراجعها", "Keep my input and review")}</Button>
          <Button variant="outline" disabled={!!pending} onClick={() => { setBase(latest); setForm(planningToForm(latest.campaign.fields)); setFormDirty(false);
            setLiteral({ mode: latest.planning.narrative?.mode ?? "CHAT", text: latest.planning.narrative?.originalText.text ?? "", language: latest.planning.narrative?.originalText.language ?? "" }); setLiteralDirty(false);
            setChoice(latest.planning.selection.kind === "NONE" ? { kind: "NONE" } : { kind: "APPROVED_CONTEXT", versionId: latest.planning.selection.versionId!, contentHash: latest.planning.selection.contentHash! }); setChoiceDirty(false);
            setPreview(latest.planning.selectedContext); setLatest(null); }}>{copy("استبدل بالنسخة المحفوظة", "Replace with saved version")}</Button></div>
      </CardContent></Card>}
      <CampaignPlanningManualForm form={form} onChange={update => { setForm(update); setFormDirty(true); setFieldError(undefined); }} disabled={disabled} onSubmit={save} errorField={fieldError} />
      <Card><CardHeader><CardTitle>{copy("كلمات يدوية محفوظة", "Saved manual words")}</CardTitle><CardDescription className="text-base">{copy("محادثة أو فقرة حرفية غير معالجة. لا توجد إجابة مساعد أو استخراج مزعوم.", "Literal unprocessed chat or paragraph text. No assistant reply or extraction is claimed.")}</CardDescription></CardHeader>
        <CardContent className="space-y-4"><label htmlFor={fieldIds + "-mode"} className="block space-y-2"><span>{copy("طريقة النص", "Text mode")}</span><select id={fieldIds + "-mode"} aria-label={copy("طريقة النص", "Text mode")} className={selectClass} disabled={disabled} value={literal.mode}
          onChange={event => { setLiteral(previous => ({ ...previous, mode: event.target.value as "CHAT" | "PARAGRAPH" })); setLiteralDirty(true); }}><option value="CHAT">{copy("محادثة يدوية", "Manual chat")}</option><option value="PARAGRAPH">{copy("فقرة", "Paragraph")}</option></select></label>
          <label htmlFor={fieldIds + "-literal-text"} className="block space-y-2"><span>{copy("كلماتك الأصلية", "Your original words")}</span><Textarea id={fieldIds + "-literal-text"} aria-label={copy("كلماتك الأصلية", "Your original words")} dir="auto" className="text-base" maxLength={20000} disabled={disabled} value={literal.text} onChange={event => { setLiteral(previous => ({ ...previous, text: event.target.value })); setLiteralDirty(true); }} /></label>
          <label className="block space-y-2"><span>{copy("لغة النص", "Text language")}</span><Input dir="ltr" className="text-base" maxLength={100} disabled={disabled} value={literal.language} onChange={event => { setLiteral(previous => ({ ...previous, language: event.target.value })); setLiteralDirty(true); }} /></label>
          <Button disabled={disabled || !displayed} onClick={() => { const narrative = ManualNarrativeSchema.safeParse({ schemaVersion: 1, mode: literal.mode, processing: "UNPROCESSED", originalText: { text: literal.text, language: literal.language || null } });
            if (narrative.success) command("SAVE_NARRATIVE", { narrative: narrative.data }); else net.setError("INVALID_FIELD"); }}>{copy("احفظ النص الحرفي", "Save literal text")}</Button>
          <Button variant="outline" disabled={disabled || !displayed} onClick={() => command("SAVE_NARRATIVE", { narrative: null })}>{copy("امسح النص المحفوظ صراحةً", "Explicitly clear saved text")}</Button>
        </CardContent></Card>
      {displayed && <Card><CardHeader><CardTitle>{copy("اقتراحات تحتاج مراجعتك", "Proposals for your review")}</CardTitle></CardHeader><CardContent className="space-y-5">
        <Button variant="outline" disabled={disabled || choiceDirty || !displayed.planning.selectedContext} onClick={() => command("PROPOSE_CONTEXT_TONE", {})}>{copy("اقترح النبرة الأصلية دون تطبيق", "Propose original tone without applying")}</Button>
        {displayed.proposals.map(proposal => <article key={proposal.id} data-campaign-proposal-id={proposal.id} className="space-y-4 rounded-lg border p-4"><Badge variant="outline">{proposal.origin === "HUMAN" ? copy("اقتراح يدوي محفوظ", "Saved human proposal") : copy("اقتراح من النبرة الأصلية", "Original tone proposal")}</Badge><p dir="auto" lang={proposal.originalText.language ?? undefined} className="whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{proposal.originalText.text}</p>
          <dl>{Object.entries(proposal.patch).map(([key, value]) => <div key={key} className="grid gap-2 sm:grid-cols-2"><div>{copy("المحفوظ حاليًا", "Currently saved")}{campaignFieldValue(key, displayed.campaign.fields[key as keyof CampaignDraftFields], isAr)}</div><div>{copy("الاقتراح", "Proposal")}{campaignFieldValue(key, value, isAr)}</div></div>)}</dl>
          <div className="flex flex-wrap gap-3">{proposal.origin === "CONTEXT_TONE" && <Button variant="outline" disabled={disabled || formDirty || literalDirty || !!proposal.appliedAt} onClick={() => command("APPLY_PROPOSAL", { proposalId: proposal.id, toneDecision: "KEEP" })}>{copy("احتفظ بالنبرة الحالية", "Keep current tone")}</Button>}
            <Button disabled={disabled || formDirty || literalDirty || !!proposal.appliedAt || proposal.basedOnFieldsRevision !== displayed.campaign.fieldsRevision
              || proposal.dependency !== null && (proposal.dependency.selectionId !== displayed.planning.selection.id || proposal.dependency.selectionRevision !== displayed.planning.selection.revision)}
              onClick={() => command("APPLY_PROPOSAL", { proposalId: proposal.id, toneDecision: proposal.origin === "CONTEXT_TONE" ? "REPLACE" : null })}>{copy("راجعت التغييرات وأطبقها", "I've reviewed and apply these changes")}</Button></div>
        </article>)}
      </CardContent></Card>}
      {displayed && <section className={briefStyles.page}><header className={briefStyles.heading}><h2>{copy("موجز مثبت السياق", "Context-pinned brief")}</h2></header><div className={briefStyles.preparation}>
        <Button variant="outline" disabled={disabled || formDirty || literalDirty || choiceDirty || !CampaignFieldsSchema.safeParse(displayed.campaign.fields).success} onClick={() => command("GENERATE_BRIEF", {})}>{copy("جهّز الموجز للمراجعة", "Prepare brief for review")}</Button>
        {topBrief && <CampaignBrief title={topBrief.content.requirements.title} version={topBrief.version} status={topBrief.approvedAt ? copy("اعتماد محفوظ", "Approval retained") : copy("غير معتمد", "Unapproved")}
          rows={Object.entries(topBrief.content.requirements).filter(([key]) => Object.hasOwn(campaignFieldLabels, key)).map(([key, value]) => ({ key, label: label(key), value: campaignFieldValue(key, value, isAr) }))}>
          <p className="text-base">{topBrief.provenance ? topBrief.provenance.versionId === null ? copy("سياق مثبت: بلا سياق", "Pinned context: none") : copy("نسخة سياق محددة مثبتة", "An exact context version is pinned") : copy("نسخة تاريخية دون سياق مخترع", "Historical version without invented context")}</p>
          <Button disabled={disabled || formDirty || literalDirty || choiceDirty || briefPosition.after !== null || !!topBrief.approvedAt || !topBrief.provenance || topBrief.inputRevision !== displayed.campaign.fieldsRevision
            || topBrief.provenance.selectionId !== displayed.planning.selection.id || topBrief.provenance.selectionRevision !== displayed.planning.selection.revision}
            onClick={() => command("SUBMIT_BRIEF", { briefId: topBrief.id, expectedBriefVersion: topBrief.version })}>{copy("أرسل النسخة لمراجعة المالك", "Submit version for owner review")}</Button>
        </CampaignBrief>}
        {displayed.briefs.length > 1 && <details className={briefStyles.history}><summary className="min-h-12 cursor-pointer py-3 text-base font-medium">{copy("سجل النسخ السابقة", "Previous version history")}</summary>
          <ol className="space-y-4 pt-3">{displayed.briefs.slice(1).map(brief => <li key={brief.id} className="rounded-lg border p-4"><p className="text-base">{copy("نسخة", "Version")} {brief.version} · {brief.approvedAt ? copy("اعتماد سابق محفوظ", "Previous approval retained") : copy("غير معتمدة", "Unapproved")}</p>
            <p className="text-sm">{brief.provenance ? brief.provenance.versionId === null ? copy("اختيار مثبت: بلا سياق", "Pinned choice: no context") : copy("نسخة سياق ثابتة مثبتة", "Exact context version pinned") : copy("سجل تاريخي دون سياق مخترع", "Historical record without invented context")}</p>
            <details><summary className="min-h-12 cursor-pointer py-3">{copy("اعرض تفاصيل هذه النسخة", "View this version's requirements")}</summary><dl className="space-y-3">{Object.entries(brief.content.requirements).filter(([key]) => Object.hasOwn(campaignFieldLabels, key)).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{campaignFieldValue(key, value, isAr)}</dd></div>)}</dl></details>
          </li>)}</ol></details>}
        <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={net.busy || !!pending || !briefPosition.history.length} onClick={() => { const next = previousVersionPosition(briefPosition); if (next) readBriefHistory(next); }}>{copy("نسخ أحدث", "Newer briefs")}</Button>
          <Button variant="outline" disabled={net.busy || !!pending || !displayed.briefsAfter} onClick={() => { const next = nextVersionPosition(briefPosition, displayed.briefsAfter, displayed.briefs.at(-1)); if (next) readBriefHistory(next); }}>{copy("نسخ أقدم", "Older briefs")}</Button></div>
      </div></section>}
    </>}
    <Dialog open={confirmNavigation} onOpenChange={setConfirmNavigation}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (navigationOpener.current?.isConnected) navigationOpener.current.focus(); else heading.current?.focus(); }}><DialogHeader><DialogTitle>{copy("مدخلات غير محفوظة", "Unsaved input")}</DialogTitle><DialogDescription>{copy("اختر صراحةً قبل مغادرة كلماتك.", "Choose explicitly before leaving your words.")}</DialogDescription></DialogHeader>
      <DialogFooter><Button onClick={() => { setConfirmNavigation(false); setLeaveContinuation(null); }}>{copy("تابع التحرير", "Keep editing")}</Button>{leaveHref && <Button asChild variant="outline"><Link href={leaveHref}>{copy("تجاهل التغييرات وغادر", "Discard changes and leave")}</Link></Button>}
        {leaveContinuation && <Button variant="outline" onClick={() => { const proceed = leaveContinuation; setConfirmNavigation(false); setLeaveContinuation(null); proceed(); }}>{copy("تجاهل التغييرات وغادر", "Discard changes and leave")}</Button>}</DialogFooter></DialogContent></Dialog>
  </section>;
}

export function PlanningCampaignListScreen({ scope, initialPage, planAuthority, initialError = null }: PlanningCampaignListScreenProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [fixedScope] = useState(() => { const parsed = PlanningScopeSchema.safeParse(scope); return parsed.success ? parsed.data : null; }), [initial] = useState(() => { const parsed = PlanningCampaignListSchema.safeParse(initialPage);
    return parsed.success && samePlanningScope(fixedScope, parsed.data.scope) ? parsed.data : null; });
  const [page, setPage] = useState(initial), [denied, setDenied] = useState(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(initialError ?? ""));
  const [authority, setAuthority] = useState(() => { const parsed = ClientAuthoritySchema.safeParse(planAuthority);
    return parsed.success && parsed.data.capability === "plan" && fixedScope?.kind === "CLIENT" && parsed.data.clientId === fixedScope.clientId
      && initial && matchingAuthority(parsed.data, initial.currentAuthority) ? parsed.data : null; });
  const [position, setPosition] = useState({ after: null as string | null, history: [] as (string | null)[] }), [historical, setHistorical] = useState(false);
  const [readRetry, setReadRetry] = useState<ListRead | null>(null);
  const [bootError, setBootError] = useState(initialError);
  const heading = useRef<HTMLHeadingElement>(null), [focusSequence, setFocusSequence] = useState(0);
  function clearPrivate() { setPage(null); setAuthority(null); setReadRetry(null); setBootError(null); setPosition({ after: null, history: [] }); setHistorical(false); setDenied(true); setFocusSequence(value => value + 1); }
  const net = usePlanningTransport(clearPrivate), scopeDrift = !samePlanningScope(fixedScope, scope), protectedDenied = denied || scopeDrift;
  useEffect(() => { if (focusSequence) heading.current?.focus(); }, [focusSequence]);
  const canWrite = !protectedDenied && (fixedScope?.kind === "OWN_BRAND" || authority !== null && fixedScope?.kind === "CLIENT"
    && authority.clientId === fixedScope.clientId && page !== null && matchingAuthority(authority, page.currentAuthority));
  function startRead(intent: ListRead) {
    if (!fixedScope || protectedDenied || net.busy) return; setHistorical(true);
    void net.run(async flight => {
      setReadRetry(intent);
      let candidate: ClientAuthorityDTO | null = null, failure: unknown;
      if (intent.planPath && fixedScope.kind === "CLIENT") {
        try { const value = await net.request(intent.planPath, flight, undefined, true);
          if (value === absentPlan) setAuthority(null); else { const parsed = ClientAuthoritySchema.safeParse(value);
            if (!parsed.success || parsed.data.capability !== "plan" || parsed.data.clientId !== fixedScope.clientId) throw new PlanningUiError("INVALID_RESPONSE"); candidate = parsed.data; }
        } catch (error) { failure = error; }
      }
      net.ensure(flight); const result = PlanningCampaignListSchema.safeParse(await net.request(intent.path, flight));
      if (!result.success || !samePlanningScope(fixedScope, result.data.scope) || result.data.campaigns.some((row, index, rows) => intent.position.after !== null && row.id <= intent.position.after
        || index > 0 && row.id <= rows[index - 1]!.id) || result.data.nextCursor !== null && result.data.nextCursor !== result.data.campaigns.at(-1)?.id) throw new PlanningUiError("INVALID_RESPONSE");
      net.ensure(flight); setPage(result.data); setPosition(intent.position); setBootError(null); setHistorical(false);
      if (fixedScope.kind === "CLIENT") setAuthority(candidate && matchingAuthority(candidate, result.data.currentAuthority) ? candidate : null);
      if (failure) throw failure;
      setReadRetry(null); setFocusSequence(value => value + 1);
    });
  }
  function read(next: typeof position) {
    if (!fixedScope || protectedDenied || net.busy) return;
    const query = scopeQuery(fixedScope); query.set("limit", "20"); if (next.after) query.set("after", next.after);
    startRead({ path: "/api/planning-campaigns?" + query, position: capturedPosition(next), planPath: fixedScope.kind === "CLIENT"
      ? "/api/organization-clients/" + encodeURIComponent(fixedScope.clientId) + "/authority?capability=plan" : null });
  }
  const newCampaignHref = fixedScope?.kind === "CLIENT" ? "/brand/campaigns/new?clientId=" + encodeURIComponent(fixedScope.clientId) : "/brand/campaigns/new";
  function href(id: string) { const path = "/brand/campaigns/" + encodeURIComponent(id);
    return fixedScope?.kind === "CLIENT" ? path + "?clientId=" + encodeURIComponent(fixedScope.clientId) : path; }
  return <section className={`${workflow.page} space-y-[22px]`}><header className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h1 ref={heading} tabIndex={-1} className="mb-1 text-2xl font-bold">{copy("حملاتك المُدارة", "Your managed campaigns")}</h1>
    <p className="max-w-2xl text-[14.5px] text-muted-foreground">{copy("ارجع لمدخلاتك الأصلية وراجع الموجز المثبت ثم أرسله لمراجعة المالك الفعلي.", "Resume your original input, review the pinned brief and submit it to the actual owner.")}</p></div>
    {canWrite && <Button asChild><Link href={newCampaignHref}>{copy("حملة جديدة", "New campaign")}</Link></Button>}</header>
    {net.busy && <p role="status">{copy("تحميل الحملات…", "Loading campaigns…")}<Button variant="outline" onClick={() => { net.cancel(); setFocusSequence(value => value + 1); }}>{copy("إلغاء الانتظار", "Cancel request")}</Button></p>}
    {(net.error || bootError) && <p role="alert" className="rounded-lg border border-destructive p-4">{copy("تعذر تحميل العرض؛ يبقى آخر عرض صالح ما دام الوصول متاحًا.", "The view could not be loaded; the last valid view remains while access is available.")}</p>}
    {!protectedDenied && readRetry && !net.busy && <Button variant="outline" onClick={() => startRead(readRetry)}>{copy("أعد القراءة", "Retry read")}</Button>}
    {!protectedDenied && !page && <Button variant="outline" disabled={net.busy} onClick={() => read(position)}>{copy("حدّث العرض الحالي", "Refresh current view")}</Button>}
    {historical && !protectedDenied && <p className="text-sm text-muted-foreground">{copy("آخر عرض صالح؛ تحديثه غير مؤكد.", "Last valid view; refresh is unconfirmed.")}</p>}
    {!protectedDenied && page && <Card className="gap-0 rounded-[18px] border border-border py-0 ring-0"><div className="grid gap-3 bg-background px-6 py-[13px] text-[12.5px] font-bold text-muted-foreground sm:grid-cols-3">
      <span>{copy("الحملة", "Campaign")}</span><span>{copy("المراجعة", "Revision")}</span><span>{copy("الحالة", "State")}</span></div>
      {page.campaigns.length === 0 && <div className="px-6 py-[22px]"><h2 className="text-base font-bold">{copy("فكرتك تبدأ هنا", "Your idea starts here")}</h2><p className="text-[13.5px] text-muted-foreground">{copy("ابدأ بالمعلومات المتاحة وكملها لاحقًا؛ السياق اختياري.", "Start with available information and complete it later; context is optional.")}</p></div>}
      {page.campaigns.map(row => <div key={row.id} data-campaign-id={row.id} className="grid items-center gap-3 border-t px-6 py-4 sm:grid-cols-3"><Button asChild variant="ghost" className="min-w-0 whitespace-pre-wrap break-words"><Link href={href(row.id)} dir="auto">{row.title || copy("مسودة دون عنوان", "Untitled draft")}</Link></Button>
        <span>{row.revision}</span><Badge variant="outline">{row.currentBriefVersion ? copy("موجز معتمد محفوظ", "Approved brief retained") : copy("مسودة تحتاج مراجعة", "Draft for review")}</Badge></div>)}
    </Card>}
    {!protectedDenied && page && <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={net.busy || !position.history.length} onClick={() => read({ after: position.history.at(-1)!, history: position.history.slice(0, -1) })}>{copy("السابق", "Previous")}</Button>
      <Button variant="outline" disabled={net.busy || !page.nextCursor} onClick={() => read({ after: page.nextCursor, history: [...position.history, position.after] })}>{copy("التالي", "Next")}</Button>
      <Button variant="outline" disabled={net.busy} onClick={() => read(position)}>{copy("حدّث العرض الحالي", "Refresh current view")}</Button></div>}
  </section>;
}

export function CampaignPlanningOwnerReviewsScreen({ initialPage, initialError = null }: CampaignPlanningOwnerReviewsScreenProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [initial] = useState(() => { const parsed = CampaignOwnerReviewsSchema.safeParse(initialPage); return parsed.success ? parsed.data : null; });
  const [page, setPage] = useState(initial), [detail, setDetail] = useState<CampaignOwnerReview | null>(null);
  const detailRef = useRef<CampaignOwnerReview | null>(null);
  const [position, setPosition] = useState({ after: null as string | null, history: [] as (string | null)[] });
  const [denied, setDenied] = useState(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(initialError ?? ""));
  const [historical, setHistorical] = useState(false), heading = useRef<HTMLHeadingElement>(null), [focusSequence, setFocusSequence] = useState(0);
  type Decision = { operationKey: string; submissionId: string; expectedRevision: number; decision: "APPROVE" | "DECLINE" };
  type Capture = { command: Decision; body: string; source: CampaignOwnerReview["review"]; phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT";
    receipt: CampaignOwnerReviewResult | null; reviewed: boolean };
  const [pending, setPending] = useState<Capture | null>(null), pendingRef = useRef<Capture | null>(null);
  const [readRetry, setReadRetry] = useState<OwnerRead | null>(null);
  const [bootError, setBootError] = useState(initialError);
  function setCapture(value: Capture | null) { pendingRef.current = value; setPending(value); }
  function install(value: CampaignOwnerReview | null) { detailRef.current = value; setDetail(value); }
  function clearPrivate() { setPage(null); install(null); setCapture(null); setReadRetry(null); setBootError(null); setPosition({ after: null, history: [] }); setDenied(true); setHistorical(false); setFocusSequence(value => value + 1); }
  const net = usePlanningTransport(clearPrivate), disabled = denied || net.busy || pending !== null;
  useEffect(() => { if (focusSequence) heading.current?.focus(); }, [focusSequence]);
  function listPath(after: string | null) {
    const query = new URLSearchParams({ limit: "20" }); if (after) query.set("after", after);
    return "/api/planning-campaigns/reviews?" + query;
  }
  async function list(flight: UiFlight, path: string, after: string | null) {
    const result = CampaignOwnerReviewsSchema.safeParse(await net.request(path, flight));
    if (!result.success || result.data.reviews.some((row, index, rows) => after !== null && row.id <= after || index > 0 && row.id <= rows[index - 1]!.id)
      || result.data.nextCursor !== null && result.data.nextCursor !== result.data.reviews.at(-1)?.id) throw new PlanningUiError("INVALID_RESPONSE"); return result.data;
  }
  function detailPath(id: string) { return "/api/planning-campaigns/reviews/detail?" + new URLSearchParams({ submissionId: id }); }
  async function read(flight: UiFlight, path: string, source: CampaignOwnerReviews["reviews"][number] | CampaignOwnerReview["review"]) {
    const result = CampaignOwnerReviewSchema.safeParse(await net.request(path, flight));
    if (!result.success || result.data.review.id !== source.id || result.data.review.campaignId !== source.campaignId || result.data.review.briefId !== source.briefId
      || !samePlanningScope(result.data.review.scope, source.scope) || result.data.review.version !== source.version || result.data.review.inputRevision !== source.inputRevision
      || result.data.review.campaignRevision !== source.campaignRevision || result.data.review.selectionRevision !== source.selectionRevision || result.data.review.revision < source.revision
      || "contentHash" in source && result.data.review.contentHash !== source.contentHash) throw new PlanningUiError("INVALID_RESPONSE"); return result.data;
  }
  async function performCurrentRead(flight: UiFlight, intent: Extract<OwnerRead, { kind: "CURRENT" }>) {
    const captured = pendingRef.current;
    // Every batch settles; an actual denial latches before any body parse even
    // when the other request fails first or the user has abandoned waiting.
    const results = await Promise.allSettled([list(flight, intent.listPath, intent.after),
      intent.source && intent.detailPath ? read(flight, intent.detailPath, intent.source) : Promise.resolve(null)]);
    if (results[0].status === "rejected") throw results[0].reason; if (results[1].status === "rejected") throw results[1].reason;
    net.ensure(flight); const current = results[1].value;
    if (captured?.phase === "CONFIRMED") {
      const receipt = captured.receipt;
      if (!receipt || !current || current.review.state !== receipt.state || current.review.revision !== receipt.revision
        || current.review.briefId !== receipt.briefId || current.review.version !== receipt.version) throw new PlanningUiError("INVALID_RESPONSE");
    }
    setPage(results[0].value); if (current) install(current); setHistorical(false);
    if (captured?.phase === "CONFIRMED") setCapture(null); else if (captured?.phase === "CONFLICT") setCapture({ ...captured, reviewed: true });
  }
  function captureCurrentRead(): Extract<OwnerRead, { kind: "CURRENT" }> {
    const source = pendingRef.current?.source ?? detailRef.current?.review ?? null;
    return { kind: "CURRENT", listPath: listPath(position.after), after: position.after, detailPath: source ? detailPath(source.id) : null, source };
  }
  async function capturedRead(flight: UiFlight, intent: OwnerRead) {
    setReadRetry(intent);
    if (intent.kind === "CURRENT") await performCurrentRead(flight, intent);
    else if (intent.kind === "LIST") {
      const value = await list(flight, intent.listPath, intent.position.after); net.ensure(flight); setPage(value); setPosition(intent.position);
    } else {
      const value = await read(flight, intent.detailPath, intent.source); net.ensure(flight); install(value); setHistorical(false);
    }
    net.ensure(flight); setReadRetry(null); setBootError(null); setFocusSequence(value => value + 1);
  }
  async function currentRead(flight: UiFlight) { await capturedRead(flight, captureCurrentRead()); }
  function startRead(intent: OwnerRead) {
    if (denied || net.busy) return;
    if (intent.kind !== "LIST" || detailRef.current !== null) setHistorical(true);
    void net.run(flight => capturedRead(flight, intent));
  }
  function pageRead(next: PagePosition) {
    if (disabled) return;
    startRead({ kind: "LIST", listPath: listPath(next.after), position: capturedPosition(next) });
  }
  async function send(flight: UiFlight, captured: Capture) {
    try { const result = CampaignOwnerReviewResultSchema.safeParse(await net.request("/api/planning-campaigns/reviews/commands", flight, captured.body));
      if (!result.success || result.data.submissionId !== captured.command.submissionId || result.data.campaignId !== captured.source.campaignId
        || result.data.briefId !== captured.source.briefId || result.data.version !== captured.source.version || result.data.revision !== captured.command.expectedRevision + 1
        || result.data.state !== (captured.command.decision === "APPROVE" ? "APPROVED" : "DECLINED")) throw new PlanningUiError("INVALID_RESPONSE");
      net.ensure(flight); setCapture({ ...captured, phase: "CONFIRMED", receipt: result.data }); await currentRead(flight);
    } catch (failure) { if (net.same(flight) && !flight.denied && pendingRef.current?.phase === "UNKNOWN" && failure instanceof PlanningUiError
      && [400, 409, 422].includes(failure.status ?? 0)) setCapture({ ...pendingRef.current, phase: "CONFLICT", reviewed: false }); throw failure; }
  }
  function decide(decision: "APPROVE" | "DECLINE") {
    const source = detailRef.current?.review;
    if (disabled || !source || historical || source.state !== "PENDING" || decision === "APPROVE" && (!source.approvalAvailable || source.sourceStale)) return;
    const command = CampaignOwnerReviewCommandSchema.safeParse({ operationKey: crypto.randomUUID(), submissionId: source.id, expectedRevision: source.revision, decision });
    if (!command.success) { net.setError("INVALID_FIELD"); return; }
    const captured: Capture = { command: command.data, body: JSON.stringify(command.data), source, phase: "UNKNOWN", receipt: null, reviewed: false };
    setCapture(captured); setHistorical(true); void net.run(flight => send(flight, captured));
  }
  function refresh() { if (denied || net.busy) return; startRead(captureCurrentRead()); }
  const shown = denied ? null : detail?.review;
  return <section className={`${workflow.page} space-y-[22px]`}><header className="space-y-3"><h1 ref={heading} tabIndex={-1} className="text-2xl font-bold">{copy("مراجعات موجز المالك", "Owner brief reviews")}</h1>
    <p className="text-base leading-7 text-muted-foreground">{copy("النسخ المقدّمة فقط، دون مسودات وكالة غير مرسلة. الاعتماد ليس إثباتًا قانونيًا أو واقعيًا.", "Submitted versions only, without unsubmitted agency drafts. Approval is not legal or factual verification.")}</p>
    {!denied && <Button variant="outline" disabled={net.busy} onClick={refresh}>{copy("حدّث الحالة الحالية", "Refresh current state")}</Button>}</header>
    {net.busy && <p role="status" className="space-y-3">{copy("جارٍ انتظار الرد الفعلي…", "Waiting for the actual response…")}<Button variant="outline" onClick={() => { net.cancel(); setFocusSequence(value => value + 1); }}>{copy("إلغاء الانتظار", "Cancel request")}</Button></p>}
    {(net.error || bootError) && <p role="alert" className="rounded-lg border border-destructive p-4 text-base">{copy("تعذر تأكيد القراءة أو الإجراء. آخر عرض صالح يبقى تاريخيًا ما دام الوصول متاحًا.", "The read or action could not be confirmed. The last valid view remains historical while access is available.")}</p>}
    {!denied && readRetry && !net.busy && <Button variant="outline" onClick={() => startRead(readRetry)}>{copy("أعد القراءة", "Retry read")}</Button>}
    {historical && !denied && <p className="text-sm text-muted-foreground">{copy("آخر نسخة مقروءة، وليست تحديثًا حاليًا مؤكدًا.", "Last read version, not a confirmed current refresh.")}</p>}
    {!denied && pending && !net.busy && <Card><CardContent className="space-y-3"><p>{pending.phase === "UNKNOWN" ? copy("أعد نفس قرار المراجعة بمفتاحه الأصلي.", "Retry the exact review decision with its original key.")
      : pending.phase === "CONFIRMED" ? copy("الإيصال تاريخي؛ التعافي يقرأ الحالة فقط.", "The receipt is historical; recovery reads current state only.") : copy("راجع الحالة الحالية قبل قرار جديد.", "Review current state before a fresh decision.")}</p>
      <div className="flex flex-wrap gap-3">{pending.phase === "UNKNOWN" && <Button onClick={() => { const captured = pendingRef.current; if (captured) void net.run(flight => send(flight, captured)); }}>{copy("أعد الطلب نفسه", "Retry same request")}</Button>}
        <Button variant="outline" onClick={refresh}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>{pending.phase === "CONFLICT" && pending.reviewed && <Button onClick={() => { setCapture(null); setFocusSequence(value => value + 1); }}>{copy("راجعت الحالة وأتابع", "I reviewed state; continue")}</Button>}</div>
    </CardContent></Card>}
    {!denied && page && <Card className="gap-0 rounded-[18px] border border-border py-0 ring-0"><div className="grid gap-3 bg-background px-6 py-[13px] text-[12.5px] font-bold text-muted-foreground sm:grid-cols-3"><span>{copy("النسخة المقدّمة", "Submitted version")}</span><span>{copy("الحالة", "State")}</span><span>{copy("المراجعة", "Review")}</span></div>
      {page.reviews.length === 0 && <p className="px-6 py-[22px] text-base">{copy("لا توجد نسخ مقدّمة متاحة حاليًا.", "No submitted versions are currently available.")}</p>}
      {page.reviews.map(row => <div key={row.id} data-campaign-submission-id={row.id} className="grid items-center gap-3 border-t px-6 py-4 sm:grid-cols-3"><p dir="auto" className="whitespace-pre-wrap break-words">{row.titleOriginal.text}</p>
        <Badge variant="outline">{row.state === "PENDING" ? copy("بانتظار المراجعة", "Awaiting review") : row.state === "APPROVED" ? copy("معتمد", "Approved") : copy("مرفوض", "Declined")}</Badge>
        <Button variant="outline" disabled={disabled} onClick={() => startRead({ kind: "DETAIL", detailPath: detailPath(row.id), source: row })}>{copy("راجع النسخة المقدّمة", "Review submitted version")}</Button></div>)}
      <div className="flex flex-wrap gap-3 border-t px-6 py-4"><Button variant="outline" disabled={disabled || !position.history.length} onClick={() => pageRead({ after: position.history.at(-1)!, history: position.history.slice(0, -1) })}>{copy("السابق", "Previous")}</Button>
        <Button variant="outline" disabled={disabled || !page.nextCursor} onClick={() => pageRead({ after: page.nextCursor, history: [...position.history, position.after] })}>{copy("التالي", "Next")}</Button></div>
    </Card>}
    {shown && <CampaignBrief title={shown.titleOriginal.text} version={shown.version} status={shown.state === "APPROVED" ? copy("معتمد", "Approved") : shown.state === "DECLINED" ? copy("مرفوض", "Declined")
      : shown.sourceStale ? copy("تغيّر المصدر", "Source changed") : copy("نسخة مقدّمة محفوظة", "Stored submitted version")}
      rows={Object.entries(shown.content.requirements).filter(([key]) => Object.hasOwn(planningLabels, key)).map(([key, value]) => ({ key, label: planningLabels[key]![isAr ? 0 : 1], value: campaignFieldValue(key, value, isAr) }))}>
      <p className="text-base">{shown.provenance.versionId === null ? copy("اختيار مثبت: بلا سياق", "Pinned choice: no context") : copy("اختيار مثبت لنسخة سياق محددة", "An exact context version is pinned")}</p>
      {shown.selectedContext && <details><summary className="min-h-12 cursor-pointer py-3">{copy("اقرأ السياق المقدّم المثبت", "Read the submitted pinned context")}</summary><PlanningContextPreview version={shown.selectedContext} /></details>}
      <OwnerReviewReferenceFiles lane="CAMPAIGN_REVIEW" submissionId={shown.id} campaignId={shown.campaignId}
        contextVersionId={shown.provenance.versionId} onDeny={clearPrivate} />
      <div className="flex flex-wrap gap-3"><Button disabled={disabled || historical || shown.state !== "PENDING" || shown.sourceStale || !shown.approvalAvailable} onClick={() => decide("APPROVE")}>{copy("راجعت النسخة وأعتمدها", "I reviewed and approve this version")}</Button>
        <Button variant="outline" disabled={disabled || historical || shown.state !== "PENDING"} onClick={() => decide("DECLINE")}>{copy("ارفض النسخة المقدّمة", "Decline submitted version")}</Button></div>
    </CampaignBrief>}
  </section>;
}
