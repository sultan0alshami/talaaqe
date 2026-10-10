"use client";
import Link from "next/link";
import styles from "./workflow-layout.module.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { CheckCircle2, Loader2, Mic, Pencil, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { countryLabel } from "@/lib/contracts/country-labels";
import { TIMEZONE_SUGGESTIONS } from "@/lib/contracts/timezone-suggestions";
import { COUNTRY_CODES, PLATFORM_FORMATS, PlatformSchema, ProfileStateSchema, type Platform, type DealFormat, OwnershipStatusSchema, UtcDateTimeSchema, CountryCodeSchema } from "@/lib/contracts/vocabulary";
import { NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";
import { formatMoneyDecimal, parseMoney, SUPPORTED_CURRENCIES, CurrencyCodeSchema, MoneySchema } from "@/lib/contracts/money";
import type { DraftDTO } from "@/lib/onboarding/drafts";
import type { OwnerProfileDTO, PortfolioContent } from "@/lib/onboarding/profiles";
import { PublicationReadinessPanel } from "./readiness-panel";
import { PortfolioContentSchema } from "@/lib/onboarding/portfolio-contract";
import { readCampaignAgentResponse } from "@/lib/campaign-agent/browser-transport";

// The SSR mount supplies only the nonsecret actor reference. Native sessions
// remain server-side; child and parent denials clear the same private boundary.
// No plaintext Storage, automatic command retry or background business queue.
type OnboardingProps = { actorReference: string; initialDraft: DraftDTO | null; initialOwner: OwnerProfileDTO };
type PortfolioDTO = NonNullable<OwnerProfileDTO["portfolio"]>;
type Snapshot = { draft: DraftDTO | null; owner: OwnerProfileDTO };
type CommandResult = { draft: DraftDTO; portfolio?: PortfolioDTO; replayed: boolean };
type Flight = { epoch: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };
type CapturedMutation = {
  kind: "INITIALIZE" | "COMMAND"; url: string; body: string | null;
  draftId: string | null; expectedRevision: number | null;
  phase: "UNKNOWN" | "CONFIRMED"; needsRead: boolean; uncertain: boolean; confirmedRevision: number | null;
};
class OnboardingUiError extends Error { constructor(public readonly code: string) { super(code); } }
const revision = z.number().int().positive().max(2147483647);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const dtoId = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
const nullableText = z.string().nullable();
const roleSchema = z.enum(["CREATOR", "BRAND"]);
const sourceKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const identitySchema = z.object({ platform: PlatformSchema.nullable(), providerAccountId: nullableText,
  normalizedHandle: nullableText, confirmedOrigin: nullableText }).strict();
const factSchema = z.object({ id: dtoId, jobId: dtoId, fieldKey: z.string().max(100),
  value: z.unknown(), unit: nullableText, source: z.string().max(100),
  evidenceAt: UtcDateTimeSchema.nullable(), retrievedAt: UtcDateTimeSchema.optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), sourceReference: nullableText,
  reviewStatus: z.literal("PROPOSED"), visibility: z.literal("PRIVATE") }).strict();
const draftSchema = z.object({
  id: dtoId, role: roleSchema, revision, step: z.string().min(1).max(100), mode: z.string().min(1).max(100),
  input: z.object({ version: z.literal(1), answers: z.record(z.string(), z.unknown()),
    sources: z.record(sourceKeySchema, z.object({ source: z.union([PlatformSchema, z.literal("WEBSITE")]),
      identity: identitySchema, revision, confirmedAt: UtcDateTimeSchema.nullable() }).strict()),
    facts: z.record(sourceKeySchema, z.array(factSchema).max(1000)), mappingRevision: revision,
    factsRevision: revision, generatedSectionsStale: z.boolean() }).strict(),
  consent: z.record(sourceKeySchema, z.object({ identityHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: revision, scopes: z.array(z.string().max(200)).max(100),
    consentVersion: z.string().max(200), grantedAt: UtcDateTimeSchema }).strict()),
  transcript: z.unknown(),
  jobs: z.array(z.object({ id: dtoId, sourceKey: z.string(), source: z.string(),
    revision, status: z.string(), attempts: count, completedItems: count,
    totalItems: count.nullable(), billingUncertain: z.boolean(), errorCode: nullableText,
    startedAt: UtcDateTimeSchema.nullable(), completedAt: UtcDateTimeSchema.nullable(),
    createdAt: UtcDateTimeSchema }).strict()),
  completedAt: UtcDateTimeSchema.nullable(), updatedAt: UtcDateTimeSchema,
}).strict();
const portfolioSchema = z.object({ version: revision, content: PortfolioContentSchema,
  approvedAt: UtcDateTimeSchema.nullable(), inputRevision: revision }).strict();
const ownerSchema = z.object({
  role: roleSchema,
  profile: z.object({ id: dtoId, displayName: z.string().max(200), handle: z.string().max(100),
    bio: nullableText, state: ProfileStateSchema, countryCode: CountryCodeSchema.nullable(),
    city: z.unknown(), timeZone: nullableText, languages: z.array(z.string()),
    dialects: z.array(z.string()), nicheSlugs: z.array(z.string()),
    fameIndustries: z.array(z.string()), contentStyles: z.array(z.string()),
    currency: CurrencyCodeSchema.nullable(), minimumMinor: MoneySchema.shape.amountMinor.nullable(),
    availability: z.unknown(), travel: z.unknown(), facts: z.unknown(), primaryAccountId: dtoId.nullable(),
    website: nullableText }).strict(),
  accounts: z.array(z.object({ id: dtoId, platform: PlatformSchema, handle: z.string().max(100),
    ownershipStatus: OwnershipStatusSchema, publicVisible: z.boolean(), brandVisible: z.boolean(),
    mappingRevision: revision, factsApprovedAt: UtcDateTimeSchema.nullable() }).strict()),
  rates: z.array(z.object({ platform: PlatformSchema, format: z.enum(["STORY", "POST", "REEL", "LIVE", "CAMPAIGN", "VIDEO", "SHORT"]),
    currencyCode: CurrencyCodeSchema, amountMinor: MoneySchema.shape.amountMinor }).strict()),
  portfolio: portfolioSchema.nullable(),
}).strict();
const snapshotSchema = z.object({ draft: draftSchema.nullable(), owner: ownerSchema.nullable() }).strict();
const commandResultSchema = z.object({ draft: draftSchema, portfolio: portfolioSchema.optional(), replayed: z.boolean() }).strict();

const selectClass = "h-12 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring";
const platforms = PlatformSchema.options;
const jsonObject = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Rate = { platform: Platform; format: DealFormat; currencyCode: string; decimal: string };
export function OnboardingScreen(props: OnboardingProps) {
  return <OnboardingSessionScreen key={props.actorReference + ":" + props.initialOwner.role} {...props} />;
}
function OnboardingSessionScreen({ actorReference, initialDraft, initialOwner }: OnboardingProps) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [draft, setDraft] = useState(initialDraft), [owner, setOwner] = useState<OwnerProfileDTO | null>(initialOwner);
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const creator = initialOwner.role === "CREATOR", profile = owner?.profile ?? initialOwner.profile, facts = jsonObject(profile.facts), availability = jsonObject(profile.availability), city = jsonObject(profile.city);
  const [name, setName] = useState(profile.displayName), [handle, setHandle] = useState(profile.handle), [bio, setBio] = useState(profile.bio ?? "");
  const [country, setCountry] = useState(profile.countryCode ?? ""), [cityLabel, setCityLabel] = useState(typeof city.label === "string" ? city.label : ""), [timeZone, setTimeZone] = useState(profile.timeZone ?? "");
  const [languages, setLanguages] = useState((creator ? profile.languages : Array.isArray(facts.languages) ? facts.languages as string[] : []).join(", "));
  const [currency, setCurrency] = useState(profile.currency ?? (typeof facts.preferredCurrency === "string" ? facts.preferredCurrency : ""));
  const [niches, setNiches] = useState<string[]>(profile.nicheSlugs), [minimum, setMinimum] = useState(profile.minimumMinor !== null && profile.currency ? formatMoneyDecimal({ amountMinor: profile.minimumMinor, currencyCode: profile.currency }) : "");
  const [available, setAvailable] = useState(typeof availability.status === "string" ? availability.status : "UNKNOWN"), [startsAt, setStartsAt] = useState(typeof availability.startsAt === "string" ? availability.startsAt : ""), [endsAt, setEndsAt] = useState(typeof availability.endsAt === "string" ? availability.endsAt : "");
  const [travel, setTravel] = useState(jsonObject(profile.travel).willing === true), [ratesVisibility, setRatesVisibility] = useState(typeof facts.ratesVisibility === "string" ? facts.ratesVisibility : "PRIVATE");
  const [rates, setRates] = useState<Rate[]>(initialOwner.rates.map((rate) => ({ ...rate, decimal: formatMoneyDecimal({ amountMinor: rate.amountMinor, currencyCode: rate.currencyCode }) })));
  const [noWebsite, setNoWebsite] = useState(facts.noWebsite === true), [website, setWebsite] = useState(profile.website ?? ""), [contactName, setContactName] = useState(typeof facts.contactName === "string" ? facts.contactName : ""), [representativeRole, setRepresentativeRole] = useState(typeof facts.representativeRole === "string" ? facts.representativeRole : "");
  const [markets, setMarkets] = useState(Array.isArray(facts.targetMarkets) ? (facts.targetMarkets as string[]).join(", ") : "");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(initialDraft ? Object.values(initialDraft.input.sources).filter((source) => source.source !== "WEBSITE").map((source) => source.source as Platform) : []);
  const [sharedHandle, setSharedHandle] = useState("");
  const [sourceHandles, setSourceHandles] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initialDraft?.input.sources ?? {}).map(([key, mapping]) => [key, mapping.identity.normalizedHandle ?? ""])));
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({}), [consented, setConsented] = useState<Record<string, boolean>>({});
  const [primaryKey, setPrimaryKey] = useState<string>(typeof initialDraft?.input.answers.primarySourceKey === "string" ? initialDraft.input.answers.primarySourceKey : "");
  const [portfolio, setPortfolio] = useState(initialOwner.portfolio), [portfolioBio, setPortfolioBio] = useState(initialOwner.portfolio?.content.bio ?? ""), [publishConsent, setPublishConsent] = useState(false);
  const [visibleAccounts, setVisibleAccounts] = useState<string[]>(initialOwner.accounts.some((a) => a.publicVisible) ? initialOwner.accounts.filter((a) => a.publicVisible).map((a) => a.id) : profile.primaryAccountId ? [profile.primaryAccountId] : []);
  const [privateDenied, setPrivateDenied] = useState(false);
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState<CapturedMutation | null>(null);
  const packet = useRef<CapturedMutation | null>(null);
  const boundDraftId = useRef<string | null>(initialDraft?.id ?? null);
  const denial = useRef(false), mounted = useRef(false), mutex = useRef(false), epoch = useRef(0);
  const active = useRef<Flight | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [fixedActor] = useState(actorReference);
  useEffect(() => {
    if (privateDenied) heading.current?.focus();
  }, [privateDenied]);
  useEffect(() => {
    const lifetime = { mounted, epoch, active, mutex, packet };
    mounted.current = true;
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!packet.current && !mutex.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => {
      lifetime.mounted.current = false; lifetime.epoch.current++;
      const flight = lifetime.active.current;
      if (flight) { clearTimeout(flight.timer); flight.controller.abort(); }
      lifetime.active.current = null; lifetime.mutex.current = false; lifetime.packet.current = null;
      window.removeEventListener("beforeunload", preventLoss);
    };
  }, []);
  function clearPrivate(status: number) {
    if (!mounted.current || denial.current) return;
    denial.current = true; epoch.current++;
    const flight = active.current;
    if (flight) { clearTimeout(flight.timer); flight.controller.abort(); }
    active.current = null; mutex.current = false; packet.current = null; boundDraftId.current = null;
    setPrivateDenied(true); setPending(null); setBusy(false); setReading(false); setNotice("");
    setDraft(null); setOwner(null); setPortfolio(null); setPortfolioBio("");
    setName(""); setHandle(""); setBio(""); setCountry(""); setCityLabel(""); setTimeZone("");
    setLanguages(""); setCurrency(""); setNiches([]); setMinimum(""); setAvailable("UNKNOWN");
    setStartsAt(""); setEndsAt(""); setTravel(false); setRatesVisibility("PRIVATE"); setRates([]);
    setNoWebsite(false); setWebsite(""); setContactName(""); setRepresentativeRole(""); setMarkets("");
    setSelectedPlatforms([]); setSharedHandle(""); setSourceHandles({}); setConfirmed({}); setConsented({});
    setPrimaryKey(""); setPublishConsent(false); setVisibleAccounts([]); setStep(0);
    setError(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
  }
  function currentFlight() {
    const flight = active.current;
    if (!mounted.current || denial.current || fixedActor !== actorReference || !flight ||
        epoch.current !== flight.epoch || flight.controller.signal.aborted) throw new OnboardingUiError("CANCELLED");
    return flight;
  }
  function keepPending(value: CapturedMutation | null) {
    packet.current = value; setPending(value);
  }
  function message(code: string) {
    const messages: Record<string, [string, string]> = {
      UNKNOWN_OUTCOME: ["لم نعرف نتيجة التغيير. احتفظنا بطلبه الأصلي في هذه الصفحة؛ أعد المحاولة نفسها قبل إجراء تغيير جديد.", "The change’s outcome is unknown. Its original request is retained on this page; retry that same request before making another change."],
      CONFIRMED_READ_FAILED: ["تأكد حفظ التغيير، لكن تعذر تحميل الحالة الحالية. أعد القراءة فقط؛ لا حاجة لإرسال التغيير مجددًا.", "The change is confirmed, but the current state could not be loaded. Retry the read only; the change does not need to be sent again."],
      STALE_VERSION: ["تغيرت المسودة في مكان آخر. حمّل آخر نسخة ثم راجع بياناتك.", "This draft changed elsewhere. Reload the latest version and review your input."],
      EMAIL_VERIFICATION_REQUIRED: ["أكد بريدك الإلكتروني من الرئيسية قبل النشر.", "Verify your email from Overview before publishing."],
      PRIMARY_OWNERSHIP_REQUIRED: ["احفظ مسودتك وقدم إثبات ملكية الحساب الأساسي للمراجعة قبل النشر.", "Save your draft and submit primary account ownership evidence for review before publishing."],
      ACCOUNT_PUBLICATION_NOT_ALLOWED: ["راجع إثباتات الحسابات التي اخترت إظهارها.", "Review ownership evidence for the accounts you selected to show."],
      REPRESENTATION_REQUIRED: ["يلزم اعتماد إثبات تمثيل الشركة قبل مشاركة الملف.", "Accepted company representation evidence is required before sharing."],
      PROFILE_ESSENTIALS_REQUIRED: ["أكمل البلد والمنطقة الزمنية واللغة والتخصص والعملة.", "Complete country, timezone, language, niche and currency."],
      PORTFOLIO_APPROVAL_REQUIRED: ["راجع النسخة الحالية من الملف واعتمدها قبل النشر.", "Review and approve the current portfolio before publishing."],
      PORTFOLIO_STALE: ["تغيرت البيانات. أنشئ نسخة جديدة وراجعها.", "The source data changed. Create and review a new version."],
      ACCOUNT_MAPPING_CHANGED: ["راجع حساباتك واحفظ بيانات الملف مجددًا.", "Review your account mapping and save the profile again."],
      CONFLICT: ["هذا المعرّف مستخدم. اختر معرّفًا آخر.", "This handle is in use. Choose another."],
      VALIDATION: ["راجع الحقول والعملة والتواريخ.", "Check the fields, currency and dates."],
      INVALID_COMMAND: ["راجع الحقول والعملة والتواريخ.", "Check the fields, currency and dates."],
      CAPABILITY_UNAVAILABLE: ["هذه الخدمة غير متاحة حاليًا. تقدر تكمل بالكتابة.", "This service is unavailable. You can continue by typing."],
    };
    const value = messages[code];
    return value ? copy(...value) : copy("تعذر حفظ التغيير. راجع بياناتك وحاول مرة ثانية.", "The change could not be saved. Review your input and try again.");
  }
  async function request(path: string, body: string | null, method: "GET" | "POST") {
    const flight = currentFlight();
    setReading(method === "GET");
    const response = await fetch(path, { method, cache: "no-store", credentials: "same-origin",
      signal: flight.controller.signal, headers: body === null ? {} : { "Content-Type": "application/json" },
      ...(body === null ? {} : { body }) });
    if (!mounted.current || active.current !== flight || epoch.current !== flight.epoch) throw new OnboardingUiError("CANCELLED");
    // Authoritative denial invalidates every private state/ref before any body read.
    if (response.status === 401 || response.status === 403) {
      clearPrivate(response.status); throw new OnboardingUiError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    }
    if (response.status === 404) throw new OnboardingUiError("NOT_FOUND");
    currentFlight();
    const envelope = jsonObject(await readCampaignAgentResponse(response, flight.controller.signal, 2097152));
    currentFlight();
    if (!response.ok) {
      const code = jsonObject(envelope.error).code;
      if (typeof code !== "string") throw new OnboardingUiError("INVALID_RESPONSE");
      // An initial validated negative response may close its own request. Once
      // uncertainty exists, a retry's negative result cannot prove that the
      // earlier same-key request will never commit. Preserve its exact packet.
      if (method === "POST" && !packet.current?.uncertain && response.status >= 400 && response.status < 429) keepPending(null);
      throw new OnboardingUiError(code);
    }
    return envelope.data;
  }
  function checkedSnapshot(value: unknown): Snapshot {
    const parsed = snapshotSchema.safeParse(value);
    if (!parsed.success || parsed.data.owner && (parsed.data.owner.role !== initialOwner.role ||
        parsed.data.owner.profile.id !== initialOwner.profile.id) ||
        parsed.data.draft && parsed.data.draft.role !== initialOwner.role) throw new OnboardingUiError("INVALID_RESPONSE");
    if (!parsed.data.owner) {
      clearPrivate(403); throw new OnboardingUiError("FORBIDDEN");
    }
    if (boundDraftId.current !== null && parsed.data.draft?.id !== boundDraftId.current) {
      clearPrivate(403); throw new OnboardingUiError("FORBIDDEN");
    }
    return parsed.data as unknown as Snapshot;
  }
  function syncForm(data: Snapshot) {
    const current = data.owner, value = current.profile, saved = jsonObject(value.facts);
    const currentAvailability = jsonObject(value.availability), currentCity = jsonObject(value.city);
    setName(value.displayName); setHandle(value.handle); setBio(value.bio ?? "");
    setCountry(value.countryCode ?? ""); setCityLabel(typeof currentCity.label === "string" ? currentCity.label : "");
    setTimeZone(value.timeZone ?? "");
    setLanguages((creator ? value.languages : Array.isArray(saved.languages) ? saved.languages as string[] : []).join(", "));
    setCurrency(value.currency ?? (typeof saved.preferredCurrency === "string" ? saved.preferredCurrency : ""));
    setNiches(value.nicheSlugs); setMinimum(value.minimumMinor !== null && value.currency ?
      formatMoneyDecimal({ amountMinor: value.minimumMinor, currencyCode: value.currency }) : "");
    setAvailable(typeof currentAvailability.status === "string" ? currentAvailability.status : "UNKNOWN");
    setStartsAt(typeof currentAvailability.startsAt === "string" ? currentAvailability.startsAt : "");
    setEndsAt(typeof currentAvailability.endsAt === "string" ? currentAvailability.endsAt : "");
    setTravel(jsonObject(value.travel).willing === true);
    setRatesVisibility(typeof saved.ratesVisibility === "string" ? saved.ratesVisibility : "PRIVATE");
    setRates(current.rates.map(rate => ({ ...rate, decimal: formatMoneyDecimal({ amountMinor: rate.amountMinor, currencyCode: rate.currencyCode }) })));
    setNoWebsite(saved.noWebsite === true); setWebsite(value.website ?? "");
    setContactName(typeof saved.contactName === "string" ? saved.contactName : "");
    setRepresentativeRole(typeof saved.representativeRole === "string" ? saved.representativeRole : "");
    setMarkets(Array.isArray(saved.targetMarkets) ? (saved.targetMarkets as string[]).join(", ") : "");
    setSelectedPlatforms(Object.values(data.draft?.input.sources ?? {}).filter(source => source.source !== "WEBSITE").map(source => source.source as Platform));
    setSourceHandles(Object.fromEntries(Object.entries(data.draft?.input.sources ?? {}).map(([key, mapping]) => [key, mapping.identity.normalizedHandle ?? ""])));
    setSharedHandle(""); setConfirmed({}); setConsented({});
    setPrimaryKey(typeof data.draft?.input.answers.primarySourceKey === "string" ? data.draft.input.answers.primarySourceKey : "");
    setPublishConsent(false);
    setVisibleAccounts(current.accounts.filter(account => account.publicVisible).map(account => account.id));
  }
  async function readSnapshot(hydrateForm = false) {
    const data = checkedSnapshot(await request("/api/onboarding", null, "GET"));
    const confirmed = packet.current;
    if (confirmed?.phase === "CONFIRMED" && (confirmed.confirmedRevision === null ||
        !data.draft || data.draft.revision < confirmed.confirmedRevision)) {
      throw new OnboardingUiError("INVALID_RESPONSE");
    }
    currentFlight(); setDraft(data.draft); setOwner(data.owner); setPortfolio(data.owner.portfolio);
    setPortfolioBio(data.owner.portfolio?.content.bio ?? "");
    if (hydrateForm) syncForm(data);
    // Current state alone cannot prove an UNKNOWN operation-key outcome.
    if (packet.current?.phase === "CONFIRMED") keepPending(null);
    return data;
  }
  async function dispatchCaptured(captured: CapturedMutation): Promise<CommandResult | Snapshot> {
    if (captured.phase !== "UNKNOWN" || packet.current !== captured) throw new OnboardingUiError("RECOVERY_REQUIRED");
    const value = await request(captured.url, captured.body, "POST");
    currentFlight();
    if (captured.kind === "INITIALIZE") {
      const data = checkedSnapshot(value);
      if (!data.draft) throw new OnboardingUiError("INVALID_RESPONSE");
      boundDraftId.current = data.draft.id;
      keepPending({ ...captured, draftId: data.draft.id, phase: "CONFIRMED", confirmedRevision: data.draft.revision });
      setDraft(data.draft); setOwner(data.owner); setPortfolio(data.owner.portfolio);
      setPortfolioBio(data.owner.portfolio?.content.bio ?? "");
      return data;
    }
    const parsed = commandResultSchema.safeParse(value);
    if (!parsed.success || parsed.data.draft.id !== captured.draftId ||
        parsed.data.draft.role !== initialOwner.role || captured.expectedRevision === null ||
        parsed.data.draft.revision !== captured.expectedRevision + 1) throw new OnboardingUiError("INVALID_RESPONSE");
    const data = parsed.data as unknown as CommandResult;
    if (boundDraftId.current !== null && data.draft.id !== boundDraftId.current) {
      clearPrivate(403); throw new OnboardingUiError("FORBIDDEN");
    }
    boundDraftId.current = data.draft.id;
    // Record known confirmation before a following awaited read can fail.
    keepPending({ ...captured, phase: "CONFIRMED", confirmedRevision: data.draft.revision });
    setDraft(data.draft);
    if (data.portfolio) { setPortfolio(data.portfolio); setPortfolioBio(data.portfolio.content.bio); }
    return data;
  }
  async function run(operation: () => Promise<void>, recovery = false) {
    if (!mounted.current || denial.current || mutex.current || fixedActor !== actorReference ||
        (!recovery && packet.current)) return;
    mutex.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(), flight: Flight = {
      epoch: ++epoch.current, controller,
      timer: setTimeout(() => controller.abort(), 30000),
    };
    active.current = flight;
    const owned = () => mounted.current && active.current === flight && epoch.current === flight.epoch && !denial.current;
    try {
      await operation(); currentFlight();
      if (packet.current?.phase === "CONFIRMED" && !packet.current.needsRead) keepPending(null);
    } catch (cause) {
      if (owned()) {
        const code = cause instanceof OnboardingUiError ? cause.code : "REQUEST_FAILED";
        if (packet.current?.phase === "UNKNOWN" && !packet.current.uncertain) {
          keepPending({ ...packet.current, uncertain: true });
        }
        setError(packet.current?.phase === "CONFIRMED" ? message("CONFIRMED_READ_FAILED") :
          packet.current?.phase === "UNKNOWN" ? message("UNKNOWN_OUTCOME") : message(code));
      }
    } finally {
      clearTimeout(flight.timer);
      if (owned()) { active.current = null; mutex.current = false; setBusy(false); setReading(false); }
    }
  }
  async function initialize() {
    if (packet.current?.phase === "UNKNOWN") throw new OnboardingUiError("RECOVERY_REQUIRED");
    const captured: CapturedMutation = { kind: "INITIALIZE", url: "/api/onboarding", body: null,
      draftId: null, expectedRevision: null, phase: "UNKNOWN", needsRead: false, uncertain: false, confirmedRevision: null };
    keepPending(captured);
    const data = await dispatchCaptured(captured) as Snapshot;
    return data.draft!;
  }
  async function command(current: DraftDTO, kind: "DRAFT" | "PROFILE", action: string, payload: unknown) {
    if (packet.current?.phase === "UNKNOWN") throw new OnboardingUiError("RECOVERY_REQUIRED");
    if (boundDraftId.current !== null && boundDraftId.current !== current.id) {
      clearPrivate(403); throw new OnboardingUiError("FORBIDDEN");
    }
    boundDraftId.current = current.id;
    const body = JSON.stringify({ kind, command: { operationKey: crypto.randomUUID(),
      expectedRevision: current.revision, action, payload } });
    if (new TextEncoder().encode(body).byteLength > 65536) throw new OnboardingUiError("PAYLOAD_TOO_LARGE");
    const captured: CapturedMutation = { kind: "COMMAND", url: "/api/onboarding/" + encodeURIComponent(current.id) + "/commands",
      body, draftId: current.id, expectedRevision: current.revision, phase: "UNKNOWN",
      needsRead: ["SAVE_PROFILE", "PUBLISH", "HIDE"].includes(action), uncertain: false, confirmedRevision: null };
    keepPending(captured);
    return await dispatchCaptured(captured) as CommandResult;
  }
  async function retryCaptured() {
    const captured = packet.current;
    if (!captured || captured.phase !== "UNKNOWN") return;
    await run(async () => {
      const retryPacket = { ...captured, uncertain: true };
      keepPending(retryPacket);
      await dispatchCaptured(retryPacket);
      const confirmedPacket = packet.current;
      if (!confirmedPacket || confirmedPacket.phase !== "CONFIRMED") throw new OnboardingUiError("INVALID_RESPONSE");
      keepPending({ ...confirmedPacket, needsRead: true });
      await readSnapshot(true);
      setNotice(copy("تأكد التغيير الأصلي وحُمّلت المسودة الحالية. راجعها قبل المتابعة.",
        "The original change is confirmed and the current draft is loaded. Review it before continuing."));
    }, true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const current = draft ?? await initialize();
      const location = country && timeZone ? { countryCode: country, cityKey: null, cityLabel: cityLabel.trim() || null, timeZone } : null;
      const payload = creator ? { displayName: name, infameHandle: handle, bio: bio.trim() || null, location, languages: languages.split(/[,،]/).map((value) => value.trim()).filter(Boolean), dialects: profile.dialects, nicheSlugs: niches, fameIndustries: profile.fameIndustries, contentStyles: profile.contentStyles, preferredCurrency: currency || null, minimumMinor: minimum ? parseMoney(minimum, currency).amountMinor : null, availability: { status: available, startsAt: startsAt || null, endsAt: endsAt || null }, travelWilling: travel, ratesVisibility, rates: rates.map((rate) => ({ platform: rate.platform, format: rate.format, currencyCode: rate.currencyCode, amountMinor: parseMoney(rate.decimal, rate.currencyCode).amountMinor })), primarySourceKey: primaryKey || null }
        : { companyName: name, brandSlug: handle, description: bio.trim() || null, location, noWebsite, website: noWebsite ? null : website, contactName, representativeRole, targetMarkets: markets.split(/[,،]/).map((value) => value.trim().toUpperCase()).filter(Boolean), languages: languages.split(/[,،]/).map((value) => value.trim()).filter(Boolean), preferredCurrency: currency || null };
      await command(current, "PROFILE", "SAVE_PROFILE", payload);
      const data = await readSnapshot(); setOwner(data.owner); setDraft(data.draft);
      setNotice(copy("انحفظت مسودتك الخاصة. تقدر ترجع لها بأي وقت.", "Your private draft is saved. You can resume anytime."));
    });
  }
  async function confirmSource(platform: Platform) {
    await run(async () => {
      if (!confirmed[platform] || !consented[platform]) throw new Error("VALIDATION");
      let current = draft ?? await initialize();
      const key = platform.toLowerCase(), identity = { platform, normalizedHandle: (sourceHandles[key] ?? "").trim().replace(/^@/, ""), providerAccountId: null, confirmedOrigin: null };
      current = (await command(current, "DRAFT", "SET_ANSWER", { field: "sourceMapping", value: { sourceKey: key, source: platform, identity } })).draft;
      current = (await command(current, "DRAFT", "CONFIRM_ACCOUNT", { sourceKey: key, identity })).draft;
      await command(current, "DRAFT", "GRANT_IMPORT_CONSENT", { sourceKey: key, identity, scopes: ["public-profile"], consentVersion: "infame-public-collection-v1", granted: true });
      setNotice(copy("تأكد الحساب المقصود وحُفظت موافقتك. إثبات الملكية والبيانات خطوة مستقلة.", "The intended account and consent are saved. Ownership and data verification are separate steps."));
    });
  }
  if (privateDenied || !owner || fixedActor !== actorReference) {
    return <section className={`${styles.page} space-y-[22px]`} data-onboarding-session="denied">
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold">
        {error === "UNAUTHENTICATED" ? copy("انتهت جلستك", "Your session ended") : copy("بياناتك غير متاحة", "Your information is unavailable")}
      </h1>
      <Card><CardContent className="space-y-4 pt-6">
        <p role="alert">{copy("أُغلقت هذه الصفحة الخاصة. سجّل الدخول مجددًا، ثم افتح إعداد ملفك من مساحتك.",
          "This private page is locked. Sign in again, then open profile setup from your workspace.")}</p>
        <Button asChild variant="outline"><Link href="/login" prefetch={false}>{copy("تسجيل الدخول", "Sign in")}</Link></Button>
      </CardContent></Card>
    </section>;
  }
  const controlsBlocked = busy || pending !== null;
  const steps = [copy("التعريف", "Identity"), copy("الحسابات", "Accounts"), copy("البيانات", "Facts"), copy("الأساسيات", "Essentials"), copy("الملف والمشاركة", "Portfolio & sharing")];
  return <section className={`${styles.page} space-y-[22px]`} data-onboarding-session="active" data-onboarding-command-state={pending?.phase ?? "IDLE"}>
    <div><p className="text-sm text-muted-foreground">{creator ? copy("مساحة صانع المحتوى", "Creator workspace") : copy("مساحة العلامة التجارية", "Brand workspace")}</p><h1 className="mt-2 text-3xl font-semibold">{copy("خلّنا نتعرف عليك", "Let's get to know you")}</h1><p className="mt-3 text-muted-foreground">{copy("بخطوات قصيرة، نرتب ملفك من المعلومات اللي تختار تشاركها.", "Build your profile in short steps using the information you choose to share.")}</p></div>
    {!draft && <Card><CardContent className="space-y-4 pt-6"><p className="text-base">{copy("كيف تفضّل تبدأ؟", "How would you like to start?")}</p><div className="flex flex-wrap gap-3"><Button size="lg" disabled={controlsBlocked} onClick={() => setError(message("CAPABILITY_UNAVAILABLE"))}><Mic aria-hidden="true" />{copy("أتكلم", "Speak")}</Button><Button variant="outline" size="lg" disabled={controlsBlocked} onClick={() => run(async () => { await initialize(); })}><Pencil aria-hidden="true" />{copy("أكتب", "Type")}</Button></div></CardContent></Card>}
    <nav className="flex flex-wrap gap-2" aria-label={copy("خطوات الملف", "Profile steps")}>{steps.map((label, index) => <Button key={index} variant={step === index ? "secondary" : "ghost"} disabled={busy} onClick={() => setStep(index)} aria-current={step === index ? "step" : undefined}>{index + 1}. {label}</Button>)}</nav>
    <div aria-live="polite" className="space-y-2">{busy && <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{reading ? copy("نحمّل الحالة الحالية…", "Loading current state…") : copy("نحفظ التغيير…", "Saving…")}</p>}{notice && <p className="flex items-start gap-2 text-foreground"><CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />{notice}</p>}</div>
    {pending && <Card data-onboarding-recovery={pending.phase}>
      <CardContent className="space-y-4 pt-6">
        <h2 className="font-semibold">{pending.phase === "CONFIRMED" ?
          copy("التغيير محفوظ — نحتاج قراءة الحالة", "Change saved — current state needs a read") :
          copy("نتيجة التغيير غير معروفة", "Change outcome unknown")}</h2>
        <p>{pending.phase === "CONFIRMED" ?
          copy("لا ترسل التغيير مجددًا. أعد تحميل الحالة الحالية قبل المتابعة.",
            "Do not send the change again. Reload the current state before continuing.") :
          copy("نحتفظ بالطلب الأصلي في هذه الصفحة فقط. لا تُرسل تغييرًا جديدًا؛ إعادة المحاولة تستخدم الطلب الأصلي نفسه.",
            "The original request is retained only on this page. New changes are locked; retry uses that exact original request.")}</p>
        <p className="text-sm text-muted-foreground">{copy("المسودة المحفوظة على الخادم تبقى محفوظة. مغادرة هذه الصفحة قد تفقد طلبًا لم نعرف نتيجته.",
          "Your server draft remains saved. Leaving this page can lose a request whose outcome is unknown.")}</p>
        <div className="flex flex-wrap gap-3">
          {pending.phase === "UNKNOWN" && <Button type="button" variant="outline" disabled={busy}
            onClick={() => void retryCaptured()} data-onboarding-exact-retry>{copy("أعد الطلب الأصلي نفسه", "Retry the exact original request")}</Button>}
          <Button type="button" variant="outline" disabled={busy} data-onboarding-read-recovery
            onClick={() => void run(async () => {
              await readSnapshot(true);
              setNotice(packet.current?.phase === "UNKNOWN" ?
                copy("حُمّلت الحالة الحالية، لكن نتيجة الطلب الأصلي ما زالت غير معروفة.", "Current state loaded; the original request outcome is still unknown.") :
                copy("حُمّلت الحالة الحالية. راجع بياناتك قبل المتابعة.", "Current state loaded. Review your information before continuing."));
            }, true)}><RefreshCw aria-hidden="true" />{copy("حمّل الحالة دون إعادة التغيير", "Read current state without resending")}</Button>
        </div>
      </CardContent>
    </Card>}
    {error && <div role="alert" className="rounded-lg border border-destructive p-4" data-onboarding-error><p>{error}</p>
      {!pending && <Button type="button" variant="outline" className="mt-3" disabled={busy}
        onClick={() => void run(async () => { await readSnapshot(true); })}>
        <RefreshCw aria-hidden="true" />{copy("حمّل المسودة الحالية", "Reload current draft")}
      </Button>}
    </div>}
    <form onSubmit={save} className="space-y-6" aria-busy={busy}>
      <fieldset disabled={controlsBlocked} className="min-w-0 space-y-6">
      {step === 0 && <Card><CardHeader><CardTitle>{steps[0]}</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><label className="space-y-2"><span>{creator ? copy("اسمك الظاهر", "Display name") : copy("اسم الشركة", "Company name")}</span><Input required value={name} onChange={(event) => setName(event.target.value)} maxLength={creator ? 100 : 200} /></label><label className="space-y-2"><span>{creator ? copy("معرّف إنفيم", "Infame handle") : copy("معرّف الشركة", "Company slug")}</span><Input aria-label={creator ? copy("معرّف إنفيم", "Infame handle") : copy("معرّف الشركة", "Company slug")} dir="ltr" required value={handle} onChange={(event) => setHandle(event.target.value)} maxLength={creator ? 30 : 50} autoCapitalize="none" spellCheck={false} /><small className="text-muted-foreground">{creator ? "infame.sa/@" : "infame.sa/brands/"}{handle}</small></label><label className="space-y-2 sm:col-span-2"><span>{copy("نبذة بكلماتك", "Overview in your own words")}</span><Textarea aria-label={copy("نبذة بكلماتك", "Overview in your own words")} value={bio} onChange={(event) => setBio(event.target.value)} maxLength={500} rows={4} className="text-base" /></label>
        {!creator && <><label className="space-y-2"><span>{copy("اسم ممثل الشركة (خاص)", "Representative name (private)")}</span><Input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label><label className="space-y-2"><span>{copy("دورك في الشركة (خاص)", "Your company role (private)")}</span><Input value={representativeRole} onChange={(event) => setRepresentativeRole(event.target.value)} /></label><label className="flex min-h-12 items-center gap-3 sm:col-span-2"><input type="checkbox" className="size-5" checked={noWebsite} onChange={(event) => setNoWebsite(event.target.checked)} />{copy("ما عندنا موقع حاليًا", "We don't have a website yet")}</label>{!noWebsite && <label className="space-y-2 sm:col-span-2"><span>{copy("موقع الشركة", "Company website")}</span><Input dir="ltr" type="url" placeholder="https://…" value={website} onChange={(event) => setWebsite(event.target.value)} /><small className="text-muted-foreground">{copy("لن نجمع محتوى الموقع قبل موافقتك عليه.", "Website content is collected only after your explicit consent.")}</small></label>}</>}
      </CardContent></Card>}
      {step === 1 && <Card><CardHeader><CardTitle>{steps[1]}</CardTitle><CardDescription>{copy("اختيار الحساب المقصود منفصل عن إثبات ملكيته. تقدر تكمل ملفك وهو خاص.", "Confirming the intended account is separate from proving ownership. Your private draft can continue.")}</CardDescription></CardHeader><CardContent className="space-y-6"><div className="flex flex-wrap gap-3">{platforms.map((platform) => <label key={platform} className="flex min-h-12 items-center gap-3 rounded-lg border px-3"><input type="checkbox" className="size-5" checked={selectedPlatforms.includes(platform)} onChange={(event) => setSelectedPlatforms(event.target.checked ? [...selectedPlatforms, platform] : selectedPlatforms.filter((item) => item !== platform))} /><span dir="ltr">{platform}</span></label>)}</div><div className="flex flex-col gap-3 sm:flex-row"><label className="grow space-y-2"><span>{copy("معرّف مشترك للتعبئة فقط", "Shared handle for prefill")}</span><Input dir="ltr" value={sharedHandle} onChange={(event) => setSharedHandle(event.target.value)} /></label><Button type="button" className="self-end" variant="outline" onClick={() => setSourceHandles({ ...sourceHandles, ...Object.fromEntries(selectedPlatforms.map((platform) => [platform.toLowerCase(), sharedHandle])) })}>{copy("عبّئ الحقول", "Prefill fields")}</Button></div>
        {selectedPlatforms.map((platform) => { const key = platform.toLowerCase(), mapped = draft?.input.sources[key]; return <div key={platform} className="space-y-3 rounded-lg border p-4"><label className="block space-y-2"><span dir="ltr">{platform}</span><Input dir="ltr" value={sourceHandles[key] ?? ""} maxLength={100} autoCapitalize="none" spellCheck={false} onChange={(event) => { setSourceHandles({ ...sourceHandles, [key]: event.target.value }); setConfirmed({ ...confirmed, [platform]: false }); setConsented({ ...consented, [platform]: false }); }} /></label><label className="flex min-h-12 items-center gap-3"><input className="size-5" type="checkbox" checked={confirmed[platform] ?? false} onChange={(event) => setConfirmed({ ...confirmed, [platform]: event.target.checked })} />{copy("هذا الحساب المقصود", "This is the intended account")}</label><label className="flex min-h-12 items-center gap-3"><input className="size-5" type="checkbox" checked={consented[platform] ?? false} onChange={(event) => setConsented({ ...consented, [platform]: event.target.checked })} />{copy("أوافق على جمع المعلومات العامة المسموح بها لهذا الحساب", "I consent to permitted public-profile collection for this account")}</label><Button type="button" variant="outline" disabled={busy || !confirmed[platform] || !consented[platform] || !sourceHandles[key]?.trim()} onClick={() => confirmSource(platform)}>{copy("أكد الحساب والموافقة", "Confirm account and consent")}</Button>{mapped?.confirmedAt && <p className="text-sm text-muted-foreground">{copy("الحساب المقصود محفوظ؛ إثبات الملكية قيد الاستكمال.", "Intended account saved; ownership proof is still required.")}</p>}{creator && <label className="flex min-h-12 items-center gap-3"><input type="radio" name="primary" checked={primaryKey === key} onChange={() => setPrimaryKey(key)} />{copy("الحساب الأساسي", "Primary account")}</label>}</div>; })}
      </CardContent></Card>}
      {step === 2 && <Card><CardHeader><CardTitle>{copy("راجع البيانات ومصادرها", "Review facts and sources")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-base text-muted-foreground">{copy("الأرقام غير المتاحة تظهر كغير معروف. لا يتم توثيق بياناتك بمجرد إدخالها.", "Unavailable metrics remain unknown. Entering a value does not verify it.")}</p>{!draft?.jobs.length && <p>{copy("ما فيه بيانات مستوردة بعد. احفظ المعلومات الأساسية وتقدر تضيف الإثبات لاحقًا.", "No imported data yet. Save your essentials and add evidence later.")}</p>}{draft?.jobs.map((job) => <div key={job.id} className="rounded-lg border p-4"><span dir="ltr">{job.source}</span><p>{job.status} · {job.completedItems}{job.totalItems !== null ? ` / ${job.totalItems}` : ""}</p></div>)}{owner.accounts.map((account) => <div key={account.id} className="rounded-lg border p-4"><p dir="ltr">{account.platform} · @{account.handle}</p><p>{account.ownershipStatus === "VERIFIED" ? copy("ملكية الحساب معتمدة", "Account ownership accepted") : copy("إثبات الملكية مطلوب", "Ownership proof required")}</p><p className="text-muted-foreground">{copy("المتابعون والمشاهدات والجمهور: غير معروف حتى إدخال بيانات موثقة ومراجعتها.", "Followers, views and audience: unknown until evidence is entered and reviewed.")}</p></div>)}</CardContent></Card>}
      {step === 3 && <Card><CardHeader><CardTitle>{steps[3]}</CardTitle><CardDescription>{copy("البلد والعملة والجمهور ثلاثة اختيارات مختلفة.", "Residence, currency and audience are separate choices.")}</CardDescription></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><label className="space-y-2"><span>{copy("بلد الإقامة / الشركة", "Residence / company country")}</span><select className={selectClass} value={country} onChange={(event) => setCountry(event.target.value)}><option value="">{copy("اختر البلد", "Choose country")}</option>{COUNTRY_CODES.map((code) => <option key={code} value={code}>{countryLabel(code, isAr ? "ar" : "en")} ({code})</option>)}</select></label><label className="space-y-2"><span>{copy("المدينة (اختياري)", "City (optional)")}</span><Input value={cityLabel} onChange={(event) => setCityLabel(event.target.value)} /></label><label className="space-y-2"><span>{copy("المنطقة الزمنية", "Timezone")}</span><Input dir="ltr" placeholder="Asia/Riyadh" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} list="infame-timezones" /><datalist id="infame-timezones">{TIMEZONE_SUGGESTIONS.map((zone) => <option key={zone} value={zone} />)}</datalist></label><label className="space-y-2"><span>{copy("لغات المحتوى", "Content languages")}</span><Input dir="ltr" placeholder="ar, en" value={languages} onChange={(event) => setLanguages(event.target.value)} /></label><label className="space-y-2"><span>{copy("العملة المفضّلة", "Preferred currency")}</span><select className={selectClass} dir="ltr" value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="">{copy("اختر العملة", "Choose currency")}</option>{SUPPORTED_CURRENCIES.map((code) => <option key={code}>{code}</option>)}</select></label>
        {creator ? <><label className="space-y-2"><span>{copy("الحد الأدنى للتعاون (اختياري)", "Minimum collaboration amount (optional)")}</span><Input dir="ltr" inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="0.00" /></label><fieldset className="space-y-3 sm:col-span-2"><legend>{copy("تخصصاتك", "Your niches")}</legend><div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto">{NICHE_TAXONOMY.filter((niche) => niche.parentSlug === null).map((niche) => <label key={niche.slug} className="flex min-h-12 items-center gap-3"><input className="size-5 shrink-0" type="checkbox" checked={niches.includes(niche.slug)} onChange={(event) => setNiches(event.target.checked ? [...niches, niche.slug] : niches.filter((slug) => slug !== niche.slug))} />{isAr ? niche.labelAr : niche.labelEn}</label>)}</div></fieldset><label className="space-y-2"><span>{copy("التفرّغ للتعاون", "Collaboration availability")}</span><select className={selectClass} value={available} onChange={(event) => setAvailable(event.target.value)}><option value="UNKNOWN">{copy("غير محدد", "Not declared")}</option><option value="AVAILABLE">{copy("متاح خلال الفترة", "Available during period")}</option><option value="UNAVAILABLE">{copy("غير متاح", "Unavailable")}</option></select></label><label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="size-5" checked={travel} onChange={(event) => setTravel(event.target.checked)} />{copy("مستعد للسفر", "Willing to travel")}</label>{available === "AVAILABLE" && <><label className="space-y-2"><span>{copy("بداية التفرغ (UTC)", "Availability start (UTC)")}</span><Input dir="ltr" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} placeholder="2026-10-01T00:00:00.000Z" /></label><label className="space-y-2"><span>{copy("نهاية التفرغ (UTC)", "Availability end (UTC)")}</span><Input dir="ltr" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} placeholder="2026-11-01T00:00:00.000Z" /></label></>}
          <fieldset className="space-y-4 sm:col-span-2"><legend>{copy("أسعارك", "Your rates")}</legend>{rates.map((rate, index) => <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4" key={index}><label className="space-y-2"><span>{copy("المنصة", "Platform")}</span><select className={selectClass} value={rate.platform} onChange={(event) => { const platform = event.target.value as Platform; setRates(rates.map((item, at) => at === index ? { ...item, platform, format: PLATFORM_FORMATS[platform][0] } : item)); }}>{platforms.map((platform) => <option key={platform}>{platform}</option>)}</select></label><label className="space-y-2"><span>{copy("المحتوى", "Format")}</span><select className={selectClass} value={rate.format} onChange={(event) => setRates(rates.map((item, at) => at === index ? { ...item, format: event.target.value as DealFormat } : item))}>{PLATFORM_FORMATS[rate.platform].map((format) => <option key={format}>{format}</option>)}</select></label><label className="space-y-2"><span>{copy("العملة", "Currency")}</span><select className={selectClass} dir="ltr" value={rate.currencyCode} onChange={(event) => setRates(rates.map((item, at) => at === index ? { ...item, currencyCode: event.target.value } : item))}><option value="">—</option>{SUPPORTED_CURRENCIES.map((code) => <option key={code}>{code}</option>)}</select></label><label className="space-y-2"><span>{copy("السعر", "Amount")}</span><Input dir="ltr" inputMode="decimal" value={rate.decimal} onChange={(event) => setRates(rates.map((item, at) => at === index ? { ...item, decimal: event.target.value } : item))} /></label><Button type="button" variant="ghost" onClick={() => setRates(rates.filter((_, at) => at !== index))}>{copy("احذف السعر", "Remove rate")}</Button></div>)}<Button type="button" variant="outline" onClick={() => setRates([...rates, { platform: "INSTAGRAM", format: "REEL", currencyCode: currency, decimal: "" }])}>{copy("أضف سعرًا", "Add a rate")}</Button><label className="block space-y-2"><span>{copy("من يشوف الأسعار؟", "Who can see your rates?")}</span><select className={selectClass} value={ratesVisibility} onChange={(event) => setRatesVisibility(event.target.value)}><option value="PRIVATE">{copy("أنا فقط", "Only me")}</option><option value="BRAND_ONLY">{copy("العلامات التجارية", "Brands")}</option><option value="PUBLIC">{copy("الجميع بعد نشر الملف", "Everyone after publication")}</option></select></label></fieldset>
        </> : <label className="space-y-2"><span>{copy("الأسواق المستهدفة", "Target markets")}</span><Input dir="ltr" placeholder="SA, EG" value={markets} onChange={(event) => setMarkets(event.target.value)} /></label>}
      </CardContent></Card>}
      {step < 4 && <div className="flex flex-wrap gap-3"><Button type="submit" size="lg" disabled={busy}>{copy("احفظ المسودة الخاصة", "Save private draft")}</Button><Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => setStep(step + 1)}>{copy("الخطوة التالية", "Next step")}</Button></div>}
      </fieldset>
    </form>
    <fieldset disabled={controlsBlocked} className="min-w-0 space-y-[22px]">
    {step === 4 && <PublicationReadinessPanel role={owner.role} onDeny={clearPrivate} portfolioVersion={portfolio?.version}
      visibleAccountIds={creator ? visibleAccounts : undefined} refreshKey={draft?.revision} onGoToStep={setStep} />}
    {step === 4 && <Card><CardHeader><CardTitle>{steps[4]}</CardTitle><CardDescription>{copy("أنشئ ملفًا قابلًا للتعديل من بياناتك المحفوظة، ثم راجعه قبل المشاركة.", "Create an editable portfolio from your saved information, then review it before sharing.")}</CardDescription></CardHeader><CardContent className="space-y-5"><Button variant="outline" size="lg" disabled={busy} onClick={() => run(async () => { await command(draft ?? await initialize(), "PROFILE", "GENERATE_PORTFOLIO", {}); })}>{portfolio ? copy("أنشئ نسخة جديدة", "Create new version") : copy("جهّز مسودة الملف", "Prepare portfolio draft")}</Button>{portfolio && <><p>{copy("نسخة", "Version")} {portfolio.version} · {portfolio.approvedAt ? copy("معتمدة", "Approved") : copy("بانتظار مراجعتك", "Awaiting your review")}</p><h2 className="text-2xl font-semibold">{portfolio.content.title}</h2><label className="block space-y-2"><span>{copy("نبذة الملف", "Portfolio overview")}</span><Textarea aria-label={copy("نبذة الملف", "Portfolio overview")} rows={6} className="text-base" value={portfolioBio} maxLength={1000} disabled={!!portfolio.approvedAt} onChange={(event) => setPortfolioBio(event.target.value)} /></label><Button disabled={busy || !!portfolio.approvedAt} onClick={() => run(async () => { const content: PortfolioContent = { ...portfolio.content, bio: portfolioBio }; await command(draft!, "PROFILE", "APPROVE_PORTFOLIO", { portfolioVersion: portfolio.version, content }); })}>{copy("راجعته وأعتمد هذه النسخة", "I've reviewed and approve this version")}</Button>{creator && <fieldset className="space-y-2"><legend className="font-semibold">{copy("الحسابات التي توافق على إظهارها", "Accounts you consent to show")}</legend>{owner.accounts.map((account) => <label key={account.id} className="flex min-h-12 items-center gap-3"><input type="checkbox" className="size-5 shrink-0" disabled={account.ownershipStatus !== "VERIFIED"} checked={visibleAccounts.includes(account.id)} onChange={(event) => setVisibleAccounts(event.target.checked ? [...visibleAccounts, account.id] : visibleAccounts.filter((id) => id !== account.id))} /><span dir="ltr">{account.platform} @{account.handle}</span>{account.ownershipStatus !== "VERIFIED" && <span>{copy("بانتظار إثبات الملكية", "Awaiting ownership evidence")}</span>}</label>)}<p className="text-muted-foreground">{copy("إثبات الحساب الإضافي لا يجعله ظاهرًا تلقائيًا. اختر ما تريد مشاركته.", "Proving an extra account does not publish it automatically. Select what you want to share.")}</p></fieldset>}<label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="size-5 shrink-0" checked={publishConsent} onChange={(event) => setPublishConsent(event.target.checked)} />{copy("أوافق على نشر الأقسام الظاهرة للعموم بعد استيفاء الإثباتات المطلوبة", "I consent to publishing the visible sections after required evidence is accepted")}</label><div className="flex flex-wrap gap-3"><Button size="lg" disabled={busy || !portfolio.approvedAt || !publishConsent} onClick={() => run(async () => { await command(draft!, "PROFILE", "PUBLISH", { consent: publishConsent, portfolioVersion: portfolio.version, ...(creator ? { visibleAccountIds: visibleAccounts } : {}) }); const data = await readSnapshot(); setOwner(data.owner); setNotice(copy("تم نشر ملفك.", "Your profile is published.")); })}>{copy("انشر الملف", "Publish profile")}</Button><Button size="lg" variant="outline" disabled={busy} onClick={() => run(async () => { await command(draft!, "PROFILE", "HIDE", {}); const data = await readSnapshot(); setOwner(data.owner); setNotice(copy("تم إخفاء ملفك.", "Your profile is hidden.")); })}>{copy("أخفِ الملف", "Hide profile")}</Button>{owner.profile.state === "PUBLISHED" && <Button asChild variant="outline" size="lg"><Link href={creator ? `/@${owner.profile.handle}` : `/brands/${owner.profile.handle}`}>{copy("افتح الملف العام", "Open public profile")}</Link></Button>}</div></>}</CardContent></Card>}
    </fieldset>
  </section>;
}
