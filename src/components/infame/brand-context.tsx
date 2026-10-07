"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigationGuardRegistrar, GuardedLink, type NavigationGuard } from "@/components/shells/navigation-guard";
import { ContextReferenceFiles, ContextReferenceVersionFiles, OwnerReviewReferenceFiles,
  type ReferenceEditorState, type ReferenceStateRegistrar } from "./context-reference-files";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { ClientAuthoritySchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { PlanningScopeSchema, BrandContextCommandSchema, BrandContextCommandResultSchema, BrandContextContentSchema,
  BrandContextNameSchema, BrandContextListSchema, BrandContextDetailResponseSchema, ContextOwnerReviewsSchema,
  ContextOwnerReviewResponseSchema, ContextOwnerReviewCommandSchema, ContextOwnerReviewResultSchema,
  type PlanningScope, type BrandContextContent, type BrandContextCommand, type BrandContextCommandResult,
  type BrandContextList, type BrandContextDetailResponse, type ContextOwnerReviews,
  type ContextOwnerReviewResponse, type ContextOwnerReviewResult } from "@/lib/brand-context/contracts";
import type { BrandContextScreenProps, ContextOwnerReviewsScreenProps } from "@/lib/brand-context/ui-contract";
import styles from "./brand-context.module.css";

type Copy = (ar: string, en: string) => string;
type Original = { text: string; language: string | null };
type NullableOriginal = { text: string | null; language: string | null };
type Detail = BrandContextDetailResponse["context"];
type Review = ContextOwnerReviewResponse["review"];
type ReviewCommand = z.infer<typeof ContextOwnerReviewCommandSchema>;
type Position = { after: string | null; history: (string | null)[] };
type Editor = { id: string | null; revision: number; inputRevision: number; archived: boolean;
  nameOriginal: Original; content: BrandContextContent; baseline: string };
type Pending<C, R> = { command: C; body: string; phase: "unknown" | "confirmed" | "conflict"; receipt: R | null; reviewed: boolean };
type ContextPending = Pending<BrandContextCommand, BrandContextCommandResult> & { expectedInputRevision: number };
type ReviewPending = Pending<ReviewCommand, ContextOwnerReviewResult> & { contextId: string; scope: PlanningScope; source: Review };
type Task = { controller: AbortController; generation: number; denied: boolean; timedOut: boolean };
const emptyPosition = (): Position => ({ after: null, history: [] });
const noPlan = Symbol("NO_PLAN");
const denialCodes = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"];
const knownCodes = new Set(["STALE_VERSION", "STALE_REVIEW", "REVIEW_DECIDED", "OPERATION_KEY_REUSED", "ARCHIVED",
  "INVALID_STATE", "REVISION_EXHAUSTED", "VALIDATION", "RETRY_REQUIRED", "STALE_AUTHORITY"]);
class UiFailure extends Error { constructor(readonly code: string, readonly status?: number) { super(code); } }
function definiteRejection(failure: unknown) {
  return failure instanceof UiFailure && failure.status !== undefined && [400, 409, 422].includes(failure.status);
}
function sameScope(a: PlanningScope | null, b: PlanningScope | null) {
  return a !== null && b !== null && a.kind === b.kind && (a.kind === "OWN_BRAND"
    ? b.kind === "OWN_BRAND" && a.brandId === b.brandId : b.kind === "CLIENT" && a.clientId === b.clientId);
}
function params(scope: PlanningScope) { return new URLSearchParams(scope.kind === "OWN_BRAND"
  ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId }); }
function data(body: unknown): unknown { return body && typeof body === "object" && !Array.isArray(body) && "data" in body ? body.data : null; }
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) throw new UiFailure("INVALID_RESPONSE"); return result.data;
}
function fingerprint(nameOriginal: Original, content: BrandContextContent) { return JSON.stringify({ nameOriginal, content }); }
function blankEditor(): Editor {
  const nameOriginal = { text: "", language: null }, content: BrandContextContent = { schemaVersion: 1,
    positioning: { text: null, language: null }, tone: { text: null, language: null }, values: [], references: [], competitors: [] };
  return { id: null, revision: 0, inputRevision: 0, archived: false, nameOriginal, content, baseline: fingerprint(nameOriginal, content) };
}
function editorFor(context: Detail): Editor { return { id: context.id, revision: context.revision, inputRevision: context.inputRevision,
  archived: context.archived, nameOriginal: context.nameOriginal, content: context.content, baseline: fingerprint(context.nameOriginal, context.content) }; }
function dirty(editor: Editor) { return editor.baseline !== fingerprint(editor.nameOriginal, editor.content); }
function authorityMatches(plan: ClientAuthorityDTO, current: ClientAuthorityDTO | null) {
  return current !== null && ["organizationId", "clientId", "brandId", "membershipId", "grantId", "organizationRevision",
    "membershipRevision", "clientRevision", "grantRevision"].every(key => plan[key as keyof ClientAuthorityDTO] === current[key as keyof ClientAuthorityDTO]);
}
function message(code: string, copy: Copy) {
  if (code === "UNAUTHENTICATED") return copy("انتهت صلاحية الجلسة. سجّل الدخول مجددًا.", "Your session is unavailable. Sign in again.");
  if (code === "FORBIDDEN" || code === "NOT_FOUND") return copy("لم يعد هذا المحتوى متاحًا لك في النطاق الحالي.", "This content is unavailable in your current scope.");
  if (["STALE_VERSION", "STALE_AUTHORITY", "STALE_REVIEW"].includes(code)) return copy("تغيّرت الحالة المحفوظة. حدّثها وراجعها قبل طلب جديد؛ كلماتك محفوظة هنا.", "Saved state changed. Reload and review it before a new request; your words remain here.");
  if (code === "REVIEW_DECIDED") return copy("اتُخذ قرار لهذا الطلب بالفعل. حدّث الحالة الحالية.", "This submission was already decided. Reload its current state.");
  if (code === "VALIDATION") return copy("تحقق من الاسم واللغات والحدود وروابط HTTPS. تبقى كلماتك كما كتبتها.", "Check the name, language tags, limits and HTTPS links. Your words remain as entered.");
  if (code === "WRITE_UNAVAILABLE") return copy("صلاحية التخطيط غير متاحة الآن. تم التحقق من العرض الحالي، وتبقى كلماتك غير المحفوظة.", "Planning permission is unavailable. Current view access was checked; your unsaved words remain.");
  if (code === "EDITOR_OPEN") return copy("راجع كلماتك غير المحفوظة قبل فتح سياق آخر.", "Review your unsaved words before opening another context.");
  if (code === "CANCELLED") return copy("توقف الانتظار. يمكنك إعادة القراءة؛ الطلب غير المؤكد يحتفظ بمفتاحه الأصلي.", "Waiting stopped. You can retry the read; an uncertain request keeps its original key.");
  if (code === "TIMEOUT") return copy("انتهت مهلة الانتظار. أعد القراءة أو أعد الطلب نفسه دون تغييره.", "Waiting timed out. Retry the read or the same unchanged request.");
  if (code === "OPERATION_KEY_REUSED") return copy("تعذر استخدام مفتاح الطلب لهذه العملية. تحقّق من الحالة وراجعها قبل طلب جديد.", "This request key cannot be used for this action. Check and review current state before a new request.");
  if (code === "REVISION_EXHAUSTED") return copy("بلغ هذا السجل حد النسخ؛ لا يمكن إجراء تعديل جديد.", "This record reached its revision limit and cannot accept another change.");
  if (code === "ARCHIVED" || code === "INVALID_STATE") return copy("لا تسمح الحالة الحالية بهذا الإجراء. حدّثها وراجعها.", "Current state does not allow this action. Reload and review it.");
  return copy("تعذر تأكيد الحالة الحالية. آخر عرض صالح وكلماتك محفوظان؛ حاول مجددًا.", "Current state could not be confirmed. The last valid view and your words remain; try again.");
}
function invalidate(refs: { mounted: { current: boolean }; generation: { current: number }; active: { current: Task | null } }) {
  refs.mounted.current = false; refs.generation.current++; refs.active.current?.controller.abort(); refs.active.current = null;
}
function useRequests(onDeny: (status: number) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const active = useRef<Task | null>(null), generation = useRef(0), mounted = useRef(true), denial = useRef(onDeny);
  useEffect(() => { denial.current = onDeny; }, [onDeny]);
  useEffect(() => { mounted.current = true; const refs = { mounted, generation, active }; return () => invalidate(refs); }, []);
  function same(task: Task) { return mounted.current && active.current === task && generation.current === task.generation; }
  function ensure(task: Task) { if (!same(task) || task.controller.signal.aborted || task.denied) throw new UiFailure(task.denied ? "DENIED" : "CANCELLED"); }
  async function request(url: string, task: Task, init?: RequestInit, optionalPlan = false): Promise<unknown> {
    const response = await fetch(url, { ...init, cache: "no-store", signal: task.controller.signal });
    if (!same(task)) throw new UiFailure("CANCELLED");
    if ([401, 403, 404].includes(response.status)) {
      if (optionalPlan && response.status === 404) return noPlan;
      task.denied = true; setError(response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : "NOT_FOUND");
      denial.current(response.status); throw new UiFailure("DENIED", response.status);
    }
    ensure(task);
    if (!response.ok) {
      let code = response.status === 503 ? "RETRY_REQUIRED" : "REQUEST_FAILED";
      try { const body: unknown = await response.json();
        if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
          && "code" in body.error && typeof body.error.code === "string" && knownCodes.has(body.error.code)) code = body.error.code;
      } catch { /* The status remains authoritative. */ }
      ensure(task); throw new UiFailure(code, response.status);
    }
    const body: unknown = await response.json(); ensure(task); return data(body);
  }
  async function run(work: (task: Task) => Promise<void>) {
    if (!mounted.current || active.current) return;
    const task: Task = { controller: new AbortController(), generation: ++generation.current, denied: false, timedOut: false };
    active.current = task; setBusy(true); setError("");
    const timeout = setTimeout(() => { task.timedOut = true; task.controller.abort(); }, 30000);
    try { await work(task); ensure(task); }
    catch (failure) { if (same(task) && !task.denied) setError(task.timedOut ? "TIMEOUT" : task.controller.signal.aborted ? "CANCELLED"
      : failure instanceof UiFailure ? failure.code : "REQUEST_FAILED"); }
    finally { clearTimeout(timeout); if (same(task)) { active.current = null; setBusy(false); } }
  }
  return { busy, isBusy: () => active.current !== null, error, setError, request, run, ensure, same, cancel: () => active.current?.controller.abort() };
}
async function pair<A, B>(a: Promise<A>, b: Promise<B>): Promise<[A, B]> {
  const results = await Promise.allSettled([a, b]);
  if (results[0].status === "rejected") throw results[0].reason;
  if (results[1].status === "rejected") throw results[1].reason;
  return [results[0].value as A, results[1].value as B];
}
function OriginalField({ field, label, value, onChange, maximum, disabled, optional = false, multiline = false, invalid = false }: {
  field?: string; label: string; value: NullableOriginal; onChange: (value: NullableOriginal) => void; maximum: number;
  disabled: boolean; optional?: boolean; multiline?: boolean; invalid?: boolean;
}) {
  const id = useId(), { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const attributes = { id: id + "-text", dir: "auto" as const, maxLength: maximum, value: value.text ?? "", disabled,
    "aria-invalid": invalid, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, text: event.target.value }) };
  return <div className={styles.fields} data-context-field={field}>
    <div className={styles.field}><label htmlFor={id + "-text"}>{label}</label>
      {multiline ? <Textarea {...attributes} /> : <Input {...attributes} />}
      {optional && <label className={styles.check}><input type="checkbox" checked={value.text === null} disabled={disabled}
        aria-label={label + ": " + copy("نص غير مقدّم", "Text not supplied")}
        onChange={event => onChange({ ...value, text: event.target.checked ? null : "" })} />
        <span>{copy("نص غير مقدّم", "Text not supplied")}</span></label>}
    </div>
    <div className={styles.field}><label htmlFor={id + "-language"}>{copy("لغة النص", "Text language")}</label>
      <Input id={id + "-language"} dir="ltr" maxLength={100} value={value.language ?? ""} disabled={disabled}
        placeholder="ar, en, ar-SA" onChange={event => onChange({ ...value, language: event.target.value === "" ? null : event.target.value })} />
    </div>
  </div>;
}
function ContextFields({ editor, change, disabled, invalid }: { editor: Editor; change: (value: Editor) => void; disabled: boolean; invalid: boolean }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const content = editor.content, replace = (value: BrandContextContent) => change({ ...editor, content: value });
  return <>
    <OriginalField field="name" label={copy("اسم السياق", "Context name")} value={editor.nameOriginal} maximum={200} disabled={disabled} invalid={invalid}
      onChange={value => change({ ...editor, nameOriginal: { text: value.text ?? "", language: value.language } })} />
    <OriginalField field="positioning" label={copy("التموضع", "Positioning")} value={content.positioning} maximum={5000} disabled={disabled} optional multiline
      onChange={positioning => replace({ ...content, positioning })} />
    <OriginalField field="tone" label={copy("النبرة", "Tone")} value={content.tone} maximum={500} disabled={disabled} optional multiline
      onChange={tone => replace({ ...content, tone })} />
    <div className={styles.group}><div className={styles.groupHeader}><h3>{copy("القيم", "Values")}</h3>
      <Button type="button" variant="outline" disabled={disabled || content.values.length >= 20}
        onClick={() => replace({ ...content, values: [...content.values, { text: "", language: null }] })}>{copy("إضافة قيمة", "Add value")}</Button></div>
      {content.values.map((value, index) => <div className={styles.group} key={index}>
        <OriginalField label={copy("القيمة", "Value") + " " + (index + 1)} value={value} maximum={200} disabled={disabled}
          onChange={next => replace({ ...content, values: content.values.map((item, at) => at === index ? { text: next.text ?? "", language: next.language } : item) })} />
        <Button type="button" variant="ghost" disabled={disabled} onClick={() => replace({ ...content, values: content.values.filter((_, at) => at !== index) })}>{copy("حذف القيمة", "Remove value") + " " + (index + 1)}</Button>
      </div>)}
    </div>
    {(["references", "competitors"] as const).map(kind => <div className={styles.group} key={kind}>
      <div className={styles.groupHeader}><h3>{kind === "references" ? copy("المراجع الخاصة", "Private references") : copy("المنافسون", "Competitors")}</h3>
        <Button type="button" variant="outline" disabled={disabled || content[kind].length >= 20} onClick={() => replace(kind === "references"
          ? { ...content, references: [...content.references, { label: { text: "", language: null }, url: null, notes: { text: null, language: null } }] }
          : { ...content, competitors: [...content.competitors, { name: { text: "", language: null }, url: null, notes: { text: null, language: null } }] })}>
          {kind === "references" ? copy("إضافة مرجع", "Add reference") : copy("إضافة منافس", "Add competitor")}</Button></div>
      {content[kind].map((item, index) => <ReferenceFields key={index} kind={kind} index={index} item={item} disabled={disabled}
        change={next => replace(kind === "references" ? { ...content, references: content.references.map((row, at) => at === index ? next as BrandContextContent["references"][number] : row) }
          : { ...content, competitors: content.competitors.map((row, at) => at === index ? next as BrandContextContent["competitors"][number] : row) })}
        remove={() => replace(kind === "references" ? { ...content, references: content.references.filter((_, at) => at !== index) }
          : { ...content, competitors: content.competitors.filter((_, at) => at !== index) })} />)}
    </div>)}
    <p className={styles.help}>{copy("النص الاختياري غير المقدّم يختلف عن النص الفارغ. تُحفظ المسافات وكلماتك الأصلية دون ترجمة؛ لا يلزم موقع إلكتروني.", "Absent optional text differs from an empty text. Whitespace and your original words are saved without translation; no website is required.")}</p>
  </>;
}
function ReferenceFields({ kind, index, item, disabled, change, remove }: { kind: "references" | "competitors"; index: number;
  item: BrandContextContent["references"][number] | BrandContextContent["competitors"][number]; disabled: boolean;
  change: (value: typeof item) => void; remove: () => void }) {
  const id = useId(), { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  return <div className={styles.group}>
    <OriginalField label={(kind === "references" ? copy("عنوان المرجع", "Reference label") : copy("اسم المنافس", "Competitor name")) + " " + (index + 1)}
      value={"label" in item ? item.label : item.name} maximum={200} disabled={disabled} onChange={value => change("label" in item
        ? { ...item, label: { text: value.text ?? "", language: value.language } } : { ...item, name: { text: value.text ?? "", language: value.language } })} />
    <div className={styles.field}><label htmlFor={id}>{copy("رابط HTTPS (اختياري)", "HTTPS URL (optional)")}</label>
      <Input id={id} dir="ltr" maxLength={2048} value={item.url ?? ""} disabled={disabled}
        onChange={event => change({ ...item, url: event.target.value === "" ? null : event.target.value })} /></div>
    <OriginalField label={copy("الملاحظات الأصلية", "Original notes") + " " + (index + 1)} value={item.notes} maximum={2000} optional multiline disabled={disabled}
      onChange={notes => change({ ...item, notes })} />
    <Button type="button" variant="ghost" disabled={disabled} onClick={remove}>{kind === "references" ? copy("حذف المرجع", "Remove reference") : copy("حذف المنافس", "Remove competitor")}</Button>
  </div>;
}
function Snapshot({ content }: { content: BrandContextContent }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  function text(label: string, original: NullableOriginal) { return <div className={styles.snapshotItem}><h4>{label}</h4>
    {original.text === null ? <p className={styles.help}>{copy("غير مقدّم", "Not supplied")}</p> : original.text === "" ? <p className={styles.help}>{copy("نص فارغ", "Empty text")}</p>
      : <p className={styles.original} dir="auto">{original.text}</p>}
    {original.language && <Badge variant="outline" dir="ltr">{original.language}</Badge>}</div>; }
  return <div className={styles.snapshot}>
    <div className={styles.snapshotGrid}>{text(copy("التموضع", "Positioning"), content.positioning)}{text(copy("النبرة", "Tone"), content.tone)}</div>
    {content.values.length > 0 && <div className={styles.snapshotGrid}>{content.values.map((value, index) => <div key={index}>{text(copy("القيمة", "Value") + " " + (index + 1), value)}</div>)}</div>}
    {([...content.references.map(item => ({ title: item.label, ...item })), ...content.competitors.map(item => ({ title: item.name, ...item }))]).map((item, index) => <div className={styles.snapshotItem} key={index}>
      {text(copy("مرجع / منافس", "Reference / competitor"), item.title)}{item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" dir="ltr">{item.url}</a>}
      {text(copy("الملاحظات الأصلية", "Original notes"), item.notes)}</div>)}
  </div>;
}
function Recovery<C, R>({ pending, busy, retry, current, release, copy }: { pending: Pending<C, R> | null; busy: boolean;
  retry: () => void; current: () => void; release: () => void; copy: Copy }) {
  if (!pending || busy) return null;
  return <Card className={styles.panel}><CardContent><p>{pending.phase === "unknown"
    ? copy("لم يتأكد رد هذا الطلب. تبقى كلماته ومفتاحه كما أُرسلا؛ إعادة المحاولة تستخدم الطلب نفسه.", "This request's reply is uncertain. Its words and key remain exactly as sent; retry uses the same request.")
    : pending.phase === "confirmed" ? copy("تم تأكيد إيصال تاريخي. يلزم عرض حالي صالح قبل متابعة العمل؛ لن يُرسل الطلب ثانية.", "A historical receipt was confirmed. A valid current view is needed to continue; the request will not be sent again.")
      : copy("رفضت الحالة الحالية هذا الطلب. أعد تحميلها ثم راجعها قبل إجراء جديد، مع إبقاء كلماتك.", "Current state rejected this request. Reload and review it before a new action, keeping your words.")}</p>
    <div className={styles.actions}>{pending.phase === "unknown" && <Button onClick={retry}>{copy("أعد الطلب نفسه", "Retry same request")}</Button>}
      <Button variant="outline" onClick={current}>{pending.phase === "confirmed" ? copy("تحديث السياق الحالي", "Reload current context") : copy("التحقق من الحالة الحالية", "Check current state")}</Button>
      {pending.phase === "conflict" && pending.reviewed && <Button onClick={release}>{copy("راجعت الحالة؛ احتفظ بكلماتي", "I reviewed current state; keep my words")}</Button>}
  </div></CardContent></Card>;
}

type ContextRead = { kind: "LIST"; archived: boolean; position: Position }
  | { kind: "DETAIL"; id: string; position: Position; discardAt?: number } | { kind: "CURRENT" };
function checkedList(value: unknown, scope: PlanningScope, archived: boolean, after: string | null) {
  const page = parsed(BrandContextListSchema, value);
  if (!sameScope(scope, page.scope) || page.contexts.some((row, index, rows) => row.archived !== archived
    || after !== null && row.id <= after || index > 0 && row.id <= rows[index - 1]!.id)
    || page.nextCursor !== null && page.nextCursor !== page.contexts.at(-1)?.id) throw new UiFailure("INVALID_RESPONSE");
  return page;
}
function checkedDetail(value: unknown, scope: PlanningScope, id: string, prior?: Detail | null) {
  const detail = parsed(BrandContextDetailResponseSchema, value);
  if (!sameScope(scope, detail.scope) || detail.context.id !== id || new Set(detail.context.versions.map(row => row.id)).size !== detail.context.versions.length
    || detail.context.versions.some((version, index, rows) => version.contextId !== id
    || index > 0 && version.version >= rows[index - 1]!.version)
    || detail.context.versionsAfter !== null && detail.context.versionsAfter !== detail.context.versions.at(-1)?.id
    || prior?.id === id && detail.context.revision < prior.revision) throw new UiFailure("INVALID_RESPONSE");
  return detail;
}
function contextReceipt(captured: ContextPending, value: unknown) {
  const result = parsed(BrandContextCommandResultSchema, value), command = captured.command;
  if (result.action !== command.action || result.revision !== command.expectedRevision + 1 || result.inputRevision !== captured.expectedInputRevision
    || command.action !== "CREATE" && result.contextId !== command.contextId
    || result.archived !== (command.action === "SET_ARCHIVED" ? command.payload.archived : false)) throw new UiFailure("INVALID_RESPONSE");
  return result;
}
export function BrandContextScreen({ scope, initialPage, initialError = null, planAuthority }: BrandContextScreenProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [initial] = useState(() => {
    const parsedScope = PlanningScopeSchema.safeParse(scope), denied = denialCodes.includes(initialError ?? "");
    const fixed = parsedScope.success ? parsedScope.data : null;
    let page: BrandContextList | null = null;
    if (fixed && initialPage && !denied) try { page = checkedList(initialPage, fixed, false, null); } catch { /* Invalid private SSR DTO stays hidden. */ }
    const plan = ClientAuthoritySchema.safeParse(planAuthority);
    return { fixed, denied, page, plan: fixed?.kind === "CLIENT" && plan.success && plan.data.capability === "plan"
      && plan.data.clientId === fixed.clientId && page && authorityMatches(plan.data, page.currentAuthority) ? plan.data : null };
  });
  const fixedScope = initial.fixed, scopeChanged = !sameScope(fixedScope, scope) && (fixedScope !== null || scope !== null);
  const [page, setPage] = useState(initial.page), [detail, setDetail] = useState<BrandContextDetailResponse | null>(null);
  const [editor, setEditor] = useState<Editor>(blankEditor), editorRef = useRef(editor), changes = useRef(0);
  const [authority, setAuthority] = useState<ClientAuthorityDTO | null>(initial.plan), [denied, setDenied] = useState(initial.denied);
  const authorityRef = useRef<ClientAuthorityDTO | null>(initial.plan);
  const [archived, setArchived] = useState(false), [position, setPosition] = useState<Position>(emptyPosition), [versionsPosition, setVersionsPosition] = useState<Position>(emptyPosition);
  const [committedArchived, setCommittedArchived] = useState(false);
  const [pending, setPending] = useState<ContextPending | null>(null), pendingRef = useRef<ContextPending | null>(null);
  const [readRetry, setReadRetry] = useState<ContextRead | null>(null), [historical, setHistorical] = useState(false), [notice, setNotice] = useState("");
  const [initialProblem, setInitialProblem] = useState(initialError ?? (initialPage && !initial.page ? "INVALID_RESPONSE" : ""));
  const [invalid, setInvalid] = useState(false), [dialog, setDialog] = useState<{ kind: "ARCHIVE"; id: string; revision: number }
    | { kind: "SWITCH"; intent: ContextRead | "NEW" } | { kind: "NAVIGATION"; proceed: () => void } | null>(null);
  const referenceReader = useRef<{ read: () => ReferenceEditorState; identity: symbol } | null>(null);
  const [referenceFlags, setReferenceFlags] = useState({ dirty: false, pending: false, busy: false });
  const registerReferenceState = useCallback<ReferenceStateRegistrar>(read => {
    const entry = { read, identity: Symbol("reference-editor") }; referenceReader.current = entry;
    return () => { if (referenceReader.current === entry) { referenceReader.current = null;
      setReferenceFlags({ dirty: false, pending: false, busy: false }); } };
  }, []);
  const referenceStateChanged = useCallback((state: Pick<ReferenceEditorState, "dirty" | "pending" | "busy">) => {
    setReferenceFlags(previous => previous.dirty === state.dirty && previous.pending === state.pending && previous.busy === state.busy
      ? previous : { ...state });
  }, []);
  function fileState() { return referenceReader.current?.read() ?? { dirty: false, pending: false, busy: false, discard: () => {} }; }
  const heading = useRef<HTMLHeadingElement>(null), editorHeading = useRef<HTMLHeadingElement>(null), opener = useRef<HTMLElement | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: "page" | "editor" | "opener"; sequence: number } | null>(null), focusSequence = useRef(0);
  function updatePending(value: ContextPending | null) { pendingRef.current = value; setPending(value); }
  function updateAuthority(value: ClientAuthorityDTO | null) { authorityRef.current = value; setAuthority(value); }
  function updateEditor(value: Editor) { editorRef.current = value; setEditor(value); }
  function focus(target: "page" | "editor" | "opener") { setFocusRequest({ target, sequence: ++focusSequence.current }); }
  function deny(status: number) {
    setPage(null); setDetail(null); updateEditor(blankEditor()); updatePending(null); updateAuthority(null); setDialog(null);
    setReadRetry(null); setPosition(emptyPosition()); setVersionsPosition(emptyPosition()); setArchived(false); setCommittedArchived(false); setNotice("");
    setHistorical(false); setInvalid(false); setInitialProblem(""); setDenied(true);
    void status; focus("page");
  }
  const net = useRequests(deny), protectedDenied = denied || scopeChanged;
  const canWrite = !protectedDenied && page !== null && (fixedScope?.kind === "OWN_BRAND" || authority?.capability === "plan");
  const blocked = net.busy || pending !== null || protectedDenied || referenceFlags.pending || referenceFlags.busy;
  const navigationRegistrar = useNavigationGuardRegistrar();
  const guard = useRef<NavigationGuard>({ isBlocked: () => false, requestLeave: proceed => proceed() });
  useEffect(() => {
    guard.current = {
      isBlocked: () => { const files = fileState(); return !protectedDenied && (dirty(editorRef.current) || pendingRef.current !== null
        || net.isBusy() || files.dirty || files.pending || files.busy); },
      requestLeave: (proceed, trigger) => {
        if (!guard.current.isBlocked()) { proceed(); return; }
        opener.current = trigger; setDialog({ kind: "NAVIGATION", proceed });
      },
    };
  });
  useEffect(() => navigationRegistrar?.({ isBlocked: () => guard.current.isBlocked(),
    requestLeave: (proceed, trigger) => guard.current.requestLeave(proceed, trigger) }), [navigationRegistrar]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (guard.current.isBlocked()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest.target === "editor" ? editorHeading.current : focusRequest.target === "opener" && opener.current?.isConnected
      && !opener.current.hasAttribute("disabled") ? opener.current : heading.current;
    (target ?? heading.current)?.focus();
  }, [focusRequest]);
  function changed(value: Editor) {
    if (pendingRef.current || net.busy || protectedDenied) return;
    changes.current++; updateEditor(value); setInvalid(false); setNotice(""); net.setError("");
  }
  async function headers(task: Task, filter = archived, at = position) {
    if (!fixedScope) throw new UiFailure("VALIDATION");
    const query = params(fixedScope); query.set("archived", String(filter)); query.set("limit", "20"); if (at.after) query.set("after", at.after);
    return checkedList(await net.request("/api/brand-contexts?" + query, task), fixedScope, filter, at.after);
  }
  async function context(task: Task, id: string, at = emptyPosition()) {
    if (!fixedScope) throw new UiFailure("VALIDATION");
    const query = params(fixedScope); query.set("contextId", id); if (at.after) query.set("versionsAfter", at.after);
    const result = checkedDetail(await net.request("/api/brand-contexts/detail?" + query, task), fixedScope, id, detail?.context);
    if (at.after && detail?.context.id === id) {
      const cursor = detail.context.versions.find(row => row.id === at.after);
      if (cursor && result.context.versions.some(row => row.version >= cursor.version)) throw new UiFailure("INVALID_RESPONSE");
    }
    return result;
  }
  function install(nextPage: BrandContextList, nextDetail: BrandContextDetailResponse | null, replace = false,
    receipt?: BrandContextCommandResult, filter = archived) {
    if (receipt && nextDetail && (nextDetail.context.revision < receipt.revision || nextDetail.context.revision === receipt.revision
      && (nextDetail.context.inputRevision !== receipt.inputRevision || nextDetail.context.archived !== receipt.archived))) throw new UiFailure("INVALID_RESPONSE");
    setPage(nextPage); setCommittedArchived(filter); setInitialProblem(""); setHistorical(false);
    if (authorityRef.current && !authorityMatches(authorityRef.current, nextPage.currentAuthority)) updateAuthority(null);
    if (!nextDetail) return;
    setDetail(nextDetail);
    const current = editorRef.current;
    if (receipt) {
      if (nextDetail.context.revision === receipt.revision && (!dirty(current) || receipt.action === "CREATE" || receipt.action === "UPDATE")) updateEditor(editorFor(nextDetail.context));
      else updateEditor({ ...current, id: receipt.contextId, revision: receipt.revision, inputRevision: receipt.inputRevision,
        archived: nextDetail.context.archived });
    } else if (replace || current.id === nextDetail.context.id && !dirty(current) && !pendingRef.current) updateEditor(editorFor(nextDetail.context));
  }
  async function currentRead(task: Task, renewed?: { plan: ClientAuthorityDTO | null }) {
    const captured = pendingRef.current, id = captured?.receipt?.contextId ?? (captured && captured.command.action !== "CREATE" ? captured.command.contextId : editorRef.current.id);
    const results = id ? await pair(headers(task), context(task, id, captured?.phase === "confirmed" ? emptyPosition() : versionsPosition))
      : [await headers(task), null] as const;
    net.ensure(task);
    if (captured?.phase === "confirmed") {
      if (!results[1] || !captured.receipt || results[1].context.revision < captured.receipt.revision) throw new UiFailure("INVALID_RESPONSE");
      if (results[1].context.revision === captured.receipt.revision && (results[1].context.inputRevision !== captured.receipt.inputRevision
        || results[1].context.archived !== captured.receipt.archived)) throw new UiFailure("INVALID_RESPONSE");
    }
    // A newly fetched plan is accepted only with this later validated view.
    // This updates future action permission, never the captured pending body.
    if (renewed) updateAuthority(renewed.plan && authorityMatches(renewed.plan, results[0].currentAuthority)
      && (!results[1] || authorityMatches(renewed.plan, results[1].currentAuthority)) ? renewed.plan : null);
    if (captured?.phase === "confirmed") {
      const receipt = captured.receipt;
      if (!receipt || !results[1]) throw new UiFailure("INVALID_RESPONSE");
      install(results[0], results[1], false, receipt); setVersionsPosition(emptyPosition()); updatePending(null);
      setNotice(copy("تم التحقق من الحالة الحالية. تبقى النسخ المعتمدة كما هي.", "Current state was checked. Approved versions remain unchanged."));
    } else {
      install(results[0], results[1]);
      if (captured?.phase === "conflict") updatePending({ ...captured, reviewed: true });
    }
  }
  function read(intent: ContextRead) {
    if (protectedDenied || !fixedScope || net.busy) return;
    if (pendingRef.current && intent.kind !== "CURRENT") return;
    const files = fileState();
    if (intent.kind !== "CURRENT" && (files.pending || files.busy)) return;
    if (intent.kind === "DETAIL" && intent.id !== editorRef.current.id && (dirty(editorRef.current) || files.dirty) && intent.discardAt !== changes.current) {
      setDialog({ kind: "SWITCH", intent }); return;
    }
    if (intent.kind === "LIST") setArchived(intent.archived);
    setReadRetry(intent); setHistorical(true); setNotice("");
    void net.run(async task => {
      if (intent.kind === "CURRENT") await refreshCurrent(task);
      else if (intent.kind === "LIST") {
        const next = await headers(task, intent.archived, intent.position); net.ensure(task); install(next, null, false, undefined, intent.archived);
        setPosition(intent.position);
      } else {
        const next = await context(task, intent.id, intent.position); net.ensure(task);
        const current = editorRef.current;
        setDetail(next); setHistorical(false); setInitialProblem(""); setVersionsPosition(intent.position);
        if (current.id !== intent.id || !dirty(current)) updateEditor(editorFor(next.context));
        if (authorityRef.current && !authorityMatches(authorityRef.current, next.currentAuthority)) updateAuthority(null);
        focus("editor");
      }
      setReadRetry(null);
    });
  }
  function newContext() {
    if (blocked) return;
    const files = fileState(); if (files.pending || files.busy) return;
    if (dirty(editorRef.current) || files.dirty) { setDialog({ kind: "SWITCH", intent: "NEW" }); return; }
    setDetail(null); updateEditor(blankEditor()); setVersionsPosition(emptyPosition()); setReadRetry(null); setNotice(""); focus("editor");
  }
  async function freshAuthority(task: Task) {
    if (!fixedScope || fixedScope.kind === "OWN_BRAND") return null;
    const value = await net.request("/api/organization-clients/" + encodeURIComponent(fixedScope.clientId) + "/authority?capability=plan", task, undefined, true);
    if (value === noPlan) {
      updateAuthority(null); await currentRead(task); net.ensure(task); throw new UiFailure("WRITE_UNAVAILABLE");
    }
    const current = parsed(ClientAuthoritySchema, value);
    if (current.capability !== "plan" || current.clientId !== fixedScope.clientId) throw new UiFailure("INVALID_RESPONSE");
    updateAuthority(current); return current;
  }
  async function refreshCurrent(task: Task) {
    if (fixedScope?.kind !== "CLIENT") { await currentRead(task); return; }
    let plan: ClientAuthorityDTO | null = null, failure: unknown;
    try {
      const value = await net.request("/api/organization-clients/" + encodeURIComponent(fixedScope.clientId) + "/authority?capability=plan", task, undefined, true);
      if (value === noPlan) updateAuthority(null);
      net.ensure(task);
      if (value !== noPlan) {
        plan = parsed(ClientAuthoritySchema, value);
        if (plan.capability !== "plan" || plan.clientId !== fixedScope.clientId) throw new UiFailure("INVALID_RESPONSE");
      }
    } catch (error) { failure = error; }
    // Even a failed optional permission lookup must be followed by the owning
    // view check; its authoritative denial clears all protected state.
    net.ensure(task); await currentRead(task, { plan: failure ? null : plan });
    if (failure) throw failure;
  }
  async function send(task: Task, captured: ContextPending) {
    try {
      const result = contextReceipt(captured, await net.request("/api/brand-contexts/commands", task, { method: "POST", headers: { "Content-Type": "application/json" }, body: captured.body }));
      net.ensure(task); updatePending({ ...captured, phase: "confirmed", receipt: result }); await currentRead(task);
    } catch (failure) {
      if (net.same(task) && !task.denied && pendingRef.current?.phase === "unknown" && definiteRejection(failure)) {
        updatePending({ ...pendingRef.current, phase: "conflict", reviewed: false });
      }
      throw failure;
    }
  }
  function command(action: "CREATE" | "UPDATE" | "SUBMIT" | "SET_ARCHIVED", archiveValue?: boolean) {
    if (!fixedScope || !canWrite || blocked) return;
    const files = fileState(); if (net.isBusy() || files.pending || files.busy || action === "SUBMIT" && files.dirty) return;
    const current = editorRef.current;
    if (current.id !== null && detail?.context.revision !== current.revision) { net.setError("STALE_VERSION"); return; }
    const payload = action === "CREATE" || action === "UPDATE" ? { nameOriginal: current.nameOriginal, content: current.content }
      : action === "SET_ARCHIVED" ? { archived: archiveValue! } : {};
    if ((action === "CREATE" || action === "UPDATE") && (!BrandContextNameSchema.safeParse(current.nameOriginal).success || !BrandContextContentSchema.safeParse(current.content).success)) {
      setInvalid(true); net.setError("VALIDATION"); focus("editor"); return;
    }
    setHistorical(true); setNotice(""); setReadRetry(null);
    void net.run(async task => {
      const expectedAuthority = await freshAuthority(task); net.ensure(task);
      const input = { operationKey: crypto.randomUUID(), scope: fixedScope, ...(expectedAuthority ? { expectedAuthority } : {}), action,
        expectedRevision: action === "CREATE" ? 0 : current.revision, ...(action === "CREATE" ? {} : { contextId: current.id }), payload };
      const result = BrandContextCommandSchema.safeParse(input);
      if (!result.success) throw new UiFailure("VALIDATION");
      const materialChange = (result.data.action === "CREATE" || result.data.action === "UPDATE") && detail
        ? fingerprint(result.data.payload.nameOriginal, result.data.payload.content) !== fingerprint(detail.context.nameOriginal, detail.context.content) : false;
      const captured: ContextPending = { command: result.data, body: JSON.stringify(result.data), phase: "unknown", receipt: null, reviewed: false,
        expectedInputRevision: action === "CREATE" ? 1 : action === "UPDATE" && materialChange ? current.revision + 1 : current.inputRevision };
      updatePending(captured); await send(task, captured);
    });
  }
  function retryCommand() {
    const captured = pendingRef.current; if (!captured || captured.phase !== "unknown" || protectedDenied) return;
    setHistorical(true); void net.run(task => send(task, captured));
  }
  function releaseConflict() {
    if (pendingRef.current?.phase !== "conflict" || !pendingRef.current.reviewed || net.busy) return;
    if (editorRef.current.id && detail?.context.id === editorRef.current.id) updateEditor({ ...editorRef.current,
      revision: detail.context.revision, inputRevision: detail.context.inputRevision, archived: detail.context.archived,
      baseline: fingerprint(detail.context.nameOriginal, detail.context.content) });
    updatePending(null); net.setError(""); setNotice(copy("احتُفظ بكلماتك. الإجراء التالي يبدأ طلبًا جديدًا بعد مراجعتك.", "Your words were kept. Your next action starts a new request after this review."));
  }
  const problem = net.error || initialProblem, currentEditor = protectedDenied ? null : editor;
  const currentDetail = protectedDenied ? null : detail, currentPage = protectedDenied ? null : page;
  const revisionDrift = currentEditor?.id !== null && currentEditor?.id === currentDetail?.context.id && currentEditor?.revision !== currentDetail?.context.revision;
  function submitForm(event: FormEvent) { event.preventDefault(); command(editorRef.current.id === null ? "CREATE" : "UPDATE"); }
  return <div className={styles.page}>
    <header className={styles.header}><div><h1 ref={heading} tabIndex={-1} className={styles.title}>{copy("سياق العلامة التجارية", "Brand context")}</h1>
      <p className={styles.subtitle}>{copy("كلمات أصلية اختيارية للتخطيط: احفظ مسودة ثم أرسل نسختها لمراجعة المالك.", "Optional original words for planning: save a draft, then submit its exact version for owner review.")}</p>
      {fixedScope && !protectedDenied && <Badge variant="outline" className={styles.scope}>{fixedScope.kind === "OWN_BRAND" ? copy("شركتي", "Own company") : copy("عميل الوكالة المحدد", "Selected agency client")}</Badge>}
      <nav className={styles.links}><GuardedLink href="/brand/context/reviews">{copy("مراجعات المالك", "Owner reviews")}</GuardedLink><GuardedLink href="/brand/settings">{copy("الإعدادات والنطاق", "Settings and scope")}</GuardedLink></nav>
    </div><div className={styles.actions}>{!protectedDenied && fixedScope && <Button variant="outline" disabled={net.busy} onClick={() => read({ kind: "CURRENT" })}>{copy("تحديث العرض الحالي", "Refresh current view")}</Button>}
      {canWrite && <Button variant="outline" disabled={blocked} onClick={event => { opener.current = event.currentTarget; newContext(); }}>{copy("سياق جديد", "New context")}</Button>}</div></header>
    {net.busy && <div className={styles.feedback} role="status"><p>{copy("جارٍ انتظار الرد الفعلي…", "Waiting for the actual response…")}</p><Button variant="outline" onClick={() => { net.cancel(); focus("page"); }}>{copy("إلغاء الانتظار", "Cancel request")}</Button></div>}
    {problem && <div className={styles.feedback} role="alert"><p>{message(problem, copy)}</p>{readRetry && !pending && !protectedDenied && <Button variant="outline" disabled={net.busy} onClick={() => read(readRetry)}>{copy("إعادة القراءة", "Retry read")}</Button>}</div>}
    {notice && !protectedDenied && <p role="status" className={styles.status}>{notice}</p>}
    {historical && currentPage && <p className={styles.help}>{copy("هذا آخر عرض صالح؛ لم يتأكد تحديثه الحالي بعد.", "This is the last valid view; its current refresh has not yet been confirmed.")}</p>}
    {!protectedDenied && <Recovery pending={pending} busy={net.busy} retry={retryCommand} current={() => read({ kind: "CURRENT" })} release={releaseConflict} copy={copy} />}
    {currentPage && <Card className={styles.tableCard}><CardContent><div className={styles.tableHeader}><div><h2>{copy("السياقات المحفوظة", "Saved contexts")}</h2>
      <p className={styles.help}>{committedArchived ? copy("آخر عرض صالح: السياقات المؤرشفة", "Last valid list: archived contexts")
        : copy("آخر عرض صالح: السياقات النشطة", "Last valid list: active contexts")}</p></div>
      <label className={styles.check}><input type="checkbox" checked={archived} disabled={blocked} onChange={event => read({ kind: "LIST", archived: event.target.checked, position: emptyPosition() })} />{copy("عرض المؤرشف", "Show archived")}</label></div>
      <div className={styles.columnLabels}><span>{copy("السياق", "Context")}</span><span>{copy("الحالة", "State")}</span><span>{copy("آخر تحديث", "Updated")}</span></div>
      {currentPage.contexts.length === 0 && <p className={styles.empty}>{copy("لا توجد سياقات في هذا العرض. يمكنك التخطيط دون سياق أو موقع إلكتروني.", "No contexts in this view. Planning can continue without a context or website.")}</p>}
      {currentPage.contexts.map(row => <div key={row.id} data-context-id={row.id} className={styles.row}>
        <Button variant="ghost" className={styles.original} dir="auto" disabled={blocked} onClick={event => { opener.current = event.currentTarget; read({ kind: "DETAIL", id: row.id, position: emptyPosition() }); }}>{row.nameOriginal.text}</Button>
        <div><Badge variant="outline">{row.archived ? copy("مؤرشف", "Archived") : copy("مسودة", "Draft")}</Badge><p className={styles.help}>{copy("المراجعة", "Revision") + " " + row.revision}</p></div>
        <time dateTime={row.updatedAt} dir="ltr">{row.updatedAt.slice(0, 10)}</time>
      </div>)}
      <div className={styles.pagination}><Button variant="outline" disabled={blocked || position.history.length === 0} onClick={() => read({ kind: "LIST", archived,
        position: { after: position.history.at(-1)!, history: position.history.slice(0, -1) } })}>{copy("السابق", "Previous")}</Button>
        <Button variant="outline" disabled={blocked || !currentPage.nextCursor} onClick={() => read({ kind: "LIST", archived,
          position: { after: currentPage.nextCursor, history: [...position.history, position.after] } })}>{copy("التالي", "Next")}</Button></div>
    </CardContent></Card>}
    {currentEditor && currentPage && (canWrite || currentEditor.id !== null || dirty(currentEditor)) && <Card className={styles.panel}><CardContent>
      <h2 ref={editorHeading} tabIndex={-1}>{currentEditor.id === null ? copy("سياق جديد", "New context") : copy("تعديل السياق", "Edit context")}</h2>
      <p className={styles.help}>{copy("الاعتماد يحفظ كلمات التخطيط كما راجعها المالك؛ لا يثبت حقائق أو حالة قانونية.", "Approval retains the planning words reviewed by the owner; it does not verify facts or legal status.")}</p>
      {currentEditor.id && <p className={styles.help}>{copy("مراجعة المحرر المحفوظة", "Editor's saved revision") + " " + currentEditor.revision}</p>}
      {!canWrite && <p className={styles.readOnly}>{copy("العرض فقط. لا تتوفر صلاحية تعديل هذا النطاق.", "View only. Editing permission is unavailable in this scope.")}</p>}
      {revisionDrift && <div className={styles.feedback}><p>{copy("تغيّرت النسخة المحفوظة. قارن الكلمات الحالية أدناه قبل استخدام المراجعة الجديدة.", "Saved state changed. Compare the current words below before using the new revision.")}</p>
        {currentDetail && <Snapshot content={currentDetail.context.content} />}
        <Button variant="outline" disabled={blocked || !canWrite} onClick={() => currentDetail && updateEditor({ ...editorRef.current,
          revision: currentDetail.context.revision, inputRevision: currentDetail.context.inputRevision, archived: currentDetail.context.archived,
          baseline: fingerprint(currentDetail.context.nameOriginal, currentDetail.context.content) })}>{copy("احتفظ بكلماتي واستخدم المراجعة الحالية", "Keep my words and use the current revision")}</Button></div>}
      <form onSubmit={submitForm}><ContextFields editor={currentEditor} change={changed} disabled={blocked || !canWrite || currentEditor.archived} invalid={invalid} />
        {canWrite && <div className={styles.actions}><Button type="submit" disabled={blocked || currentEditor.archived || !!revisionDrift}>{copy("حفظ السياق", "Save context")}</Button>
          {currentEditor.id && <><Button type="button" variant="outline" disabled={blocked || referenceFlags.dirty || dirty(currentEditor) || currentEditor.archived || !!revisionDrift}
            onClick={() => command("SUBMIT")}>{copy("إرسال لمراجعة المالك", "Submit for owner review")}</Button>
            {currentEditor.archived ? <Button type="button" variant="outline" disabled={blocked || !!revisionDrift} onClick={() => command("SET_ARCHIVED", false)}>{copy("استعادة السياق", "Restore context")}</Button>
              : <Button type="button" variant="outline" disabled={blocked || !!revisionDrift} onClick={event => { opener.current = event.currentTarget;
                setDialog({ kind: "ARCHIVE", id: currentEditor.id!, revision: currentEditor.revision }); }}>{copy("أرشفة السياق", "Archive context")}</Button>}</>}
        </div>}
      </form>
      {fixedScope && currentEditor.id && <ContextReferenceFiles key={currentEditor.id} scope={fixedScope} contextId={currentEditor.id}
        contextRevision={currentEditor.revision} planAuthority={authority} archived={currentEditor.archived}
        disabled={net.busy || pending !== null || dirty(currentEditor) || !!revisionDrift || !canWrite}
        registerStateReader={registerReferenceState} onStateChange={referenceStateChanged}
        onParentChanged={() => read({ kind: "CURRENT" })} onDeny={() => deny(401)} />}
    </CardContent></Card>}
    {currentDetail && <section className={styles.versionList} aria-label={copy("النسخ المعتمدة", "Approved versions")}><h2>{copy("النسخ المعتمدة", "Approved versions")}</h2>
      {currentDetail.context.versions.length === 0 && <p className={styles.help}>{copy("لا توجد نسخة معتمدة بعد. حفظ المسودة وحده لا يعتمدها.", "No approved version yet. Saving a draft does not approve it.")}</p>}
      {currentDetail.context.versions.map(version => <Card key={version.id} className={styles.versionCard} data-context-version-id={version.id}><CardContent>
        <h3>{copy("النسخة", "Version") + " " + version.version}</h3><p className={styles.original} dir="auto">{version.nameOriginal.text}</p>
        <p className={styles.help}>{copy("مراجعة المصدر", "Source revision") + " " + version.inputRevision}</p><Snapshot content={version.content} />
        {fixedScope && <ContextReferenceVersionFiles scope={fixedScope} contextId={version.contextId} versionId={version.id} onDeny={() => deny(401)} />}
      </CardContent></Card>)}
      <div className={styles.actions}><Button variant="outline" disabled={blocked || versionsPosition.history.length === 0} onClick={() => read({ kind: "DETAIL", id: currentDetail.context.id,
        position: { after: versionsPosition.history.at(-1)!, history: versionsPosition.history.slice(0, -1) } })}>{copy("نسخ أحدث", "Newer versions")}</Button>
        <Button variant="outline" disabled={blocked || !currentDetail.context.versionsAfter} onClick={() => read({ kind: "DETAIL", id: currentDetail.context.id,
          position: { after: currentDetail.context.versionsAfter, history: [...versionsPosition.history, versionsPosition.after] } })}>{copy("نسخ أقدم", "Older versions")}</Button></div>
    </section>}
    {!currentPage && !problem && <Card className={styles.panel}><CardContent><p>{copy("أنشئ ملف شركتك أو حدّد نطاقًا متاحًا لبدء التخطيط.", "Create your company profile or choose an available scope to begin planning.")}</p><Link href="/brand/onboarding">{copy("ملف الشركة", "Company profile")}</Link></CardContent></Card>}
    <Dialog open={dialog !== null && !protectedDenied} onOpenChange={open => { if (!open) setDialog(null); }}>
      <DialogContent className={styles.dialog} closeLabel={copy("إغلاق", "Close")} onCloseAutoFocus={event => { event.preventDefault(); focus("opener"); }}>
        <DialogHeader><DialogTitle>{dialog?.kind === "ARCHIVE" ? copy("أرشفة السياق", "Archive context") : copy("كلمات غير محفوظة", "Unsaved words")}</DialogTitle>
          <DialogDescription>{dialog?.kind === "ARCHIVE" ? copy("تمنع الأرشفة إرسال نسخ جديدة؛ تبقى النسخ المعتمدة محفوظة ويمكن استعادة السياق.", "Archiving prevents new submissions. Approved versions remain and the context can be restored.")
            : copy("لن نستبدل كلماتك دون اختيارك. تابع التحرير أو تجاهل التغييرات لفتح العرض المطلوب.", "Your words will not be replaced without your choice. Keep editing or discard changes to open the requested view.")}</DialogDescription></DialogHeader>
        <DialogFooter className={styles.dialogActions}><Button variant="outline" onClick={() => setDialog(null)}>{dialog?.kind === "ARCHIVE" ? copy("إلغاء", "Cancel") : copy("متابعة التحرير", "Keep editing")}</Button>
          <Button disabled={pending !== null || net.busy || referenceFlags.pending || referenceFlags.busy} onClick={() => {
            const chosen = dialog; if (!chosen) return;
            const files = fileState(); if (pendingRef.current || net.isBusy() || files.pending || files.busy) return;
            setDialog(null);
            if (chosen.kind === "ARCHIVE") { if (editorRef.current.id === chosen.id && editorRef.current.revision === chosen.revision) command("SET_ARCHIVED", true); }
            else if (chosen.kind === "NAVIGATION") { files.discard(); chosen.proceed(); }
            else if (chosen.intent === "NEW") { files.discard(); setDetail(null); updateEditor(blankEditor()); setVersionsPosition(emptyPosition()); setReadRetry(null); focus("editor"); }
            else { files.discard(); read(chosen.intent.kind === "DETAIL" ? { ...chosen.intent, discardAt: changes.current } : chosen.intent); }
          }}>{dialog?.kind === "ARCHIVE" ? copy("تأكيد الأرشفة", "Confirm archive") : copy("تجاهل التغييرات", "Discard changes")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

type ReviewHeader = ContextOwnerReviews["reviews"][number];
type ReviewRead = { kind: "LIST"; position: Position } | { kind: "DETAIL"; source: ReviewHeader | Review } | { kind: "CURRENT" };
function checkedReviews(value: unknown, after: string | null) {
  const page = parsed(ContextOwnerReviewsSchema, value);
  if (page.reviews.some((row, index, rows) => after !== null && row.id <= after || index > 0 && row.id <= rows[index - 1]!.id)
    || page.nextCursor !== null && page.nextCursor !== page.reviews.at(-1)?.id) throw new UiFailure("INVALID_RESPONSE");
  return page;
}
function checkedReview(value: unknown, source: ReviewHeader | Review) {
  const result = parsed(ContextOwnerReviewResponseSchema, value), review = result.review;
  if (review.id !== source.id || review.contextId !== source.contextId || !sameScope(review.scope, source.scope)
    || review.inputRevision !== source.inputRevision || review.revision < source.revision
    || JSON.stringify(review.nameOriginal) !== JSON.stringify(source.nameOriginal)
    || "contentHash" in source && (review.contentHash !== source.contentHash || fingerprint(review.nameOriginal, review.content) !== fingerprint(source.nameOriginal, source.content))) {
    throw new UiFailure("INVALID_RESPONSE");
  }
  return result;
}
function reviewReceipt(captured: ReviewPending, value: unknown) {
  const result = parsed(ContextOwnerReviewResultSchema, value), command = captured.command;
  if (result.submissionId !== command.submissionId || result.contextId !== captured.contextId || result.revision !== command.expectedRevision + 1
    || result.state !== (command.decision === "APPROVE" ? "APPROVED" : "DECLINED")) throw new UiFailure("INVALID_RESPONSE");
  return result;
}
export function ContextOwnerReviewsScreen({ initialPage, initialError = null }: ContextOwnerReviewsScreenProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [initial] = useState(() => {
    let page: ContextOwnerReviews | null = null;
    if (!denialCodes.includes(initialError ?? "") && initialPage) try { page = checkedReviews(initialPage, null); } catch { /* Keep malformed private SSR data hidden. */ }
    return { page, denied: denialCodes.includes(initialError ?? "") };
  });
  const [page, setPage] = useState(initial.page), [detail, setDetail] = useState<ContextOwnerReviewResponse | null>(null);
  const detailRef = useRef<ContextOwnerReviewResponse | null>(null);
  const [position, setPosition] = useState<Position>(emptyPosition), [denied, setDenied] = useState(initial.denied);
  const [pending, setPending] = useState<ReviewPending | null>(null), pendingRef = useRef<ReviewPending | null>(null);
  const [readRetry, setReadRetry] = useState<ReviewRead | null>(null), [historical, setHistorical] = useState(false), [notice, setNotice] = useState("");
  const [initialProblem, setInitialProblem] = useState(initialError ?? (initialPage && !initial.page ? "INVALID_RESPONSE" : ""));
  const heading = useRef<HTMLHeadingElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ detail: boolean; sequence: number } | null>(null), focusSequence = useRef(0);
  function focus(toDetail: boolean) { setFocusRequest({ detail: toDetail, sequence: ++focusSequence.current }); }
  function updateDetail(value: ContextOwnerReviewResponse | null) { detailRef.current = value; setDetail(value); }
  function updatePending(value: ReviewPending | null) { pendingRef.current = value; setPending(value); }
  function deny(status: number) {
    setPage(null); updateDetail(null); updatePending(null); setReadRetry(null); setPosition(emptyPosition());
    setNotice(""); setHistorical(false); setInitialProblem(""); setDenied(true);
    void status; focus(false);
  }
  const net = useRequests(deny), blocked = denied || net.busy || pending !== null;
  useEffect(() => { if (focusRequest) (focusRequest.detail ? reviewHeading.current ?? heading.current : heading.current)?.focus(); }, [focusRequest]);
  async function reviews(task: Task, at = position) {
    const query = new URLSearchParams({ limit: "20" }); if (at.after) query.set("after", at.after);
    return checkedReviews(await net.request("/api/brand-contexts/reviews?" + query, task), at.after);
  }
  async function review(task: Task, source: ReviewHeader | Review) {
    const query = new URLSearchParams({ submissionId: source.id });
    return checkedReview(await net.request("/api/brand-contexts/reviews/detail?" + query, task), source);
  }
  async function currentRead(task: Task) {
    const captured = pendingRef.current, source = captured?.source ?? detailRef.current?.review;
    const result = source ? await pair(reviews(task), review(task, source)) : [await reviews(task), null] as const;
    net.ensure(task);
    if (captured?.phase === "confirmed") {
      const receipt = captured.receipt;
      if (!receipt || !result[1] || result[1].review.revision < receipt.revision || result[1].review.state !== receipt.state
        || result[1].review.versionId !== receipt.versionId) throw new UiFailure("INVALID_RESPONSE");
    }
    setPage(result[0]); if (result[1]) updateDetail(result[1]); setInitialProblem(""); setHistorical(false);
    if (captured?.phase === "confirmed") {
      updatePending(null); setNotice(copy("تم التحقق من القرار الحالي للنسخة المقدّمة.", "The current decision for the submitted version was checked."));
    } else if (captured?.phase === "conflict") updatePending({ ...captured, reviewed: true });
  }
  function read(intent: ReviewRead) {
    if (denied || net.busy || pendingRef.current && intent.kind !== "CURRENT") return;
    setReadRetry(intent); setHistorical(true); setNotice("");
    void net.run(async task => {
      if (intent.kind === "CURRENT") await currentRead(task);
      else if (intent.kind === "LIST") { const next = await reviews(task, intent.position); net.ensure(task); setPage(next); setPosition(intent.position); setHistorical(false); setInitialProblem(""); }
      else { const next = await review(task, intent.source); net.ensure(task); updateDetail(next); setHistorical(false); setInitialProblem(""); focus(true); }
      setReadRetry(null);
    });
  }
  async function send(task: Task, captured: ReviewPending) {
    try {
      const receipt = reviewReceipt(captured, await net.request("/api/brand-contexts/reviews/commands", task,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: captured.body }));
      net.ensure(task); updatePending({ ...captured, phase: "confirmed", receipt }); await currentRead(task);
    } catch (failure) {
      if (net.same(task) && !task.denied && pendingRef.current?.phase === "unknown" && definiteRejection(failure)) {
        updatePending({ ...pendingRef.current, phase: "conflict", reviewed: false });
      }
      throw failure;
    }
  }
  function decide(decision: "APPROVE" | "DECLINE") {
    const source = detailRef.current?.review;
    if (blocked || !source || source.state !== "PENDING" || decision === "APPROVE" && (!source.approvalAvailable || source.sourceStale)) return;
    const command = parsed(ContextOwnerReviewCommandSchema, { operationKey: crypto.randomUUID(), submissionId: source.id, expectedRevision: source.revision, decision });
    const captured: ReviewPending = { command, body: JSON.stringify(command), contextId: source.contextId, scope: source.scope,
      source, phase: "unknown", receipt: null, reviewed: false };
    updatePending(captured); setHistorical(true); setReadRetry(null); setNotice(""); void net.run(task => send(task, captured));
  }
  function releaseConflict() {
    const current = pendingRef.current;
    if (!current || current.phase !== "conflict" || !current.reviewed || net.busy) return;
    updatePending(null); net.setError(""); setNotice(copy("راجعت الحالة الحالية. اختر إجراءً جديدًا إن كان متاحًا.", "Current state was reviewed. Choose a fresh action if it is available."));
  }
  const currentPage = denied ? null : page, currentReview = denied ? null : detail?.review, problem = net.error || initialProblem;
  return <div className={styles.page}>
    <header className={styles.header}><div><h1 className={styles.title} ref={heading} tabIndex={-1}>{copy("مراجعات المالك", "Owner reviews")}</h1>
      <p className={styles.subtitle}>{copy("راجع فقط النسخ الأصلية التي أُرسلت إليك. اعتماد التخطيط لا يثبت حقائق أو حالة قانونية.", "Review only the original versions submitted to you. Planning approval does not verify facts or legal status.")}</p>
      <nav className={styles.links}><Link href="/brand/context">{copy("سياق العلامة التجارية", "Brand context")}</Link><Link href="/brand/settings">{copy("الإعدادات", "Settings")}</Link></nav>
    </div>{!denied && <Button variant="outline" disabled={net.busy} onClick={() => read({ kind: "CURRENT" })}>{copy("تحديث العرض الحالي", "Refresh current view")}</Button>}</header>
    {net.busy && <div className={styles.feedback} role="status"><p>{copy("جارٍ انتظار الرد الفعلي…", "Waiting for the actual response…")}</p><Button variant="outline" onClick={() => { net.cancel(); focus(false); }}>{copy("إلغاء الانتظار", "Cancel request")}</Button></div>}
    {problem && <div className={styles.feedback} role="alert"><p>{message(problem, copy)}</p>{readRetry && !pending && !denied && <Button variant="outline" disabled={net.busy} onClick={() => read(readRetry)}>{copy("إعادة القراءة", "Retry read")}</Button>}</div>}
    {notice && !denied && <p className={styles.status} role="status">{notice}</p>}
    {historical && currentPage && <p className={styles.help}>{copy("هذا آخر عرض صالح؛ لم يتأكد تحديثه الحالي بعد.", "This is the last valid view; its current refresh has not yet been confirmed.")}</p>}
    {!denied && <Recovery pending={pending} busy={net.busy} retry={() => { const current = pendingRef.current; if (current?.phase === "unknown") { setHistorical(true); void net.run(task => send(task, current)); } }}
      current={() => read({ kind: "CURRENT" })} release={releaseConflict} copy={copy} />}
    {currentPage && <Card className={styles.tableCard}><CardContent><div className={styles.tableHeader}><h2>{copy("النسخ المقدّمة", "Submitted versions")}</h2></div>
      <div className={styles.columnLabels}><span>{copy("السياق الأصلي", "Original context")}</span><span>{copy("الحالة", "State")}</span><span>{copy("المراجعة", "Review")}</span></div>
      {currentPage.reviews.length === 0 && <p className={styles.empty}>{copy("لا توجد نسخ مقدّمة متاحة لك حاليًا.", "No submitted versions are currently available to you.")}</p>}
      {currentPage.reviews.map(row => <div key={row.id} data-context-submission-id={row.id} className={styles.row}>
        <p className={styles.original} dir="auto">{row.nameOriginal.text}</p><div><Badge variant="outline">{row.state === "PENDING" ? copy("بانتظار المراجعة", "Awaiting review")
          : row.state === "APPROVED" ? copy("معتمد", "Approved") : copy("مرفوض", "Declined")}</Badge>{row.sourceStale && <p className={styles.help}>{copy("تغيّر المصدر", "Source changed")}</p>}</div>
        <Button variant="outline" disabled={blocked} onClick={() => read({ kind: "DETAIL", source: row })}>{copy("مراجعة الطلب", "Review submission")}</Button>
      </div>)}
      <div className={styles.pagination}><Button variant="outline" disabled={blocked || position.history.length === 0} onClick={() => read({ kind: "LIST",
        position: { after: position.history.at(-1)!, history: position.history.slice(0, -1) } })}>{copy("السابق", "Previous")}</Button>
        <Button variant="outline" disabled={blocked || !currentPage.nextCursor} onClick={() => read({ kind: "LIST", position: {
          after: currentPage.nextCursor, history: [...position.history, position.after] } })}>{copy("التالي", "Next")}</Button></div>
    </CardContent></Card>}
    {currentReview && <Card className={styles.panel}><CardContent><div className={styles.header}><div>
      <h2 ref={reviewHeading} tabIndex={-1}>{copy("النسخة المقدّمة للمراجعة", "Submitted version for review")}</h2><p className={styles.original} dir="auto">{currentReview.nameOriginal.text}</p>
      <Badge variant="outline" className={styles.scope}>{currentReview.scope.kind === "OWN_BRAND" ? copy("شركتي", "Own company") : copy("نسخة عميل مقدّمة فقط", "Submitted client version only")}</Badge>
    </div><Button variant="ghost" disabled={blocked} onClick={() => { updateDetail(null); setReadRetry(null); focus(false); }}>{copy("إغلاق المراجعة", "Close review")}</Button></div>
      <p className={styles.help}>{copy("مراجعة المصدر", "Source revision") + " " + currentReview.inputRevision}</p>
      <Snapshot content={currentReview.content} />
      <OwnerReviewReferenceFiles lane="CONTEXT_REVIEW" submissionId={currentReview.id} contextId={currentReview.contextId} onDeny={() => deny(401)} />
      {currentReview.sourceStale && <p className={styles.feedback}>{copy("تغيّر مصدر هذه النسخة أو إذنها؛ لا يمكن اعتمادها الآن. يمكنك رفضها وانتظار إرسال نسخة جديدة.", "This version's source or authorization changed. It cannot be approved now; you can decline it and wait for a new submission.")}</p>}
      {currentReview.state === "PENDING" ? <div className={styles.actions}>
        <Button disabled={blocked || historical || !currentReview.approvalAvailable || currentReview.sourceStale} onClick={() => decide("APPROVE")}>{copy("اعتماد هذه النسخة", "Approve this version")}</Button>
        <Button variant="outline" disabled={blocked || historical} onClick={() => decide("DECLINE")}>{copy("رفض الطلب", "Decline submission")}</Button>
      </div> : <p className={styles.status}>{currentReview.state === "APPROVED" ? copy("هذه النسخة معتمدة. يبقى القرار والمحتوى المقدّم محفوظين.", "This version is approved. Its decision and submitted content are retained.")
        : copy("رُفضت هذه النسخة. يبقى المحتوى المقدّم محفوظًا.", "This version was declined. Its submitted content is retained.")}</p>}
    </CardContent></Card>}
    {!currentPage && !problem && <Card className={styles.panel}><CardContent><p>{copy("حمّل المراجعات المتاحة ضمن جلستك الحالية.", "Load the reviews available in your current session.")}</p></CardContent></Card>}
  </div>;
}
