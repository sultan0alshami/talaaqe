"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AdminCreatorsSchema, type AdminCreatorDTO, type AdminCreatorsDTO } from "@/lib/admin/contracts";
import { useI18n } from "@/lib/i18n";
import styles from "./providers-screen.module.css";

const profileLabels: Record<AdminCreatorDTO["state"], [string, string]> = {
  DRAFT: ["مسودة", "Draft"], PRIVATE: ["خاص", "Private"],
  PUBLISHED: ["منشور", "Published"], HIDDEN: ["مخفي", "Hidden"],
};
const ownershipLabels = {
  UNPROVED: ["غير مثبت", "Unproved"], PENDING: ["قيد المراجعة", "Pending"],
  VERIFIED: ["موثّق", "Verified"], REJECTED: ["مرفوض", "Rejected"], REVOKED: ["مسحوب", "Revoked"],
} satisfies Record<Exclude<keyof AdminCreatorDTO["accountCounts"], "total">, [string, string]>;
const ownershipStatuses = Object.keys(ownershipLabels) as (keyof typeof ownershipLabels)[];

function responseCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = body.error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : null;
}
function errorMessage(code: string, isAr: boolean) {
  if (code === "UNAUTHENTICATED") return isAr ? "انتهت الجلسة. سجّل دخولك لتحميل بيانات المؤثرين." : "Your session ended. Sign in to load creator data.";
  if (code === "FORBIDDEN") return isAr ? "بيانات المؤثرين غير متاحة لصلاحيتك الحالية." : "Creator data is unavailable for your current permissions.";
  if (code === "INVALID_RESPONSE") return isAr ? "تعذر قراءة قائمة المؤثرين. أعد تحميل البيانات." : "The creator list response could not be read. Reload the data.";
  return isAr ? "تعذر تحميل قائمة المؤثرين. أعد المحاولة." : "The creator list could not be loaded. Try again.";
}

export function ProvidersScreen({ initialCreators, after, errorCode = null }: {
  initialCreators: AdminCreatorsDTO | null;
  after?: string;
  errorCode?: string | null;
}) {
  const { isAr } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const [creators, setCreators] = useState(initialCreators);
  const [error, setError] = useState(errorCode);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const listPath = "/api/admin/creators" + (after ? "?" + new URLSearchParams({ after }).toString() : "");

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch(listPath, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setCreators(null); setError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"); return;
      }
      let body: unknown;
      try { body = await response.json(); }
      catch { setError("INVALID_RESPONSE"); return; }
      if (response.status !== 200) { setError(responseCode(body) ?? "UNAVAILABLE"); return; }
      const parsed = AdminCreatorsSchema.safeParse(body && typeof body === "object" && "data" in body ? body.data : undefined);
      if (!parsed.success) { setError("INVALID_RESPONSE"); return; }
      setCreators(parsed.data); setError(null);
    } catch { setError("NETWORK"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className={styles.page} aria-busy={busy}>
    <header className={styles.heading}>
      <div className={styles.headingCopy}>
        <h1>{copy("إدارة المؤثرين", "Creators management")}</h1>
        <p className={styles.timestamp}>{creators ? <>{copy("وقت البيانات (UTC):", "Data as of (UTC):")} <time dateTime={creators.asOf} dir="ltr">{creators.asOf}</time></> : copy("لم تُحمّل قائمة المؤثرين بعد.", "No creator list has been loaded.")}</p>
      </div>
      <button type="button" className={styles.action} disabled={busy} onClick={() => void reload()}>{busy ? copy("جارٍ تحميل البيانات…", "Loading data…") : error ? copy("إعادة المحاولة", "Retry") : copy("تحديث البيانات", "Refresh data")}</button>
    </header>
    <p className={styles.note}>{copy("تشمل القائمة جميع ملفات المؤثرين المحفوظة، بما فيها الخاصة والمسودات والمخفية وملفات الاختبار والملفات غير المرتبطة بمستخدم أو التابعة لحسابات موقوفة.", "The list includes all saved creator profiles, including private, draft, hidden and test profiles, profiles without a user association and profiles belonging to suspended accounts.")}</p>
    <p className={styles.note}>{copy("حالة الملف وأعداد حالات ملكية الحسابات تصف السجلات المحفوظة؛ لا تثبت الظهور العام الحالي أو صحة الإثبات أو أهلية العروض. ارتباط المستخدم لا يثبت ملكية الحسابات الاجتماعية، والإقامة منفصلة عن جمهور الحسابات. يظل الاسم والمعرّف والمدينة بلغتها الأصلية.", "Profile state and account ownership-status counts describe saved records; they do not establish current public visibility, valid proof or offer eligibility. A user association does not prove social-account ownership, and residence is separate from account audience. Names, handles and cities retain their original language.")}</p>
    {busy && <p className={styles.feedback} role="status">{copy("جارٍ تحميل قائمة المؤثرين…", "Loading the creator list…")}</p>}
    {error && <div className={styles.error} role="alert">
      <p>{errorMessage(error, isAr)}</p>
      {creators && <p>{copy("تُعرض آخر قائمة محمّلة ووقتها؛ لم تنجح محاولة التحديث.", "The last loaded list and its timestamp remain displayed; the reload did not succeed.")}</p>}
      {(error === "UNAUTHENTICATED" || error === "FORBIDDEN") && <Link href="/login" className={styles.textLink}>{copy("تسجيل الدخول", "Sign in")}</Link>}
    </div>}
    {!creators ? <div className={styles.unavailable}>
      <h2>{copy("بيانات المؤثرين غير متاحة", "Creator data unavailable")}</h2>
      <p>{copy("حمّل البيانات لعرض الملفات المحفوظة. لا تُعرض بيانات خاصة من نسخة سابقة بعد رفض الوصول.", "Load the data to view saved profiles. Private data from a previous snapshot is hidden after access is denied.")}</p>
    </div> : <>
      <div className={styles.table} role="table" aria-label={copy("قائمة المؤثرين المحفوظة", "Saved creators list")}>
        <div className={styles.row + " " + styles.tableHeader} role="row">
          <span role="columnheader">{copy("المؤثر", "Creator")}</span>
          <span role="columnheader">{copy("حالة الملف المحفوظة", "Saved profile state")}</span>
          <span role="columnheader">{copy("الإقامة", "Residence")}</span>
          <span role="columnheader">{copy("الحسابات المحفوظة", "Saved accounts")}</span>
          <span role="columnheader">{copy("حالات الملكية المسجلة", "Recorded ownership statuses")}</span>
          <span role="columnheader">{copy("الإثباتات", "Evidence")}</span>
        </div>
        {creators.creators.length === 0 && <div role="row"><p className={styles.empty} role="cell" aria-colspan={6}>{copy("لا يوجد مؤثرون في هذه الصفحة.", "No creators on this page.")}</p></div>}
        {creators.creators.map(creator => <div key={creator.id} className={styles.row} role="row" data-admin-creator={creator.id}>
          <div className={styles.identity} role="cell">
            <span className={styles.avatar} data-admin-avatar aria-hidden="true">{Array.from(creator.displayName.trim())[0] ?? "—"}</span>
            <div className={styles.identityCopy}>
              <p className={styles.name} dir="auto">{creator.displayName.trim() ? creator.displayName : copy("اسم غير معروف", "Unknown name")}</p>
              <p className={styles.handle} dir="auto">{creator.handle.trim() ? creator.handle : copy("معرّف غير معروف", "Unknown handle")}</p>
              <p className={styles.association} data-user-association={creator.claimStatus}>{creator.claimStatus === "CLAIMED" ? copy("مرتبط بمستخدم", "User associated") : copy("دون ارتباط بمستخدم", "No user association")}</p>
            </div>
          </div>
          <div className={styles.cell} role="cell" data-label={copy("حالة الملف المحفوظة", "Saved profile state")}>
            <span className={styles.chip} data-profile-state={creator.state}>{profileLabels[creator.state][isAr ? 0 : 1]}</span>
          </div>
          <div className={styles.cell} role="cell" data-label={copy("الإقامة", "Residence")}>
            <p className={styles.residence}>{copy("الدولة (ISO):", "Country (ISO):")} {creator.countryCode ? <bdi dir="ltr">{creator.countryCode}</bdi> : copy("غير معروفة", "Unknown")}</p>
            <p className={styles.residence}>{copy("المدينة:", "City:")} <bdi className={styles.original} dir="auto">{creator.cityLabel ?? copy("غير معروفة", "Unknown")}</bdi></p>
          </div>
          <div className={styles.cell} role="cell" data-label={copy("الحسابات المحفوظة", "Saved accounts")}>
            <span className={styles.total} data-account-count="total"><bdi dir="ltr">{creator.accountCounts.total}</bdi></span>
          </div>
          <div className={styles.cell} role="cell" data-label={copy("حالات الملكية المسجلة", "Recorded ownership statuses")}>
            <div className={styles.ownershipCounts}>{ownershipStatuses.map(status => <span key={status} data-ownership-status={status}>
              {ownershipLabels[status][isAr ? 0 : 1]}: <bdi dir="ltr">{creator.accountCounts[status]}</bdi>
            </span>)}</div>
          </div>
          <div className={styles.cell} role="cell" data-label={copy("الإثباتات", "Evidence")}>
            <Link href="/admin/evidence" prefetch={false} className={styles.action} aria-disabled={busy} tabIndex={busy ? -1 : undefined} onClick={event => { if (inFlight.current) event.preventDefault(); }}>{copy("مراجعة الإثباتات", "Review evidence")}</Link>
          </div>
        </div>)}
      </div>
      <nav className={styles.pagination} aria-label={copy("صفحات المؤثرين", "Creator pages")}>
        <p>{copy("حتى ٣٠ ملف مؤثر محفوظ في الصفحة، بترتيب المعرّف.", "Up to 30 saved creator profiles per page, in ID order.")}</p>
        {after && <Link href="/admin/providers" prefetch={false} className={styles.action} aria-disabled={busy} tabIndex={busy ? -1 : undefined} onClick={event => { if (inFlight.current) event.preventDefault(); }}>{copy("الصفحة الأولى", "First page")}</Link>}
        {creators.nextCursor ? <Link href={"/admin/providers?" + new URLSearchParams({ after: creators.nextCursor }).toString()} prefetch={false} className={styles.action} aria-disabled={busy} tabIndex={busy ? -1 : undefined} onClick={event => { if (inFlight.current) event.preventDefault(); }}>{copy("الصفحة التالية", "Next page")}</Link> : <button type="button" className={styles.action} disabled>{copy("الصفحة التالية", "Next page")}</button>}
      </nav>
    </>}
  </div>;
}
