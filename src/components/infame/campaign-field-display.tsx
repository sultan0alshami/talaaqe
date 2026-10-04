"use client";

import type { ReactNode } from "react";
import type { CampaignDraftFields, CampaignFields, CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import { CURATED_CITIES, type Deliverable } from "@/lib/contracts/vocabulary";
import { NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import { countryLabel } from "@/lib/contracts/country-labels";

// The existing campaign display projection, shared without form or request code.
export const campaignFieldLabels: Record<keyof CampaignFields, [string, string]> = {
  originalLanguage: ["لغة النص الأصلي", "Original text language"],
  title: ["اسم الحملة", "Campaign title"],
  productService: ["المنتج أو الخدمة", "Product or service"],
  goal: ["هدف الحملة", "Campaign goal"],
  summary: ["ملخص الحملة", "Campaign summary"],
  marketCountryCodes: ["أسواق الحملة", "Campaign markets"],
  targetAgeBuckets: ["الفئات العمرية", "Audience age groups"],
  targetGenders: ["جنس الجمهور", "Audience genders"],
  targetCountryCodes: ["بلدان الجمهور", "Audience countries"],
  targetCityKeys: ["مدن الجمهور", "Audience cities"],
  contentLanguages: ["لغات المحتوى", "Content languages"],
  dialects: ["اللهجات", "Dialects"],
  nicheSlugs: ["التخصصات", "Niches"],
  deliverables: ["المحتوى المطلوب", "Deliverables"],
  budget: ["الميزانية الإجمالية", "Total budget"],
  desiredCreatorCount: ["عدد صناع المحتوى", "Creator count"],
  impressionsTarget: ["هدف مرات الظهور", "Impressions target"],
  period: ["الفترة والمنطقة الزمنية", "Period and timezone"],
  physicalPresenceRequired: ["يلزم حضور فعلي", "Physical presence required"],
  presenceCountryCodes: ["بلدان الحضور", "Presence countries"],
  travelAllowed: ["السفر مسموح", "Travel allowed"],
  tone: ["أسلوب المحتوى", "Content tone"],
  noGoTopics: ["المواضيع المحظورة", "No-go topics"],
  preferredTiers: ["فئات صناع المحتوى المفضلة", "Preferred creator tiers"],
  dataVerificationRequired: ["يلزم توثيق البيانات", "Verified data required"],
  preferredLicencePolicyIds: [
    "سياسات الترخيص المفضلة",
    "Preferred licence policies",
  ],
  usageRights: ["حقوق استخدام المحتوى", "Content usage rights"],
  kpis: ["مؤشرات الأداء", "Performance indicators"],
  assumptions: ["الافتراضات", "Assumptions"],
  openQuestions: ["الأسئلة المفتوحة", "Open questions"],
};
export const campaignValueLabels: Record<string, [string, string]> = {
  AWARENESS: ["الوعي بالعلامة", "Awareness"],
  SALES: ["المبيعات", "Sales"],
  APP_INSTALLS: ["تثبيت التطبيق", "App installs"],
  EVENT: ["فعالية", "Event"],
  LAUNCH: ["إطلاق منتج", "Launch"],
  FEMALE: ["نساء", "Female"],
  MALE: ["رجال", "Male"],
  OTHER: ["آخر", "Other"],
  UNKNOWN: ["غير معروف", "Unknown"],
  NANO: ["نانو", "Nano"],
  MICRO: ["مايكرو", "Micro"],
  MACRO: ["ماكرو", "Macro"],
  MEGA: ["ميغا", "Mega"],
  STORY: ["ستوري", "Story"],
  POST: ["منشور", "Post"],
  REEL: ["ريل", "Reel"],
  LIVE: ["بث مباشر", "Live"],
  CAMPAIGN: ["حزمة حملة", "Campaign package"],
  VIDEO: ["فيديو", "Video"],
  SHORT: ["فيديو قصير", "Short"],
  "ar-SA-central": ["السعودية — الوسطى", "Saudi — Central"],
  "ar-SA-western": ["السعودية — الغربية", "Saudi — Western"],
  "ar-SA-eastern": ["السعودية — الشرقية", "Saudi — Eastern"],
  "ar-SA-southern": ["السعودية — الجنوبية", "Saudi — Southern"],
  "ar-SA-northern": ["السعودية — الشمالية", "Saudi — Northern"],
  "ar-Gulf": ["خليجية", "Gulf"],
  "ar-EG": ["مصرية", "Egyptian"],
  "ar-Levant": ["شامية", "Levantine"],
  "ar-IQ": ["عراقية", "Iraqi"],
  "ar-Maghreb": ["مغاربية", "Maghrebi"],
  "ar-SD": ["سودانية", "Sudanese"],
  "ar-Formal": ["فصحى", "Formal Arabic"],
};
export function campaignWallTime(instant: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
export function campaignFieldValue(field: string, value: unknown, isAr: boolean): ReactNode {
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const valueLabel = (item: string) => campaignValueLabels[item]?.[isAr ? 0 : 1] ?? item;
  const countryName = (code: string) => countryLabel(code, isAr ? "ar" : "en");
  if (value === null || value === undefined)
    return copy("غير محدد", "Not specified");
  if (Array.isArray(value) && value.length === 0)
    return copy("بدون تفضيل / لا يوجد", "No preference / none");
  if (typeof value === "boolean")
    return value ? copy("نعم", "Yes") : copy("لا", "No");
  if (field === "budget") {
    const money = value as NonNullable<CampaignDraftFields["budget"]>;
    return (
      <bdi dir="ltr">
        {formatMoneyDecimal(money)} {money.currencyCode}
      </bdi>
    );
  }
  if (field === "deliverables")
    return (
      <ul className="space-y-2">
        {(value as Deliverable[]).map((row, index) => (
          <li key={index}>
            <bdi dir="ltr">{row.platform}</bdi> · {valueLabel(row.format)} ×{" "}
            {row.count}
          </li>
        ))}
      </ul>
    );
  if (field === "period") {
    const period = value as NonNullable<CampaignDraftFields["period"]>;
    return (
      <span className="block space-y-1">
        <bdi dir="ltr" className="block">
          {campaignWallTime(period.startsAt, period.timeZone).replace("T", " ")}
        </bdi>
        <bdi dir="ltr" className="block">
          {campaignWallTime(period.endsAt, period.timeZone).replace("T", " ")}
        </bdi>
        <bdi dir="ltr" className="block">
          {period.timeZone}
        </bdi>
      </span>
    );
  }
  if (field === "kpis")
    return (
      <ul>
        {(value as NonNullable<CampaignDraftFields["kpis"]>).map((row, index) => (
          <li key={index} dir="auto">
            {row.name} — {row.target}
          </li>
        ))}
      </ul>
    );
  if (Array.isArray(value))
    return value.length ? (
      <ul className="space-y-1">
        {value.map((item, index) => (
          <li key={index} dir="auto">
            {field === "nicheSlugs"
              ? (() => {
                  const niche = NICHE_TAXONOMY.find(
                    (row) => row.slug === item,
                  );
                  return niche
                    ? isAr
                      ? niche.labelAr
                      : niche.labelEn
                    : item;
                })()
              : field === "targetCityKeys"
                ? (() => {
                    const city = CURATED_CITIES.find(
                      (row) => row.key === item,
                    );
                    return city ? (isAr ? city.ar : city.en) : item;
                  })()
                : field.endsWith("CountryCodes")
                  ? `${countryName(String(item))} (${item})`
                  : valueLabel(String(item))}
          </li>
        ))}
      </ul>
    ) : (
      copy("بدون تفضيل / لا يوجد", "No preference / none")
    );
  return (
    <span dir="auto" className="whitespace-pre-wrap break-words">
      {field === "goal" ? valueLabel(String(value)) : String(value)}
    </span>
  );
}

export type CampaignRequirementRow = { key: keyof CampaignFields; label: string; value: ReactNode };
export function campaignRequirementRows(requirements: CampaignRequirementsDTO, isAr: boolean): CampaignRequirementRow[] {
  return Object.entries(requirements)
    .filter(([key]) => Object.hasOwn(campaignFieldLabels, key))
    .map(([key, value]) => ({ key: key as keyof CampaignFields, label: campaignFieldLabels[key as keyof CampaignFields][isAr ? 0 : 1], value: campaignFieldValue(key, value, isAr) }));
}
