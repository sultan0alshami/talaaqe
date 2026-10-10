"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InfameBrandPattern } from "@/components/infame/brand-pattern";
import { campaignRequirementRows } from "@/components/infame/campaign-field-display";
import { countryLabel } from "@/lib/contracts/country-labels";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import { AdminBriefsSchema, type AdminBriefsDTO } from "@/lib/admin/briefs-contracts";
import { readCampaignAgentResponse } from "@/lib/campaign-agent/browser-transport";
import { useI18n } from "@/lib/i18n";
import styles from "./admin-catalog-layout.module.css";

type RequestPage = { after: string | null; previous: Array<string | null> };
type Snapshot = { data: AdminBriefsDTO; page: RequestPage; fresh: boolean };
type Flight = { generation: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };
const originalFields = new Set(["title", "productService", "summary", "tone", "noGoTopics", "usageRights", "kpis", "assumptions", "openQuestions"]);
function validPage(data: AdminBriefsDTO, page: RequestPage) {
  return data.briefs.length <= 30 && data.briefs.every((row, index) =>
    (!page.after || row.id > page.after) && (index === 0 || row.id > data.briefs[index - 1]!.id) &&
    row.requirements.campaignId === row.campaignId && row.requirements.version === row.version) &&
    (data.nextCursor === null || data.briefs.length > 0 && data.nextCursor === data.briefs[data.briefs.length - 1]!.id);
}

export function BriefsScreen({ initialBriefs, errorCode = null }: {
  initialBriefs: AdminBriefsDTO | null; errorCode?: string | null;
}) {
  const { lang, isAr, dir } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const componentId = useId();
  const [initial] = useState(() => {
    const denied = errorCode === "UNAUTHENTICATED" || errorCode === "FORBIDDEN";
    const page: RequestPage = { after: null, previous: [] }, parsed = AdminBriefsSchema.safeParse(initialBriefs);
    const snapshot: Snapshot | null = !denied && parsed.success && validPage(parsed.data, page) ? { data: parsed.data, page, fresh: true } : null;
    return { denied, snapshot, error: errorCode ?? (initialBriefs !== null && !snapshot ? "INVALID_RESPONSE" : null) };
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initial.snapshot), snapshotRef = useRef(initial.snapshot);
  const [error, setError] = useState<string | null>(initial.error), [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(initial.denied), deniedRef = useRef(initial.denied);
  const [retry, setRetry] = useState<RequestPage | null>(null), [open, setOpen] = useState<string | null>(null);
  const mounted = useRef(false), generation = useRef(0), active = useRef<Flight | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    const lifetime = { mounted, generation, active };
    return () => {
      lifetime.mounted.current = false; lifetime.generation.current++;
      const flight = lifetime.active.current;
      if (flight) { clearTimeout(flight.timer); flight.controller.abort(); }
      lifetime.active.current = null;
    };
  }, []);
  useEffect(() => { if (denied) heading.current?.focus(); }, [denied]);

  async function load(page: RequestPage) {
    if (!mounted.current || deniedRef.current || active.current) return;
    const controller = new AbortController(), own = ++generation.current;
    let timedOut = false;
    const flight: Flight = { generation: own, controller,
      timer: setTimeout(() => { timedOut = true; controller.abort(); }, 30000) };
    const captured: RequestPage = { after: page.after, previous: [...page.previous] };
    active.current = flight; setBusy(true); setError(null); setRetry(captured);
    if (snapshotRef.current) { const historical = { ...snapshotRef.current, fresh: false }; snapshotRef.current = historical; setSnapshot(historical); }
    const current = () => mounted.current && !deniedRef.current && generation.current === own && active.current === flight;
    try {
      const query = captured.after === null ? "" : "?" + new URLSearchParams({ after: captured.after }).toString();
      const response = await fetch("/api/admin/briefs" + query, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        deniedRef.current = true; generation.current++; controller.abort();
        snapshotRef.current = null; setSnapshot(null); setOpen(null); setRetry(null);
        setDenied(true); setError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
        return;
      }
      const envelope = await readCampaignAgentResponse(response, controller.signal, 2097152);
      if (!current() || controller.signal.aborted) return;
      if (!response.ok) { setError("UNAVAILABLE"); return; }
      const data = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : undefined;
      const parsed = AdminBriefsSchema.safeParse(data);
      if (!parsed.success || !validPage(parsed.data, captured) || snapshotRef.current && Date.parse(parsed.data.asOf) < Date.parse(snapshotRef.current.data.asOf)) {
        setError("INVALID_RESPONSE"); return;
      }
      const accepted: Snapshot = { data: parsed.data, page: captured, fresh: true };
      snapshotRef.current = accepted; setSnapshot(accepted); setOpen(null); setError(null); setRetry(null);
    } catch {
      if (current()) setError(timedOut ? "TIMEOUT" : controller.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
    } finally {
      clearTimeout(flight.timer);
      if (active.current === flight) { active.current = null; if (mounted.current) setBusy(false); }
    }
  }
  function utc(value: string) {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", { timeZone: "UTC", calendar: "gregory", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
  function explainError(code: string) {
    return code === "UNAUTHENTICATED" ? copy("انتهت الجلسة. سجّل الدخول وافتح الصفحة مجددًا.", "Your session ended. Sign in and reopen this page.") :
      code === "FORBIDDEN" ? copy("الموجزات غير متاحة لصلاحيتك الحالية.", "Briefs are unavailable for your current permissions.") :
      code === "TIMEOUT" ? copy("لم يصل الرد في الوقت المحدد. يمكنك إعادة القراءة نفسها.", "The response timed out. You can retry the same read.") :
      copy("تعذّر تأكيد الموجزات الحالية. احتفظنا بالنسخة السابقة إن وُجدت.", "Current briefs could not be confirmed. Any previous snapshot is retained.");
  }
  const data = snapshot?.data;
  return <section className={styles.page} dir={dir} data-admin-briefs>
    <header className={styles.header}><div className={styles.headerCopy}>
      <h1 ref={heading} tabIndex={-1}>{copy("موجزات الحملات", "Campaign briefs")}</h1>
      <p className={styles.timestamp}>{data ? <>{copy("وقت القراءة:", "Read at:")} <time dateTime={data.asOf}>{utc(data.asOf)}</time> <bdi>UTC</bdi></> : copy("وقت القراءة غير متاح", "Read time unavailable")}</p>
    </div><div className={styles.headerActions}><InfameBrandPattern compact />
      <Button type="button" variant="outline" disabled={busy || denied} onClick={() => void load(snapshot?.page ?? { after: null, previous: [] })} data-admin-briefs-refresh>
        <RefreshCw aria-hidden="true" />{busy ? copy("جارٍ التحميل…", "Loading…") : copy("تحديث الموجزات", "Refresh briefs")}
      </Button>
    </div></header>
    <p className={styles.note}>{copy("نسخ المتطلبات التاريخية المحفوظة في المسار السابق. تتطلب الحملات المُدارة صلاحية مستقلة. اعتماد نسخة محفوظة مستقل عن أهلية التعاون الحالية.", "Historical requirements saved in the earlier workflow. Managed campaigns require separate access. Stored approval is independent of current collaboration eligibility.")}</p>
    {error && <div className={styles.error} role="alert"><p>{explainError(error)}</p>
      {retry && !denied && <Button type="button" variant="outline" disabled={busy} onClick={() => void load(retry)}>{copy("أعد القراءة نفسها", "Retry the same read")}</Button>}
      {denied && <Button asChild variant="outline"><Link href="/login" prefetch={false}>{copy("تسجيل الدخول", "Sign in")}</Link></Button>}
    </div>}
    {snapshot && !snapshot.fresh && <p className={styles.notice} role="status">{copy("تعرض الصفحة نسخة سابقة؛ لم يتأكد تحديثها الحالي.", "This page shows a previous snapshot; its current refresh is unconfirmed.")}</p>}
    {busy && <p className={styles.notice} role="status">{copy("بانتظار الرد الفعلي…", "Waiting for the actual response…")}</p>}
    <div className={styles.briefTable} role="table" aria-colcount={6} aria-label={copy("نسخ موجزات الحملات", "Campaign brief versions")} aria-busy={busy}>
      <div className={`${styles.briefRow} ${styles.tableHeader}`} role="row">
        {[copy("الحملة والعلامة", "Campaign and brand"), copy("النسخة", "Version"), copy("وقت الإنشاء", "Created"), copy("الميزانية", "Budget"), copy("الاعتماد", "Approval"), copy("المتطلبات", "Requirements")].map(label => <span key={label} role="columnheader">{label}</span>)}
      </div>
      {!data && <div role="row"><div role="cell" aria-colspan={6}><p className={styles.empty}>{denied ? copy("المحتوى الخاص مغلق حتى تجديد الدخول.", "Private content is locked until authentication is renewed.") : copy("الموجزات غير متاحة حتى تُحمّل بيانات مسموحة.", "Briefs remain unavailable until an authorized snapshot loads.")}</p></div></div>}
      {data?.briefs.length === 0 && <div role="row"><div role="cell" aria-colspan={6}><p className={styles.empty}>{copy("لا توجد نسخ موجزات في هذه الصفحة ضمن النطاق المسموح.", "No brief versions exist on this page within the permitted scope.")}</p></div></div>}
      {data?.briefs.map((brief, index) => {
        const expanded = open === brief.id, panelId = componentId + "-brief-" + index, triggerId = panelId + "-trigger";
        return <Fragment key={brief.id}>
          <div className={styles.briefRow} role="row" data-admin-brief-id={brief.id}>
            <div role="cell" className={styles.identity} data-label={copy("الحملة والعلامة", "Campaign and brand")}><p className={styles.originalTitle} dir="auto" lang={brief.requirements.originalLanguage ?? undefined}>{brief.requirements.title}</p><p className={styles.brand} dir="auto">{brief.brandName || copy("اسم غير متاح", "Name unavailable")}</p></div>
            <div role="cell" className={styles.cell} data-label={copy("النسخة", "Version")}><bdi>{brief.version}</bdi><p className={styles.small}>{copy("مراجعة المدخلات", "Input revision")} <bdi>{brief.inputRevision}</bdi></p></div>
            <div role="cell" className={styles.cell} data-label={copy("وقت الإنشاء", "Created")}><time dateTime={brief.createdAt}>{utc(brief.createdAt)}</time><bdi> UTC</bdi></div>
            <div role="cell" className={styles.cell} data-label={copy("الميزانية", "Budget")}><bdi dir="ltr" className={styles.money}>{formatMoneyDecimal(brief.requirements.budget)} {brief.requirements.budget.currencyCode}</bdi></div>
            <div role="cell" className={styles.cell} data-label={copy("الاعتماد", "Approval")}><span className={styles.chip}>{brief.approvedAt ? copy("نسخة معتمدة", "Approved version") : copy("غير معتمدة", "Unapproved")}</span>{brief.approvedAt && <p className={styles.small}><time dateTime={brief.approvedAt}>{utc(brief.approvedAt)}</time><bdi> UTC</bdi></p>}</div>
            <div role="cell" className={styles.cell} data-label={copy("المتطلبات", "Requirements")}><Button id={triggerId} type="button" variant="outline" size="sm" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : brief.id)} data-admin-brief-expand>{expanded ? copy("إغلاق", "Close") : copy("عرض الموجز", "View brief")}</Button></div>
          </div>
          {expanded && <div role="row"><div role="cell" aria-colspan={6}><section id={panelId} role="region" aria-labelledby={triggerId} className={styles.briefDetail}>
            <h2>{copy("المتطلبات المحفوظة لهذه النسخة", "Saved requirements for this version")}</h2>
            <dl className={styles.requirements}>{campaignRequirementRows(brief.requirements, isAr).map(row => <div key={row.key} data-admin-brief-field={row.key}>
              <dt>{row.label}</dt><dd dir="auto" lang={originalFields.has(row.key) ? brief.requirements.originalLanguage ?? undefined : undefined}>{row.value}</dd>
            </div>)}
              <div data-admin-brief-field="brandCountryCode"><dt>{copy("بلد العلامة المحفوظ", "Saved brand country")}</dt><dd>{countryLabel(brief.requirements.brandCountryCode, lang)} <bdi>({brief.requirements.brandCountryCode})</bdi></dd></div>
              <div data-admin-brief-field="mandatoryPolicyVersionIds"><dt>{copy("نسخ السياسات الإلزامية المحفوظة", "Saved mandatory policy versions")}</dt><dd>{brief.requirements.mandatoryPolicyVersionIds.length ? <ul>{brief.requirements.mandatoryPolicyVersionIds.map(id => <li key={id}><bdi dir="ltr">{id}</bdi></li>)}</ul> : copy("لا توجد نسخ إلزامية محفوظة", "No mandatory versions stored")}</dd></div>
            </dl>
            <p className={styles.note}>{copy("الأوقات الأصلية المحفوظة:", "Original stored instants:")} <time dateTime={brief.requirements.period.startsAt}><bdi>{brief.requirements.period.startsAt}</bdi></time> · <time dateTime={brief.requirements.period.endsAt}><bdi>{brief.requirements.period.endsAt}</bdi></time></p>
          </section></div></div>}
        </Fragment>;
      })}
    </div>
    <nav className={styles.pagination} aria-label={copy("صفحات الموجزات", "Brief pages")}>
      <p>{data ? copy("عدد النسخ في الصفحة:", "Versions on this page:") + " " + new Intl.NumberFormat(lang).format(data.briefs.length) : copy("عدد النسخ غير متاح", "Version count unavailable")}</p>
      <Button type="button" variant="outline" disabled={busy || denied || !snapshot?.fresh || !snapshot.page.previous.length} onClick={() => {
        if (!snapshot || !snapshot.page.previous.length) return;
        void load({ after: snapshot.page.previous[snapshot.page.previous.length - 1]!, previous: snapshot.page.previous.slice(0, -1) });
      }}>{copy("الصفحة السابقة", "Previous page")}</Button>
      <Button type="button" variant="outline" disabled={busy || denied || !snapshot?.fresh || !data?.nextCursor} onClick={() => {
        if (snapshot && data?.nextCursor) void load({ after: data.nextCursor, previous: [...snapshot.page.previous, snapshot.page.after] });
      }}>{copy("الصفحة التالية", "Next page")}</Button>
    </nav>
  </section>;
}
