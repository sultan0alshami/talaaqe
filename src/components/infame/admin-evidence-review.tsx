"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import type { EvidenceKind, EvidenceQueue, LicencePolicyOptions } from "@/lib/evidence/client-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { evidenceErrorCode, evidenceErrorMessage, evidenceRead } from "./evidence-client";
import styles from "./admin-evidence.module.css";

type Entry = EvidenceQueue["entries"][number];
type Decision = "VERIFIED" | "REJECTED" | "REVOKED";
export type EvidenceReviewForm = { note: string; language: string; nonce: string; policyId: string };
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : "—"; }
export function evidenceKindLabel(kind: EvidenceKind, isAr: boolean) {
  const labels: Record<EvidenceKind, [string, string]> = { OWNERSHIP: ["ملكية الحساب", "Account ownership"], SCREENSHOT: ["أرقام من لقطة شاشة", "Screenshot metrics"],
    ADVERTISING_LICENCE: ["ترخيص إعلاني", "Advertising licence"], REPRESENTATIVE: ["صلاحية التمثيل", "Representative authority"], BUSINESS_REGISTRATION: ["السجل التجاري", "Business registration"] };
  return labels[kind][isAr ? 0 : 1];
}
export function savedReviewStatusLabel(status: string, isAr: boolean) {
  const labels: Record<string, [string, string]> = { PENDING: ["بانتظار المراجعة", "Pending review"], VERIFIED: ["مراجعة محفوظة: معتمد", "Saved review: verified"], REJECTED: ["مرفوض", "Rejected"],
    EXPIRED: ["منتهي", "Expired"], REVOKED: ["مسحوب", "Revoked"], NEEDS_RECHECK: ["يلزم إعادة الفحص", "Needs recheck"] };
  return labels[status]?.[isAr ? 0 : 1] ?? status;
}
export function evidenceEntrySummary(entry: Entry, isAr: boolean) {
  const data = entry.data;
  if ("challengeCode" in data) return { identity: text(object(data.identity).normalizedHandle ?? data.accountId), source: evidenceKindLabel("OWNERSHIP", isAr), date: data.submittedAt, status: data.status };
  if ("source" in data) return { identity: `${data.account.platform} · ${data.account.handle}`, source: data.source === "SELF_REPORTED" ? (isAr ? "مصرّح بها ذاتيًا" : "Self-reported") : (isAr ? "مصدر مراجعة لقطة شاشة" : "Screenshot review source"), date: data.observedAt, status: data.reviewStatus };
  if ("creatorId" in data) return { identity: `${data.holderName} · ${data.jurisdiction}`, source: evidenceKindLabel("ADVERTISING_LICENCE", isAr), date: data.reviewedAt ?? data.validFrom, status: data.status };
  return { identity: data.identifier ?? data.brandId, source: evidenceKindLabel(entry.kind, isAr), date: data.reviewedAt, status: data.status };
}
function Fact({ label, children }: { label: string; children: ReactNode }) { return <div className={styles.fact}><dt>{label}</dt><dd dir="auto">{children ?? "—"}</dd></div>; }
function Window({ value }: { value: unknown }) { const window = object(value); return <span dir="ltr">{text(window.startsAt)} → {text(window.endsAt)}{typeof window.timeZone === "string" ? ` · ${window.timeZone}` : ""}</span>; }
function StructuredMetrics({ data }: { data: Extract<Entry["data"], { source: unknown }> }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const context = object(data.engagementContext), demographics = object(data.demographics);
  const dimensionLabels: Record<string, [string, string]> = { age: ["العمر", "Age"], gender: ["الجنس", "Gender"], countries: ["البلدان", "Countries"], cities: ["المدن", "Cities"] };
  return <>
    <dl className={styles.facts}>
      <Fact label={copy("المتابعون", "Followers")}>{data.followers}</Fact>
      <Fact label={copy("متوسط المشاهدات", "Average views")}>{data.averageViews}</Fact>
      <Fact label={copy("معدل التفاعل", "Engagement rate")}>{data.engagementRate === null ? "—" : `${data.engagementRate}%`}</Fact>
      <Fact label={copy("تاريخ القياس الأصلي", "Original observation date")}><span dir="ltr">{data.observedAt}</span></Fact>
      <Fact label={copy("تاريخ الإضافة", "Imported at")}><span dir="ltr">{data.importedAt}</span></Fact>
      <Fact label={copy("نسخة ربط الحساب في الملاحظة", "Observation mapping revision")}>{data.mappingRevision}</Fact>
      <Fact label={copy("نسخة الحساب الحالية", "Current account mapping revision")}>{data.account.mappingRevision}</Fact>
      <Fact label={copy("نسخة الإثبات الحالية", "Current evidence revision")}>{data.account.evidenceRevision}</Fact>
    </dl>
    {Object.keys(context).length > 0 && <section className={styles.metricSection}>
      <h3>{copy("تعريف معدل التفاعل", "Engagement definition")}</h3>
      <p dir="auto">{text(context.definition)}</p><p><Window value={context.window} /></p>
      <p>{copy("الوحدة", "Unit")}: {text(context.unit)} · {copy("حد ظهور الملاحظة", "Observation visibility limit")}: {text(context.visibility)}</p>
    </section>}
    {Object.entries(dimensionLabels).map(([key, labels]) => {
      const dimension = object(demographics[key]);
      const values = Array.isArray(dimension.value) ? dimension.value : [];
      return <section key={key} className={styles.metricSection}><h3>{labels[isAr ? 0 : 1]}</h3>
        {values.length ? <ul>{values.map((value, index) => { const row = object(value); return <li key={index}><span dir="auto">{text(row.key)}</span>: {text(row.percent)}%</li>; })}</ul> : <p>{copy("غير معروف", "Unknown")}</p>}
        {values.length > 0 && <p>{copy("حد ظهور الملاحظة", "Observation visibility limit")}: {text(dimension.visibility)}</p>}
        {dimension.roundingToleranceDocumented === true && <p>{copy("تفاوت التقريب موثّق.", "Rounding tolerance is documented.")}</p>}
      </section>;
    })}
    {Array.isArray(data.formatMetrics) && data.formatMetrics.length > 0 && <section className={styles.metricSection}>
      <h3>{copy("أرقام حسب نوع المحتوى", "Metrics by content format")}</h3>
      <ul>{data.formatMetrics.map((value, index) => { const row = object(value); return <li key={index}>
        <p>{text(row.format)}: {text(row.value)} {text(row.unit)}</p><p dir="auto">{text(row.definition)}</p><p><Window value={row.window} /></p>
        <p>{copy("حد ظهور الملاحظة", "Observation visibility limit")}: {text(row.visibility)}</p>
      </li>; })}</ul>
    </section>}
  </>;
}

export function AdminEvidenceReview({ entry, form, blocked, busy, onFormChange, onReview }: {
  entry: Entry; form: EvidenceReviewForm; blocked: boolean; busy: boolean;
  onFormChange: (patch: Partial<EvidenceReviewForm>) => void; onReview: (decision: Decision) => void;
}) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const id = useId(), data = entry.data, summary = evidenceEntrySummary(entry, isAr);
  const licenceId = "creatorId" in data ? data.id : null;
  const [policies, setPolicies] = useState<LicencePolicyOptions | null>(null), [policyError, setPolicyError] = useState<string | null>(null), [policyLoading, setPolicyLoading] = useState(!!licenceId);
  const readingPolicies = useRef(!!licenceId);
  useEffect(() => {
    if (!licenceId) return;
    let active = true;
    void evidenceRead<LicencePolicyOptions>(`/api/evidence/licences/${encodeURIComponent(licenceId)}/policies?limit=25`).then(result => {
      if (active) { setPolicies(result); setPolicyError(null); }
    }).catch(caught => { if (active) { setPolicies(null); setPolicyError(evidenceErrorCode(caught)); } }).finally(() => {
      if (active) { readingPolicies.current = false; setPolicyLoading(false); }
    });
    return () => { active = false; };
  }, [licenceId]);
  async function loadPolicies(cursor?: string) {
    if (!licenceId || busy || readingPolicies.current) return;
    readingPolicies.current = true; setPolicyLoading(true); setPolicyError(null);
    if (!cursor) setPolicies(null);
    try {
      const search = new URLSearchParams({ limit: "25", ...(cursor ? { cursor } : {}) });
      const result = await evidenceRead<LicencePolicyOptions>(`/api/evidence/licences/${encodeURIComponent(licenceId)}/policies?${search}`);
      setPolicies(previous => cursor && previous ? { ...result, options: [...previous.options, ...result.options.filter(option => !previous.options.some(existing => existing.id === option.id))] } : result);
    } catch (caught) { setPolicyError(evidenceErrorCode(caught)); }
    finally { readingPolicies.current = false; setPolicyLoading(false); }
  }
  const selectedPolicy = policies?.options.find(option => option.id === form.policyId);
  const proofId = "challengeCode" in data ? data.proofAssetId : data.evidenceAssetId;
  const noteValid = !!form.note.trim() && form.note.length <= 4000;
  const historical = "source" in data && !!data.excludedAt;
  const mayDecide = "source" in data ? data.source === "SELF_REPORTED" && ["PENDING", "VERIFIED"].includes(data.reviewStatus) && !historical
    : "challengeCode" in data ? data.status === "PENDING" : ["PENDING", "NEEDS_RECHECK"].includes(data.status);
  const mayRevoke = "source" in data ? data.source === "SCREENSHOT_VERIFIED" && data.reviewStatus === "VERIFIED" && !historical : data.status === "VERIFIED";
  const verifyReady = noteValid && !!proofId && ("challengeCode" in data ? !!data.submittedAt && !!form.nonce.trim() : licenceId ? !!selectedPolicy && !policyLoading && !policyError : true);
  return <section className={styles.review} aria-label={`${copy("مراجعة الإثبات", "Review evidence")} ${entry.id}`}>
    <h2>{evidenceKindLabel(entry.kind, isAr)}</h2>
    <p className={styles.explanation}>{copy("هذه بيانات الإثبات وسجل مراجعته. الاعتماد الحالي يخضع لفحص الصلاحية والمالك والنطاق والملف في الخادم عند كل إجراء.", "These are the evidence details and saved review history. The server checks current validity, owner, scope and proof bytes for each action.")}</p>
    <dl className={styles.facts}>
      <Fact label={copy("معرّف الإثبات", "Evidence ID")}><span dir="ltr">{entry.id}</span></Fact>
      <Fact label={copy("حالة المراجعة المحفوظة", "Saved review status")}>{savedReviewStatusLabel(summary.status, isAr)}</Fact>
      <Fact label={copy("المصدر", "Source")}>{summary.source}</Fact>
      {"challengeCode" in data ? <>
        <Fact label={copy("معرّف حساب التواصل", "Social account ID")}><span dir="ltr">{data.accountId}</span></Fact>
        <Fact label={copy("المنصة المحفوظة", "Saved platform")}>{text(object(data.identity).platform)}</Fact>
        <Fact label={copy("الحساب المحفوظ", "Saved handle")}>{text(object(data.identity).normalizedHandle)}</Fact>
        <Fact label={copy("معرّف المنصة المحفوظ", "Saved provider account ID")}>{text(object(data.identity).providerAccountId)}</Fact>
        <Fact label={copy("نسخة الربط المحفوظة", "Saved mapping revision")}>{data.mappingRevision}</Fact>
        <Fact label={copy("نسخة التحدي", "Challenge revision")}>{data.revision}</Fact>
        <Fact label={copy("رمز التحدي المتوقع", "Expected challenge code")}><span dir="ltr">{data.challengeCode}</span></Fact>
        <Fact label={copy("أُرسل الإثبات في", "Proof submitted at")}><span dir="ltr">{data.submittedAt ?? "—"}</span></Fact>
        <Fact label={copy("ينتهي التحدي في", "Challenge expires at")}><span dir="ltr">{data.expiresAt}</span></Fact>
      </> : "source" in data ? <>
        <Fact label={copy("حساب التواصل الحالي", "Current social account")}>{data.account.platform} · {data.account.handle}</Fact>
        <Fact label={copy("الملاحظة السابقة", "Superseded observation")}><span dir="ltr">{data.supersedesId ?? "—"}</span></Fact>
        <Fact label={copy("استُبعدت في", "Excluded at")}><span dir="ltr">{data.excludedAt ?? "—"}</span></Fact>
        <Fact label={copy("اعتماد الحقول في", "Fields approved at")}><span dir="ltr">{data.approvedAt ?? "—"}</span></Fact>
      </> : "creatorId" in data ? <>
        <Fact label={copy("معرّف ملف صانع المحتوى", "Creator profile ID")}><span dir="ltr">{data.creatorId}</span></Fact>
        <Fact label={copy("السوق المختص", "Jurisdiction")}>{data.jurisdiction}</Fact>
        <Fact label={copy("الجهة المصدرة", "Issuer")}>{data.issuer}</Fact>
        <Fact label={copy("اسم حامل الترخيص", "Licence holder")}>{data.holderName}</Fact>
        <Fact label={copy("رقم الترخيص", "Licence number")}>{data.licenceNumber}</Fact>
        <Fact label={copy("نوع الترخيص", "Licence type")}>{data.type}</Fact>
        <Fact label={copy("النطاق الأصلي", "Original scope")}>{data.scope}</Fact>
        <Fact label={copy("الحسابات المشمولة", "Scoped accounts")}><ul>{data.accountIds.map(account => <li key={account} dir="ltr">{account}</li>)}</ul></Fact>
        <Fact label={copy("المنصات المشمولة", "Scoped platforms")}>{data.platformScope.join(" · ")}</Fact>
        <Fact label={copy("ساري من", "Valid from")}><span dir="ltr">{data.validFrom ?? "—"}</span></Fact>
        <Fact label={copy("ينتهي في", "Expires at")}><span dir="ltr">{data.expiresAt ?? "—"}</span></Fact>
        <Fact label={copy("نسخة الترخيص", "Licence revision")}>{data.revision}</Fact>
        <Fact label={copy("سياسة المراجعة السابقة", "Previous review policy")}>{data.policyVersion}</Fact>
        <Fact label={copy("طريقة المراجعة السابقة", "Previous review method")}>{data.reviewMethod}</Fact>
      </> : <>
        <Fact label={copy("معرّف ملف الشركة", "Brand profile ID")}><span dir="ltr">{data.brandId}</span></Fact>
        <Fact label={copy("السوق المختص", "Jurisdiction")}>{data.jurisdiction}</Fact>
        <Fact label={copy("المعرّف الأصلي", "Original identifier")}>{data.identifier}</Fact>
        <Fact label={copy("نسخة الإثبات", "Evidence revision")}>{data.revision}</Fact>
        <Fact label={copy("ينتهي في", "Expires at")}><span dir="ltr">{data.expiresAt ?? "—"}</span></Fact>
      </>}
    </dl>
    {"source" in data && <>
      <p className={styles.explanation}>{copy("حدود الظهور المحفوظة تخص الملاحظة الأصلية. اختيار صاحب الملف لمشاركة الحقول مستقل؛ هذه الحدود لا تعني أن الأرقام منشورة حاليًا.", "Saved visibility limits belong to the original observation. The owner's field sharing choice is separate; these limits do not mean the metrics are currently published.")}</p>
      {data.source === "SELF_REPORTED" && data.approvedAt && <p className={styles.explanation}>{copy("اعتمد صاحب الملف هذه الحقول ذاتيًا. هذا لا يحوّل المصدر إلى لقطة شاشة معتمدة من المراجع.", "The profile owner approved these fields as self-reported. This does not promote their source to reviewer-verified screenshot metrics.")}</p>}
      <StructuredMetrics data={data} />
      <section className={styles.history}><h3>{copy("سجل مراجعة لقطة الشاشة", "Screenshot review history")}</h3>
        {data.reviewHistory.length ? <ol>{data.reviewHistory.map((review, index) => <li key={index}>
          <p>{savedReviewStatusLabel(review.decision, isAr)} · <span dir="ltr">{review.reviewedAt}</span></p>
          <p dir="auto" lang={review.note.language ?? undefined} className={styles.original}>{review.note.text}</p>
          <p>{copy("معرّف المراجع", "Reviewer ID")}: <span dir="ltr">{review.reviewerId}</span></p>
        </li>)}</ol> : <p>{copy("لا توجد مراجعة إدارية محفوظة لهذه الملاحظة.", "No saved admin review for this observation.")}</p>}
      </section>
    </>}
    {!("source" in data) && <section className={styles.history}><h3>{copy("المراجعة السابقة", "Previous review")}</h3>
      <p dir="ltr">{data.reviewedAt ?? "—"}</p>
      {data.reviewNote ? <p dir="auto" lang={data.reviewNote.language ?? undefined} className={styles.original}>{data.reviewNote.text}</p> : <p>{copy("لا توجد ملاحظة مراجعة محفوظة.", "No saved review note.")}</p>}
    </section>}
    <div className={styles.proof}>
      {proofId ? <a href={`/api/evidence/assets/${encodeURIComponent(proofId)}`} className={styles.attachment}>{copy("نزّل الإثبات الخاص للمراجعة", "Download private proof for review")}</a>
        : <p>{copy("لم يُرفق ملف إثبات.", "No proof attachment.")}</p>}
    </div>
    {licenceId && mayDecide && <section className={styles.policySection}>
      <h3>{copy("سياسة السوق الحالية للمراجعة", "Current market policy for review")}</h3>
      <p className={styles.explanation}>{copy("اختر نسخة سياسة يعيدها الخادم لهذا السوق والنطاق. يُعاد فحص السياسة وملفات الإثبات عند حفظ المراجعة.", "Choose a policy version returned by the server for this market and scope. The policy and proof bytes are rechecked when the review is saved.")}</p>
      {policyLoading && <p role="status">{copy("جارٍ تحميل خيارات السياسة…", "Loading policy options…")}</p>}
      {policyError && <p role="alert">{evidenceErrorMessage(policyError, isAr)}</p>}
      <div className={styles.field}><label htmlFor={`${id}-policy`}>{copy("نسخة سياسة السوق", "Market policy version")}</label>
        <select id={`${id}-policy`} value={selectedPolicy ? form.policyId : ""} disabled={blocked || policyLoading} onChange={event => onFormChange({ policyId: event.target.value })}>
          <option value="">{copy("اختر نسخة سياسة للمراجعة", "Choose a policy version for review")}</option>
          {policies?.options.map(option => <option value={option.id} key={option.id}>{option.marketCountryCode} · {option.licencePolicyId} · {option.id}</option>)}
        </select>
      </div>
      {selectedPolicy && <dl className={styles.facts}>
        <Fact label={copy("معرّف نسخة السياسة", "Policy version ID")}><span dir="ltr">{selectedPolicy.id}</span></Fact>
        <Fact label={copy("مرجع المراجعة الأصلي", "Original review reference")}><span dir="auto" className={styles.original}>{selectedPolicy.reviewReference}</span></Fact>
        <Fact label={copy("راجعت في", "Reviewed at")}><span dir="ltr">{selectedPolicy.reviewedAt}</span></Fact>
        <Fact label={copy("تنتهي في", "Expires at")}><span dir="ltr">{selectedPolicy.expiresAt ?? "—"}</span></Fact>
      </dl>}
      {!policyLoading && !policyError && policies && !policies.options.length && <p>{copy("لا توجد نسخة سياسة مؤهلة في الصفحة الحالية. الاعتماد يتطلب خيارًا صالحًا من الخادم.", "No eligible policy version on this page. Verification requires a valid server option.")}</p>}
      <div className={styles.actions}>
        <Button type="button" variant="outline" disabled={busy || policyLoading} onClick={() => void loadPolicies()}>{copy("حدّث خيارات السياسة", "Refresh policy options")}</Button>
        {policies?.nextCursor && <Button type="button" variant="outline" disabled={busy || policyLoading} onClick={() => void loadPolicies(policies.nextCursor ?? undefined)}>{copy("حمّل خيارات أخرى", "Load more policy options")}</Button>}
      </div>
    </section>}
    {(mayDecide || mayRevoke) ? <div className={styles.reviewForm}>
      <div className={styles.field}><label htmlFor={`${id}-note`}>{copy("سبب المراجعة (مطلوب)", "Review reason (required)")}</label>
        <Textarea id={`${id}-note`} dir="auto" rows={4} maxLength={4000} disabled={blocked} value={form.note} onChange={event => onFormChange({ note: event.target.value })} />
      </div>
      <div className={styles.field}><label htmlFor={`${id}-language`}>{copy("لغة السبب الأصلية (اختياري، رمز BCP47)", "Original reason language (optional, BCP47 code)")}</label>
        <Input id={`${id}-language`} dir="ltr" maxLength={100} disabled={blocked} value={form.language} onChange={event => onFormChange({ language: event.target.value })} placeholder="ar / en" />
      </div>
      {"challengeCode" in data && mayDecide && <div className={styles.field}>
        <label htmlFor={`${id}-nonce`}>{copy("رمز التحدي الذي شاهدته في الإثبات", "Challenge code observed in the proof")}</label>
        <Input id={`${id}-nonce`} dir="ltr" maxLength={100} disabled={blocked} value={form.nonce} onChange={event => onFormChange({ nonce: event.target.value })} autoComplete="off" />
        <p className={styles.explanation}>{copy("أدخل الرمز الذي شاهدته فعليًا؛ لا يُملأ تلقائيًا من التحدي المحفوظ.", "Enter the code you actually observed; it is not filled from the saved challenge.")}</p>
      </div>}
      <div className={styles.actions}>
        {mayDecide && <>
          <Button type="button" disabled={blocked || !verifyReady} onClick={() => onReview("VERIFIED")}>{copy("اعتمد الإثبات بعد المراجعة", "Verify evidence after review")}</Button>
          <Button type="button" variant="destructive" disabled={blocked || !noteValid} onClick={() => onReview("REJECTED")}>{copy("ارفض الإثبات", "Reject evidence")}</Button>
        </>}
        {mayRevoke && <Button type="button" variant="destructive" disabled={blocked || !noteValid} onClick={() => onReview("REVOKED")}>{copy("اسحب اعتماد الإثبات", "Revoke evidence review")}</Button>}
      </div>
    </div> : <p className={styles.explanation}>{copy("هذا سجل مراجعة محفوظ؛ حالته الحالية لا تسمح بإجراء مراجعة جديد هنا.", "This is saved review history; its current state does not permit a new review here.")}</p>}
  </section>;
}
