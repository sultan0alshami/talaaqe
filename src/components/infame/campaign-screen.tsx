"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Check,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CampaignDraftFieldsSchema,
  CampaignFieldsSchema,
  type CampaignDraftFields,
} from "@/lib/campaigns/contracts";
import type { CampaignDTO } from "@/lib/campaigns/service";
import {
  ArabicDialectSchema,
  AudienceAgeBucketSchema,
  AudienceGenderSchema,
  CampaignGoalSchema,
  COUNTRY_CODES,
  CreatorTierSchema,
  CURATED_CITIES,
  OriginalTextSchema,
  PLATFORM_FORMATS,
  PlatformSchema,
  resolveLocalDateTime,
  type Deliverable,
  type Platform,
} from "@/lib/contracts/vocabulary";
import { NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";
import {
  currencyPrecision,
  formatMoneyDecimal,
  parseMoney,
  SUPPORTED_CURRENCIES,
} from "@/lib/contracts/money";
import { countryLabel } from "@/lib/contracts/country-labels";
import { TIMEZONE_SUGGESTIONS } from "@/lib/contracts/timezone-suggestions";

const selectClass =
  "h-12 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const fieldLabels: Record<string, [string, string]> = {
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
const values: Record<string, [string, string]> = {
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
type FormState = {
  title: string;
  productService: string;
  goal: string;
  summary: string;
  originalLanguage: string;
  marketCountryCodes: string[];
  targetAgeBuckets: string[];
  targetGenders: string[];
  targetCountryCodes: string[];
  targetCityKeys: string[];
  contentLanguages: string;
  dialects: string[];
  nicheSlugs: string[];
  deliverables: Deliverable[];
  budgetDecimal: string;
  currencyCode: string;
  desiredCreatorCount: string;
  impressionsTarget: string;
  startsLocal: string;
  endsLocal: string;
  timeZone: string;
  startOffset: string;
  endOffset: string;
  physicalPresenceRequired: boolean;
  presenceCountryCodes: string[];
  travelAllowed: boolean;
  tone: string;
  noGoTopics: string;
  preferredTiers: string[];
  dataVerificationRequired: boolean;
  preferredLicencePolicyIds: string;
  usageRights: string;
  kpis: { name: string; target: string }[];
  assumptions: string;
  openQuestions: string;
};
function wallTime(instant: string, timeZone: string): string {
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
function toForm(fields: CampaignDraftFields): FormState {
  const period = fields.period;
  const startsLocal = period ? wallTime(period.startsAt, period.timeZone) : "",
    endsLocal = period ? wallTime(period.endsAt, period.timeZone) : "";
  const offset = (local: string, instant: string) =>
    String((Date.parse(`${local}Z`) - Date.parse(instant)) / 60000);
  return {
    title: fields.title ?? "",
    productService: fields.productService ?? "",
    goal: fields.goal ?? "",
    summary: fields.summary ?? "",
    originalLanguage: fields.originalLanguage ?? "",
    marketCountryCodes: fields.marketCountryCodes ?? [],
    targetAgeBuckets: fields.targetAgeBuckets ?? [],
    targetGenders: fields.targetGenders ?? [],
    targetCountryCodes: fields.targetCountryCodes ?? [],
    targetCityKeys: fields.targetCityKeys ?? [],
    contentLanguages: (fields.contentLanguages ?? []).join(", "),
    dialects: fields.dialects ?? [],
    nicheSlugs: fields.nicheSlugs ?? [],
    deliverables: fields.deliverables ?? [],
    budgetDecimal: fields.budget ? formatMoneyDecimal(fields.budget) : "",
    currencyCode: fields.budget?.currencyCode ?? "",
    desiredCreatorCount: String(fields.desiredCreatorCount ?? 1),
    impressionsTarget:
      fields.impressionsTarget == null ? "" : String(fields.impressionsTarget),
    startsLocal,
    endsLocal,
    timeZone: period?.timeZone ?? "",
    startOffset: period ? offset(startsLocal, period.startsAt) : "",
    endOffset: period ? offset(endsLocal, period.endsAt) : "",
    physicalPresenceRequired: fields.physicalPresenceRequired ?? false,
    presenceCountryCodes: fields.presenceCountryCodes ?? [],
    travelAllowed: fields.travelAllowed ?? false,
    tone: fields.tone ?? "",
    noGoTopics: (fields.noGoTopics ?? []).join("\n"),
    preferredTiers: fields.preferredTiers ?? [],
    dataVerificationRequired: fields.dataVerificationRequired ?? false,
    preferredLicencePolicyIds: (fields.preferredLicencePolicyIds ?? []).join(
      "\n",
    ),
    usageRights: fields.usageRights ?? "",
    kpis: fields.kpis ?? [],
    assumptions: (fields.assumptions ?? []).join("\n"),
    openQuestions: (fields.openQuestions ?? []).join("\n"),
  };
}
class UiError extends Error {
  constructor(
    public code: string,
    public field?: string,
  ) {
    super(code);
  }
}
const lines = (text: string) => [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];
function integer(text: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new UiError("INVALID_NUMBER", field);
  return Number(text);
}
function formPatch(
  form: FormState,
  stored: CampaignDraftFields,
): CampaignDraftFields {
  const patch: Record<string, unknown> = {
    originalLanguage: form.originalLanguage.trim() || null,
    targetAgeBuckets: form.targetAgeBuckets,
    targetGenders: form.targetGenders,
    targetCountryCodes: form.targetCountryCodes,
    targetCityKeys: form.targetCityKeys,
    dialects: form.dialects,
    nicheSlugs: form.nicheSlugs,
    physicalPresenceRequired: form.physicalPresenceRequired,
    presenceCountryCodes: form.presenceCountryCodes,
    travelAllowed: form.travelAllowed,
    noGoTopics: lines(form.noGoTopics),
    preferredTiers: form.preferredTiers,
    dataVerificationRequired: form.dataVerificationRequired,
    preferredLicencePolicyIds: lines(form.preferredLicencePolicyIds),
    kpis: form.kpis.filter((row) => row.name.trim() || row.target.trim()),
    assumptions: lines(form.assumptions),
    openQuestions: lines(form.openQuestions),
    impressionsTarget:
      form.impressionsTarget === ""
        ? null
        : integer(form.impressionsTarget, "impressionsTarget"),
    desiredCreatorCount: integer(
      form.desiredCreatorCount,
      "desiredCreatorCount",
    ),
  };
  for (const field of [
    "title",
    "productService",
    "summary",
    "tone",
    "usageRights",
    "goal",
  ] as const) {
    if (form[field].trim()) patch[field] = form[field];
    else if (stored[field] !== undefined)
      throw new UiError("REQUIRED_FIELD", field);
  }
  if (form.marketCountryCodes.length)
    patch.marketCountryCodes = form.marketCountryCodes;
  else if (stored.marketCountryCodes !== undefined)
    throw new UiError("REQUIRED_FIELD", "marketCountryCodes");
  const languages = [
    ...new Set(
      form.contentLanguages
        .split(/[,،]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (languages.length) patch.contentLanguages = languages;
  else if (stored.contentLanguages !== undefined)
    throw new UiError("REQUIRED_FIELD", "contentLanguages");
  if (form.deliverables.length) patch.deliverables = form.deliverables;
  else if (stored.deliverables !== undefined)
    throw new UiError("REQUIRED_FIELD", "deliverables");
  if (form.budgetDecimal || form.currencyCode) {
    try {
      patch.budget = parseMoney(form.budgetDecimal, form.currencyCode);
    } catch {
      throw new UiError("INVALID_MONEY", "budget");
    }
  } else if (stored.budget) throw new UiError("REQUIRED_FIELD", "budget");
  if (form.startsLocal || form.endsLocal || form.timeZone) {
    try {
      const withSeconds = (local: string) =>
        local.length === 16 ? `${local}:00` : local;
      const chosenOffset = (value: string) =>
        value === ""
          ? undefined
          : /^-?[0-9]+$/.test(value)
            ? Number(value)
            : NaN;
      patch.period = {
        startsAt: resolveLocalDateTime(
          withSeconds(form.startsLocal),
          form.timeZone,
          chosenOffset(form.startOffset),
        ),
        endsAt: resolveLocalDateTime(
          withSeconds(form.endsLocal),
          form.timeZone,
          chosenOffset(form.endOffset),
        ),
        timeZone: form.timeZone,
      };
    } catch {
      throw new UiError("INVALID_PERIOD", "period");
    }
  } else if (stored.period) throw new UiError("REQUIRED_FIELD", "period");
  const result = CampaignDraftFieldsSchema.safeParse(patch);
  if (!result.success)
    throw new UiError(
      "INVALID_FIELD",
      String(result.error.issues[0]?.path[0] ?? ""),
    );
  return result.data;
}
function Choice({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 text-base"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        disabled={disabled}
      />
      {children}
    </label>
  );
}
function MultipleChoice({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [next, setNext] = useState("");
  const id = useId();
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-2 text-base font-medium">{label}</legend>
      <div className="flex items-center gap-2">
        <select
          id={id}
          aria-label={label}
          className={selectClass}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        >
          <option value="">—</option>
          {options
            .filter((option) => !selected.includes(option.value))
            .map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label + " +"}
          disabled={!next}
          onClick={() => {
            onChange([...selected, next]);
            setNext("");
          }}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {selected.map((value) => (
          <li
            className="flex max-w-full items-center gap-1 rounded-md border ps-3"
            key={value}
          >
            <span className="min-w-0 break-words text-base">
              {options.find((option) => option.value === value)?.label ?? value}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                label +
                " − " +
                (options.find((option) => option.value === value)?.label ??
                  value)
              }
              onClick={() =>
                onChange(selected.filter((item) => item !== value))
              }
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function CampaignScreen({
  initialCampaign,
}: {
  initialCampaign: CampaignDTO | null;
}) {
  const { isAr } = useI18n(),
    router = useRouter();
  const copy = (ar: string, en: string) => (isAr ? ar : en);
  const label = (field: string) => fieldLabels[field]?.[isAr ? 0 : 1] ?? field;
  const valueLabel = (value: string) => values[value]?.[isAr ? 0 : 1] ?? value;
  const [campaign, setCampaign] = useState(initialCampaign),
    [form, setForm] = useState(() => toForm(initialCampaign?.fields ?? {}));
  const [mode, setMode] = useState<"FORM" | "GUIDED">("FORM"),
    [guidedMode, setGuidedMode] = useState<"chat" | "paragraph">("chat");
  const [inputText, setInputText] = useState(""),
    [inputLanguage, setInputLanguage] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<{ code: string; field?: string } | null>(null),
    [notice, setNotice] = useState<
      "SAVED" | "GENERATED" | "APPROVED" | "RELOADED" | "APPLIED" | null
    >(null);
  const [dirty, setDirty] = useState(false),
    [approval, setApproval] = useState(false),
    [latest, setLatest] = useState<CampaignDTO | null>(null);
  const [pendingRequest, setPendingRequest] = useState<{
    path: string;
    body: Record<string, unknown>;
    purpose: "START" | "SAVE" | "GENERATE" | "APPROVE" | "APPLY" | "GUIDED";
  } | null>(null);
  const inFlight = useRef(false);
  const terminal =
    campaign?.status === "COMPLETED" || campaign?.status === "CANCELLED";
  const countryName = (code: string) => countryLabel(code, isAr ? "ar" : "en");
  const countryOptions = COUNTRY_CODES.map((code) => ({
    value: code,
    label: `${countryName(code)} (${code})`,
  }));
  const currentBrief = campaign?.briefs.at(-1),
    staleBrief =
      !!currentBrief && currentBrief.inputRevision !== campaign?.fieldsRevision;
  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setDirty(true);
    setApproval(false);
  }
  function errorMessage(code: string) {
    const messages: Record<string, [string, string]> = {
      STALE_VERSION: [
        "تغيرت الحملة في مكان آخر. حمّل النسخة الحالية وقارنها بمدخلاتك قبل الحفظ.",
        "This campaign changed elsewhere. Load the current version and compare it with your input before saving.",
      ],
      STALE_BRIEF: [
        "الموجز قديم. راجع أحدث نسخة قبل اعتمادها.",
        "This brief is stale. Review the latest version before approval.",
      ],
      STALE_PROPOSAL: [
        "الاقتراح قديم أو سبق تطبيقه. راجع الحقول الحالية.",
        "This proposal is stale or already applied. Review the current fields.",
      ],
      CAPABILITY_UNAVAILABLE: [
        "المساعد غير متاح حاليًا. النص باقٍ هنا؛ تقدر تكمل نفس الحقول بالنموذج وتحفظ حملتك.",
        "The assistant is currently unavailable. Your text remains here; continue with the same fields in the form and save your campaign.",
      ],
      NETWORK: [
        "تعذر تأكيد نتيجة الطلب. أعد نفس الطلب بأمان قبل إجراء تغيير آخر.",
        "The request result could not be confirmed. Retry the same request safely before making another change.",
      ],
      NETWORK_READ: [
        "تعذر تحميل النسخة الحالية. مدخلاتك باقية؛ حاول تحميلها مرة ثانية.",
        "The current version could not be loaded. Your input remains; try loading it again.",
      ],
      BRAND_PROFILE_REQUIRED: [
        "احفظ ملف شركتك الخاص أولًا، ثم ارجع لحملتك.",
        "Save your private company profile first, then return to your campaign.",
      ],
      BRAND_COUNTRY_REQUIRED: [
        "أكمل بلد الشركة في ملفك قبل تجهيز الموجز.",
        "Complete your company country in your profile before preparing the brief.",
      ],
      REQUIRED_FIELD: [
        "هذا الحقل محفوظ سابقًا ويلزم تعبئته بقيمة صحيحة.",
        "This previously saved field needs a valid value.",
      ],
      INVALID_FIELD: [
        "راجع قيمة هذا الحقل وحدوده. لم يتم حفظ التغيير.",
        "Review this field and its limits. The change was not saved.",
      ],
      INVALID_MONEY: [
        "اختر العملة وأدخل مبلغًا بأرقام لاتينية دون فواصل، وبدقة العملة المحددة.",
        "Choose a currency and enter an ungrouped amount using Latin digits and the selected currency precision.",
      ],
      INVALID_PERIOD: [
        "راجع التاريخين والمنطقة الزمنية. الوقت غير الموجود مرفوض، والوقت المكرر يحتاج إزاحة UTC محددة.",
        "Check both dates and the timezone. Nonexistent local times are rejected; repeated times need an explicit UTC offset.",
      ],
      INVALID_NUMBER: [
        "أدخل عددًا صحيحًا غير سالب بأرقام لاتينية ضمن الحدود.",
        "Enter a nonnegative whole number using Latin digits within the allowed limits.",
      ],
      MISSING_REQUIREMENTS: [
        "أكمل الحقول المطلوبة ثم احفظها قبل تجهيز الموجز.",
        "Complete and save the required fields before preparing the brief.",
      ],
      UNSAVED: [
        "احفظ تعديلاتك قبل تجهيز الموجز أو تطبيق اقتراح أو اعتماد نسخة.",
        "Save your edits before preparing a brief, applying a proposal or approving a version.",
      ],
      CAMPAIGN_TERMINAL: [
        "هذه الحملة مكتملة أو ملغاة ولا تقبل التعديل.",
        "This campaign is completed or cancelled and cannot be edited.",
      ],
      FORBIDDEN: [
        "ما عندك صلاحية لهذا الإجراء.",
        "You do not have permission for this action.",
      ],
      UNAUTHORIZED: [
        "انتهت الجلسة. سجّل دخولك لاستكمال المسودة.",
        "Your session ended. Sign in to continue the draft.",
      ],
      UNAUTHENTICATED: [
        "انتهت الجلسة. سجّل دخولك لاستكمال المسودة.",
        "Your session ended. Sign in to continue the draft.",
      ],
      PAYLOAD_TOO_LARGE: [
        "المسودة أكبر من حد الطلب. اختصر النصوص والقوائم ثم حاول مرة ثانية.",
        "The draft exceeds the request size limit. Shorten its text and lists, then try again.",
      ],
      NOT_FOUND: [
        "الحملة غير متاحة لهذا الحساب.",
        "This campaign is unavailable to this account.",
      ],
      QUESTION_LIMIT: [
        "وصلت المحادثة لخمسة أسئلة توضيحية. كمل الحقول بالنموذج.",
        "The conversation reached five clarification questions. Continue with the form.",
      ],
    };
    return (
      messages[code]?.[isAr ? 0 : 1] ??
      copy(
        "تعذر تنفيذ الإجراء. مدخلاتك باقية؛ راجعها وحاول مرة ثانية.",
        "The action failed. Your input remains; review it and try again.",
      )
    );
  }
  async function request<T>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: body ? "POST" : "GET",
        cache: "no-store",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
    } catch {
      throw new UiError("NETWORK");
    }
    let result: { data?: T; error?: { code?: string } };
    try {
      result = await response.json();
    } catch {
      throw new UiError("NETWORK");
    }
    if (!response.ok) throw new UiError(result.error?.code ?? "REQUEST_FAILED");
    if (result.data === undefined) throw new UiError("NETWORK");
    return result.data;
  }
  async function send(
    path: string,
    body: Record<string, unknown>,
    purpose: NonNullable<typeof pendingRequest>["purpose"],
  ): Promise<CampaignDTO | undefined> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPendingRequest({ path, body, purpose });
    try {
      const result = await request<{ campaign: CampaignDTO }>(path, body);
      setPendingRequest(null);
      setCampaign(result.campaign);
      setLatest(null);
      setApproval(false);
      if (purpose === "SAVE" || purpose === "APPLY") {
        setForm(toForm(result.campaign.fields));
        setDirty(false);
      }
      setNotice(
        purpose === "SAVE" || purpose === "START"
          ? "SAVED"
          : purpose === "GENERATE"
            ? "GENERATED"
            : purpose === "APPROVE"
              ? "APPROVED"
              : "APPLIED",
      );
      if (!campaign && !inputText.trim())
        router.replace(
          `/brand/campaigns/${encodeURIComponent(result.campaign.id)}`,
          { scroll: false },
        );
      return result.campaign;
    } catch (caught) {
      const failure =
        caught instanceof UiError ? caught : new UiError("REQUEST_FAILED");
      if (failure.code !== "NETWORK") setPendingRequest(null);
      setError({ code: failure.code, field: failure.field });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function askAssistant() {
    const text = OriginalTextSchema.safeParse({
      text: inputText,
      language: inputLanguage.trim() || null,
    });
    if (!text.success || !inputText.trim()) {
      setError({ code: "INVALID_FIELD", field: "originalLanguage" });
      return;
    }
    const current =
      campaign ??
      (await send(
        "/api/campaigns",
        { operationKey: crypto.randomUUID(), fields: {} },
        "START",
      ));
    if (current)
      await send(
        `/api/campaigns/${encodeURIComponent(current.id)}/${guidedMode}`,
        {
          operationKey: crypto.randomUUID(),
          expectedRevision: current.revision,
          text: text.data,
        },
        "GUIDED",
      );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const patch = formPatch(form, campaign?.fields ?? {});
      await send(
        campaign
          ? `/api/campaigns/${encodeURIComponent(campaign.id)}/commands`
          : "/api/campaigns",
        campaign
          ? {
              operationKey: crypto.randomUUID(),
              expectedRevision: campaign.revision,
              action: "UPDATE_FIELDS",
              payload: { patch },
            }
          : { operationKey: crypto.randomUUID(), fields: patch },
        "SAVE",
      );
    } catch (caught) {
      const failure =
        caught instanceof UiError ? caught : new UiError("INVALID_FIELD");
      setError({ code: failure.code, field: failure.field });
      setNotice(null);
    }
  }
  async function loadLatest() {
    if (!campaign || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setLatest(
        await request<CampaignDTO>(
          `/api/campaigns/${encodeURIComponent(campaign.id)}`,
        ),
      );
      setNotice("RELOADED");
    } catch (caught) {
      setError({
        code:
          caught instanceof UiError
            ? caught.code === "NETWORK"
              ? "NETWORK_READ"
              : caught.code
            : "REQUEST_FAILED",
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function showValue(field: string, value: unknown): ReactNode {
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
            {wallTime(period.startsAt, period.timeZone).replace("T", " ")}
          </bdi>
          <bdi dir="ltr" className="block">
            {wallTime(period.endsAt, period.timeZone).replace("T", " ")}
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
          {(value as FormState["kpis"]).map((row, index) => (
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
  const field = (key: string, child: ReactNode, hint?: string) => (
    <div id={`campaign-${key}`} className="min-w-0 scroll-mt-4 space-y-2">
      {child}
      {hint && (
        <p className="text-sm leading-6 text-muted-foreground">{hint}</p>
      )}
      {error?.field === key && (
        <p role="alert" className="text-base text-destructive">
          {errorMessage(error.code)}
        </p>
      )}
    </div>
  );
  const textField = (
    key: "title" | "productService" | "summary" | "tone" | "usageRights",
    maxLength: number,
    multiline = false,
  ) =>
    field(
      key,
      <label className="block space-y-2">
        <span className="text-base font-medium">{label(key)}</span>
        {multiline ? (
          <Textarea
            dir="auto"
            className="text-base"
            rows={key === "summary" || key === "usageRights" ? 4 : 3}
            maxLength={maxLength}
            value={form[key]}
            onChange={(event) => update(key, event.target.value)}
          />
        ) : (
          <Input
            className="text-base"
            dir="auto"
            maxLength={maxLength}
            value={form[key]}
            onChange={(event) => update(key, event.target.value)}
          />
        )}
      </label>,
    );
  const multi = (
    key:
      | "marketCountryCodes"
      | "targetCountryCodes"
      | "presenceCountryCodes"
      | "targetCityKeys"
      | "nicheSlugs",
    options: { value: string; label: string }[],
  ) =>
    field(
      key,
      <MultipleChoice
        label={label(key)}
        options={options}
        selected={form[key]}
        onChange={(selected) => {
          update(key, selected);
          if (key === "targetCountryCodes")
            update(
              "targetCityKeys",
              form.targetCityKeys.filter((city) =>
                selected.includes(city.split(":")[0]),
              ),
            );
        }}
      />,
      key === "targetCityKeys" && !options.length
        ? copy(
            "ما فيه مدن منتقاة للبلدان المختارة حاليًا. تقدر تحدد الجمهور على مستوى البلد.",
            "No curated cities are available for the selected countries yet. You can target the audience at country level.",
          )
        : undefined,
    );
  const choices = (
    key: "targetAgeBuckets" | "targetGenders" | "dialects" | "preferredTiers",
    options: readonly string[],
  ) =>
    field(
      key,
      <fieldset>
        <legend className="mb-2 text-base font-medium">{label(key)}</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {options.map((value) => (
            <Choice
              key={value}
              checked={form[key].includes(value)}
              onChange={(checked) =>
                update(
                  key,
                  checked
                    ? [...form[key], value]
                    : form[key].filter((item) => item !== value),
                )
              }
            >
              {valueLabel(value)}
            </Choice>
          ))}
        </div>
      </fieldset>,
    );
  const disabled = busy || terminal || !!pendingRequest;
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost">
        <Link href="/brand/campaigns">
          {copy("كل الحملات", "All campaigns")}
        </Link>
      </Button>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {copy("مساحة العلامة التجارية", "Brand workspace")}
        </p>
        <h1 className="text-3xl font-semibold">
          {campaign
            ? copy("رتّب تفاصيل حملتك", "Shape your campaign")
            : copy("ابدأ حملة", "Start a campaign")}
        </h1>
        <p className="text-base leading-7 text-muted-foreground">
          {copy(
            "اكتب بالنموذج أو اشرح الفكرة للمساعد. راجع كل التفاصيل واحفظها، ثم اعتمد نسخة الموجز بوضوح.",
            "Use the form or explain your idea to the assistant. Review and save every detail, then explicitly approve a brief version.",
          )}
        </p>
        {campaign && (
          <p className="text-sm">
            {copy("مسودة محفوظة", "Saved draft")} · {copy("مراجعة", "Revision")}{" "}
            {campaign.revision} ·{" "}
            {campaign.currentBriefVersion
              ? `${copy("موجز معتمد", "Approved brief")} ${campaign.currentBriefVersion}`
              : copy(
                  "لم يُعتمد الموجز الحالي",
                  "Current brief is not approved",
                )}
            {dirty ? ` · ${copy("تعديلات غير محفوظة", "Unsaved edits")}` : ""}
          </p>
        )}
      </div>
      <div
        aria-label={copy("طريقة إدخال الحملة", "Campaign entry method")}
        className="grid gap-3 sm:grid-cols-2"
      >
        <Button
          type="button"
          size="lg"
          variant={mode === "FORM" ? "secondary" : "outline"}
          aria-pressed={mode === "FORM"}
          onClick={() => setMode("FORM")}
        >
          <FileText aria-hidden="true" />
          {copy("أعبّي النموذج", "Fill the form")}
        </Button>
        <Button
          type="button"
          size="lg"
          variant={mode === "GUIDED" ? "secondary" : "outline"}
          aria-pressed={mode === "GUIDED"}
          onClick={() => setMode("GUIDED")}
        >
          <MessageSquare aria-hidden="true" />
          {copy("أشرح فكرتي", "Explain my idea")}
        </Button>
      </div>
      <div aria-live="polite" className="space-y-3">
        {busy && (
          <p className="flex items-center gap-2 text-base">
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {copy("جارٍ تنفيذ طلبك…", "Processing your request…")}
          </p>
        )}
        {notice && (
          <p role="status" className="text-base">
            {
              {
                SAVED: copy(
                  "انحفظت المسودة. ما تم اعتماد الموجز تلقائيًا.",
                  "Draft saved. Brief approval remains a separate step.",
                ),
                GENERATED: copy(
                  "الموجز جاهز للمراجعة.",
                  "Your brief is ready for review.",
                ),
                APPROVED: copy(
                  "اعتمدت هذه النسخة من الموجز.",
                  "You approved this brief version.",
                ),
                APPLIED: copy(
                  "تم تطبيق الاقتراح على الحقول المحفوظة.",
                  "The proposal was applied to the saved fields.",
                ),
                RELOADED: copy(
                  "النسخة الحالية جاهزة للمقارنة. مدخلاتك لم تتغير.",
                  "The current version is ready to compare. Your input is unchanged.",
                ),
              }[notice]
            }
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-destructive p-4 text-base"
          >
            <p>
              {error.field ? `${label(error.field)}: ` : ""}
              {errorMessage(error.code)}
            </p>
            {error.field && (
              <a
                href={`#campaign-${error.field}`}
                className="inline-flex min-h-12 items-center underline"
              >
                {copy("انتقل للحقل", "Go to field")}
              </a>
            )}
            {["BRAND_PROFILE_REQUIRED", "BRAND_COUNTRY_REQUIRED"].includes(
              error.code,
            ) && (
              <Button asChild variant="outline">
                <Link href="/brand/onboarding">
                  {copy("أكمل ملف الشركة", "Complete company profile")}
                </Link>
              </Button>
            )}
            {["UNAUTHORIZED", "UNAUTHENTICATED"].includes(error.code) && (
              <Button asChild variant="outline">
                <Link href="/login">{copy("تسجيل الدخول", "Sign in")}</Link>
              </Button>
            )}
            {[
              "STALE_VERSION",
              "STALE_BRIEF",
              "STALE_PROPOSAL",
              "NETWORK_READ",
            ].includes(error.code) && (
              <Button variant="outline" disabled={busy} onClick={loadLatest}>
                <RefreshCw aria-hidden="true" />
                {copy(
                  "حمّل النسخة الحالية للمقارنة",
                  "Load current version to compare",
                )}
              </Button>
            )}
            {error.code === "NETWORK" && pendingRequest && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const pending = pendingRequest;
                  if (pending)
                    void send(pending.path, pending.body, pending.purpose);
                }}
              >
                {copy("أعد نفس الطلب", "Retry the same request")}
              </Button>
            )}
            {error.code === "CAPABILITY_UNAVAILABLE" && (
              <Button variant="outline" onClick={() => setMode("FORM")}>
                {copy("أكمل بالنموذج", "Continue with the form")}
              </Button>
            )}
          </div>
        )}
      </div>
      {latest && (
        <Card>
          <CardHeader>
            <CardTitle>
              {copy("قارن النسخة الحالية", "Compare the current version")} ·{" "}
              {latest.revision}
            </CardTitle>
            <CardDescription className="text-base">
              {copy(
                "راجع الفروق، ثم اختر الاحتفاظ بمدخلاتك لإعادة الحفظ أو استبدالها بالنسخة المحفوظة.",
                "Review the differences, then keep your input for a new save or replace it with the saved version.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <details>
              <summary className="min-h-12 cursor-pointer py-3 text-base font-medium">
                {copy("عرض الحقول المحفوظة", "Show saved fields")}
              </summary>
              <dl className="space-y-4 pt-4">
                {Object.entries(latest.fields).map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-medium">{label(key)}</dt>
                    <dd className="mt-1 text-base">{showValue(key, value)}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy}
                onClick={() => {
                  setCampaign(latest);
                  setLatest(null);
                  setDirty(true);
                  setError(null);
                  setApproval(false);
                }}
              >
                {copy(
                  "احتفظ بمدخلاتي وأراجعها قبل الحفظ",
                  "Keep my input and review before saving",
                )}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCampaign(latest);
                  setForm(toForm(latest.fields));
                  setLatest(null);
                  setDirty(false);
                  setError(null);
                  setApproval(false);
                }}
              >
                {copy(
                  "استبدل المدخلات بالنسخة المحفوظة",
                  "Replace input with the saved version",
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {terminal && (
        <p role="status" className="rounded-lg border p-4 text-base">
          {errorMessage("CAMPAIGN_TERMINAL")}
        </p>
      )}
      {campaign && !initialCampaign && (
        <Button asChild variant="outline">
          <Link href={`/brand/campaigns/${encodeURIComponent(campaign.id)}`}>
            {copy("افتح المسودة المحفوظة", "Open the saved draft")}
          </Link>
        </Button>
      )}
      {mode === "GUIDED" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {copy(
                "اشرح الفكرة بطريقتك",
                "Explain the idea in your own words",
              )}
            </CardTitle>
            <CardDescription className="text-base">
              {copy(
                "المحادثة والفقرة تقترحان نفس حقول النموذج. لا يُطبّق اقتراح أو يُعتمد موجز بدون مراجعتك.",
                "Chat and paragraph input propose the same form fields. A proposal or brief needs your explicit review before it is applied or approved.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant={guidedMode === "chat" ? "secondary" : "outline"}
                aria-pressed={guidedMode === "chat"}
                onClick={() => setGuidedMode("chat")}
              >
                {copy("محادثة", "Conversation")}
              </Button>
              <Button
                variant={guidedMode === "paragraph" ? "secondary" : "outline"}
                aria-pressed={guidedMode === "paragraph"}
                onClick={() => setGuidedMode("paragraph")}
              >
                {copy("فقرة كاملة", "Full paragraph")}
              </Button>
            </div>
            <p className="text-base text-muted-foreground">
              {copy(
                "المساعد غير مهيأ حاليًا. النموذج متاح بالكامل؛ طلب المساعد يعرض حالة الخدمة الفعلية.",
                "The assistant is not configured currently. The complete form is available; assistant requests show the actual service status.",
              )}
            </p>
            {campaign?.conversation.length ? (
              <ol
                aria-label={copy("المحادثة المحفوظة", "Saved conversation")}
                className="space-y-3"
              >
                {campaign.conversation.map((turn, index) => (
                  <li key={index} className="space-y-2 rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">
                      {turn.role === "user"
                        ? copy("أنت", "You")
                        : copy("المساعد", "Assistant")}
                    </p>
                    <p
                      dir="auto"
                      lang={turn.language ?? undefined}
                      className="whitespace-pre-wrap break-words text-base"
                    >
                      {turn.text}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-base">
                {copy("ما فيه رسائل محفوظة بعد.", "No saved messages yet.")}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {copy("أسئلة توضيحية محفوظة", "Saved clarification questions")}:{" "}
              {campaign?.clarificationCount ?? 0} / 5
            </p>
            <label className="block space-y-2">
              <span className="text-base font-medium">
                {guidedMode === "chat"
                  ? copy("رسالتك", "Your message")
                  : copy("وصف الحملة", "Campaign description")}
              </span>
              <Textarea
                dir="auto"
                rows={6}
                maxLength={20000}
                className="text-base"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-base">
                {copy(
                  "لغة النص الأصلية (اختياري، رمز BCP47)",
                  "Original text language (optional, BCP47 code)",
                )}
              </span>
              <Input
                className="text-base"
                dir="ltr"
                value={inputLanguage}
                maxLength={100}
                onChange={(event) => setInputLanguage(event.target.value)}
                placeholder="ar / en"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                disabled={disabled || !inputText.trim()}
                onClick={askAssistant}
              >
                {copy("اطلب اقتراحًا للمراجعة", "Request a proposal to review")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setMode("FORM")}
              >
                {copy(
                  "افتح نفس الحقول بالنموذج",
                  "Open the same fields in the form",
                )}
              </Button>
            </div>
            {!campaign && (
              <p className="text-base text-muted-foreground">
                {copy(
                  "طلب الاقتراح ينشئ مسودة خاصة للحملة. النص غير المعالج يبقى في هذا المحرر حتى تغادر الصفحة.",
                  "Requesting a proposal creates a private campaign draft. Unprocessed text stays in this editor until you leave the page.",
                )}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {mode === "FORM" && (
        <form
          onSubmit={save}
          className="space-y-6"
          aria-label={copy("تفاصيل الحملة", "Campaign details")}
        >
          <fieldset disabled={disabled} className="min-w-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {copy("١. الفكرة والهدف", "1. Idea and goal")}
                </CardTitle>
                <CardDescription className="text-base">
                  {copy(
                    "النص اللي تكتبه يبقى بلغته الأصلية عند تغيير لغة الواجهة.",
                    "Your written content keeps its original language when you change the interface language.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-2">
                {textField("title", 200)}
                {field(
                  "goal",
                  <label className="block space-y-2">
                    <span className="text-base font-medium">
                      {label("goal")}
                    </span>
                    <select
                      className={selectClass}
                      value={form.goal}
                      onChange={(event) => update("goal", event.target.value)}
                    >
                      <option value="">
                        {copy("اختر الهدف", "Choose a goal")}
                      </option>
                      {CampaignGoalSchema.options.map((goal) => (
                        <option key={goal} value={goal}>
                          {valueLabel(goal)}
                        </option>
                      ))}
                    </select>
                  </label>,
                )}
                <div className="sm:col-span-2">
                  {textField("productService", 5000, true)}
                </div>
                <div className="sm:col-span-2">
                  {textField("summary", 5000, true)}
                </div>
                {field(
                  "originalLanguage",
                  <label className="block space-y-2">
                    <span className="text-base font-medium">
                      {label("originalLanguage")}
                    </span>
                    <Input
                      className="text-base"
                      dir="ltr"
                      value={form.originalLanguage}
                      maxLength={100}
                      onChange={(event) =>
                        update("originalLanguage", event.target.value)
                      }
                      placeholder="ar / en"
                    />
                  </label>,
                  copy(
                    "اختياري. نتركها غير محددة إذا ما اخترتها.",
                    "Optional. Left unspecified unless you declare it.",
                  ),
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {copy("٢. الأسواق والجمهور", "2. Markets and audience")}
                </CardTitle>
                <CardDescription className="text-base">
                  {copy(
                    "اختر أسواق الحملة صراحةً. تفضيلات الجمهور الفارغة تعني بدون تفضيل.",
                    "Explicitly choose campaign markets. Empty audience preferences mean no preference.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-2">
                {multi("marketCountryCodes", countryOptions)}
                {multi("targetCountryCodes", countryOptions)}
                {multi(
                  "targetCityKeys",
                  CURATED_CITIES.filter((city) =>
                    form.targetCountryCodes.includes(city.countryCode),
                  ).map((city) => ({
                    value: city.key,
                    label: isAr ? city.ar : city.en,
                  })),
                )}
                {choices("targetAgeBuckets", AudienceAgeBucketSchema.options)}
                {choices("targetGenders", AudienceGenderSchema.options)}
                {field(
                  "contentLanguages",
                  <label className="block space-y-2">
                    <span className="text-base font-medium">
                      {label("contentLanguages")}
                    </span>
                    <Input
                      className="text-base"
                      dir="ltr"
                      value={form.contentLanguages}
                      maxLength={2000}
                      placeholder="ar, en"
                      onChange={(event) =>
                        update("contentLanguages", event.target.value)
                      }
                    />
                  </label>,
                  copy(
                    "رموز BCP47 مفصولة بفاصلة؛ يلزم لغة واحدة على الأقل.",
                    "Comma-separated BCP47 codes; at least one language is required.",
                  ),
                )}
                {choices("dialects", ArabicDialectSchema.options)}
                {multi(
                  "nicheSlugs",
                  NICHE_TAXONOMY.map((niche) => ({
                    value: niche.slug,
                    label: `${niche.parentSlug ? "↳ " : ""}${isAr ? niche.labelAr : niche.labelEn}`,
                  })),
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {copy("٣. المحتوى والميزانية", "3. Deliverables and budget")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {field(
                  "deliverables",
                  <fieldset className="space-y-4">
                    <legend className="mb-2 text-base font-medium">
                      {label("deliverables")}
                    </legend>
                    {form.deliverables.map((row, index) => (
                      <div
                        key={index}
                        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3"
                      >
                        <label className="space-y-2">
                          <span className="text-base">
                            {copy("المنصة", "Platform")}
                          </span>
                          <select
                            className={selectClass}
                            dir="ltr"
                            value={row.platform}
                            onChange={(event) => {
                              const platform = event.target.value as Platform;
                              update(
                                "deliverables",
                                form.deliverables.map((item, at) =>
                                  at === index
                                    ? {
                                        platform,
                                        format: PLATFORM_FORMATS[platform][0],
                                        count: item.count,
                                      }
                                    : item,
                                ),
                              );
                            }}
                          >
                            {PlatformSchema.options.map((platform) => (
                              <option key={platform}>{platform}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-2">
                          <span className="text-base">
                            {copy("صيغة المحتوى", "Content format")}
                          </span>
                          <select
                            className={selectClass}
                            value={row.format}
                            onChange={(event) =>
                              update(
                                "deliverables",
                                form.deliverables.map((item, at) =>
                                  at === index
                                    ? {
                                        ...item,
                                        format: event.target
                                          .value as Deliverable["format"],
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            {PLATFORM_FORMATS[row.platform].map((format) => (
                              <option key={format} value={format}>
                                {valueLabel(format)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-2">
                          <span className="text-base">
                            {copy("العدد (١–١٠٠٠)", "Count (1–1000)")}
                          </span>
                          <Input
                            className="text-base"
                            dir="ltr"
                            type="number"
                            min={1}
                            max={1000}
                            step={1}
                            value={Number.isFinite(row.count) ? row.count : ""}
                            onChange={(event) =>
                              update(
                                "deliverables",
                                form.deliverables.map((item, at) =>
                                  at === index
                                    ? {
                                        ...item,
                                        count:
                                          event.target.value === ""
                                            ? NaN
                                            : Number(event.target.value),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            update(
                              "deliverables",
                              form.deliverables.filter((_, at) => at !== index),
                            )
                          }
                        >
                          {copy("احذف هذا المحتوى", "Remove this deliverable")}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={form.deliverables.length >= 100}
                      onClick={() =>
                        update("deliverables", [
                          ...form.deliverables,
                          { platform: "INSTAGRAM", format: "REEL", count: 1 },
                        ])
                      }
                    >
                      <Plus aria-hidden="true" />
                      {copy(
                        "أضف محتوى وحدد منصته",
                        "Add a deliverable and choose its platform",
                      )}
                    </Button>
                  </fieldset>,
                  copy(
                    "الصيغ المتاحة تتبع المنصة المختارة. الصفوف المتكررة تُجمع ضمن الحد نفسه.",
                    "Available formats follow the selected platform. Duplicate rows are combined within the same count limit.",
                  ),
                )}
                <div className="grid gap-5 sm:grid-cols-2">
                  {field(
                    "budget",
                    <div className="space-y-4">
                      <label className="block space-y-2">
                        <span className="text-base font-medium">
                          {copy("عملة الحملة", "Campaign currency")}
                        </span>
                        <select
                          className={selectClass}
                          dir="ltr"
                          value={form.currencyCode}
                          onChange={(event) =>
                            update("currencyCode", event.target.value)
                          }
                        >
                          <option value="">
                            {copy("اختر العملة", "Choose currency")}
                          </option>
                          {SUPPORTED_CURRENCIES.map((code) => (
                            <option key={code}>{code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-2">
                        <span className="text-base font-medium">
                          {label("budget")}
                        </span>
                        <Input
                          className="text-base"
                          dir="ltr"
                          inputMode="decimal"
                          value={form.budgetDecimal}
                          maxLength={40}
                          onChange={(event) =>
                            update("budgetDecimal", event.target.value)
                          }
                        />
                      </label>
                    </div>,
                    form.currencyCode
                      ? copy(
                          `الدقة المسموحة: ${currencyPrecision(form.currencyCode)} منازل عشرية. ما فيه تحويل عملات تلقائي.`,
                          `Allowed precision: ${currencyPrecision(form.currencyCode)} decimal places. No automatic currency conversion.`,
                        )
                      : copy(
                          "العملة اختيار مستقل عن البلد ولغة الواجهة.",
                          "Currency is independent of country and interface language.",
                        ),
                  )}
                  {field(
                    "desiredCreatorCount",
                    <label className="block space-y-2">
                      <span className="text-base font-medium">
                        {label("desiredCreatorCount")} (1–12)
                      </span>
                      <Input
                        className="text-base"
                        dir="ltr"
                        inputMode="numeric"
                        value={form.desiredCreatorCount}
                        maxLength={2}
                        onChange={(event) =>
                          update("desiredCreatorCount", event.target.value)
                        }
                      />
                    </label>,
                  )}
                  {field(
                    "impressionsTarget",
                    <label className="block space-y-2">
                      <span className="text-base font-medium">
                        {label("impressionsTarget")}{" "}
                        {copy("(اختياري)", "(optional)")}
                      </span>
                      <Input
                        className="text-base"
                        dir="ltr"
                        inputMode="numeric"
                        value={form.impressionsTarget}
                        maxLength={16}
                        onChange={(event) =>
                          update("impressionsTarget", event.target.value)
                        }
                      />
                    </label>,
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {copy("٤. الفترة والحضور", "4. Period and presence")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {field(
                  "period",
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block space-y-2">
                      <span className="text-base font-medium">
                        {copy(
                          "تاريخ البداية بالتوقيت المحدد",
                          "Start in the selected timezone",
                        )}
                      </span>
                      <Input
                        className="text-base"
                        dir="ltr"
                        type="datetime-local"
                        step={1}
                        value={form.startsLocal}
                        onChange={(event) => {
                          update("startsLocal", event.target.value);
                          update("startOffset", "");
                        }}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-base font-medium">
                        {copy(
                          "تاريخ النهاية بالتوقيت المحدد",
                          "End in the selected timezone",
                        )}
                      </span>
                      <Input
                        className="text-base"
                        dir="ltr"
                        type="datetime-local"
                        step={1}
                        value={form.endsLocal}
                        onChange={(event) => {
                          update("endsLocal", event.target.value);
                          update("endOffset", "");
                        }}
                      />
                    </label>
                    <label className="block space-y-2 sm:col-span-2">
                      <span className="text-base font-medium">
                        {copy("المنطقة الزمنية (IANA)", "Timezone (IANA)")}
                      </span>
                      <Input
                        className="text-base"
                        dir="ltr"
                        list="campaign-timezones"
                        value={form.timeZone}
                        maxLength={100}
                        placeholder="Europe/London"
                        onChange={(event) => {
                          update("timeZone", event.target.value);
                          update("startOffset", "");
                          update("endOffset", "");
                        }}
                      />
                      <datalist id="campaign-timezones">
                        {TIMEZONE_SUGGESTIONS.map((zone) => (
                          <option key={zone} value={zone} />
                        ))}
                      </datalist>
                    </label>
                    <details className="sm:col-span-2">
                      <summary className="min-h-12 cursor-pointer py-3 text-base">
                        {copy(
                          "إزاحة UTC للوقت المكرر (اختياري)",
                          "UTC offset for repeated local times (optional)",
                        )}
                      </summary>
                      <p className="mb-3 text-sm leading-6 text-muted-foreground">
                        {copy(
                          "دقائق شرق UTC، مثل 60 أو -300. يُطلب فقط عند تكرار الوقت مع التوقيت الصيفي، ويجب أن يطابق المنطقة.",
                          "Minutes east of UTC, such as 60 or -300. Required only for a repeated daylight-saving time and must match the zone.",
                        )}
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-base">
                            {copy("إزاحة البداية", "Start offset")}
                          </span>
                          <Input
                            className="text-base"
                            dir="ltr"
                            value={form.startOffset}
                            maxLength={5}
                            onChange={(event) =>
                              update("startOffset", event.target.value)
                            }
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-base">
                            {copy("إزاحة النهاية", "End offset")}
                          </span>
                          <Input
                            className="text-base"
                            dir="ltr"
                            value={form.endOffset}
                            maxLength={5}
                            onChange={(event) =>
                              update("endOffset", event.target.value)
                            }
                          />
                        </label>
                      </div>
                    </details>
                  </div>,
                  copy(
                    "نحفظ التاريخين كوقت UTC مع المنطقة التي اخترتها؛ ما نخمن المنطقة من المتصفح.",
                    "Dates are saved as UTC instants with your selected timezone; your browser timezone is not assumed.",
                  ),
                )}
                <div className="grid gap-5 sm:grid-cols-2">
                  {field(
                    "physicalPresenceRequired",
                    <Choice
                      checked={form.physicalPresenceRequired}
                      onChange={(checked) =>
                        update("physicalPresenceRequired", checked)
                      }
                    >
                      {label("physicalPresenceRequired")}
                    </Choice>,
                  )}
                  {field(
                    "travelAllowed",
                    <Choice
                      checked={form.travelAllowed}
                      onChange={(checked) => update("travelAllowed", checked)}
                    >
                      {label("travelAllowed")}
                    </Choice>,
                  )}
                  {multi("presenceCountryCodes", countryOptions)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {copy(
                    "٥. الإبداع والحقوق والثقة",
                    "5. Creative direction, rights and trust",
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-2">
                {textField("tone", 500, true)}
                {field(
                  "noGoTopics",
                  <label className="block space-y-2">
                    <span className="text-base font-medium">
                      {label("noGoTopics")}
                    </span>
                    <Textarea
                      dir="auto"
                      className="text-base"
                      rows={3}
                      value={form.noGoTopics}
                      maxLength={12000}
                      onChange={(event) =>
                        update("noGoTopics", event.target.value)
                      }
                    />
                  </label>,
                  copy(
                    "موضوع واحد في كل سطر، أو اتركه فارغًا.",
                    "One topic per line, or leave empty.",
                  ),
                )}
                {choices("preferredTiers", CreatorTierSchema.options)}
                {field(
                  "dataVerificationRequired",
                  <Choice
                    checked={form.dataVerificationRequired}
                    onChange={(checked) =>
                      update("dataVerificationRequired", checked)
                    }
                  >
                    {label("dataVerificationRequired")}
                  </Choice>,
                )}
                <div className="sm:col-span-2">
                  {textField("usageRights", 10000, true)}
                </div>
                {field(
                  "preferredLicencePolicyIds",
                  <label className="block space-y-2">
                    <span className="text-base font-medium">
                      {label("preferredLicencePolicyIds")}{" "}
                      {copy("(اختياري)", "(optional)")}
                    </span>
                    <Textarea
                      dir="ltr"
                      rows={3}
                      className="text-base"
                      value={form.preferredLicencePolicyIds}
                      maxLength={12000}
                      onChange={(event) =>
                        update("preferredLicencePolicyIds", event.target.value)
                      }
                    />
                  </label>,
                  copy(
                    "معرف سياسة معروف واحد في كل سطر. القائمة المفضلة لا تثبت الامتثال أو الترخيص.",
                    "One known policy ID per line. A preference does not establish compliance or a licence.",
                  ),
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {copy("٦. القياس والملاحظات", "6. Measurement and notes")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {field(
                  "kpis",
                  <fieldset className="space-y-4">
                    <legend className="mb-2 text-base font-medium">
                      {label("kpis")}
                    </legend>
                    {form.kpis.map((row, index) => (
                      <div
                        key={index}
                        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
                      >
                        <label className="space-y-2">
                          <span className="text-base">
                            {copy("المؤشر", "Indicator")}
                          </span>
                          <Input
                            className="text-base"
                            dir="auto"
                            maxLength={200}
                            value={row.name}
                            onChange={(event) =>
                              update(
                                "kpis",
                                form.kpis.map((item, at) =>
                                  at === index
                                    ? { ...item, name: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-base">
                            {copy("النتيجة المستهدفة", "Target outcome")}
                          </span>
                          <Input
                            className="text-base"
                            dir="auto"
                            maxLength={1000}
                            value={row.target}
                            onChange={(event) =>
                              update(
                                "kpis",
                                form.kpis.map((item, at) =>
                                  at === index
                                    ? { ...item, target: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            update(
                              "kpis",
                              form.kpis.filter((_, at) => at !== index),
                            )
                          }
                        >
                          {copy("احذف المؤشر", "Remove indicator")}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={form.kpis.length >= 30}
                      onClick={() =>
                        update("kpis", [...form.kpis, { name: "", target: "" }])
                      }
                    >
                      <Plus aria-hidden="true" />
                      {copy("أضف مؤشرًا", "Add an indicator")}
                    </Button>
                  </fieldset>,
                )}
                <div className="grid gap-5 sm:grid-cols-2">
                  {(["assumptions", "openQuestions"] as const).map((key) => (
                    <div key={key}>
                      {field(
                        key,
                        <label className="block space-y-2">
                          <span className="text-base font-medium">
                            {label(key)}
                          </span>
                          <Textarea
                            dir="auto"
                            className="text-base"
                            rows={4}
                            value={form[key]}
                            maxLength={16000}
                            onChange={(event) =>
                              update(key, event.target.value)
                            }
                          />
                        </label>,
                        copy(
                          "عنصر واحد في كل سطر، أو اتركه فارغًا.",
                          "One item per line, or leave empty.",
                        ),
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <p className="text-base leading-7 text-muted-foreground">
              {copy(
                "احفظ اللي جهزته الآن وكمل الباقي لاحقًا. الخيارات غير المحددة لا تُستنتج من بلدك أو لغة الواجهة.",
                "Save what you have now and complete the rest later. Unspecified choices are not inferred from your country or interface language.",
              )}
            </p>
            <Button type="submit" size="lg">
              {copy("راجع واحفظ التفاصيل", "Review and save details")}
            </Button>
          </fieldset>
        </form>
      )}
      {!!campaign?.proposals.length && (
        <Card>
          <CardHeader>
            <CardTitle>
              {copy("اقتراحات تحتاج مراجعتك", "Proposals for your review")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {campaign.proposals.map((proposal) => (
              <article
                key={proposal.id}
                className="space-y-4 rounded-lg border p-4"
              >
                <p
                  dir="auto"
                  lang={proposal.originalText.language ?? undefined}
                  className="whitespace-pre-wrap text-base"
                >
                  {proposal.originalText.text}
                </p>
                <dl className="space-y-4">
                  {Object.entries(proposal.patch).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-base font-medium">{label(key)}</dt>
                      <dd className="mt-2 grid gap-2 text-base sm:grid-cols-2">
                        <div className="rounded-md bg-muted p-3">
                          <p className="mb-2 text-sm">
                            {copy("المحفوظ حاليًا", "Currently saved")}
                          </p>
                          {showValue(
                            key,
                            campaign.fields[key as keyof CampaignDraftFields],
                          )}
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="mb-2 text-sm">
                            {copy("الاقتراح", "Proposal")}
                          </p>
                          {showValue(key, value)}
                        </div>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm">
                  {proposal.appliedAt
                    ? copy("تم تطبيقه", "Applied")
                    : proposal.basedOnFieldsRevision !== campaign.fieldsRevision
                      ? copy(
                          "اقتراح قديم — لا يمكن تطبيقه",
                          "Stale proposal — cannot be applied",
                        )
                      : copy("بانتظار تأكيدك", "Awaiting your confirmation")}
                </p>
                <Button
                  disabled={
                    disabled ||
                    dirty ||
                    !!proposal.appliedAt ||
                    proposal.basedOnFieldsRevision !== campaign.fieldsRevision
                  }
                  onClick={() =>
                    void send(
                      `/api/campaigns/${encodeURIComponent(campaign.id)}/commands`,
                      {
                        operationKey: crypto.randomUUID(),
                        expectedRevision: campaign.revision,
                        action: "APPLY_PROPOSAL",
                        payload: { proposalId: proposal.id },
                      },
                      "APPLY",
                    )
                  }
                >
                  <Check aria-hidden="true" />
                  {copy(
                    "راجعت التغييرات وأطبقها",
                    "I've reviewed and apply these changes",
                  )}
                </Button>
              </article>
            ))}
          </CardContent>
        </Card>
      )}
      {campaign && (
        <Card>
          <CardHeader>
            <CardTitle>{copy("موجز الحملة", "Campaign brief")}</CardTitle>
            <CardDescription className="text-base">
              {copy(
                "الموجز نسخة من التفاصيل المحفوظة. كل تعديل مادي يحتاج مراجعة واعتماد نسخة جديدة.",
                "The brief is a version of your saved requirements. Material edits need review and approval of a new version.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!!campaign.missingFields.length && (
              <div className="space-y-3">
                <p className="text-base font-medium">
                  {copy(
                    "حقول مطلوبة لإكمال الموجز",
                    "Required to complete the brief",
                  )}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {campaign.missingFields.map((key) => (
                    <li key={key}>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setMode("FORM");
                          requestAnimationFrame(() => {
                            const target = document.getElementById(
                              `campaign-${key}`,
                            );
                            target?.scrollIntoView({
                              behavior: "instant",
                              block: "center",
                            });
                            (
                              target?.querySelector(
                                "input,select,textarea",
                              ) as HTMLElement | null
                            )?.focus({ preventScroll: true });
                          });
                        }}
                      >
                        {label(key)}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              size="lg"
              variant="outline"
              disabled={
                disabled ||
                dirty ||
                !CampaignFieldsSchema.safeParse(campaign.fields).success
              }
              onClick={() =>
                void send(
                  `/api/campaigns/${encodeURIComponent(campaign.id)}/brief/generate`,
                  {
                    operationKey: crypto.randomUUID(),
                    expectedRevision: campaign.revision,
                  },
                  "GENERATE",
                )
              }
            >
              {copy("جهّز الموجز للمراجعة", "Prepare brief for review")}
            </Button>
            {dirty && (
              <p className="text-base text-muted-foreground">
                {errorMessage("UNSAVED")}
              </p>
            )}
            {currentBrief && (
              <article className="space-y-5 rounded-lg border p-4 sm:p-6">
                <h2 className="text-xl font-semibold">
                  {copy("نسخة الموجز", "Brief version")} {currentBrief.version}
                </h2>
                <p className="text-base">
                  {staleBrief
                    ? copy(
                        "قديمة — تفاصيل الحملة تغيرت",
                        "Stale — campaign requirements changed",
                      )
                    : currentBrief.approvedAt
                      ? copy("معتمدة", "Approved")
                      : copy("بانتظار اعتمادك", "Awaiting your approval")}
                </p>
                <dl className="grid gap-5 sm:grid-cols-2">
                  {Object.entries(currentBrief.content.requirements)
                    .filter(([key]) => Object.hasOwn(fieldLabels, key))
                    .map(([key, value]) => (
                      <div className="min-w-0" key={key}>
                        <dt className="text-base font-medium">{label(key)}</dt>
                        <dd className="mt-2 text-base leading-7">
                          {showValue(key, value)}
                        </dd>
                      </div>
                    ))}
                </dl>
                <p className="text-base text-muted-foreground">
                  {currentBrief.content.policyReview
                    ? copy(
                        "مراجعة السياسات محفوظة مع هذه النسخة.",
                        "Policy review is recorded with this version.",
                      )
                    : copy(
                        "مراجعة السياسات المحلية غير متاحة لهذه النسخة. اعتماد الموجز لا يُعد إثبات امتثال.",
                        "Local policy review is unavailable for this version. Brief approval does not establish compliance.",
                      )}
                </p>
                {!currentBrief.approvedAt && (
                  <>
                    <Choice
                      checked={approval}
                      onChange={setApproval}
                      disabled={disabled || dirty || staleBrief}
                    >
                      {copy(
                        `راجعت التفاصيل وأوافق على اعتماد النسخة ${currentBrief.version}.`,
                        `I reviewed the requirements and approve version ${currentBrief.version}.`,
                      )}
                    </Choice>
                    <Button
                      size="lg"
                      disabled={disabled || dirty || staleBrief || !approval}
                      onClick={() =>
                        void send(
                          `/api/campaigns/${encodeURIComponent(campaign.id)}/brief/approve`,
                          {
                            operationKey: crypto.randomUUID(),
                            expectedRevision: campaign.revision,
                            briefId: currentBrief.id,
                            expectedBriefVersion: currentBrief.version,
                          },
                          "APPROVE",
                        )
                      }
                    >
                      <Check aria-hidden="true" />
                      {copy("اعتمد هذه النسخة", "Approve this version")}
                    </Button>
                  </>
                )}
                {currentBrief.approvedAt &&
                  campaign.currentBriefVersion === currentBrief.version &&
                  !staleBrief &&
                  !dirty && (
                    <Button asChild size="lg">
                      <Link
                        href={`/brand/campaigns/${encodeURIComponent(campaign.id)}/matches`}
                      >
                        {copy(
                          "انتقل لاختيار صناع المحتوى",
                          "Continue to creator selection",
                        )}
                      </Link>
                    </Button>
                  )}
              </article>
            )}
            {campaign.briefs.length > 1 && (
              <details>
                <summary className="min-h-12 cursor-pointer py-3 text-base font-medium">
                  {copy("سجل النسخ السابقة", "Previous version history")}
                </summary>
                <ol className="space-y-4 pt-3">
                  {campaign.briefs
                    .slice(0, -1)
                    .reverse()
                    .map((brief) => (
                      <li key={brief.id} className="rounded-lg border p-4">
                        <p className="text-base">
                          {copy("نسخة", "Version")} {brief.version} ·{" "}
                          {brief.approvedAt
                            ? copy(
                                "اعتماد سابق محفوظ",
                                "Previous approval retained",
                              )
                            : copy("غير معتمدة", "Unapproved")}
                        </p>
                        <details>
                          <summary className="min-h-12 cursor-pointer py-3 text-base">
                            {copy(
                              "اعرض تفاصيل هذه النسخة",
                              "View this version's requirements",
                            )}
                          </summary>
                          <dl className="space-y-4">
                            {Object.entries(brief.content.requirements)
                              .filter(([key]) =>
                                Object.hasOwn(fieldLabels, key),
                              )
                              .map(([key, value]) => (
                                <div key={key}>
                                  <dt className="font-medium">{label(key)}</dt>
                                  <dd className="mt-1 text-base">
                                    {showValue(key, value)}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        </details>
                      </li>
                    ))}
                </ol>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
