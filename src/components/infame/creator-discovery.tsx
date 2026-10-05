"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiscoveryPageSchema, DiscoveryQuerySchema, type DiscoveryPage, type DiscoveryQuery } from "@/lib/discovery/contracts";
import type { DiscoveryCountryOptions } from "@/lib/discovery/presentation";
import type { PublicDiscoveryCreator } from "@/lib/discovery/contracts";
import type { CollectionScope } from "@/lib/collections/contracts";
import type { ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { CollectionSaveDialog } from "./collection-save";
import { useI18n } from "@/lib/i18n";
import { CreatorDiscoveryCard } from "./creator-discovery-card";
import styles from "./creator-discovery.module.css";

type CapturedRead = { query: DiscoveryQuery; cursor: string | null; history: (string | null)[] };
const defaults = DiscoveryQuerySchema.parse({});
export function CreatorDiscoveryScreen({ initialPage, initialError = null, countryOptions, collectionScope = null, planAuthority = null }: {
  initialPage: DiscoveryPage | null; initialError?: string | null; countryOptions: DiscoveryCountryOptions;
  collectionScope?: CollectionScope | null; planAuthority?: ClientAuthorityDTO | null;
}) {
  const { lang, isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const initialDenied = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(initialError ?? "");
  const [page, setPage] = useState(initialDenied ? null : initialPage), [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false), [denied, setDenied] = useState(initialDenied);
  const [savingCreator, setSavingCreator] = useState<PublicDiscoveryCreator | null>(null);
  const saveOpener = useRef<HTMLButtonElement | null>(null), heading = useRef<HTMLHeadingElement | null>(null);
  const [draft, setDraft] = useState({ q: "", residenceCountryCode: "", platform: "", reachBand: "", limit: "12" });
  const [applied, setApplied] = useState(defaults), [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const flight = useRef(false), controller = useRef<AbortController | null>(null);
  const retry = useRef<CapturedRead | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; flight.current = false; }, []);
  async function load(captured: CapturedRead) {
    if (flight.current || denied) return;
    flight.current = true; setBusy(true); setError(null);
    retry.current = captured;
    const abort = new AbortController(); controller.current = abort;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 30_000);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(captured.query)) if (key !== "cursor" && value !== undefined && value !== "") params.set(key, String(value));
      if (captured.cursor) params.set("cursor", captured.cursor);
      const response = await fetch("/api/discovery/creators?" + params, { cache: "no-store", signal: abort.signal });
      // Denial clears the old snapshot before potentially malformed JSON.
      if ([401, 403, 404].includes(response.status)) {
        setPage(null); setHistory([]); setCursor(null); setDenied(true); retry.current = null;
        setSavingCreator(null);
        setError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"); return;
      }
      if (!response.ok) throw new Error(response.status === 503 ? "RETRY_REQUIRED" : "REQUEST_FAILED");
      const body: unknown = await response.json();
      const parsed = DiscoveryPageSchema.safeParse(body && typeof body === "object" && "data" in body ? body.data : null);
      if (!parsed.success) throw new Error("INVALID_RESPONSE");
      if (abort.signal.aborted) return;
      setPage(parsed.data); setApplied(captured.query); setCursor(captured.cursor); setHistory(captured.history);
      retry.current = null;
    } catch (failure) {
      if (timedOut) setError("TIMEOUT");
      else if (controller.current === abort && abort.signal.aborted) setError("CANCELLED");
      else if (!abort.signal.aborted) setError(failure instanceof Error && ["RETRY_REQUIRED", "INVALID_RESPONSE", "REQUEST_FAILED"].includes(failure.message) ? failure.message : "NETWORK");
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) { controller.current = null; flight.current = false; setBusy(false); }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (flight.current || denied) return;
    const result = DiscoveryQuerySchema.safeParse({
      q: draft.q, limit: draft.limit,
      ...(draft.residenceCountryCode ? { residenceCountryCode: draft.residenceCountryCode } : {}),
      ...(draft.platform ? { platform: draft.platform } : {}),
      ...(draft.reachBand ? { reachBand: draft.reachBand } : {}),
    });
    if (!result.success) { setError("VALIDATION"); return; }
    void load({ query: result.data, cursor: null, history: [] });
  }
  const countries = countryOptions[lang];
  const countryNames = Object.fromEntries(countries.map(country => [country.code, country.name]));
  const dirty = draft.q.trim() !== applied.q || draft.residenceCountryCode !== (applied.residenceCountryCode ?? "")
    || draft.platform !== (applied.platform ?? "") || draft.reachBand !== (applied.reachBand ?? "") || Number(draft.limit) !== applied.limit;
  const platforms = { INSTAGRAM: copy("إنستغرام", "Instagram"), TIKTOK: copy("تيك توك", "TikTok"),
    YOUTUBE: copy("يوتيوب", "YouTube"), SNAPCHAT: copy("سناب شات", "Snapchat"), X: copy("إكس", "X") };
  const bands = [["NANO", copy("نانو · 1,000 إلى أقل من 10,000", "Nano · 1,000–<10,000")],
    ["MICRO", copy("مايكرو · 10,000 إلى أقل من 100,000", "Micro · 10,000–<100,000")],
    ["MID", copy("متوسط · 100,000 إلى أقل من 500,000", "Mid · 100,000–<500,000")],
    ["MACRO", copy("ماكرو · 500,000 إلى أقل من 1,000,000", "Macro · 500,000–<1,000,000")],
    ["MEGA", copy("ميغا · 1,000,000 فأكثر", "Mega · ≥1,000,000")]];
  const errorText = error === "UNAUTHENTICATED"
    ? copy("سجّل الدخول مجددًا لمتابعة الاستكشاف.", "Sign in again to continue browsing.")
    : denied ? copy("الاستكشاف غير متاح لهذا الحساب.", "Browsing is unavailable for this account.")
    : error === "VALIDATION" ? copy("راجع خيارات البحث.", "Review your search options.")
    : error === "CANCELLED" ? copy("أُلغي التحميل. النتائج السابقة باقية.", "Loading cancelled. Previous results are retained.")
    : error === "TIMEOUT" ? copy("استغرق التحميل وقتًا طويلًا. يمكنك إعادة المحاولة.", "Loading timed out. You can retry.")
    : copy("تعذر تحميل النتائج. يمكنك إعادة المحاولة.", "Results could not be loaded. You can retry.");
  return <section className={styles.page} aria-labelledby="creator-discovery-heading" aria-busy={busy}>
    <header className={styles.header}>
      <div>
        <h1 id="creator-discovery-heading" className={styles.title} ref={heading} tabIndex={-1}>{copy("استكشف صنّاع المحتوى", "Explore creators")}</h1>
        <p className={styles.subtitle}>{copy("ملفات عامة بإذن أصحابها، ومعلومات بتاريخ ومصدر واضحين.", "Public profiles shared with permission, with dated and sourced information.")}</p>
      </div>
      <Button variant="outline" disabled={busy || denied} onClick={() => void load({ query: applied, cursor, history })}>{copy("تحديث النتائج", "Refresh results")}</Button>
    </header>
    <div className={styles.basis}>
      <form onSubmit={submit}>
        <fieldset disabled={busy || denied} className={styles.filters}>
          <div className={styles.filterField}><label htmlFor="discovery-search">{copy("الاسم أو اسم المستخدم", "Name or handle")}</label>
            <Input id="discovery-search" maxLength={120} value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} /></div>
          <div className={styles.filterField}><label htmlFor="discovery-residence">{copy("بلد الإقامة", "Country of residence")}</label>
            <select id="discovery-residence" value={draft.residenceCountryCode} onChange={event => setDraft({ ...draft, residenceCountryCode: event.target.value })}>
              <option value="">{copy("كل البلدان", "All countries")}</option>{countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select></div>
          <div className={styles.filterField}><label htmlFor="discovery-platform">{copy("المنصة", "Platform")}</label>
            <select id="discovery-platform" value={draft.platform} onChange={event => setDraft({ ...draft, platform: event.target.value })}>
              <option value="">{copy("كل المنصات", "All platforms")}</option>
              {Object.entries(platforms).map(([platform, label]) => <option key={platform} value={platform}>{label}</option>)}
            </select></div>
          <div className={styles.filterField}><label htmlFor="discovery-reach">{copy("فئة المتابعين لكل حساب", "Per-account follower band")}</label>
            <select id="discovery-reach" value={draft.reachBand} onChange={event => setDraft({ ...draft, reachBand: event.target.value })}>
              <option value="">{copy("كل الملفات", "All profiles")}</option>
              {bands.map(([band, label]) => <option key={band} value={band}>{label}</option>)}
            </select></div>
          <div className={styles.filterField}><label htmlFor="discovery-size">{copy("عدد الملفات في خطوة البحث", "Profiles per search step")}</label>
            <select id="discovery-size" value={draft.limit} onChange={event => setDraft({ ...draft, limit: event.target.value })}><option value="6">6</option><option value="12">12</option></select></div>
          <div className={styles.filterActions}><Button type="submit">{copy("بحث", "Search")}</Button></div>
        </fieldset>
      </form>
    </div>
    <div className={styles.results}>
    <p className={styles.appliedFilter}>{copy("خيارات النتائج المعروضة:", "Filters for displayed results:")} {[
      applied.q || copy("كل الأسماء", "All names"),
      applied.residenceCountryCode ? countryNames[applied.residenceCountryCode] : copy("كل البلدان", "All countries"),
      applied.platform ? platforms[applied.platform] : copy("كل المنصات", "All platforms"),
      applied.reachBand ? bands.find(([band]) => band === applied.reachBand)?.[1] : copy("كل الملفات", "All profiles"),
    ].join(" · ")}</p>
    {dirty && <p className={styles.status}>{copy("الخيارات المعدلة لم تُطبّق بعد. اضغط بحث لعرض نتائجها؛ التحديث والتنقل يستخدمان خيارات النتائج المعروضة.", "Changed filters are not applied yet. Search to apply them; refresh and pagination use the displayed filters.")}</p>}
    <p role="status" aria-live="polite" aria-atomic="true" className={styles.snapshot}>{busy
      ? copy("جارٍ تحميل الملفات العامة…", "Loading public profiles…")
      : !error && page ? page.creators.length ? copy(`تم تحديث النتائج: ${page.creators.length} ملفًا عامًا في هذه النتائج.`, `Results updated: ${page.creators.length} public profiles in this result page.`)
        : copy("لا توجد ملفات عامة مطابقة في هذه النتائج.", "No matching public profiles in this result page.") : ""}</p>
    {busy && <Button variant="outline" onClick={() => controller.current?.abort()}>{copy("إلغاء التحميل", "Cancel loading")}</Button>}
    {error && <div className={styles.status} role="alert"><p>{errorText}</p>
      {denied ? <Button asChild><Link href="/login">{copy("تسجيل الدخول", "Sign in")}</Link></Button>
        : <><p className={styles.appliedFilter}>{copy("إعادة المحاولة تستخدم نفس طلب البحث الذي تعذر تحميله. لتطبيق خيارات جديدة اضغط بحث.", "Retry repeats the failed search request. Search applies your new filters.")}</p>
          <Button variant="outline" disabled={busy} onClick={() => void load(retry.current ?? { query: applied, cursor, history })}>{copy("إعادة المحاولة", "Retry")}</Button></>}
    </div>}
    {page && <>
      <p className={styles.snapshot}>{error || busy || dirty ? copy("آخر نتائج ناجحة:", "Last successful results:") : copy("تاريخ النتائج:", "Results as of:")} <time dateTime={page.asOf}>{new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(page.asOf))}</time> <bdi dir="ltr">UTC</bdi></p>
      {page.creators.length ? <ul className={styles.list}>{page.creators.map(creator => <li key={creator.id}><CreatorDiscoveryCard creator={creator} lang={lang} countryNames={countryNames}
        actions={collectionScope && <Button variant="outline" disabled={busy || denied || savingCreator !== null || collectionScope.kind === "CLIENT" && planAuthority === null}
          onClick={event => { saveOpener.current = event.currentTarget; setSavingCreator(creator); }}>{copy("حفظ في قائمة", "Save to collection")}</Button>} /></li>)}</ul>
        : <p className={styles.status}>{copy("لا توجد ملفات عامة مطابقة في هذه النتائج. جرّب خيارات أخرى أو تابع للنتائج التالية إن كانت متاحة.", "No matching public profiles in this result page. Try other filters or continue to the next results when available.")}</p>}
      <nav className={styles.pagination} aria-label={copy("خطوات نتائج البحث", "Search result steps")}>
        <Button variant="outline" disabled={busy || denied || !!error || !history.length} onClick={() => void load({ query: applied, cursor: history[history.length - 1], history: history.slice(0, -1) })}>{copy("السابق", "Previous")}</Button>
        <Button variant="outline" disabled={busy || denied || !!error || !page.nextCursor} onClick={() => void load({ query: applied, cursor: page.nextCursor, history: [...history, cursor] })}>{copy("التالي", "Next")}</Button>
      </nav>
    </>}
    </div>
    {collectionScope && <CollectionSaveDialog scope={collectionScope} planAuthority={planAuthority} creator={savingCreator}
      onRestoreFocus={() => { const target = saveOpener.current?.isConnected ? saveOpener.current : heading.current; target?.focus(); }}
      onClose={() => setSavingCreator(null)} onDenied={() => { setSavingCreator(null); setPage(null); setHistory([]); setCursor(null); setDenied(true); retry.current = null; setError("FORBIDDEN"); }} />}
  </section>;
}
