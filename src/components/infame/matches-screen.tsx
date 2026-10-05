"use client";

import Link from "next/link";
import workflowStyles from "./workflow-layout.module.css";
import styles from "./matches-screen.module.css";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Bookmark, Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { formatMoneyDecimal, type Money } from "@/lib/contracts/money";
import type { Criterion } from "@/lib/matching/types";
import {
  MatchingCampaignResponseSchema, MatchingCampaignSummarySchema, MatchingRunSchema, MatchingDecisionReceiptSchema,
  RunCommandSchema, DecisionCommandSchema, summarizeMatchingCampaign, matchesDecisionReceipt, matchesRunReceipt,
  type MatchingCampaignSummary, type MatchingRunDTO, type MatchingRunCommand, type MatchingDecisionCommand,
} from "@/lib/matching/contracts";

export type { MatchingCampaignSummary } from "@/lib/matching/contracts";
type Candidate = MatchingRunDTO["results"][number];
type Pending = ({ kind: "RUN"; body: MatchingRunCommand } | { kind: "DECISION"; body: MatchingDecisionCommand }) & {
  path: string; json: string; phase: "unknown" | "confirmed" | "conflict"; recordedRunId: string | null;
  minimumCampaignRevision: number; reviewed: boolean;
};
type Batch = { generation: number; abort: AbortController; denied: boolean; timedOut: boolean };
function disposeMatchingBatch(state: {
  mounted: { current: boolean }; active: { current: Batch | null }; generation: { current: number }; inFlight: { current: boolean };
}) {
  state.mounted.current = false; state.active.current?.abort.abort(); state.active.current = null;
  state.generation.current++; state.inFlight.current = false;
}
type Filter = "ALL" | "SAVED" | "DISMISSED";
class RequestFailure extends Error { constructor(public code: string, public status?: number) { super(code); } }
const criteria: { key: Criterion; ar: string; en: string; weight: number }[] = [
  { key: "age", ar: "العمر", en: "Age", weight: 25 }, { key: "niche", ar: "المجال", en: "Niche", weight: 20 },
  { key: "geography", ar: "موقع الجمهور", en: "Audience location", weight: 15 }, { key: "gender", ar: "الجنس", en: "Gender", weight: 10 },
  { key: "engagement", ar: "التفاعل", en: "Engagement", weight: 10 }, { key: "budget", ar: "الميزانية", en: "Budget", weight: 10 },
  { key: "exposure", ar: "مرات الظهور", en: "Exposure", weight: 10 },
];
const formats: Record<string, [string, string]> = { STORY: ["ستوري", "Story"], POST: ["منشور", "Post"], REEL: ["ريل", "Reel"], LIVE: ["بث مباشر", "Live"], CAMPAIGN: ["حزمة حملة", "Campaign package"], VIDEO: ["فيديو", "Video"], SHORT: ["فيديو قصير", "Short"] };
const sources: Record<string, [string, string]> = { API: ["بيانات مصدر متصل", "Connected-source data"], SCREENSHOT_VERIFIED: ["لقطة شاشة راجعها مسؤول", "Admin-reviewed screenshot"], SELF_REPORTED: ["بيانات ذكرها صاحب الحساب", "Self-reported data"], PUBLIC_IMPORT: ["استيراد عام غير موثّق", "Unverified public import"] };
export function MatchesScreen({ initialCampaign, initialRun, accessUnavailable = false, initialReadinessError = null }: { initialCampaign: MatchingCampaignSummary; initialRun: MatchingRunDTO | null; accessUnavailable?: boolean; initialReadinessError?: string | null }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [routeId] = useState(initialCampaign.id);
  const parsedCampaign = MatchingCampaignSummarySchema.safeParse(initialCampaign), parsedRun = MatchingRunSchema.nullable().safeParse(initialRun);
  const [campaign, setCampaign] = useState<MatchingCampaignSummary | null>(accessUnavailable || !parsedCampaign.success ? null : parsedCampaign.data);
  const [run, setRun] = useState<MatchingRunDTO | null>(accessUnavailable || !parsedCampaign.success || !parsedRun.success ? null : parsedRun.data);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(accessUnavailable ? "FORBIDDEN"
    : !parsedCampaign.success || !parsedRun.success ? "INVALID_RESPONSE" : null);
  const [notice, setNotice] = useState<string | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [readRetry, setReadRetry] = useState(false);
  const [unavailable, setUnavailable] = useState(accessUnavailable), [readinessError, setReadinessError] = useState(accessUnavailable ? null : initialReadinessError);
  const inFlight = useRef(false), mounted = useRef(true), generation = useRef(0), activeBatch = useRef<Batch | null>(null);
  const denied = useRef(accessUnavailable), pendingRef = useRef<Pending | null>(null);
  const campaignPath = "/brand/campaigns/" + encodeURIComponent(routeId), apiPath = "/api/campaigns/" + encodeURIComponent(routeId);
  const approved = !!campaign?.currentBriefVersion && ["BRIEF_APPROVED", "SHORTLISTED", "IN_DEALS"].includes(campaign.status);
  const canRun = approved && campaign?.policyReviewed === true && !unavailable;
  useEffect(() => {
    mounted.current = true;
    const cleanupState = { mounted, active: activeBatch, generation, inFlight };
    return () => disposeMatchingBatch(cleanupState);
  }, []);
  const number = (value: number) => new Intl.NumberFormat(isAr ? "ar" : "en", { maximumFractionDigits: 1 }).format(value);
  const percent = (value: number) => `${number(value * 100)}${copy("٪", "%")}`;
  const fraction = (numerator: number, denominator: number) => <bdi dir="ltr">{number(numerator)} / {number(denominator)}</bdi>;
  const money = (value: Money | null) => value ? `${formatMoneyDecimal(value)} ${value.currencyCode}` : copy("غير معروف", "Unknown");
  const date = (value: string) => new Intl.DateTimeFormat(isAr ? "ar" : "en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
  const format = (value: string) => formats[value]?.[isAr ? 0 : 1] ?? value;
  function errorCopy(code: string): string {
    const messages: Record<string, [string, string]> = {
      POLICY_REVIEW_REQUIRED: ["الموجز معتمد، لكن أسواق الحملة تحتاج مراجعة سياسات موثّقة قبل المطابقة. راجع الموجز وانتظر اكتمال المراجعة.", "Your brief is approved, but its markets need a documented policy review before matching. Review the brief and wait for that review."],
      POLICY_OUTCOMES_UNAVAILABLE: ["نتائج السياسات المطلوبة غير متاحة. لا توجد قائمة مؤهلة مؤكدة حاليًا.", "Required policy outcomes are unavailable. An eligible shortlist cannot currently be confirmed."],
      POLICY_UNAVAILABLE: ["مراجعة سياسات السوق المطلوبة غير متاحة أو لم تعد صالحة. راجع الموجز وانتظر مراجعة حالية قبل المتابعة.", "The required market policy review is unavailable or no longer current. Review the brief and wait for a current review before continuing."],
      STALE_VERSION: ["تغيرت النسخة في مكان آخر. حمّل الحالة الحالية قبل أي قرار جديد.", "The version changed elsewhere. Load the current state before another decision."],
      STALE_RUN: ["هذه المطابقة قديمة أو تغيرت صلاحية البيانات. حمّل الحالة الحالية ثم شغّل مطابقة جديدة.", "This run is stale or data permissions changed. Load the current state, then run matching again."],
      NETWORK: ["تعذر تأكيد نتيجة الطلب. أعد نفس الطلب بأمان أو حمّل الحالة الحالية.", "The request result could not be confirmed. Retry the same request safely or load the current state."],
      INVALID_RESPONSE: ["وصل رد لا يمكن تأكيده. احتفظنا بالحالة السابقة وطلبك نفسه؛ استخدم الاستعادة قبل إجراء جديد.", "The reply could not be confirmed. Previous state and the same request are retained; recover before another action."],
      TIMEOUT: ["استغرق الطلب وقتًا طويلًا. نتيجة الحفظ قد تكون غير مؤكدة؛ احتفظنا بالطلب نفسه للاستعادة.", "The request timed out. The save outcome may be uncertain; the same request is retained for recovery."],
      CANCELLED: ["أُلغي الانتظار. قد يكون الحفظ وصل للخادم؛ استعد الطلب نفسه قبل أي إجراء جديد.", "Waiting was cancelled. The save may have reached the server; recover the same request before another action."],
      FORBIDDEN: ["هذا الإجراء غير متاح لحسابك حاليًا. تحقق من البريد وصلاحية الحساب.", "This action is unavailable to your account. Check email verification and account access."],
      UNAUTHENTICATED: ["انتهت الجلسة. سجّل دخولك لاستكمال الحملة.", "Your session ended. Sign in to continue the campaign."],
      NOT_FOUND: ["الحملة أو النتيجة غير متاحة لهذا الحساب.", "This campaign or result is unavailable to this account."],
      OFFER_ALREADY_SENT: ["لهذا الصانع عرض قائم؛ لا يمكن تغيير قراره من القائمة.", "This creator has an existing offer; its decision cannot be changed here."],
      CANDIDATE_LIMIT_EXCEEDED: ["يلزم استكمال تجهيز فهرس المرشحين قبل هذه المطابقة. حاول لاحقًا.", "Candidate indexing needs to be completed before this run. Try again later."],
    };
    return messages[code]?.[isAr ? 0 : 1] ?? copy("تعذر تنفيذ الإجراء. حمّل الحالة الحالية وحاول مرة ثانية.", "The action failed. Load the current state and try again.");
  }
  function updatePending(next: Pending | null) { pendingRef.current = next; setPending(next); }
  function ownedBatch(batch: Batch) { return mounted.current && activeBatch.current === batch && generation.current === batch.generation; }
  function currentBatch(batch: Batch) { return ownedBatch(batch) && !batch.denied && !denied.current && !batch.abort.signal.aborted; }
  function deny(batch: Batch, status: number) {
    if (!ownedBatch(batch) || batch.denied) return;
    batch.denied = true; denied.current = true;
    setCampaign(null); setRun(null); setFilter("ALL"); updatePending(null); setNotice(null); setReadinessError(null); setReadRetry(false);
    setUnavailable(true); setError(status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "NOT_FOUND");
  }
  function applyScopedFailure(batch: Batch, code: string) {
    if (!ownedBatch(batch) || batch.denied || denied.current) return;
    if (code === "POLICY_UNAVAILABLE") { setRun(null); setReadinessError(code); }
    if (code === "STALE_RUN" || code === "STALE_VERSION") setRun(previous => previous
      ? { ...previous, stale: true, results: previous.results.map(row => ({ ...row, stale: true })) } : previous);
  }
  async function request(batch: Batch, path: string, json?: string): Promise<unknown> {
    let response: Response;
    try { response = await fetch(path, { method: json === undefined ? "GET" : "POST", cache: "no-store", signal: batch.abort.signal,
      ...(json === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: json }) }); }
    catch { throw new RequestFailure(batch.abort.signal.aborted ? "CANCELLED" : "NETWORK"); }
    if (!ownedBatch(batch)) throw new RequestFailure("CANCELLED");
    // The actual owning-campaign/explicit-run endpoints use these statuses for
    // access loss. A denial wins over cancellation and precedes all JSON work.
    if ([401, 403, 404].includes(response.status)) { deny(batch, response.status); throw new RequestFailure("DENIED", response.status); }
    if (!currentBatch(batch)) throw new RequestFailure(batch.denied ? "DENIED" : "CANCELLED");
    if (!response.ok) {
      let code = response.status === 503 ? "RETRY_REQUIRED" : "REQUEST_FAILED";
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
          && "code" in body.error && typeof body.error.code === "string" && /^[A-Z_]{1,80}$/.test(body.error.code)) code = body.error.code;
      } catch { /* A failure body cannot change the observed HTTP status. */ }
      applyScopedFailure(batch, code);
      throw new RequestFailure(code, response.status);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new RequestFailure("INVALID_RESPONSE"); }
    if (!currentBatch(batch)) throw new RequestFailure(batch.denied ? "DENIED" : "CANCELLED");
    if (!body || typeof body !== "object" || Array.isArray(body) || !("data" in body)) throw new RequestFailure("INVALID_RESPONSE");
    return body.data;
  }
  async function readPair(batch: Batch, explicitRunId?: string, minimumRevision = 0) {
    const path = apiPath + "/matches" + (explicitRunId ? "?runId=" + encodeURIComponent(explicitRunId) : "");
    // Every response processes its status independently; early failure must not
    // abandon a sibling's later authoritative denial.
    const responses = await Promise.allSettled([request(batch, apiPath), request(batch, path)]);
    if (!currentBatch(batch)) throw new RequestFailure(batch.denied ? "DENIED" : "CANCELLED");
    const campaignResponse = responses[0]!, runResponse = responses[1]!;
    if (campaignResponse.status === "rejected") throw campaignResponse.reason;
    if (runResponse.status === "rejected") throw runResponse.reason;
    const nextCampaign = MatchingCampaignResponseSchema.safeParse(campaignResponse.value);
    const nextRun = MatchingRunSchema.nullable().safeParse(runResponse.value);
    if (!nextCampaign.success || !nextRun.success || nextCampaign.data.id !== routeId
      || nextCampaign.data.revision < minimumRevision
      || explicitRunId !== undefined && (!nextRun.data || nextRun.data.runId !== explicitRunId)) throw new RequestFailure("INVALID_RESPONSE");
    const summary = MatchingCampaignSummarySchema.safeParse(summarizeMatchingCampaign(nextCampaign.data));
    if (!summary.success) throw new RequestFailure("INVALID_RESPONSE");
    return { campaign: summary.data, run: nextRun.data && nextRun.data.briefVersion !== summary.data.currentBriefVersion
      ? { ...nextRun.data, stale: true, results: nextRun.data.results.map(row => ({ ...row, stale: true })) } : nextRun.data };
  }
  function applyPair(batch: Batch, pair: { campaign: MatchingCampaignSummary; run: MatchingRunDTO | null }) {
    if (!currentBatch(batch)) throw new RequestFailure(batch.denied ? "DENIED" : "CANCELLED");
    setCampaign(pair.campaign); setRun(pair.run); setUnavailable(false); setReadinessError(null); setReadRetry(false);
  }
  async function withBatch(work: (batch: Batch) => Promise<void>) {
    if (inFlight.current || denied.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const batch: Batch = { generation: ++generation.current, abort: new AbortController(), denied: false, timedOut: false };
    activeBatch.current = batch;
    const timer = setTimeout(() => { batch.timedOut = true; batch.abort.abort(); }, 30_000);
    try { await work(batch); }
    catch (caught) {
      if (ownedBatch(batch) && !batch.denied && !denied.current) {
        const code = batch.timedOut ? "TIMEOUT" : batch.abort.signal.aborted ? "CANCELLED"
          : caught instanceof RequestFailure ? caught.code : "REQUEST_FAILED";
        applyScopedFailure(batch, code); setError(code);
      }
    } finally {
      clearTimeout(timer);
      if (ownedBatch(batch)) { activeBatch.current = null; inFlight.current = false; setBusy(false); }
    }
  }
  async function recover(batch: Batch, command: Pending) {
    if (command.phase !== "confirmed" || !command.recordedRunId) throw new RequestFailure("INVALID_RESPONSE");
    setReadRetry(true);
    const pair = await readPair(batch, command.recordedRunId, command.minimumCampaignRevision);
    applyPair(batch, pair);
    if (command.kind === "RUN") setFilter("ALL");
    updatePending(null); setNotice(command.kind === "RUN" ? "MATCHED" : "DECISION_SAVED");
  }
  async function reload() {
    if (inFlight.current || denied.current) return;
    await withBatch(async batch => {
      const captured = pendingRef.current;
      if (captured?.phase === "confirmed") { await recover(batch, captured); return; }
      setReadRetry(true);
      const pair = await readPair(batch); applyPair(batch, pair);
      if (captured?.phase === "conflict") updatePending({ ...captured, reviewed: true });
      setNotice("RELOADED");
    });
  }
  async function send(command: Pending) {
    if (inFlight.current || denied.current || command.phase !== "unknown"
      || pendingRef.current && pendingRef.current !== command) return;
    updatePending(command);
    await withBatch(async batch => {
      try {
        const data = await request(batch, command.path, command.json);
        let recordedRunId: string;
        if (command.kind === "RUN") {
          const result = MatchingRunSchema.safeParse(data);
          if (!result.success || !matchesRunReceipt(command.body, result.data)) throw new RequestFailure("INVALID_RESPONSE");
          recordedRunId = result.data.runId;
        } else {
          const result = MatchingDecisionReceiptSchema.safeParse(data);
          if (!result.success || !matchesDecisionReceipt(command.body, result.data)) throw new RequestFailure("INVALID_RESPONSE");
          recordedRunId = command.body.runId;
        }
        if (!currentBatch(batch)) throw new RequestFailure(batch.denied ? "DENIED" : "CANCELLED");
        // Retain only receipt identity/history. Cards and decisions are displayed
        // exclusively after the owning campaign + explicit current run GET pair.
        const confirmed: Pending = { ...command, phase: "confirmed", recordedRunId };
        updatePending(confirmed); await recover(batch, confirmed);
      } catch (caught) {
        if (currentBatch(batch) && pendingRef.current?.phase !== "confirmed" && caught instanceof RequestFailure
          && caught.status !== undefined && caught.status >= 400 && caught.status < 500) {
          updatePending({ ...command, phase: "conflict", reviewed: false });
        }
        throw caught;
      }
    });
  }
  function start() {
    if (inFlight.current || denied.current || !canRun || !campaign?.currentBriefVersion || pendingRef.current) return;
    const result = RunCommandSchema.safeParse({ operationKey: crypto.randomUUID(), expectedBriefVersion: campaign.currentBriefVersion, expectedCampaignRevision: campaign.revision });
    if (!result.success) { setError("INVALID_COMMAND"); return; }
    const body = Object.freeze(result.data);
    void send({ kind: "RUN", path: apiPath + "/matches", body, json: JSON.stringify(body), phase: "unknown", recordedRunId: null, minimumCampaignRevision: campaign.revision, reviewed: false });
  }
  function decide(row: Candidate, decision: "NONE" | "SAVED" | "DISMISSED") {
    if (inFlight.current || denied.current || !campaign || !run || run.stale || row.stale || pendingRef.current) return;
    const result = DecisionCommandSchema.safeParse({ operationKey: crypto.randomUUID(), expectedBriefVersion: run.briefVersion,
      runId: run.runId, creatorId: row.creatorId, expectedDecisionRevision: row.decision?.revision ?? 0, decision });
    if (!result.success) { setError("INVALID_COMMAND"); return; }
    const body = Object.freeze(result.data);
    void send({ kind: "DECISION", path: apiPath + "/matches/decisions", body, json: JSON.stringify(body), phase: "unknown", recordedRunId: null, minimumCampaignRevision: campaign.revision, reviewed: false });
  }
  function guardNavigation(event: MouseEvent<HTMLElement>) {
    if ((inFlight.current || pendingRef.current) && event.target instanceof Element && event.target.closest("a")) event.preventDefault();
  }
  const visible = run?.results.filter((row) => filter === "SAVED" ? row.decision?.decision === "SAVED" : filter === "DISMISSED" ? row.decision?.decision === "DISMISSED" : row.decision?.decision !== "DISMISSED") ?? [];
  const statusCopy = !campaign || unavailable ? null : !approved ? copy("اعتمد أحدث موجز للحملة قبل المطابقة.", "Approve the latest campaign brief before matching.") : !campaign.policyReviewed ? errorCopy("POLICY_REVIEW_REQUIRED") : readinessError ? errorCopy(readinessError) : run?.readiness !== undefined && run.readiness !== "READY" ? errorCopy(run.readiness) : null;
  return <section className={`${workflowStyles.page} ${styles.page} space-y-[22px]`} aria-busy={busy}
    onClickCapture={guardNavigation} onAuxClickCapture={guardNavigation}>
    <div className={styles.header}>
      <div className={styles.heading}>
        <Button asChild variant="ghost" className="max-w-full"><Link href={campaign ? campaignPath : "/brand/campaigns"} prefetch={false}>{campaign ? copy("ارجع للموجز", "Back to brief") : copy("ارجع للحملات", "Back to campaigns")}</Link></Button>
        {campaign && <p className={styles.campaign}><span aria-hidden="true">✦ </span><span dir="auto">{campaign.title}</span></p>}
        <h1 className={styles.title}>{copy("صنّاع المحتوى المناسبون", "Creator matches")}</h1>
        <p className={styles.subtitle}>{copy("مطابقة محسوبة من متطلبات الحملة والبيانات المسموح بمشاركتها. تظهر فقط النتائج بدرجة ٦٠ أو أكثر، وبحد أقصى ١٢ نتيجة.", "Matching uses campaign requirements and permitted data. Only scores of 60 or above appear, with at most 12 results.")}</p>
      </div>
      {campaign && !unavailable && <div className={styles.toolbar}>
        <Button variant="outline" onClick={() => void reload()} disabled={busy}><RefreshCw aria-hidden="true" />{copy("حمّل الحالة الحالية", "Load current state")}</Button>
        <Button onClick={start} disabled={busy || !canRun || !!pending}>{busy ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" />}{run ? copy("مطابقة جديدة", "Run again") : copy("ابدأ المطابقة", "Run matching")}</Button>
      </div>}
    </div>
    <div aria-live="polite" className="space-y-3">{busy && <p className="flex items-center gap-2 text-base"><Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{copy("جارٍ تنفيذ الطلب…", "Processing your request…")}</p>}{notice && <p className="text-base">{notice === "DECISION_SAVED" ? copy("تم حفظ قرارك.", "Your decision was saved.") : notice === "RELOADED" ? copy("تم تحميل الحالة الحالية.", "The current state was loaded.") : copy("تمت المطابقة وحُفظت النتيجة.", "Matching completed and the result was saved.")}</p>}</div>
    {busy && <Button variant="outline" onClick={() => activeBatch.current?.abort.abort()}>{copy("إلغاء الانتظار", "Cancel waiting")}</Button>}
    {error && <Card role="alert" className="border-destructive"><CardContent className="space-y-3 text-base"><p>{errorCopy(error)}</p>{error === "UNAUTHENTICATED" && <Button asChild variant="outline"><Link href="/login" prefetch={false}>{copy("سجّل دخولك", "Sign in")}</Link></Button>}</CardContent></Card>}
    {pending?.phase === "unknown" && !busy && <Card><CardContent className="space-y-3 text-base"><p>{copy("نتيجة الطلب غير مؤكدة. يمكنك تحميل الحالة الحالية؛ يبقى الطلب الأصلي محفوظًا وتبقى الإجراءات الجديدة متوقفة حتى استعادته.", "The request outcome is uncertain. You can load current state; the original request remains saved and new actions remain paused until recovery.")}</p><Button variant="outline" disabled={busy} onClick={() => pendingRef.current && void send(pendingRef.current)}>{copy("أعد نفس الطلب", "Retry the same request")}</Button></CardContent></Card>}
    {pending?.phase === "confirmed" && <Card><CardContent className="space-y-3 text-base"><p>{copy("وصل تأكيد الطلب. استكمل تحميل الحالة الحالية قبل إجراء جديد؛ لن نرسل طلب الحفظ مجددًا.", "The receipt arrived. Finish loading current state before another action; the save request will not be sent again.")}</p><Button variant="outline" disabled={busy} onClick={() => void reload()}>{copy("استكمل تحميل الحالة الحالية", "Finish loading current state")}</Button></CardContent></Card>}
    {pending?.phase === "conflict" && <Card><CardContent className="space-y-3 text-base"><p>{copy("رفض الخادم الطلب. حمّل الحالة الحالية وراجعها قبل بدء إجراء جديد.", "The server rejected the request. Load and review current state before starting another action.")}</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => void reload()}>{copy("تحميل للمراجعة", "Reload for review")}</Button><Button variant="outline" disabled={busy || !pending.reviewed} onClick={() => { if (!inFlight.current && pendingRef.current?.phase === "conflict" && pendingRef.current.reviewed) updatePending(null); }}>{copy("راجعت؛ إنهاء الطلب المرفوض", "Reviewed; dismiss rejected request")}</Button></div></CardContent></Card>}
    {readRetry && !pending && !unavailable && <Button variant="outline" disabled={busy} onClick={() => void reload()}>{copy("إعادة محاولة التحميل", "Retry loading")}</Button>}
    {statusCopy && <Card><CardHeader><CardTitle>{copy("جاهزية المطابقة", "Matching readiness")}</CardTitle><CardDescription className="text-base leading-7">{statusCopy}</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href={unavailable ? "/verify-email" : campaignPath}>{unavailable ? copy("تحقق من البريد", "Verify email") : copy("راجع الموجز", "Review brief")}</Link></Button></CardContent></Card>}
    {run?.stale && <Card><CardHeader><CardTitle>{copy("هذه القائمة قديمة", "This shortlist is stale")}</CardTitle><CardDescription className="text-base leading-7">{copy("تغير الموجز أو بيانات المرشحين أو السياسات منذ هذه المطابقة. القرارات متوقفة؛ حمّل الحالة الحالية وأعد المطابقة بعد استكمال المتطلبات.", "The brief, candidate data or policies changed since this run. Decisions are paused; load the current state and run again after completing requirements.")}</CardDescription></CardHeader></Card>}
    {run && <div className="space-y-3 text-base"><p>{copy("نسخة الموجز", "Brief version")} {number(run.briefVersion)} · <time dateTime={run.createdAt}>{date(run.createdAt)}</time> · UTC</p><p className={styles.basis}>{copy(`هذه مقارنة على حصة المقعد الأول من ميزانية ${number(run.desiredCreatorCount)} صانع. لا تحجز ميزانية ولا تخصص مقعدًا فعليًا؛ يتحدد ذلك عند إنشاء عرض.`, `This compares each candidate with the first slot in a budget planned for ${number(run.desiredCreatorCount)} creators. It reserves no budget or actual slot; those are assigned when an offer is created.`)}</p><div className="flex flex-wrap gap-2" role="group" aria-label={copy("عرض القرارات", "Filter decisions")}>{(["ALL", "SAVED", "DISMISSED"] as const).map((value) => <Button key={value} variant={filter === value ? "secondary" : "outline"} aria-pressed={filter === value} disabled={busy || unavailable} onClick={() => { if (!inFlight.current && !denied.current) setFilter(value); }}>{value === "ALL" ? copy("القائمة", "Shortlist") : value === "SAVED" ? copy("المحفوظة", "Saved") : copy("المستبعدة", "Dismissed")}</Button>)}</div></div>}
    {campaign && (!visible.length ? <Card><CardHeader><CardTitle>{!run ? copy("القائمة تبدأ من موجزك", "Your shortlist starts with your brief") : run.results.length ? copy("لا توجد نتائج في هذا العرض", "No results in this view") : copy("لا توجد نتائج مؤهلة حاليًا", "No qualifying matches yet")}</CardTitle><CardDescription className="text-base leading-7">{!run ? copy("بعد اعتماد الموجز واكتمال مراجعة السياسات، شغّل المطابقة. لا تبدأ المطابقة عند فتح الصفحة.", "After brief approval and policy review, run matching. Opening this page does not start a run.") : run.results.length ? copy("غيّر عرض القرارات لرؤية بقية النتائج.", "Change the decision filter to see the other results.") : copy("راجع القيود والميزانية والخدمات المطلوبة أو انتظر بيانات حديثة ومسموحًا بمشاركتها. القائمة لا تُملأ بنتائج أقل من الحد.", "Review constraints, budget and requested services, or wait for fresh permitted data. The shortlist is never filled with below-threshold results.")}</CardDescription></CardHeader></Card> : <ul className={styles.list}>{visible.map((row) => <li key={row.creatorId}>
      <article className={styles.matchCard}>
        <div className={styles.summary}>
          <div className={styles.scoreColumn}>
            <div className={styles.avatar} aria-hidden="true">{Array.from(row.creator.displayName.trim())[0] ?? "@"}</div>
            <div className={styles.score}><div className={styles.scoreValue}>{number(row.score)}{copy("٪", "%")}</div><div className={styles.scoreLabel}>{copy("درجة المطابقة", "Match score")}</div></div>
          </div>
          <div className={styles.identity}>
            <h2 dir="auto" className={styles.name}>{row.creator.displayName}</h2>
            <p dir="ltr" className={styles.handle}>@{row.creator.handle}</p>
            <div className={styles.facts}>
              <p>{copy("توافق المتطلبات", "Requirement fit")}: {percent(row.weightedFit)}</p>
              <p>{copy("الثقة في البيانات", "Data confidence")}: {percent(row.rawConfidence)}</p>
              <p>{copy("معايير معروفة", "Known criteria")}: {fraction(row.completeness.known, row.completeness.total)}</p>
            </div>
            <ul className={styles.chips} aria-label={copy("الخدمات في مقارنة التكلفة", "Services in the quote comparison")}>
              {row.quote.rows.map((item, index) => <li key={index} className={styles.chip}><bdi dir="ltr">{item.deliverable.platform}</bdi> · {format(item.deliverable.format)}</li>)}
            </ul>
            {row.reasons.length > 0 && <p className={styles.reason}><strong>{copy("سبب المطابقة", "Why match")}: </strong>{row.reasons[0].text[isAr ? "ar" : "en"]}</p>}
            {row.prospect && <p className={styles.prospect}>{copy("ملف لم يطالب به صاحبه بعد. يلزم قبول المطالبة وإثبات الحساب قبل صفقة قابلة للتنفيذ.", "Unclaimed prospect. The creator must claim the profile and prove the account before an executable deal.")}</p>}
          </div>
          <div className={styles.actions}>{row.decision?.decision === "OFFER_SENT" ? <p>{copy("أُرسل عرض لهذا الصانع", "An offer was sent to this creator")}</p> : <><Button variant={row.decision?.decision === "SAVED" ? "secondary" : "outline"} disabled={busy || !!pending || row.stale || !!run?.stale} aria-pressed={row.decision?.decision === "SAVED"} onClick={() => decide(row, row.decision?.decision === "SAVED" ? "NONE" : "SAVED")}><Bookmark aria-hidden="true" />{row.decision?.decision === "SAVED" ? copy("إلغاء الحفظ", "Unsave") : copy("احفظ الصانع", "Save creator")}</Button><Button variant="ghost" disabled={busy || !!pending || row.stale || !!run?.stale} onClick={() => decide(row, row.decision?.decision === "DISMISSED" ? "NONE" : "DISMISSED")}><X aria-hidden="true" />{row.decision?.decision === "DISMISSED" ? copy("أعده للقائمة", "Restore to shortlist") : copy("استبعد", "Dismiss")}</Button>{!row.prospect && row.executableOffer && row.score >= 60 && !row.stale && !run?.stale && !busy && !pending && run && <Button asChild><Link href={`/brand/deals/new?campaignId=${encodeURIComponent(routeId)}&creatorId=${encodeURIComponent(row.creatorId)}&matchRunId=${encodeURIComponent(run.runId)}`} prefetch={false}>{copy("جهّز عرضًا", "Prepare offer")}</Link></Button>}</>}</div>
        </div>
        <div className={styles.details + " space-y-5"}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{criteria.map((criterion) => <div key={criterion.key} className="min-w-0 rounded-lg bg-muted p-3"><dt className="text-sm text-muted-foreground">{copy(criterion.ar, criterion.en)} · {number(criterion.weight)}{copy("٪", "%")}</dt><dd className="mt-1 font-medium">{row.subscores[criterion.key] === null ? copy("غير معروف", "Unknown") : percent(row.subscores[criterion.key]!)}</dd></div>)}</dl>
      <div className="space-y-2 rounded-lg border p-4"><h3 className="font-medium">{copy("تكلفة الخدمات", "Service quote")}</h3><p>{row.quote.coverage === "FULL" ? copy("تغطية كاملة", "Full coverage") : row.quote.coverage === "PARTIAL" ? copy("تغطية جزئية", "Partial coverage") : copy("التكلفة غير متاحة", "Quote missing")}</p><p>{row.quote.total ? copy("الإجمالي المعروف", "Known total") : copy("مجموع الخدمات المسعّرة فقط", "Priced-service subtotal only")}: <bdi dir="ltr" className="whitespace-nowrap">{money(row.quote.total ?? row.quote.subtotal)}</bdi></p><p>{copy("حصة المقارنة للمقعد الأول", "First-slot comparison allocation")}: <bdi dir="ltr" className="whitespace-nowrap">{money(row.allocation)}</bdi></p>{!row.quote.minimumKnown && <p className="text-muted-foreground">{copy("الحد الأدنى للصفقة غير معروف؛ لا يمكن تأكيد التكلفة الكاملة.", "The minimum deal amount is unknown; a complete quote cannot be confirmed.")}</p>}<ul className="space-y-2">{row.quote.rows.map((item, index) => <li key={index} className="flex flex-wrap justify-between gap-2"><span><bdi dir="ltr">{item.deliverable.platform}</bdi> · {format(item.deliverable.format)} × {number(item.deliverable.count)}</span><bdi dir="ltr" className="whitespace-nowrap">{money(item.amount)}</bdi></li>)}{row.quote.unsupported.map((item, index) => <li key={`unsupported-${index}`}><bdi dir="ltr">{item.platform}</bdi> · {format(item.format)} × {number(item.count)} — {copy("خدمة غير مدعومة في هذه البيانات", "Unsupported in available data")}</li>)}</ul>{row.quote.coverage !== "FULL" && <p className="text-muted-foreground">{copy("المبلغ الجزئي لا يُعمم على بقية الخدمات. لا يُستنتج سعر صفر ولا تُحوّل العملات تلقائيًا.", "Partial amounts are not extrapolated to other services. Unknown is not zero, and currencies are not converted automatically.")}</p>}</div>
      <div className="space-y-2"><h3 className="font-medium">{copy("مرات الظهور التقديرية", "Estimated impressions")}</h3><p>{row.estimatedImpressions.total === null ? row.estimatedImpressions.knownSubtotal === null ? copy("غير معروفة", "Unknown") : `${number(row.estimatedImpressions.knownSubtotal)} · ${copy("تقدير جزئي", "Partial estimate")}` : number(row.estimatedImpressions.total)}</p><p className="leading-7 text-muted-foreground">{copy("تقدير وليست نتيجة مضمونة أو جمهورًا فريدًا. عند نقص المشاهدات، أي تقدير مبني على المتابعين موسوم كفرضية.", "This is an estimate, not guaranteed results or unique audience. Estimates based on followers are explicitly labelled as hypotheses.")}</p><ul className="space-y-2">{row.estimatedImpressions.rows.map((item, index) => <li key={index}><bdi dir="ltr">{item.deliverable.platform}</bdi> · {format(item.deliverable.format)}: {item.estimatedImpressions === null ? copy("غير معروف", "Unknown") : number(item.estimatedImpressions)} · {item.basis === "FOLLOWER_HYPOTHESIS" ? copy("فرضية من المتابعين", "Follower hypothesis") : item.basis === "OBSERVED_AVERAGE" ? copy("متوسط ملاحظ للخدمة", "Observed service average") : copy("أساس غير متاح", "Basis unavailable")}{item.observedUnit && <span className="text-muted-foreground"> · {item.observedUnit === "VIEWS" ? copy("وحدة المصدر: مشاهدات", "Source unit: views") : copy("وحدة المصدر: مرات ظهور", "Source unit: impressions")}</span>}{item.window && <span className="text-muted-foreground"> · {date(item.window.startsAt)} — {date(item.window.endsAt)} UTC</span>}{item.definition && <p dir="auto" className="break-words text-sm text-muted-foreground">{item.definition}</p>}</li>)}</ul></div>
      <details className="rounded-lg border p-4"><summary className="min-h-11 cursor-pointer content-center font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{copy("التفسير ومصادر البيانات", "Explanation and data sources")}</summary><div className="mt-4 space-y-4"><p className="leading-7 text-muted-foreground">{copy("الثقة تتبع أضعف مصدر مستخدم في الحساب. المعيار غير المعروف يأخذ ٠٫٥ للحساب فقط؛ وتوافق المجال المحدد بدون معلومات ذات صلة يأخذ صفرًا. موقع الجمهور مستقل عن بلد إقامة الصانع.", "Confidence follows the weakest contributing source. An unknown criterion uses 0.5 only in the calculation; a specified niche without relevant information scores zero. Audience location is separate from creator residence.")}</p><ul className="space-y-3">{row.reasons.map((reason, index) => <li key={index} className="leading-7">{reason.criterion && <strong>{criteria.find((criterion) => criterion.key === reason.criterion)?.[isAr ? "ar" : "en"]}: </strong>}{reason.text[isAr ? "ar" : "en"]}</li>)}</ul><ul className="space-y-2">{row.provenance.map((evidence) => <li key={evidence.version} className="text-sm leading-6">{sources[evidence.source]?.[isAr ? 0 : 1] ?? evidence.source} · <time dateTime={evidence.evidenceAt}>{date(evidence.evidenceAt)}</time> UTC</li>)}</ul><p className="text-sm text-muted-foreground">{copy("طريقة الحساب", "Calculation version")}: <bdi dir="ltr" className="break-all">{row.strategyId}</bdi></p></div></details>
        </div>
      </article>
    </li>)}</ul>)}
  </section>;
}
