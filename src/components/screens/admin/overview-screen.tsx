"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AdminOverviewSchema, type AdminOverviewDTO } from "@/lib/admin/contracts";
import { useI18n } from "@/lib/i18n";
import styles from "./overview-layout.module.css";

type EvidenceKind = AdminOverviewDTO["pending"][number]["kind"];

const kindLabels: Record<EvidenceKind, [string, string]> = {
  OWNERSHIP: ["ملكية الحساب", "Account ownership"],
  SCREENSHOT: ["لقطة الإحصاءات", "Metrics screenshot"],
  ADVERTISING_LICENCE: ["ترخيص الإعلان", "Advertising licence"],
  REPRESENTATIVE: ["التفويض التمثيلي", "Representative authority"],
  BUSINESS_REGISTRATION: ["التسجيل التجاري", "Business registration"],
};

function readError(code: string, isAr: boolean) {
  if (code === "UNAUTHENTICATED") return isAr ? "انتهت الجلسة. سجّل دخولك لتحميل بيانات الإدارة." : "Your session ended. Sign in to load admin data.";
  if (code === "FORBIDDEN") return isAr ? "بيانات الإدارة غير متاحة لصلاحيتك الحالية." : "Admin data is unavailable for your current permissions.";
  if (code === "INVALID_RESPONSE") return isAr ? "تعذر قراءة بيانات النظرة العامة. أعد تحميلها." : "The overview response could not be read. Reload it.";
  return isAr ? "تعذر تحميل النظرة العامة. أعد المحاولة." : "The overview could not be loaded. Try again.";
}

function responseError(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = body.error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : null;
}

export function OverviewScreen({ initialOverview, errorCode = null }: {
  initialOverview: AdminOverviewDTO | null;
  errorCode?: string | null;
}) {
  const { isAr } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const [overview, setOverview] = useState(initialOverview);
  const [error, setError] = useState(errorCode);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const formatCount = (value: number) => new Intl.NumberFormat("en-US").format(value);

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setOverview(null);
        setError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
        return;
      }
      let body: unknown;
      try { body = await response.json(); }
      catch { setError("INVALID_RESPONSE"); return; }
      if (!response.ok) {
        setError(responseError(body) ?? (response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : "UNAVAILABLE"));
        return;
      }
      const parsed = AdminOverviewSchema.safeParse(body && typeof body === "object" && "data" in body ? body.data : undefined);
      if (!parsed.success) { setError("INVALID_RESPONSE"); return; }
      setOverview(parsed.data);
      setError(null);
    } catch { setError("NETWORK"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const stats1 = overview ? [
    { key: "users", label: copy("المستخدمون", "Users"), value: overview.counts.users },
    { key: "brandAccounts", label: copy("حسابات العلامات التجارية", "Brand accounts"), value: overview.counts.brandAccounts },
    { key: "creatorAccounts", label: copy("حسابات صناع المحتوى", "Creator accounts"), value: overview.counts.creatorAccounts },
    { key: "campaigns", label: copy("الحملات", "Campaigns"), value: overview.counts.campaigns },
  ] : [];
  const stats2 = overview ? [
    { key: "weeklyCampaigns", label: copy("حملات آخر ٧ أيام", "Campaigns created in the last 7 days"), value: overview.counts.weeklyCampaigns },
    { key: "briefVersions", label: copy("نسخ موجز الحملة", "Brief versions"), value: overview.counts.briefVersions },
    { key: "pendingEvidence", label: copy("سجلات الإثبات المعلقة", "Pending evidence records"), value: overview.counts.pendingEvidence },
    { key: "deals", label: copy("الصفقات", "Deals"), value: overview.counts.deals },
  ] : [];
  const maxPending = overview ? Math.max(...overview.pending.map(row => row.count), 1) : 1;

  return (
    <div className={styles.page} aria-busy={busy}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1>{copy("نظرة عامة للإدارة", "Admin overview")}</h1>
          <p className={styles.timestamp}>
            {overview ? <>{copy("وقت البيانات (UTC):", "Data as of (UTC):")} <time dateTime={overview.asOf} dir="ltr">{overview.asOf}</time></> : copy("لم تُحمّل نسخة من البيانات بعد.", "No data snapshot has been loaded.")}
          </p>
        </div>
        <button type="button" className={styles.action} disabled={busy} onClick={() => void reload()}>
          {busy ? copy("جارٍ تحميل البيانات…", "Loading data…") : error ? copy("إعادة المحاولة", "Retry") : copy("تحديث البيانات", "Reload data")}
        </button>
      </header>

      <p className={styles.scope}>
        {copy("تشمل الأعداد جميع السجلات المحفوظة، بما فيها الخاصة والمسودات والاختبار والموقوفة. لا تدل على النشر أو الأهلية أو الاعتماد الحالي أو نتائج تشغيل فعلية.", "Counts include all saved records, including private, draft, test and suspended records. They do not indicate publication, eligibility, current verification or live traction.")}
      </p>

      {error && <div role="alert" className={styles.error}>
        <p>{readError(error, isAr)}</p>
        {overview && <p>{copy("تُعرض آخر نسخة محمّلة ووقتها؛ لم تنجح محاولة التحديث.", "The last loaded snapshot and its timestamp remain displayed; the reload did not succeed.")}</p>}
        {error === "UNAUTHENTICATED" && <Link href="/login" className={styles.textLink}>{copy("تسجيل الدخول", "Sign in")}</Link>}
      </div>}

      {!overview ? <div className={styles.panel}>
        <h2>{copy("البيانات غير متاحة", "Data unavailable")}</h2>
        <p className={styles.note}>{copy("حمّل بيانات الإدارة لعرض الأعداد وسجلات الإثبات. لا تتوفر أعداد محفوظة للعرض الآن.", "Load admin data to view counts and evidence records. No saved counts are available to display yet.")}</p>
      </div> : <>
        <dl className={styles.stats}>
          {stats1.map(stat => <div key={stat.key} className={styles.stat} data-admin-stat={stat.key}>
            <dt>{stat.label}</dt>
            <dd><bdi dir="ltr">{formatCount(stat.value)}</bdi><span className={styles.statNote}>{copy("سجلات محفوظة", "Saved records")}</span></dd>
          </div>)}
        </dl>
        <dl className={`${styles.stats} ${styles.secondStats}`}>
          {stats2.map((stat, index) => <div key={stat.key} className={`${styles.stat} ${index ? styles.statMuted : ""}`} data-admin-stat={stat.key}>
            <dt>{stat.label}</dt>
            <dd><bdi dir="ltr">{formatCount(stat.value)}</bdi></dd>
          </div>)}
        </dl>

        <div className={styles.body}>
          <section className={styles.panel} aria-labelledby="admin-pending-heading">
            <h2 id="admin-pending-heading">{copy("سجلات الإثبات المعلقة حسب النوع", "Pending evidence records by kind")}</h2>
            <div className={styles.chart}>
              {overview.pending.map(row => {
                const label = kindLabels[row.kind][isAr ? 0 : 1];
                return <div key={row.kind} className={styles.chartRow} data-evidence-kind={row.kind}>
                  <div className={styles.chartLabel}><span>{label}</span><bdi dir="ltr">{formatCount(row.count)}</bdi></div>
                  <meter className={styles.bar} min={0} value={row.count} max={maxPending} aria-label={label} aria-valuetext={copy(`${formatCount(row.count)} سجل معلق`, `${formatCount(row.count)} pending records`)} />
                </div>;
              })}
            </div>
            <p className={styles.note}>{copy("هذه حالات معلقة محفوظة، وقد تشمل تحديات لم تُقدّم للمراجعة بعد. ليست إثباتات مقبولة أو اعتمادًا حاليًا.", "These are saved pending states and may include challenges not yet submitted for review. They are not accepted evidence or current verification.")}</p>
          </section>

          <section className={`${styles.panel} ${styles.queuePanel}`} aria-labelledby="admin-ownership-heading">
            <h2 id="admin-ownership-heading">{copy("تحديات ملكية الحساب المعلقة", "Pending ownership challenges")}</h2>
            {overview.ownershipPreview.length === 0 ? <p className={styles.empty}>{copy("لا توجد تحديات ملكية معلقة محفوظة.", "No saved pending ownership challenges.")}</p> : <ul className={styles.queue}>
              {overview.ownershipPreview.map(entry => <li key={entry.id} className={styles.queueRow} data-ownership-id={entry.id}>
                <div className={styles.queueCopy}>
                  <p className={styles.handle}><bdi dir="ltr">@{entry.handle}</bdi></p>
                  <p className={styles.details}><bdi dir="ltr">{entry.platform}</bdi> · {copy("بدأ (UTC):", "Started (UTC):")} <time dateTime={entry.startedAt} dir="ltr">{entry.startedAt}</time></p>
                  <p className={styles.reference}>{entry.hasEvidenceReference ? copy("مرجع إثبات مسجل", "Evidence reference recorded") : copy("لا يوجد مرجع إثبات مسجل.", "No evidence reference recorded.")}</p>
                </div>
                <Link href="/admin/evidence" className={styles.action} aria-label={copy(`مراجعة إثبات @${entry.handle}`, `Review evidence for @${entry.handle}`)}>{copy("مراجعة", "Review")}</Link>
              </li>)}
            </ul>}
            <p className={styles.note}>{copy("تُعرض حتى ٨ سجلات حسب ترتيب المعرّف، لا حسب الأحدث. وقت البدء هو إنشاء التحدي، وليس تقديمه أو مراجعته. وجود مرجع لا يعني قبول الإثبات أو اعتماد الملكية الحالي.", "Up to 8 records are shown in ID order, not newest first. Started is challenge creation, not submission or review. A recorded reference does not establish accepted evidence or current ownership verification.")}</p>
            <Link href="/admin/evidence" className={styles.textLink}>{copy("فتح مراجعة الإثباتات", "Open evidence review")}</Link>
          </section>
        </div>
      </>}
    </div>
  );
}
