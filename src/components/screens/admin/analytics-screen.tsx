"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfameBrandPattern } from "@/components/infame/brand-pattern";
import { AdminAnalyticsSchema, type AdminAnalyticsDTO } from "@/lib/admin/analytics-contracts";
import { readCampaignAgentResponse } from "@/lib/campaign-agent/browser-transport";
import styles from "./analytics-layout.module.css";

type Copy = (ar: string, en: string) => string;
type CountKey = keyof AdminAnalyticsDTO["counts"];
const labels: Record<CountKey, [string, string]> = {
  campaigns: ["الحملات المحفوظة", "Stored campaigns"],
  deals: ["الصفقات المحفوظة", "Stored deals"],
  completedDeals: ["صفقات بحالة مكتملة", "Deals marked completed"],
  briefVersions: ["نسخ موجز الحملة", "Campaign brief versions"],
  matchRuns: ["عمليات الترشيح المحفوظة", "Stored matching runs"],
  recommendationRows: ["سجلات الترشيحات", "Recommendation records"],
};
const statuses: Record<AdminAnalyticsDTO["campaignStatuses"][number]["status"], [string, string]> = {
  DRAFT: ["مسودة", "Draft"], BRIEF_GENERATED: ["موجز مجهّز", "Brief generated"],
  BRIEF_APPROVED: ["موجز معتمد", "Brief approved"], SHORTLISTED: ["قائمة مرشحين", "Shortlisted"],
  IN_DEALS: ["في صفقات", "In deals"], COMPLETED: ["مكتملة", "Completed"], CANCELLED: ["ملغاة", "Cancelled"],
};
const unavailableLabels: Record<AdminAnalyticsDTO["unavailableMetrics"][number], [string, string]> = {
  REVENUE: ["الإيرادات", "Revenue"], SUBSCRIPTIONS: ["الاشتراكات", "Subscriptions"],
  GROWTH: ["النمو", "Growth"], MATCH_LATENCY: ["زمن الترشيح", "Matching latency"],
  ACCEPTANCE_RATE: ["معدل القبول", "Acceptance rate"],
};
const top: CountKey[] = ["campaigns", "deals", "completedDeals"];
const lower: CountKey[] = ["briefVersions", "matchRuns", "recommendationRows"];
function copyError(code: string | null, copy: Copy) {
  if (code === "UNAUTHENTICATED") return copy("انتهت الجلسة. سجّل الدخول من جديد لعرض البيانات.", "Your session ended. Sign in again to view the data.");
  if (code === "FORBIDDEN") return copy("بيانات الإدارة غير متاحة لصلاحيتك الحالية.", "Admin data is unavailable for your current permissions.");
  if (code === "TIMEOUT") return copy("لم يصل الرد في الوقت المحدد. أعد المحاولة.", "The response did not arrive in time. Try again.");
  return copy("تعذّر تأكيد البيانات الحالية. يمكنك إعادة المحاولة.", "Current data could not be confirmed. You can try again.");
}

export function AnalyticsScreen({ initialAnalytics, errorCode = null }: {
  initialAnalytics: AdminAnalyticsDTO | null; errorCode?: string | null;
}) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [initial] = useState(() => {
    const parsed = AdminAnalyticsSchema.safeParse(initialAnalytics), denied = errorCode === "UNAUTHENTICATED" || errorCode === "FORBIDDEN";
    return { snapshot: !denied && parsed.success ? parsed.data : null, denied,
      error: errorCode ?? (initialAnalytics !== null && !parsed.success ? "INVALID_RESPONSE" : null) };
  });
  const [snapshot, setSnapshot] = useState<AdminAnalyticsDTO | null>(initial.snapshot), snapshotRef = useRef(initial.snapshot);
  const [error, setError] = useState<string | null>(initial.error), [busy, setBusy] = useState(false), [stale, setStale] = useState(false);
  const [privateDenied, setPrivateDenied] = useState(initial.denied), deniedRef = useRef(initial.denied);
  const mounted = useRef(false), generation = useRef(0), active = useRef<AbortController | null>(null), heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    const lifetime = { mounted, generation, active };
    return () => { lifetime.mounted.current = false; lifetime.generation.current++; lifetime.active.current?.abort(); };
  }, []);
  async function refresh() {
    if (!mounted.current || deniedRef.current || active.current) return;
    const controller = new AbortController(), own = ++generation.current;
    active.current = controller; setBusy(true); setError(null); setStale(snapshotRef.current !== null);
    let timedOut = false;
    const current = () => mounted.current && !deniedRef.current && own === generation.current && active.current === controller;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
      const response = await fetch("/api/admin/analytics", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        // Authoritative status clears every private count and timestamp BEFORE
        // consuming any body. Generation prevents later callbacks restoring it.
        deniedRef.current = true; setPrivateDenied(true); generation.current++; controller.abort();
        snapshotRef.current = null; setSnapshot(null); setStale(false);
        setError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"); heading.current?.focus();
        return;
      }
      const envelope = await readCampaignAgentResponse(response, controller.signal, 16384);
      if (!current() || controller.signal.aborted) return;
      if (!response.ok) { setError("UNAVAILABLE"); return; }
      const data = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : undefined;
      const parsed = AdminAnalyticsSchema.safeParse(data);
      if (!parsed.success || snapshotRef.current && Date.parse(parsed.data.asOf) < Date.parse(snapshotRef.current.asOf)) {
        setError("INVALID_RESPONSE"); return;
      }
      snapshotRef.current = parsed.data; setSnapshot(parsed.data); setStale(false); setError(null);
    } catch {
      if (current()) setError(timedOut ? "TIMEOUT" : controller.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false); }
    }
  }
  const count = (value: number) => new Intl.NumberFormat(isAr ? "ar-SA" : "en-US").format(value);
  function utc(instant: string, dateOnly = false) {
    return new Intl.DateTimeFormat(isAr ? "ar-SA" : "en-GB", { timeZone: "UTC", calendar: "gregory",
      year: "numeric", month: "short", day: "numeric", ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }) }).format(new Date(instant));
  }
  const maxStatus = Math.max(1, ...(snapshot?.campaignStatuses.map(row => row.count) ?? []));
  const maxDay = Math.max(1, ...(snapshot?.campaignDays.map(row => row.count) ?? []));
  function metric(key: CountKey, accent = false) {
    return <Card key={key} className={`${styles.metric} ${accent ? styles.accent : ""}`}><CardContent className={styles.metricContent}>
      <dl><dt>{labels[key][isAr ? 0 : 1]}</dt><dd data-analytics-count={key}>{snapshot ? count(snapshot.counts[key]) : <span aria-label={copy("غير متاح", "Unavailable")}>—</span>}</dd></dl>
      {key === "completedDeals" && <p className={styles.metricNote}>{copy("حالة محفوظة، وليست إثبات دفع أو نتائج.", "A saved status, not payment or results verification.")}</p>}
      {key === "recommendationRows" && <p className={styles.metricNote}>{copy("سجلات عبر عمليات الترشيح؛ ليست عدد أشخاص فريدًا.", "Records across matching runs; not a count of unique people.")}</p>}
    </CardContent></Card>;
  }
  return <section className={styles.page} dir={isAr ? "rtl" : "ltr"} aria-busy={busy} data-admin-analytics>
    <header className={styles.header}><div className={styles.headerCopy}>
      <h1 ref={heading} tabIndex={-1}>{copy("تحليلات السجلات", "Stored record analytics")}</h1>
      <p className={styles.timestamp}>{snapshot ? <>{copy("وقت البيانات (UTC):", "Data as of (UTC):")} <time dateTime={snapshot.asOf} dir="ltr">{utc(snapshot.asOf)}</time></>
        : copy("لم تُحمّل نسخة من البيانات بعد.", "No data snapshot has been loaded.")}</p>
    </div><div className={styles.actions}><InfameBrandPattern compact className={styles.pattern} />
      <Button type="button" variant="outline" disabled={busy || privateDenied} onClick={() => void refresh()}>{busy ? copy("جارٍ تحميل البيانات…", "Loading data…") : error ? copy("إعادة المحاولة", "Retry") : copy("تحديث البيانات", "Reload data")}</Button>
    </div></header>
    <p className={styles.scope}>{copy("تصف الأعداد السجلات المحفوظة في المسار السابق، بما فيها الخاصة والمسودات والاختبار والموقوفة. تتطلب طلبات إنفيم المُدارة صلاحية منفصلة.", "Counts describe saved earlier-workflow records, including private, draft, test and suspended records. Managed Infame requests require separate access.")}</p>
    {error && <div role="alert" className={styles.error}><p>{copyError(error, copy)}</p></div>}
    {privateDenied && <p className={styles.notice}>{copy("جدّد الدخول وافتح الصفحة مجددًا لعرض البيانات.", "Renew your session and reopen this page to view data.")}</p>}
    {stale && snapshot && <p className={styles.notice} role="status">{copy("تظهر آخر نسخة صالحة؛ لم يُؤكَّد تحديثها الحالي.", "The last valid snapshot is shown; its current refresh is unconfirmed.")}</p>}
    {busy && <p className={styles.notice} role="status">{copy("جارٍ انتظار الرد الفعلي…", "Waiting for the actual response…")}</p>}
    <div className={styles.metrics} aria-label={copy("أعداد السجلات", "Record counts")}>{top.map((key, index) => metric(key, index === 0))}</div>
    <div className={styles.charts}>
      <Card className={styles.panel}><CardHeader className={styles.panelHeader}><CardTitle><h2>{copy("حالات الحملات المحفوظة", "Stored campaign statuses")}</h2></CardTitle></CardHeader>
        <CardContent className={styles.panelContent}>{snapshot ? <ol className={styles.statusList}>{snapshot.campaignStatuses.map(row => <li key={row.status} data-analytics-status={row.status}>
          <div className={styles.statusLabel}><span>{statuses[row.status][isAr ? 0 : 1]}</span><span>{count(row.count)}</span></div>
          <div className={styles.track} aria-hidden="true"><div className={styles.fill} style={{ inlineSize: `${row.count / maxStatus * 100}%` }} /></div>
        </li>)}</ol> : <p className={styles.empty}>{copy("أعداد الحالات غير متاحة حتى تُحمّل البيانات.", "Status counts remain unavailable until data loads.")}</p>}
        {snapshot?.counts.campaigns === 0 && <p className={styles.empty}>{copy("لا توجد حملات محفوظة ضمن هذا النطاق.", "No stored campaigns exist in this scope.")}</p>}
      </CardContent></Card>
      <Card className={styles.panel}><CardHeader className={styles.panelHeader}><CardTitle><h2>{copy("الحملات المنشأة خلال آخر ٧ أيام (UTC)", "Campaigns created over the last 7 days (UTC)")}</h2></CardTitle></CardHeader>
        <CardContent className={styles.panelContent}>{snapshot ? <>
          <p className={styles.window}>{utc(snapshot.window.startsAt, true)} — {utc(snapshot.window.endsAt, true)}<br />{copy("اليوم الحالي حتى وقت البيانات فقط.", "The current day includes records only up to the snapshot time.")}</p>
          <ol className={styles.days}>{snapshot.campaignDays.map(row => <li key={row.date} data-analytics-day={row.date}>
            <span className={styles.dayCount}>{count(row.count)}</span><div className={styles.dayTrack} aria-hidden="true"><div className={styles.dayFill} style={{ blockSize: `${row.count / maxDay * 100}%` }} /></div>
            <time dateTime={row.date}>{new Intl.DateTimeFormat(isAr ? "ar-SA" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(row.date + "T00:00:00.000Z"))}<br />
              {new Intl.DateTimeFormat(isAr ? "ar-SA" : "en-GB", { day: "numeric", month: "numeric", calendar: "gregory", timeZone: "UTC" }).format(new Date(row.date + "T00:00:00.000Z"))}</time>
          </li>)}</ol>
          {snapshot.campaignDays.every(row => row.count === 0) && <p className={styles.empty}>{copy("لم تُنشأ حملات ضمن هذه الفترة.", "No campaigns were created in this period.")}</p>}
        </> : <p className={styles.empty}>{copy("أعداد الأيام غير متاحة حتى تُحمّل البيانات.", "Daily counts remain unavailable until data loads.")}</p>}</CardContent>
      </Card>
    </div>
    <div className={styles.metrics} aria-label={copy("الموجزات والترشيحات", "Briefs and matching records")}>{lower.map(key => metric(key))}</div>
    <section className={styles.unavailable} aria-label={copy("مقاييس غير متاحة", "Unavailable metrics")}><h2>{copy("مقاييس غير متاحة", "Unavailable metrics")}</h2>
      <p>{copy("لا تُعرض أرقام للإيرادات أو أداء التشغيل دون بيانات مؤكدة.", "Revenue and operational-performance figures are shown only when supported by verified data.")}</p>
      <ul>{(snapshot?.unavailableMetrics ?? ["REVENUE", "SUBSCRIPTIONS", "GROWTH", "MATCH_LATENCY", "ACCEPTANCE_RATE"] as const).map(key => <li key={key}>
        {unavailableLabels[key][isAr ? 0 : 1]}: {copy("غير متاح", "Unavailable")}</li>)}</ul>
    </section>
  </section>;
}
