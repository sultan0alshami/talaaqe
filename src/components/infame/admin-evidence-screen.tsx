"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { EvidenceKind, EvidenceQueue } from "@/lib/evidence/client-contracts";
import { Button } from "@/components/ui/button";
import { evidenceErrorCode, evidenceErrorMessage, evidenceRead, useEvidenceOperation } from "./evidence-client";
import { AdminEvidenceReview, evidenceEntrySummary, evidenceKindLabel, savedReviewStatusLabel, type EvidenceReviewForm } from "./admin-evidence-review";
import styles from "./admin-evidence.module.css";

const kinds: EvidenceKind[] = ["OWNERSHIP", "SCREENSHOT", "ADVERTISING_LICENCE", "REPRESENTATIVE", "BUSINESS_REGISTRATION"];
const statuses = ["PENDING", "VERIFIED", "REJECTED", "EXPIRED", "REVOKED", "NEEDS_RECHECK"] as const;
type SavedStatus = typeof statuses[number];
type Entry = EvidenceQueue["entries"][number];
const emptyForm: EvidenceReviewForm = { note: "", language: "", nonce: "", policyId: "" };

export function AdminEvidenceScreen({ initial, initialError }: { initial: EvidenceQueue | null; initialError?: string }) {
  const { isAr } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const [queue, setQueue] = useState(initial), [kind, setKind] = useState<EvidenceKind>(initial?.kind ?? "OWNERSHIP"), [status, setStatus] = useState<SavedStatus>("PENDING");
  const [readError, setReadError] = useState<string | null>(initialError ?? null), [open, setOpen] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, EvidenceReviewForm>>({}), [refreshVersion, setRefreshVersion] = useState(0);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]), [page, setPage] = useState(0);
  const interactionInFlight = useRef(false);
  const query = useRef<{ kind: EvidenceKind; status: SavedStatus; cursor?: string }>({ kind: initial?.kind ?? "OWNERSHIP", status: "PENDING" });
  async function refreshData() {
    const current = query.current;
    const search = new URLSearchParams({ kind: current.kind, status: current.status, limit: "25", ...(current.cursor ? { cursor: current.cursor } : {}) });
    try {
      const result = await evidenceRead<EvidenceQueue>(`/api/evidence/reviews?${search}`);
      setQueue(result); setReadError(null); setRefreshVersion(value => value + 1);
    } catch (caught) { setReadError(evidenceErrorCode(caught)); throw caught; }
  }
  const operation = useEvidenceOperation(refreshData);
  const error = operation.error ?? readError;
  const denied = error === "UNAUTHENTICATED" || error === "FORBIDDEN";
  const mutationBlocked = operation.blocked || !!readError || !queue;
  // Acquire before changing query state: React's busy state can still be the
  // previous render during a second event in the same turn.
  async function whileIdle(action: () => Promise<unknown>) {
    if (interactionInFlight.current || operation.busy) return;
    interactionInFlight.current = true;
    try { await action(); } finally { interactionInFlight.current = false; }
  }
  async function selectQueue(nextKind: EvidenceKind, nextStatus: SavedStatus) {
    await whileIdle(async () => {
      query.current = { kind: nextKind, status: nextStatus };
      setKind(nextKind); setStatus(nextStatus); setQueue(null); setOpen(null); setCursors([undefined]); setPage(0);
      await operation.refresh();
    });
  }
  async function selectPage(index: number, cursor?: string) {
    await whileIdle(async () => {
      query.current = { kind, status, ...(cursor ? { cursor } : {}) };
      setOpen(null); setQueue(null); setPage(index);
      if (index >= cursors.length) setCursors(previous => [...previous, cursor]);
      await operation.refresh();
    });
  }
  function formKey(entry: Entry) { return `${entry.kind}:${entry.id}`; }
  function updateForm(entry: Entry, patch: Partial<EvidenceReviewForm>) {
    const key = formKey(entry);
    setForms(previous => ({ ...previous, [key]: { ...(previous[key] ?? emptyForm), ...patch } }));
  }
  async function review(entry: Entry, decision: "VERIFIED" | "REJECTED" | "REVOKED") {
    const form = forms[formKey(entry)] ?? emptyForm, data = entry.data;
    if (mutationBlocked || !form.note.trim()) return;
    const note = { text: form.note, language: form.language.trim() || null };
    await whileIdle(async () => {
      if ("challengeCode" in data) {
        await operation.command("OWNERSHIP_REVIEW", { expectedRevision: data.revision, decision, note,
          ...(decision === "VERIFIED" ? { observedChallengeCode: form.nonce } : {}) }, entry.id);
      } else if ("source" in data) {
        await operation.command("SCREENSHOT_REVIEW", { expectedEvidenceRevision: data.account.evidenceRevision, decision, note }, entry.id);
      } else if ("creatorId" in data) {
        await operation.command("LICENCE_REVIEW", { expectedRevision: data.revision, decision, note,
          ...(decision === "VERIFIED" ? { policyVersionId: form.policyId } : {}) }, entry.id);
      } else {
        await operation.command("BUSINESS_REVIEW", { expectedRevision: data.revision, decision, note }, entry.id);
      }
    });
  }
  return <div className={styles.page}>
    <header className={styles.heading}>
      <h1>{copy("مراجعة الإثباتات", "Evidence review")}</h1>
      <p>{copy("راجع الملكية والأرقام والترخيص والتمثيل والسجل كلًا على حدة. حالة المراجعة المحفوظة تصف السجل؛ صلاحية الإثبات والنشر تُفحص بشكل مستقل.", "Review ownership, metrics, licences, representation and registration separately. Saved review status describes history; accepted proof and publication eligibility are checked independently.")}</p>
    </header>
    <div className={styles.filters}>
      <div className={styles.field}>
        <label htmlFor="admin-evidence-kind">{copy("نوع الإثبات", "Evidence kind")}</label>
        <select id="admin-evidence-kind" value={kind} disabled={operation.busy} onChange={event => void selectQueue(event.target.value as EvidenceKind, status)}>
          {kinds.map(value => <option value={value} key={value}>{evidenceKindLabel(value, isAr)}</option>)}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="admin-evidence-status">{copy("حالة المراجعة المحفوظة", "Saved review status")}</label>
        <select id="admin-evidence-status" value={status} disabled={operation.busy} onChange={event => void selectQueue(kind, event.target.value as SavedStatus)}>
          {statuses.map(value => <option value={value} key={value}>{savedReviewStatusLabel(value, isAr)}</option>)}
        </select>
      </div>
      <Button type="button" variant="outline" disabled={operation.busy} onClick={() => void whileIdle(() => operation.refresh())}>{copy("حدّث البيانات", "Refresh data")}</Button>
    </div>
    {operation.busy && <p className={styles.feedback} role="status">{copy("جارٍ تنفيذ طلبك…", "Processing your request…")}</p>}
    {error && <div className={styles.error} role="alert">
      <p>{evidenceErrorMessage(error, isAr)}</p>
      {denied && <Link href="/login">{copy("تسجيل الدخول", "Sign in")}</Link>}
    </div>}
    {operation.pending && <div className={styles.feedback}>
      <p>{copy("نتيجة الطلب غير مؤكدة. إعادة المحاولة تستخدم نفس الإجراء والمدخلات والمفتاح.", "The request result is uncertain. Retrying uses the identical action, input and operation key.")}</p>
      <Button type="button" disabled={operation.busy} onClick={() => void whileIdle(() => operation.retry())}>{copy("أعد نفس الطلب", "Retry the same request")}</Button>
    </div>}
    {operation.refreshRequired && <p className={styles.feedback}>{copy("حمّل البيانات الحالية قبل إجراء مراجعة جديدة.", "Load the current data before another review.")}</p>}
    {operation.notice && <p className={styles.feedback} role="status">{copy("حُفظت المراجعة وحُمّلت البيانات الحالية.", "Review saved and current data loaded.")}</p>}
    {!denied && queue && <>
      <div className={styles.table} role="table" aria-label={copy("طابور مراجعة الإثباتات", "Evidence review queue")} aria-busy={operation.busy}>
        <div className={`${styles.row} ${styles.tableHeader}`} role="row">
          <span role="columnheader">{copy("الحساب أو النطاق", "Account or scope")}</span>
          <span role="columnheader">{copy("المصدر", "Source")}</span>
          <span role="columnheader">{copy("التاريخ المتاح", "Available date")}</span>
          <span role="columnheader">{copy("حالة المراجعة المحفوظة", "Saved review status")}</span>
          <span role="columnheader">{copy("المراجعة", "Review")}</span>
        </div>
        {!queue.entries.length && <p className={styles.empty}>{copy("لا توجد سجلات مطابقة لهذا الطابور.", "No records match this queue.")}</p>}
        {queue.entries.map(entry => {
          const key = formKey(entry), expanded = open === key, summary = evidenceEntrySummary(entry, isAr);
          return <div key={key} role="rowgroup" data-evidence-id={entry.id}>
            <div className={styles.row} role="row">
              <div className={styles.identity} role="cell">
                <span className={styles.avatar} aria-hidden="true">{summary.identity.charAt(0)}</span>
                <div><p className={styles.name} dir="auto">{summary.identity}</p><p className={styles.secondary} dir="ltr">{entry.id}</p></div>
              </div>
              <div role="cell" className={styles.cell} data-label={copy("المصدر", "Source")}>{summary.source}</div>
              <div role="cell" className={styles.cell} data-label={copy("التاريخ المتاح", "Available date")}><span dir="ltr">{summary.date ?? "—"}</span></div>
              <div role="cell" className={styles.cell} data-label={copy("حالة المراجعة المحفوظة", "Saved review status")}><span className={styles.status}>{savedReviewStatusLabel(summary.status, isAr)}</span></div>
              <div role="cell" className={styles.rowAction}>
                <Button type="button" variant="secondary" size="sm" disabled={operation.busy} aria-expanded={expanded} aria-controls={`review-${entry.id}`}
                  aria-label={`${copy(expanded ? "إغلاق" : "مراجعة", expanded ? "Close" : "Review")} ${entry.id}`} onClick={() => setOpen(expanded ? null : key)}>
                  {copy(expanded ? "إغلاق" : "مراجعة", expanded ? "Close" : "Review")}
                </Button>
              </div>
            </div>
            {expanded && <div role="row"><div role="cell" aria-colspan={5} className={styles.expanded} id={`review-${entry.id}`}>
              <AdminEvidenceReview key={`${key}:${refreshVersion}`} entry={entry} form={forms[key] ?? emptyForm} blocked={mutationBlocked} busy={operation.busy}
                onFormChange={patch => updateForm(entry, patch)} onReview={decision => void review(entry, decision)} />
            </div></div>}
          </div>;
        })}
      </div>
      <div className={styles.pagination}>
        <p>{copy("السجلات في هذه الصفحة", "Records on this page")}: {queue.entries.length}</p>
        <Button type="button" variant="outline" disabled={operation.busy || page === 0} onClick={() => void selectPage(page - 1, cursors[page - 1])}>{copy("الصفحة السابقة", "Previous page")}</Button>
        <Button type="button" variant="outline" disabled={operation.busy || !queue.nextCursor} onClick={() => void selectPage(page + 1, queue.nextCursor ?? undefined)}>{copy("الصفحة التالية", "Next page")}</Button>
      </div>
    </>}
  </div>;
}
