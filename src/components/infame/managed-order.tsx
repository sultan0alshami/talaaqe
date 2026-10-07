"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GuardedLink, useNavigationGuardRegistrar } from "@/components/shells/navigation-guard";
import { CampaignBrief } from "./campaign-brief";
import { campaignRequirementRows } from "./campaign-field-display";
import styles from "./deal-layout.module.css";
import { PlanningScopeSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { ContextReferenceResponseSchema, type ContextReferenceManifest } from "@/lib/brand-context/reference-contracts";
import { ClientAuthoritySchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { PlanningCampaignSchema, type PlanningCampaign } from "@/lib/campaign-planning/contracts";
import { MANAGED_ORDER_DISCLOSURE_VERSION, ManagedOrderCommandSchema, ManagedOrderResultSchema, ManagedOrderDetailSchema,
  ManagedOrderListSchema, type ManagedOrderCommand, type ManagedOrderResult, type ManagedOrderDetail, type ManagedOrderList,
} from "@/lib/managed/contracts";
import type { ManagedRequestPageContext, ManagedRequestRecoveryState, ManagedRequestActionProps } from "@/lib/managed/ui-contract";
import { MANAGED_REQUEST_RECOVERY_PREFIX, managedRequestRecoveryKey } from "@/lib/managed/recovery-key";
export type { ManagedRequestRecoveryState } from "@/lib/managed/ui-contract";

type Copy = (ar: string, en: string) => string;
type Flight = { controller: AbortController; generation: number; denied: boolean };
class Failure extends Error { constructor(readonly code: string, readonly status?: number) { super(code); } }
const absentPermission = Symbol("ABSENT_SIGN_PERMISSION");
const errors = new Set(["VALIDATION", "STALE_VERSION", "STALE_BRIEF", "APPROVAL_REQUIRED", "INVALID_STATE", "LEGACY_CAMPAIGN",
  "ORDER_ALREADY_REQUESTED", "IDEMPOTENCY_CONFLICT", "SNAPSHOT_TOO_LARGE", "RETRY_REQUIRED", "RATE_LIMITED"]);
const authorityKeys = ["organizationId", "clientId", "brandId", "membershipId", "grantId", "organizationRevision",
  "membershipRevision", "clientRevision", "grantRevision"] as const;
function sameAuthority(a: ClientAuthorityDTO | null, b: ClientAuthorityDTO | null) {
  return a === null || b === null ? a === b : authorityKeys.every(key => a[key] === b[key]);
}
function sameScope(a: PlanningScope | null, b: PlanningScope | null) {
  return a !== null && b !== null && a.kind === b.kind && (a.kind === "OWN_BRAND"
    ? b.kind === "OWN_BRAND" && a.brandId === b.brandId : b.kind === "CLIENT" && a.clientId === b.clientId);
}
function scopeQuery(scope: PlanningScope) {
  return new URLSearchParams(scope.kind === "OWN_BRAND" ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId });
}
function listPath(scope: PlanningScope, after: string | null = null, campaignId?: string) {
  const query = scopeQuery(scope);
  if (after) query.set("after", after);
  if (campaignId !== undefined) { query.set("campaignId", campaignId); query.set("limit", "1"); }
  return "/api/managed-orders?" + query;
}
function detailPath(scope: PlanningScope, orderId: string) { const query = scopeQuery(scope); query.set("orderId", orderId); return "/api/managed-orders/detail?" + query; }
function planningPath(scope: PlanningScope, campaignId: string) { const query = scopeQuery(scope); query.set("campaignId", campaignId); return "/api/planning-campaigns/detail?" + query; }
function pagePath(scope: PlanningScope | null, orderId?: string) {
  return "/brand/requests" + (orderId ? "/" + encodeURIComponent(orderId) : "")
    + (scope?.kind === "CLIENT" ? "?clientId=" + encodeURIComponent(scope.clientId) : "");
}
function campaignPath(scope: PlanningScope | null, campaignId?: string) {
  return "/brand/campaigns/" + (campaignId ? encodeURIComponent(campaignId) : "new")
    + (scope?.kind === "CLIENT" ? "?clientId=" + encodeURIComponent(scope.clientId) : "");
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const packet = schema.safeParse(value); if (!packet.success) throw new Failure("INVALID_RESPONSE"); return packet.data; }
function listData(value: unknown, scope: PlanningScope, after: string | null = null, campaignId?: string) {
  const result = parse(ManagedOrderListSchema, value);
  if (!sameScope(scope, result.scope) || result.orders.some((row, index, rows) => after !== null && row.id <= after
    || index > 0 && row.id <= rows[index - 1]!.id || campaignId !== undefined && row.campaignId !== campaignId)
    || result.nextCursor !== null && result.nextCursor !== result.orders.at(-1)?.id
    || campaignId !== undefined && (result.orders.length > 1 || result.nextCursor !== null)) throw new Failure("INVALID_RESPONSE");
  return result;
}
function detailData(value: unknown, scope: PlanningScope, orderId: string) {
  const result = parse(ManagedOrderDetailSchema, value);
  if (!sameScope(scope, result.scope) || result.order.id !== orderId) throw new Failure("INVALID_RESPONSE");
  return result;
}
function errorText(code: string | null, copy: Copy) {
  if (code === "UNAUTHENTICATED") return copy("انتهت صلاحية الوصول. سجّل الدخول من جديد.", "Access expired. Sign in again.");
  if (code === "DENIED") return copy("هذا الطلب أو السياق غير متاح لك الآن.", "This request or scope is unavailable to you now.");
  if (code === "NOT_ALLOWED") return copy("يلزم تفويض إرسال الطلب لهذا العميل.", "Permission to submit this client's request is required.");
  if (code === "APPROVAL_REQUIRED" || code === "STALE_BRIEF") return copy("راجع موجزًا معتمدًا وحاليًا قبل إرسال الطلب.", "Review a current approved brief before requesting an estimate.");
  if (code === "ORDER_ALREADY_REQUESTED") return copy("يوجد طلب محفوظ لهذه الحملة. حمّل الحالة الحالية لمراجعته.", "A request exists for this campaign. Load current data to review it.");
  if (code === "LEGACY_CAMPAIGN") return copy("هذه الحملة لها سجل صفقة محفوظ. أنشئ حملة جديدة للعمل المُدار.", "This campaign has retained deal history. Create a new campaign for managed work.");
  return copy("تعذر تأكيد الحالة الحالية. بياناتك وطلبك الملتقط محفوظان للمراجعة.", "Current state could not be confirmed. Your captured request is retained for review.");
}
function invalidateRequestFlight(refs: { mounted: { current: boolean }; generation: { current: number }; active: { current: Flight | null } }) {
  refs.mounted.current = false; refs.generation.current++; refs.active.current?.controller.abort(); refs.active.current = null;
}
function useLifecycleCallbacks<T>(callbacks: T) {
  const latest = useRef(callbacks);
  useEffect(() => { latest.current = callbacks; }, [callbacks]);
  return latest;
}
function useRequestNetwork(clearPrivate: () => void, onBusy?: (value: boolean) => void) {
  const active = useRef<Flight | null>(null), generation = useRef(0), mounted = useRef(true), clear = useRef(clearPrivate), activity = useRef(onBusy);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { clear.current = clearPrivate; activity.current = onBusy; }, [clearPrivate, onBusy]);
  useEffect(() => { mounted.current = true; const refs = { mounted, generation, active }; return () => invalidateRequestFlight(refs); }, []);
  function same(flight: Flight) { return mounted.current && active.current === flight && generation.current === flight.generation; }
  function ensure(flight: Flight) { if (!same(flight) || flight.denied || flight.controller.signal.aborted) throw new Failure("CANCELLED"); }
  async function request(path: string, flight: Flight, body?: string, optionalSign = false): Promise<unknown> {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: flight.controller.signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body }) });
    if (!same(flight)) throw new Failure("CANCELLED");
    if ([401, 403, 404].includes(response.status)) {
      if (optionalSign && response.status === 404) return absentPermission;
      flight.denied = true; clear.current(); generation.current++; flight.controller.abort();
      setError(response.status === 401 ? "UNAUTHENTICATED" : "DENIED");
      throw new Failure("DENIED", response.status);
    }
    ensure(flight);
    if (!response.ok) {
      let code = response.status === 503 ? "RETRY_REQUIRED" : "REQUEST_FAILED";
      try { const value: unknown = await response.json(); if (value && typeof value === "object" && "error" in value
        && value.error && typeof value.error === "object" && "code" in value.error && typeof value.error.code === "string" && errors.has(value.error.code)) code = value.error.code; } catch { /* Keep the known status. */ }
      ensure(flight); throw new Failure(code, response.status);
    }
    const value: unknown = await response.json(); ensure(flight);
    if (!value || typeof value !== "object" || Array.isArray(value) || !("data" in value)) throw new Failure("INVALID_RESPONSE");
    return value.data;
  }
  async function run(operation: (flight: Flight) => Promise<void>) {
    if (active.current || !mounted.current) return;
    const flight: Flight = { controller: new AbortController(), generation: ++generation.current, denied: false };
    active.current = flight; activity.current?.(true); setBusy(true); setError(null);
    const timeout = setTimeout(() => flight.controller.abort(), 30000);
    try { await operation(flight); ensure(flight); }
    catch (failure) { if (same(flight) && !flight.denied) setError(flight.controller.signal.aborted ? "NETWORK" : failure instanceof Failure ? failure.code : "NETWORK"); }
    finally { clearTimeout(timeout); if (active.current === flight) { active.current = null; if (mounted.current) { activity.current?.(false); setBusy(false); } } }
  }
  return { busy, error, setError, run, request, ensure, cancel: () => active.current?.controller.abort() };
}
function Notice({ error, historical, copy }: { error: string | null; historical?: boolean; copy: Copy }) {
  return <>{historical && <p className="text-sm leading-7 text-muted-foreground">{copy("تظهر بيانات محفوظة سابقة حتى ينجح تحميل الحالة الحالية.", "Previously saved data is shown until current data loads successfully.")}</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive p-4 text-sm leading-7 text-destructive">{errorText(error, copy)}</p>}</>;
}
function Original({ value, copy }: { value: { text: string | null; language: string | null }; copy: Copy }) {
  return <p dir="auto" lang={value.language ?? undefined} className="m-0 min-w-0 whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
    {value.text === null ? copy("غير محدد", "Not specified") : value.text === "" ? copy("نص فارغ محفوظ", "Saved empty text") : value.text}</p>;
}

export function ManagedRequestListScreen({ actorReference, scope, initialList, profileRequired }: ManagedRequestPageContext) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [fixed] = useState(() => ({ actorReference, scope: scope === null ? null : parse(PlanningScopeSchema, scope) }));
  const [page, setPage] = useState(() => initialList && fixed.scope ? listData(initialList, fixed.scope) : null);
  const [denied, setDenied] = useState(false), [historical, setHistorical] = useState(false);
  const [position, setPosition] = useState<{ after: string | null; history: (string | null)[] }>({ after: null, history: [] });
  const [readRetry, setReadRetry] = useState<typeof position | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const drift = fixed.actorReference !== actorReference || (fixed.scope !== null || scope !== null) && !sameScope(fixed.scope, scope);
  const net = useRequestNetwork(() => { setPage(null); setDenied(true); setReadRetry(null); setHistorical(false); });
  function read(next = { after: position.after, history: [...position.history] }) {
    if (!fixed.scope || denied || drift) return;
    setHistorical(true); setReadRetry(next);
    void net.run(async flight => { const result = listData(await net.request(listPath(fixed.scope!, next.after), flight), fixed.scope!, next.after);
      net.ensure(flight); setPage(result); setPosition(next); setReadRetry(null); setHistorical(false); heading.current?.focus(); });
  }
  return <section className={styles.page} aria-busy={net.busy}>
    <header className={styles.header}><h1 ref={heading} tabIndex={-1}>{copy("طلبات الحملات", "Campaign requests")}</h1>
      <p className={styles.headerCopy}>{copy("طلبات عروض مُدارة من نسخ موجز معتمدة ومحفوظة.", "Managed estimate requests from retained approved brief versions.")}</p></header>
    <Notice error={drift ? "DENIED" : net.error} historical={historical && !!page} copy={copy} />
    {!denied && !drift && <>
      {page && page.orders.length > 0 ? <ul className="m-0 grid list-none gap-4 p-0">{page.orders.map(order => <li key={order.id}>
        <Card><CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-5">
          <div className="min-w-0 flex-1 space-y-2"><GuardedLink href={pagePath(fixed.scope, order.id)} prefetch={false}
            dir="auto" lang={order.titleOriginal.language ?? undefined} className="block min-h-11 whitespace-pre-wrap break-words py-2 text-sm font-semibold underline underline-offset-4 [overflow-wrap:anywhere]">{order.titleOriginal.text}</GuardedLink>
            <p className="text-sm text-muted-foreground">{copy("طلب مسجل", "Request recorded")} · <bdi dir="ltr">{order.submittedAt}</bdi></p></div>
          <Button asChild variant="outline"><GuardedLink href={pagePath(fixed.scope, order.id)} prefetch={false}>{copy("افتح الطلب", "Open request")}</GuardedLink></Button>
        </CardContent></Card></li>)}</ul> : <Card><CardHeader><CardTitle><h2>{copy("ما عندك طلبات حملات حتى الآن", "No campaign requests yet")}</h2></CardTitle>
        <CardDescription>{profileRequired ? copy("أكمل ملف الشركة ثم جهّز حملتك.", "Complete your company profile, then prepare your campaign.")
          : copy("ابدأ بحملة وموجز معتمد لطلب عرض مُدار.", "Start with a campaign and an approved brief to request a managed estimate.")}</CardDescription></CardHeader>
        <CardContent><Button asChild><GuardedLink href={profileRequired ? "/brand/onboarding" : campaignPath(fixed.scope)} prefetch={false}>
          {profileRequired ? copy("أكمل ملف الشركة", "Complete company profile") : copy("حملة جديدة", "New campaign")}</GuardedLink></Button></CardContent></Card>}
      {fixed.scope && <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={net.busy} onClick={() => read(readRetry ?? undefined)}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>
        {position.history.length > 0 && <Button variant="outline" disabled={net.busy} onClick={() => read({ after: position.history.at(-1)!, history: position.history.slice(0, -1) })}>{copy("السابق", "Previous")}</Button>}
        {page?.nextCursor && <Button variant="outline" disabled={net.busy || historical} onClick={() => read({ after: page.nextCursor, history: [...position.history, position.after] })}>{copy("التالي", "Next")}</Button>}
      </div>}
    </>}
    {net.busy && <p role="status" className="text-sm text-muted-foreground">{copy("جاري تحميل الطلبات…", "Loading requests…")}</p>}
  </section>;
}

type RequestSnapshot = ManagedOrderDetail["order"]["submission"]["snapshot"];
function approvedRequirementRows(requirements: RequestSnapshot["brief"]["content"]["requirements"], isAr: boolean, copy: Copy) {
  return campaignRequirementRows(requirements, isAr).map(row => {
    if (row.key === "budget") return { ...row, label: copy("ميزانية الحملة المطلوبة", "Requested campaign budget") };
    const originalRows = row.key === "noGoTopics" ? requirements.noGoTopics : row.key === "assumptions" ? requirements.assumptions : row.key === "openQuestions" ? requirements.openQuestions : null;
    return originalRows === null ? row : { ...row, value: originalRows.length ? <ul className="space-y-2">{originalRows.map((text, index) =>
      <li key={index} dir="auto" lang={requirements.originalLanguage ?? undefined} className="whitespace-pre-wrap break-words">{text}</li>)}</ul> : copy("لا يوجد", "None") };
  });
}
function FrozenContext({ context, copy }: { context: RequestSnapshot["selectedContext"]; copy: Copy }) {
  if (!context) return <p className="text-sm leading-7 text-muted-foreground">{copy("النسخة المعتمدة مثبتة بلا سياق علامة.", "The approved version explicitly has no brand context.")}</p>;
  return <div className="min-w-0 space-y-5">
    <Original value={context.nameOriginal} copy={copy} /><p className="text-sm text-muted-foreground">{copy("نسخة السياق", "Context version")} <bdi>{context.version}</bdi></p>
    <dl className="m-0 min-w-0 space-y-5">
      <div><dt className="mb-2 font-semibold">{copy("التموضع", "Positioning")}</dt><dd className="m-0"><Original value={context.content.positioning} copy={copy} /></dd></div>
      <div><dt className="mb-2 font-semibold">{copy("النبرة", "Tone")}</dt><dd className="m-0"><Original value={context.content.tone} copy={copy} /></dd></div>
      <div><dt className="mb-2 font-semibold">{copy("القيم", "Values")}</dt><dd className="m-0">{context.content.values.length ? <ul className="space-y-3">{context.content.values.map((value, index) => <li key={index}><Original value={value} copy={copy} /></li>)}</ul> : copy("لا توجد قيم محفوظة", "No values recorded")}</dd></div>
      <div><dt className="mb-2 font-semibold">{copy("المراجع", "References")}</dt><dd className="m-0"><ul className="space-y-4">{context.content.references.map((reference, index) => <li key={index} className="min-w-0 space-y-2"><Original value={reference.label} copy={copy} />
        {reference.url && <a href={reference.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="block min-h-11 break-words py-2 underline [overflow-wrap:anywhere]">{reference.url}</a>}<Original value={reference.notes} copy={copy} /></li>)}</ul></dd></div>
      <div><dt className="mb-2 font-semibold">{copy("المنافسون", "Competitors")}</dt><dd className="m-0"><ul className="space-y-4">{context.content.competitors.map((competitor, index) => <li key={index} className="min-w-0 space-y-2"><Original value={competitor.name} copy={copy} />
        {competitor.url && <a href={competitor.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="block min-h-11 break-words py-2 underline [overflow-wrap:anywhere]">{competitor.url}</a>}<Original value={competitor.notes} copy={copy} /></li>)}</ul></dd></div>
    </dl>
  </div>;
}
function FrozenReferences({ references, copy }: { references: RequestSnapshot["references"]; copy: Copy }) {
  if (references.kind === "NO_CONTEXT") return <p className="text-sm leading-7 text-muted-foreground">{copy("لا يوجد سياق مرتبط بهذه النسخة.", "No context is linked to this version.")}</p>;
  if (references.kind === "LEGACY_ABSENT") return <p className="text-sm leading-7 text-muted-foreground">{copy("لم يُحفظ بيان مراجع لهذه النسخة التاريخية.", "This historical version has no recorded reference manifest.")}</p>;
  if (!references.items.length) return <p className="text-sm leading-7 text-muted-foreground">{copy("بيان المراجع المعتمد فارغ.", "The approved reference manifest is empty.")}</p>;
  return <ul className="m-0 list-none space-y-4 p-0">{references.items.map(item => <li key={item.bindingId} className="min-w-0 space-y-2 rounded-xl border border-border p-4">
    <Original value={item.labelOriginal} copy={copy} /><Original value={item.notesOriginal} copy={copy} />
    <p className="text-xs text-muted-foreground"><bdi dir="ltr">{item.contentType}</bdi> · <bdi>{item.size}</bdi> {copy("بايت", "bytes")}</p>
  </li>)}</ul>;
}
export function ManagedRequestDetailScreen({ actorReference, scope, initialDetail }: ManagedRequestPageContext) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [fixed] = useState(() => ({ actorReference, scope: scope === null ? null : parse(PlanningScopeSchema, scope), orderId: initialDetail?.order.id ?? null }));
  const [detail, setDetail] = useState(() => initialDetail && fixed.scope && fixed.orderId ? detailData(initialDetail, fixed.scope, fixed.orderId) : null);
  const [denied, setDenied] = useState(false), [historical, setHistorical] = useState(false), heading = useRef<HTMLHeadingElement>(null);
  const drift = fixed.actorReference !== actorReference || fixed.orderId !== (initialDetail?.order.id ?? null)
    || (fixed.scope !== null || scope !== null) && !sameScope(fixed.scope, scope);
  const net = useRequestNetwork(() => { setDetail(null); setDenied(true); setHistorical(false); });
  function reload() { if (!fixed.scope || !fixed.orderId || denied || drift) return; setHistorical(true);
    void net.run(async flight => { const result = detailData(await net.request(detailPath(fixed.scope!, fixed.orderId!), flight), fixed.scope!, fixed.orderId!);
      net.ensure(flight); setDetail(result); setHistorical(false); heading.current?.focus(); }); }
  const snapshot = !denied && !drift ? detail?.order.submission.snapshot : null;
  return <section className={styles.page} aria-busy={net.busy}>
    <header className={styles.header}><div className={styles.back}><GuardedLink href={pagePath(fixed.scope)} prefetch={false}>{copy("طلبات الحملات", "Campaign requests")}</GuardedLink></div>
      <div className={styles.headerRow}><h1 ref={heading} tabIndex={-1} dir="auto" lang={snapshot?.brief.content.requirements.originalLanguage ?? undefined}>{snapshot?.brief.content.requirements.title ?? copy("طلب حملة", "Campaign request")}</h1>
        {snapshot && <span className={styles.status}>{copy("طلب مسجل", "Request recorded")}</span>}</div></header>
    <Notice error={drift ? "DENIED" : net.error} historical={historical && !!detail} copy={copy} />
    {!denied && !drift && detail && snapshot && <>
      <div className={styles.body}><div className={styles.main}>
        <Card><CardHeader><CardTitle><h2>{copy("السياق المعتمد المقدّم", "Submitted approved context")}</h2></CardTitle></CardHeader><CardContent><FrozenContext context={snapshot.selectedContext} copy={copy} /></CardContent></Card>
        <Card><CardHeader><CardTitle><h2>{copy("بيانات المراجع المثبتة", "Pinned reference metadata")}</h2></CardTitle></CardHeader><CardContent><FrozenReferences references={snapshot.references} copy={copy} /></CardContent></Card>
      </div><aside className={styles.rail}>
        <Card><CardHeader><CardTitle><h2>{copy("لم يصدر عرض سعر بعد", "Estimate not issued")}</h2></CardTitle></CardHeader><CardContent><p className="text-sm leading-7">{copy("الطلب يحفظ النسخة المعتمدة لإعداد عرض مُدار. ميزانية الموجز هي ميزانية طلبها العميل.", "The request retains the approved version for managed estimate preparation. The brief budget is the customer's requested budget.")}</p></CardContent></Card>
        <Card><CardHeader><CardTitle>{copy("النسخة المقدّمة", "Submitted version")}</CardTitle></CardHeader><CardContent><dl className="space-y-3 text-sm">
          <div><dt>{copy("نسخة الطلب", "Request version")}</dt><dd><bdi>{detail.order.submission.version}</bdi></dd></div>
          <div><dt>{copy("وقت التسجيل", "Recorded at")}</dt><dd className="m-0 break-words"><bdi dir="ltr">{detail.order.submission.createdAt}</bdi></dd></div>
        </dl></CardContent></Card>
      </aside></div>
      <CampaignBrief title={snapshot.brief.content.requirements.title} version={snapshot.brief.version} status={copy("موجز معتمد محفوظ", "Retained approved brief")}
        rows={approvedRequirementRows(snapshot.brief.content.requirements, isAr, copy)}>
        <p className="text-sm leading-7">{copy("هذه النسخة المحفوظة عند إرسال الطلب؛ تعديل مسودة الحملة لا يغيّرها.", "This is the version retained when the request was submitted; campaign draft edits do not change it.")}</p>
      </CampaignBrief>
    </>}
    {!denied && !drift && <Button variant="outline" disabled={net.busy} onClick={reload}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>}
    {net.busy && <p role="status" className="text-sm text-muted-foreground">{copy("جاري تحميل الطلب…", "Loading request…")}</p>}
  </section>;
}

const sourceBindingSchema = z.object({ inputRevision: z.number().int().positive(), approvedAt: z.iso.datetime(),
  approvedByUserId: z.string().min(1).max(200), contextVersionId: z.string().min(1).max(200).nullable(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), referenceKind: z.enum(["NO_CONTEXT", "LEGACY_ABSENT", "MANIFEST"]),
  manifestId: z.string().min(1).max(200).nullable(), manifestHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()
  .refine(value => (value.contextVersionId === null) === (value.contextHash === null)
    && (value.referenceKind === "NO_CONTEXT") === (value.contextVersionId === null)
    && (value.referenceKind === "MANIFEST" ? value.manifestId !== null && value.manifestHash !== null : value.manifestId === null && value.manifestHash === null));
const savedSchema = z.object({ command: ManagedOrderCommandSchema, body: z.string().max(16384), sourceBinding: sourceBindingSchema,
  phase: z.enum(["UNKNOWN", "CONFIRMED", "CONFLICT"]), receipt: ManagedOrderResultSchema.nullable() }).strict()
  .refine(value => (value.phase === "CONFIRMED") === (value.receipt !== null));
type Pending = z.infer<typeof savedSchema> & { reviewed: boolean };
type Candidate = { source: PlanningCampaign; sign: ClientAuthorityDTO | null; existing: ManagedOrderList["orders"][number] | null;
  references: ContextReferenceManifest | { kind: "NO_CONTEXT" } | null };
function eligibleBrief(source: PlanningCampaign) {
  const brief = source.briefs[0], selection = source.planning.selection;
  return brief && !["CANCELLED", "COMPLETED"].includes(source.campaign.status) && brief.approvedAt !== null && brief.approvedByUserId !== null
    && brief.version === source.campaign.currentBriefVersion && brief.inputRevision === source.campaign.fieldsRevision
    && brief.provenance !== null && brief.provenance.selectionId === selection.id && brief.provenance.selectionRevision === selection.revision
    && brief.provenance.versionId === selection.versionId && brief.provenance.contentHash === selection.contentHash ? brief : null;
}
function receiptData(value: unknown, command: ManagedOrderCommand): ManagedOrderResult {
  const result = parse(ManagedOrderResultSchema, value);
  if (result.action !== command.action || result.campaignId !== command.campaignId || result.briefId !== command.briefId
    || result.briefVersion !== command.expectedBriefVersion || result.selectionId !== command.expectedSelectionId
    || result.selectionRevision !== command.expectedSelectionRevision) throw new Failure("INVALID_RESPONSE");
  return result;
}
function matchesSubmission(detail: ManagedOrderDetail, pending: Pending) {
  const receipt = pending.receipt, snapshot = detail.order.submission.snapshot, command = pending.command, binding = pending.sourceBinding;
  return receipt !== null && detail.order.id === receipt.orderId && detail.order.campaignId === receipt.campaignId
    && detail.order.submission.id === receipt.submissionId && detail.order.submission.version === receipt.submissionVersion
    && detail.order.revision >= receipt.revision && detail.order.submission.disclosureVersion === command.disclosureVersion
    && snapshot.brief.id === command.briefId && snapshot.brief.version === command.expectedBriefVersion
    && snapshot.brief.inputRevision === binding.inputRevision && snapshot.brief.approvedAt === binding.approvedAt
    && snapshot.brief.approvedByUserId === binding.approvedByUserId
    && snapshot.provenance.selectionId === command.expectedSelectionId && snapshot.provenance.selectionRevision === command.expectedSelectionRevision
    && snapshot.provenance.versionId === binding.contextVersionId && snapshot.provenance.contentHash === binding.contextHash
    && snapshot.references.kind === binding.referenceKind && (snapshot.references.kind !== "MANIFEST"
      || snapshot.references.id === binding.manifestId && snapshot.references.hash === binding.manifestHash);
}
function cleanActorStorage(actor: string) {
  try {
    const ownerKey = MANAGED_REQUEST_RECOVERY_PREFIX + "actor", previous = sessionStorage.getItem(ownerKey);
    if (previous && previous !== actor) {
      const prefix = MANAGED_REQUEST_RECOVERY_PREFIX + encodeURIComponent(previous) + ":";
      for (let index = sessionStorage.length - 1; index >= 0; index--) { const key = sessionStorage.key(index); if (key?.startsWith(prefix)) sessionStorage.removeItem(key); }
    }
    sessionStorage.setItem(ownerKey, actor);
  } catch { /* In-memory exact retry remains available. */ }
}

export function ManagedRequestAction({ source, actorReference, blocked, onRecoveryState }: ManagedRequestActionProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en, router = useRouter(), checkId = useId();
  const registrar = useNavigationGuardRegistrar();
  const [fixed] = useState(() => ({ actorReference, scope: parse(PlanningScopeSchema, source.scope), campaignId: source.campaign.id }));
  const key = managedRequestRecoveryKey(fixed.actorReference, fixed.scope, fixed.campaignId);
  const [pending, setPending] = useState<Pending | null>(null), pendingRef = useRef<Pending | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null), candidateRef = useRef<Candidate | null>(null);
  const [found, setFound] = useState<ManagedOrderList["orders"][number] | null>(null), [lookupReady, setLookupReady] = useState(false);
  const [dialog, setDialog] = useState(false), dialogRef = useRef(false), [checked, setChecked] = useState(false), checkedRef = useRef(false);
  const [denied, setDenied] = useState(false), deniedRef = useRef(false), busyRef = useRef(false), callback = useRef(onRecoveryState);
  const [loaded, setLoaded] = useState(false), [historical, setHistorical] = useState(false), [focusSequence, setFocusSequence] = useState(0);
  const focusTarget = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null);
  const blockedRef = useRef(blocked), [leaveOpen, setLeaveOpen] = useState(false), continuation = useRef<(() => void) | null>(null);
  const drift = fixed.actorReference !== actorReference || fixed.campaignId !== source.campaign.id || !sameScope(fixed.scope, source.scope);
  useEffect(() => { callback.current = onRecoveryState; blockedRef.current = blocked; }, [onRecoveryState, blocked]);
  function report() {
    const state: ManagedRequestRecoveryState = { pending: pendingRef.current !== null, busy: busyRef.current,
      dirty: dialogRef.current && checkedRef.current, denied: deniedRef.current };
    callback.current?.(state);
  }
  function remember(value: Pending | null) {
    pendingRef.current = value; setPending(value);
    try { if (value) { const { reviewed: _reviewed, ...saved } = value; void _reviewed; sessionStorage.setItem(key, JSON.stringify(saved)); }
      else sessionStorage.removeItem(key); } catch { /* Keep the exact in-memory body. */ }
    report();
  }
  function closeDialog() { dialogRef.current = false; checkedRef.current = false; setDialog(false); setChecked(false); candidateRef.current = null; setCandidate(null); report(); }
  function clearPrivate() {
    deniedRef.current = true; setDenied(true); remember(null); closeDialog(); setFound(null); setLookupReady(false); setHistorical(false);
    continuation.current = null; setLeaveOpen(false); setFocusSequence(value => value + 1); report();
  }
  const net = useRequestNetwork(clearPrivate, value => { busyRef.current = value; report(); });
  function publishCandidate(value: Candidate) { candidateRef.current = value; setCandidate(value); }
  async function currentRead(flight: Flight): Promise<Candidate> {
    let sign: ClientAuthorityDTO | null = null, permissionFailure: unknown;
    if (fixed.scope.kind === "CLIENT") {
      try {
        const value = await net.request("/api/organization-clients/" + encodeURIComponent(fixed.scope.clientId) + "/authority?capability=signCustomer", flight, undefined, true);
        if (value !== absentPermission) { sign = parse(ClientAuthoritySchema, value);
          if (sign.capability !== "signCustomer" || sign.clientId !== fixed.scope.clientId) throw new Failure("INVALID_RESPONSE"); }
      } catch (failure) { if (deniedRef.current) throw failure; permissionFailure = failure; sign = null; }
    }
    const current = parse(PlanningCampaignSchema, await net.request(planningPath(fixed.scope, fixed.campaignId), flight));
    if (!sameScope(fixed.scope, current.scope) || current.campaign.id !== fixed.campaignId) throw new Failure("INVALID_RESPONSE");
    const lookup = listData(await net.request(listPath(fixed.scope, null, fixed.campaignId), flight), fixed.scope, null, fixed.campaignId);
    if (!sameAuthority(current.currentAuthority, lookup.currentAuthority)) throw new Failure("INVALID_RESPONSE");
    let references: Candidate["references"] = null;
    if (!lookup.orders.length && eligibleBrief(current)) {
      const selected = current.planning.selectedContext;
      if (selected === null) references = { kind: "NO_CONTEXT" };
      else {
        const query = scopeQuery(fixed.scope); query.set("contextId", selected.contextId); query.set("versionId", selected.id);
        const referenceResponse = parse(ContextReferenceResponseSchema, await net.request("/api/brand-contexts/references?" + query, flight));
        if (!sameScope(fixed.scope, referenceResponse.scope) || referenceResponse.contextId !== selected.contextId || referenceResponse.versionId !== selected.id
          || !sameAuthority(current.currentAuthority, referenceResponse.currentAuthority)
          || !sameAuthority(lookup.currentAuthority, referenceResponse.currentAuthority)) throw new Failure("INVALID_RESPONSE");
        references = referenceResponse.references;
      }
    }
    if (sign && !sameAuthority(sign, current.currentAuthority)) sign = null;
    net.ensure(flight); const next: Candidate = { source: current, sign, existing: lookup.orders[0] ?? null, references };
    publishCandidate(next); setFound(next.existing); setLookupReady(true); setHistorical(false);
    const captured = pendingRef.current;
    if (captured?.phase === "CONFLICT") remember({ ...captured, reviewed: true });
    if (permissionFailure) throw permissionFailure;
    return next;
  }
  async function confirmedRead(flight: Flight, captured: Pending) {
    if (!captured.receipt) throw new Failure("INVALID_RESPONSE");
    const detail = detailData(await net.request(detailPath(fixed.scope, captured.receipt.orderId), flight), fixed.scope, captured.receipt.orderId);
    // A contradictory read cannot revoke an already validated receipt or reopen
    // POST recovery. Retain the exact confirmed command and recover through GET.
    if (!matchesSubmission(detail, captured)) throw new Failure("INVALID_ACKNOWLEDGEMENT");
    net.ensure(flight); remember(null); closeDialog(); busyRef.current = false; report();
    router.push(pagePath(fixed.scope, detail.order.id));
  }
  async function send(flight: Flight, captured: Pending) {
    try {
      const receipt = receiptData(await net.request("/api/managed-orders/commands", flight, captured.body), captured.command);
      net.ensure(flight); const confirmed: Pending = { ...captured, phase: "CONFIRMED", receipt, reviewed: false }; remember(confirmed);
      await confirmedRead(flight, confirmed);
    } catch (failure) {
      const current = pendingRef.current;
      if (!deniedRef.current && current?.phase === "UNKNOWN" && failure instanceof Failure && [400, 409, 422].includes(failure.status ?? 0)) {
        remember({ ...current, phase: "CONFLICT", reviewed: false });
      }
      throw failure;
    }
  }
  function reload() {
    if (deniedRef.current || drift) return; setHistorical(true);
    void net.run(async flight => { const captured = pendingRef.current;
      if (captured?.phase === "CONFIRMED") await confirmedRead(flight, captured); else await currentRead(flight);
      setFocusSequence(value => value + 1); });
  }
  function open(event: MouseEvent<HTMLButtonElement>) {
    if (blockedRef.current || deniedRef.current || drift || pendingRef.current) return;
    opener.current = event.currentTarget;
    void net.run(async flight => {
      const next = await currentRead(flight);
      // The indexed current lookup is performed even for an older/unapproved
      // displayed draft, so an existing immutable request can still be opened.
      net.ensure(flight);
      if (next.existing) { setFocusSequence(value => value + 1); return; }
      if (!eligibleBrief(next.source)) throw new Failure("APPROVAL_REQUIRED");
      if (fixed.scope.kind === "CLIENT" && !next.sign) throw new Failure("NOT_ALLOWED");
      if (blockedRef.current) throw new Failure("CANCELLED");
      dialogRef.current = true; checkedRef.current = false; setChecked(false); setDialog(true); report();
    });
  }
  function confirm() {
    const next = candidateRef.current, brief = next && eligibleBrief(next.source);
    if (!next || !brief || !next.references || !checkedRef.current || blockedRef.current || pendingRef.current || deniedRef.current || drift) return;
    const command = parse(ManagedOrderCommandSchema, { action: "SUBMIT", operationKey: crypto.randomUUID(), scope: fixed.scope,
      campaignId: fixed.campaignId, expectedCampaignRevision: next.source.campaign.revision, expectedPlanningRevision: next.source.planning.revision,
      expectedSelectionId: next.source.planning.selection.id, expectedSelectionRevision: next.source.planning.selection.revision,
      briefId: brief.id, expectedBriefVersion: brief.version, disclosureVersion: MANAGED_ORDER_DISCLOSURE_VERSION,
      ...(next.sign ? { expectedAuthority: next.sign } : {}) });
    const sourceBinding = parse(sourceBindingSchema, { inputRevision: brief.inputRevision, approvedAt: brief.approvedAt,
      approvedByUserId: brief.approvedByUserId, contextVersionId: brief.provenance!.versionId, contextHash: brief.provenance!.contentHash,
      referenceKind: next.references.kind, manifestId: next.references.kind === "MANIFEST" ? next.references.id : null,
      manifestHash: next.references.kind === "MANIFEST" ? next.references.hash : null });
    const captured: Pending = { command, body: JSON.stringify(command), sourceBinding, phase: "UNKNOWN", receipt: null, reviewed: false };
    remember(captured); dialogRef.current = false; checkedRef.current = false; setDialog(false); setChecked(false); report();
    void net.run(flight => send(flight, captured));
  }
  function initializeRecovery() {
    cleanActorStorage(fixed.actorReference);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = parse(savedSchema, JSON.parse(raw));
        if (!sameScope(saved.command.scope, fixed.scope) || saved.command.campaignId !== fixed.campaignId
          || JSON.stringify(saved.command) !== saved.body || saved.sourceBinding.inputRevision > saved.command.expectedCampaignRevision) throw new Failure("INVALID_RESPONSE");
        if (saved.receipt) receiptData(saved.receipt, saved.command);
        remember({ ...saved, reviewed: false });
      }
    } catch { try { sessionStorage.removeItem(key); } catch { /* No private storage is required. */ } }
    setLoaded(true);
    // On a normal reload, exact lookup discovers the saved request without a
    // twenty-row scan. Restored UNKNOWN commands are never auto-posted.
    if (pendingRef.current?.phase === "CONFIRMED") void net.run(flight => confirmedRead(flight, pendingRef.current!));
    else if (!pendingRef.current) void net.run(async flight => { const lookup = listData(await net.request(listPath(fixed.scope, null, fixed.campaignId), flight), fixed.scope, null, fixed.campaignId);
      net.ensure(flight); setFound(lookup.orders[0] ?? null); setLookupReady(true); });
  }
  function requestLeave(proceed: () => void, element: HTMLElement | null) {
    if (pendingRef.current || busyRef.current) { net.setError("UNRESOLVED_REQUEST"); setFocusSequence(value => value + 1); return; }
    if (dialogRef.current && checkedRef.current) { opener.current = element; continuation.current = proceed; setLeaveOpen(true); return; }
    proceed();
  }
  const lifecycle = useLifecycleCallbacks({ initialize: initializeRecovery, deny: () => { net.cancel(); clearPrivate(); }, requestLeave });
  useEffect(() => {
    let live = true;
    // Restore external tab storage and start the actual native read after mount.
    // UNKNOWN commands are retained for explicit retry, never auto-posted.
    void Promise.resolve().then(() => { if (live) lifecycle.current.initialize(); });
    return () => { live = false; };
  }, [lifecycle]);
  useEffect(() => { if (focusSequence) focusTarget.current?.focus(); }, [focusSequence]);
  useEffect(() => { if (drift) lifecycle.current.deny(); }, [drift, lifecycle]);
  useEffect(() => {
    if (onRecoveryState || !registrar) return;
    return registrar({ isBlocked: () => !deniedRef.current && (pendingRef.current !== null || busyRef.current || dialogRef.current && checkedRef.current),
      requestLeave: (proceed, element) => lifecycle.current.requestLeave(proceed, element) });
  }, [onRecoveryState, registrar, lifecycle]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!deniedRef.current && (pendingRef.current || busyRef.current || dialogRef.current && checkedRef.current)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const label = copy("اطلب عرضًا مُدارًا", "Request managed estimate"), protectedDenied = denied || drift;
  const disclosureBrief = candidate ? eligibleBrief(candidate.source) : null;
  return <div ref={focusTarget} tabIndex={-1} className="min-w-0 space-y-4" aria-busy={net.busy}>
    <Notice error={drift ? "DENIED" : net.error} historical={historical} copy={copy} />
    {!protectedDenied && <>
      {!pending && found ? <Button asChild variant="outline"><GuardedLink href={pagePath(fixed.scope, found.id)} prefetch={false}>{copy("افتح الطلب المسجل", "Open recorded request")}</GuardedLink></Button>
        : !pending && <Button disabled={!loaded || blocked || net.busy || !lookupReady} onClick={open}>{label}</Button>}
      {pending && <Card><CardContent className="space-y-4">
        <p className="text-sm leading-7">{pending.phase === "UNKNOWN" ? copy("الرد غير مؤكد؛ أعد الطلب نفسه دون مفتاح جديد.", "The reply is uncertain; retry the same request without a new key.")
          : pending.phase === "CONFIRMED" ? copy("حُفظ إيصال الطلب. نحتاج تحميل الطلب الحالي لعرضه.", "The request receipt is recorded. Load the current request to display it.")
            : copy("رُفض الطلب الملتقط. حمّل الحالة الحالية ثم راجعها قبل تحريره.", "The captured request was rejected. Load and review current state before releasing it.")}</p>
        <div className="flex flex-wrap gap-3">
          {pending.phase === "UNKNOWN" && <Button disabled={net.busy} onClick={() => { const captured = pendingRef.current; if (captured?.phase === "UNKNOWN") void net.run(flight => send(flight, captured)); }}>{copy("أعد الطلب نفسه", "Retry same request")}</Button>}
          <Button variant="outline" disabled={net.busy} onClick={reload}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>
          {pending.phase === "CONFLICT" && <Button variant="outline" disabled={net.busy || !pending.reviewed} onClick={() => { if (pendingRef.current?.reviewed) { remember(null); setFocusSequence(value => value + 1); } }}>{copy("راجعت الحالة الحالية", "I've reviewed current state")}</Button>}
        </div>
      </CardContent></Card>}
      {!pending && net.error && <Button variant="outline" disabled={net.busy} onClick={reload}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>}
    </>}
    {net.busy && <p role="status" className="text-sm leading-7 text-muted-foreground">{copy("جاري التحقق من الطلب الحالي…", "Checking current request…")}</p>}
    <Dialog open={dialog && !protectedDenied} onOpenChange={openValue => { if (!openValue && !pendingRef.current && !busyRef.current) closeDialog(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none sm:max-w-[1000px]" closeLabel={copy("إغلاق", "Close")}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); else focusTarget.current?.focus(); }}>
        <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{copy("سيحفظ الطلب نسخة الموجز المعتمد وسياقها المعتمد وبيانات المراجع المثبتة لإعداد عرض مُدار.", "The request will retain the approved brief, its approved context and pinned reference metadata for managed estimate preparation.")}</DialogDescription></DialogHeader>
        {candidate && disclosureBrief && <CampaignBrief title={disclosureBrief.content.requirements.title} version={disclosureBrief.version}
          status={copy("موجز معتمد للمشاركة", "Approved brief to share")} rows={approvedRequirementRows(disclosureBrief.content.requirements, isAr, copy)}>
          <section className="w-full min-w-0 space-y-4" aria-label={copy("السياق المعتمد للمشاركة", "Approved context to share")}>
            <h2 className="text-base font-semibold">{copy("السياق المعتمد للمشاركة", "Approved context to share")}</h2>
            <FrozenContext context={candidate.source.planning.selectedContext} copy={copy} />
          </section>
          {candidate.references && <section className="w-full min-w-0 space-y-4" aria-label={copy("المراجع المعتمدة للمشاركة", "Approved references to share")}>
            <h2 className="text-base font-semibold">{copy("المراجع المعتمدة للمشاركة", "Approved references to share")}</h2>
            <FrozenReferences references={candidate.references} copy={copy} />
          </section>}
        </CampaignBrief>}
        <label htmlFor={checkId} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border p-4 text-sm leading-7">
          <Checkbox id={checkId} checked={checked} onCheckedChange={value => { checkedRef.current = value === true; setChecked(value === true); report(); }} />
          <span>{copy("أوافق على مشاركة هذه النسخة المعتمدة وسياقها ومراجعها المثبتة لطلب عرض مُدار.", "I agree to share this approved version and its pinned context and references to request a managed estimate.")}</span>
        </label>
        <DialogFooter><Button variant="outline" onClick={closeDialog}>{copy("إلغاء", "Cancel")}</Button><Button disabled={!checked || blocked || net.busy} onClick={confirm}>{label}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={leaveOpen} onOpenChange={value => { setLeaveOpen(value); if (!value) continuation.current = null; }}><DialogContent closeLabel={copy("إغلاق", "Close")}>
      <DialogHeader><DialogTitle>{copy("مراجعة الطلب قبل المغادرة", "Review the request before leaving")}</DialogTitle><DialogDescription>{copy("تظل النسخة المعتمدة محفوظة. اختر البقاء أو إلغاء اختيار المشاركة والمغادرة.", "The approved version remains saved. Stay, or cancel the sharing selection and leave.")}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => { setLeaveOpen(false); continuation.current = null; opener.current?.focus(); }}>{copy("ابقَ", "Stay")}</Button>
        <Button onClick={() => { const proceed = continuation.current; continuation.current = null; setLeaveOpen(false); closeDialog(); proceed?.(); }}>{copy("ألغِ الاختيار وغادر", "Cancel selection and leave")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
