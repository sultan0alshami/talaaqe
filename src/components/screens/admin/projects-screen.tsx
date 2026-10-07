"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AdminCampaignsSchema, type AdminCampaignsDTO } from "@/lib/admin/contracts";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import { useI18n } from "@/lib/i18n";
import { campaignStatuses } from "@/components/infame/dashboard-parts";
import styles from "./projects-layout.module.css";

function responseCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = body.error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : null;
}
function errorMessage(code: string, isAr: boolean) {
  if (code === "UNAUTHENTICATED") return isAr ? "انتهت الجلسة. سجّل دخولك لتحميل بيانات الحملات." : "Your session ended. Sign in to load campaign data.";
  if (code === "FORBIDDEN") return isAr ? "بيانات الحملات غير متاحة لصلاحيتك الحالية." : "Campaign data is unavailable for your current permissions.";
  if (code === "INVALID_RESPONSE") return isAr ? "تعذر قراءة قائمة الحملات. أعد تحميل البيانات." : "The campaign list response could not be read. Reload the data.";
  return isAr ? "تعذر تحميل قائمة الحملات. أعد المحاولة." : "The campaign list could not be loaded. Try again.";
}

export function ProjectsScreen({ initialCampaigns, after, errorCode = null }: {
  initialCampaigns: AdminCampaignsDTO | null;
  after?: string;
  errorCode?: string | null;
}) {
  const { isAr, t } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [error, setError] = useState(errorCode);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const listPath = "/api/admin/campaigns" + (after ? "?" + new URLSearchParams({ after }).toString() : "");

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch(listPath, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setCampaigns(null); setError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"); return;
      }
      let body: unknown;
      try { body = await response.json(); }
      catch { setError("INVALID_RESPONSE"); return; }
      if (response.status !== 200) { setError(responseCode(body) ?? "UNAVAILABLE"); return; }
      const parsed = AdminCampaignsSchema.safeParse(body && typeof body === "object" && "data" in body ? body.data : undefined);
      if (!parsed.success) { setError("INVALID_RESPONSE"); return; }
      setCampaigns(parsed.data); setError(null);
    } catch { setError("NETWORK"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className={styles.page} aria-busy={busy}>
    <header className={styles.heading}>
      <div className={styles.headingCopy}>
        <h1>{t.aProjectsTitle}</h1>
        <p className={styles.timestamp}>{campaigns ? <>{copy("وقت البيانات (UTC):", "Data as of (UTC):")} <time dateTime={campaigns.asOf} dir="ltr">{campaigns.asOf}</time></> : copy("لم تُحمّل قائمة الحملات بعد.", "No campaign list has been loaded.")}</p>
      </div>
      <button type="button" className={styles.action} disabled={busy} onClick={() => void reload()}>{busy ? copy("جارٍ تحميل البيانات…", "Loading data…") : error ? copy("إعادة المحاولة", "Retry") : copy("تحديث البيانات", "Refresh data")}</button>
    </header>
    <p className={styles.note}>{copy("تعرض القائمة سجلات الحملات من المسار السابق، بما فيها الخاصة والمسودات وحملات الاختبار والحملات التابعة لحسابات موقوفة. تتطلب طلبات إنفيم المُدارة صلاحية منفصلة. الحالة المحفوظة لا تثبت الأهلية للنشر أو إرسال العروض.", "The list shows campaign records from the earlier workflow, including private, draft and test campaigns and campaigns belonging to suspended accounts. Managed Infame requests require separate access. Saved status does not establish publication or offer eligibility.")}</p>
    <p className={styles.note}>{copy("الميزانية من المدخلات الحالية المحفوظة عند توفرها، وليست عرض سعر متفقًا عليه أو ميزانية موجز تاريخي معتمد. يظل العنوان واسم العلامة بلغتهما الأصلية.", "Available budgets come from current saved input, rather than an agreed quote or an approved historical brief. Titles and brand names retain their original language.")}</p>
    {busy && <p className={styles.feedback} role="status">{copy("جارٍ تحميل قائمة الحملات…", "Loading the campaign list…")}</p>}
    {error && <div className={styles.error} role="alert">
      <p>{errorMessage(error, isAr)}</p>
      {campaigns && <p>{copy("تُعرض آخر قائمة محمّلة ووقتها؛ لم تنجح محاولة التحديث.", "The last loaded list and its timestamp remain displayed; the reload did not succeed.")}</p>}
      {(error === "UNAUTHENTICATED" || error === "FORBIDDEN") && <Link href="/login" className={styles.textLink}>{copy("تسجيل الدخول", "Sign in")}</Link>}
    </div>}
    {!campaigns ? <div className={styles.unavailable}>
      <h2>{copy("بيانات الحملات غير متاحة", "Campaign data unavailable")}</h2>
      <p>{copy("حمّل البيانات لعرض الحملات المحفوظة.", "Load the data to view saved campaigns.")}</p>
    </div> : <>
      <div className={styles.table} role="table" aria-label={copy("قائمة الحملات المحفوظة", "Saved campaigns list")}>
        <div className={`${styles.row} ${styles.tableHeader}`} role="row">
          <span role="columnheader">{copy("الحملة", "Campaign")}</span>
          <span role="columnheader">{copy("العلامة التجارية", "Brand")}</span>
          <span role="columnheader">{copy("الميزانية المحفوظة", "Saved budget")}</span>
          <span role="columnheader">{copy("الحالة المحفوظة", "Saved status")}</span>
          <span role="columnheader">{copy("تاريخ الإنشاء (UTC)", "Created (UTC)")}</span>
        </div>
        {campaigns.campaigns.length === 0 && <div role="row"><p className={styles.empty} role="cell" aria-colspan={5}>{copy("لا توجد حملات في هذه الصفحة.", "No campaigns on this page.")}</p></div>}
        {campaigns.campaigns.map(campaign => <div key={campaign.id} className={styles.row} role="row" data-admin-campaign={campaign.id}>
          <div className={styles.identity} role="cell" data-label={copy("الحملة", "Campaign")}>
            <p className={styles.title} dir="auto">{campaign.title.trim() ? campaign.title : copy("عنوان غير معروف", "Unknown title")}</p>
            <p className={styles.revision}>{copy("النسخة المحفوظة:", "Saved revision:")} <bdi dir="ltr">{campaign.revision}</bdi></p>
          </div>
          <div className={styles.cell} role="cell" data-label={copy("العلامة التجارية", "Brand")}><p className={styles.brand} dir="auto">{campaign.brandName.trim() ? campaign.brandName : copy("علامة غير معروفة", "Unknown brand")}</p></div>
          <div className={styles.cell} role="cell" data-label={copy("الميزانية المحفوظة", "Saved budget")} data-budget-source={campaign.budgetSource}>
            {campaign.budget ? <><bdi className={styles.money} dir="ltr">{formatMoneyDecimal(campaign.budget)} {campaign.budget.currencyCode}</bdi><p className={styles.budgetNote}>{copy("من المدخلات الحالية المحفوظة", "From current saved input")}</p></> : <><span>{copy("غير متاحة", "Unavailable")}</span><p className={styles.budgetNote}>{copy("لم تتوفر ميزانية صالحة في المدخلات المحفوظة", "No readable saved-input budget")}</p></>}
          </div>
          <div className={styles.cell} role="cell" data-label={copy("الحالة المحفوظة", "Saved status")}><span className={styles.chip} data-campaign-status={campaign.status}>{campaignStatuses[campaign.status][isAr ? 0 : 1]}</span></div>
          <div className={styles.cell} role="cell" data-label={copy("تاريخ الإنشاء (UTC)", "Created (UTC)")}><time dateTime={campaign.createdAt} dir="ltr">{campaign.createdAt.slice(0, 10).replaceAll("-", "/")}</time></div>
        </div>)}
      </div>
      <nav className={styles.pagination} aria-label={copy("صفحات الحملات", "Campaign pages")}>
        <p>{copy("حتى ٣٠ حملة محفوظة في الصفحة، بترتيب المعرّف.", "Up to 30 saved campaigns per page, in ID order.")}</p>
        {after && <Link href="/admin/projects" prefetch={false} className={styles.action} aria-disabled={busy} tabIndex={busy ? -1 : undefined} onClick={event => { if (inFlight.current) event.preventDefault(); }}>{copy("الصفحة الأولى", "First page")}</Link>}
        {campaigns.nextCursor ? <Link href={"/admin/projects?" + new URLSearchParams({ after: campaigns.nextCursor }).toString()} prefetch={false} className={styles.action} aria-disabled={busy} tabIndex={busy ? -1 : undefined} onClick={event => { if (inFlight.current) event.preventDefault(); }}>{copy("الصفحة التالية", "Next page")}</Link> : <button type="button" className={styles.action} disabled>{copy("الصفحة التالية", "Next page")}</button>}
      </nav>
    </>}
  </div>;
}
