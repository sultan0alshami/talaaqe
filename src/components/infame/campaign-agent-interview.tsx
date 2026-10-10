"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MessageSquare, Paperclip, Mic, AudioLines, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { InfameBrandPattern } from "@/components/infame/brand-pattern";
import { campaignFieldLabels, campaignFieldValue } from "@/components/infame/campaign-field-display";
import type { CampaignAgentCommand, CampaignAgentResult } from "@/lib/campaign-agent/native-contracts";
import type { CampaignAgentRead, CampaignAgentSourcePage } from "@/lib/campaign-agent/service";
import type { AgentBinding, CampaignAgentFieldKey, CampaignAgentState, CustomerTextSource } from "@/lib/campaign-agent/contracts";
import type { ClientAuthorityDTO } from "@/lib/organizations/contracts";
import type { CampaignAgentBarrierCommand, CampaignAgentBarrierResult, CampaignAgentOutcome } from "@/lib/campaign-agent/recovery-contracts";
import type { CampaignAgentRecoveryPacket } from "@/lib/campaign-agent/browser-recovery";
import type { CampaignAgentRecoveryStub, CampaignAgentJournalRead } from "@/lib/campaign-agent/browser-storage";
import { readCampaignAgentResponse } from "@/lib/campaign-agent/browser-transport";

type Preferences = CampaignAgentState["preferences"];
type Copy = (ar: string, en: string) => string;
type ReviewRow = { field: CampaignAgentFieldKey; valueHash: string; present: boolean };
type SelectedSource = { id: string; sourceHash: string };
type Choice = { checked: boolean; references: SelectedSource[] };
export type CampaignAgentRecoveryState = { pending: boolean; busy: boolean; dirty: boolean; denied: boolean };
type Receipt = CampaignAgentResult | CampaignAgentBarrierResult;
type Captured = { body: string; phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT"; reviewed: boolean } & (
  { kind: "COMMAND"; command: CampaignAgentCommand; receipt: CampaignAgentResult | null }
  | { kind: "RECOVERY_BARRIER"; command: CampaignAgentBarrierCommand; receipt: CampaignAgentBarrierResult | null });
type PagePosition = { after: string | null; history: (string | null)[] };
type SourceCapture = { position: PagePosition; agentId: string };
type Flight = { controller: AbortController; sequence: number; denied: boolean; timedOut: boolean };
class UiError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); }
}

export type CampaignAgentBrowserAdapter = {
  // Values are required browser-safe codecs/transport. Type imports above erase.
  getState(binding: AgentBinding, signal: AbortSignal): Promise<Response>;
  getSources(binding: AgentBinding, after: string | null, signal: AbortSignal): Promise<Response>;
  sendCommand(originalBody: string, signal: AbortSignal): Promise<Response>;
  sendBarrier(originalBody: string, signal: AbortSignal): Promise<Response>;
  getOutcome(stub: CampaignAgentRecoveryStub, signal: AbortSignal): Promise<Response>; // READ-ONLY POST transport.
  getPlan(binding: AgentBinding, signal: AbortSignal): Promise<Response | null>; // OWN returns null; CLIENT has no optional404.
  decodeRead(data: unknown, binding: AgentBinding): Promise<CampaignAgentRead>;
  decodeSources(data: unknown, binding: AgentBinding, agentId: string, after: string | null): Promise<CampaignAgentSourcePage>;
  decodeReceipt(data: unknown, original: CampaignAgentCommand): CampaignAgentResult;
  parseCommand(data: unknown): CampaignAgentCommand;
  parseBarrier(data: unknown): CampaignAgentBarrierCommand;
  decodeBarrierReceipt(data: unknown, original: CampaignAgentBarrierCommand): CampaignAgentBarrierResult;
  decodeOutcome(data: unknown, stub: CampaignAgentRecoveryStub): Promise<CampaignAgentOutcome>;
  decodePlan(data: unknown, binding: AgentBinding): ClientAuthorityDTO;
  captureFromPacket(packet: CampaignAgentRecoveryPacket): Captured;
  stubForPacket(packet: CampaignAgentRecoveryPacket): Promise<CampaignAgentRecoveryStub>;
  barrierFromStub(stub: CampaignAgentRecoveryStub): Promise<Captured>; // Verifies preserved wire hashes with WebCrypto.
  targetForStub(stub: CampaignAgentRecoveryStub): CampaignAgentBarrierCommand["target"]; // COMMAND only, exact metadata.
  originalTarget(stub: CampaignAgentRecoveryStub): CampaignAgentBarrierCommand["target"]; // Also unwraps a barrier's original five-action target.
  permitsBarrierHandoff(old: Captured, fresh: CampaignAgentRead): boolean; // Monotonic CAS epochs, at least one strictly greater.
  reviewRows(read: CampaignAgentRead): Promise<readonly ReviewRow[]>;
  acknowledges(original: CampaignAgentCommand, receipt: CampaignAgentResult, current: CampaignAgentRead): boolean;
  journal: {
    load(signal: AbortSignal): Promise<CampaignAgentJournalRead>;
    save(packet: CampaignAgentRecoveryPacket, signal: AbortSignal): Promise<void>;
    clear(keepUnknownBarrier: boolean): void;
  };
};
export type CampaignAgentInterviewProps = {
  binding: AgentBinding; actorReference: string; adapter: CampaignAgentBrowserAdapter;
  planAuthority: ClientAuthorityDTO | null; canWrite: boolean; blocked: boolean;
  privacyEpoch: number; // Increment synchronously on EVERY parent private denial.
  onDeny: () => void;
  onRecoveryState: (state: CampaignAgentRecoveryState) => void;
  onCommitted: (receipt: Receipt, signal: AbortSignal) => Promise<void>; // Root GET-only parent reconciliation.
  registerPrivateDenial: (invalidate: (status: number) => void) => () => void; // Journal onDeny and parent sibling denials.
  onReviewDiscard?: () => void;
  generatedProfile?: { briefId: string; briefVersion: number; content: ReactNode } | null;
};
const denialStatuses = new Set([401, 403, 404]);
const explicitErrors = new Set(["VALIDATION", "STALE_VERSION", "AGENT_REQUIRED", "MISSING_REQUIREMENTS",
  "CONFIRMATION_REQUIRED", "STALE_CONFIRMATION", "TEXT_SOURCE_LIMIT", "INVALID_STORED_AGENT",
  "SNAPSHOT_TOO_LARGE", "RETRY_REQUIRED", "OPERATION_KEY_REUSED", "IDEMPOTENCY_CONFLICT", "RECOVERY_UNAVAILABLE",
  "INVALID_RECOVERY_PACKET", "BROWSER_CRYPTO_UNAVAILABLE", "JOURNAL_UNAVAILABLE", "INVALID_RESPONSE"]);
const sameBinding = (a: AgentBinding, b: AgentBinding) => a.campaignId === b.campaignId && a.workspaceId === b.workspaceId
  && a.scope.kind === b.scope.kind && (a.scope.kind === "OWN_BRAND"
    ? b.scope.kind === "OWN_BRAND" && a.scope.brandId === b.scope.brandId
    : b.scope.kind === "CLIENT" && a.scope.clientId === b.scope.clientId);
const newPosition = (): PagePosition => ({ after: null, history: [] });
function errorCopy(code: string | null, copy: Copy) {
  if (code === "UNAUTHENTICATED") return copy("انتهت صلاحية الدخول. سجّل الدخول من جديد.", "Your session expired. Sign in again.");
  if (code === "DENIED") return copy("لم تعد تفاصيل هذه الحملة متاحة لك.", "This campaign's private details are no longer available to you.");
  if (code === "STALE_VERSION" || code === "STALE_CONFIRMATION") return copy("تغيّرت الحقول أو نسخة السياق. اقرأ الحالة الحالية وراجع التفاصيل من جديد.", "Fields or the context version changed. Read current state and review the details again.");
  if (code === "MISSING_REQUIREMENTS" || code === "CONFIRMATION_REQUIRED") return copy("أكمل الحقول الثلاثين وراجع كل قيمة قبل تجهيز الملف.", "Complete all 30 fields and review each value before preparing the profile.");
  if (code === "TEXT_SOURCE_LIMIT") return copy("وصلت إلى حد الكلمات المحفوظة لهذه المقابلة.", "This interview has reached its saved text-source limit.");
  if (code === "INVALID_STORED_AGENT") return copy("تعذر التحقق من سجل المقابلة المحفوظ. لا يمكن اعتباره مراجعة حالية.", "The saved interview history could not be verified. It cannot count as a current review.");
  if (code === "UNRESOLVED_REQUEST") return copy("تحقق من الطلب السابق قبل بدء إجراء آخر.", "Resolve the earlier request before starting another action.");
  if (code === "JOURNAL_UNAVAILABLE") return copy("تعذر حفظ طلب الاستعادة بأمان. لم يبدأ طلب جديد؛ احتفظ بكلماتك حتى تُحل المشكلة.", "Request recovery could not be saved safely. No new request was started; keep your words while the issue is resolved.");
  return copy("لم يتأكد الرد. كلماتك والطلب الملتقط باقيان للمراجعة ما دام الوصول متاحًا.", "The response is unconfirmed. Your words and captured request remain for review while access is available.");
}
function useLifecycleCallbacks<T>(value: T) {
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  return latest;
}
function disposeFlight(refs: { mounted: { current: boolean }; sequence: { current: number }; active: { current: Flight | null } }) {
  refs.mounted.current = false; refs.sequence.current++; refs.active.current?.controller.abort();
}
function asPacket(saved: Captured): CampaignAgentRecoveryPacket {
  return { kind: saved.kind, body: saved.body, phase: saved.phase, receipt: saved.receipt, reviewed: saved.reviewed };
}
function originalReceipt(receipt: Receipt): CampaignAgentResult | null { return receipt.action === "RECOVERY_BARRIER" ? receipt.originalReceipt : receipt; }

export function CampaignAgentInterview(props: CampaignAgentInterviewProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const ids = useId(), heading = useRef<HTMLHeadingElement | null>(null), reviewOpener = useRef<HTMLElement | null>(null);
  const [fixed] = useState(() => ({ binding: props.binding, actorReference: props.actorReference, privacyEpoch: props.privacyEpoch }));
  const callbacks = useLifecycleCallbacks(props);
  const adapter = props.adapter;
  const [hydrated, setHydrated] = useState(false), hydratedRef = useRef(false), mounted = useRef(true);
  const [journalReady, setJournalReady] = useState(false), journalReadyRef = useRef(false);
  const [read, setRead] = useState<CampaignAgentRead | null>(null), readRef = useRef<CampaignAgentRead | null>(null);
  const [historical, setHistorical] = useState(false), [rows, setRows] = useState<readonly ReviewRow[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({ input: "TEXT", output: "TEXT" });
  const preferencesRef = useRef(preferences), [preferencesDirty, setPreferencesDirty] = useState(false), preferencesDirtyRef = useRef(false);
  const [draft, setDraft] = useState({ text: "", language: "" }), draftRef = useRef(draft);
  const [choices, setChoices] = useState<Partial<Record<CampaignAgentFieldKey, Choice>>>({}), choicesRef = useRef(choices);
  const [reviewDialog, setReviewDialog] = useState(false);
  const [page, setPage] = useState<CampaignAgentSourcePage | null>(null), [pageHistorical, setPageHistorical] = useState(false);
  const [position, setPosition] = useState<PagePosition>(newPosition), [sourceRetry, setSourceRetry] = useState<SourceCapture | null>(null);
  const retainedSources = useRef(new Map<string, CustomerTextSource>());
  const [sourceOptions, setSourceOptions] = useState<CustomerTextSource[]>([]);
  const [pending, setPending] = useState<Captured | null>(null), pendingRef = useRef<Captured | null>(null);
  const [stub, setStub] = useState<CampaignAgentRecoveryStub | null>(null), stubRef = useRef<CampaignAgentRecoveryStub | null>(null);
  const [knownReceipt, setKnownReceipt] = useState<Receipt | null>(null), knownReceiptRef = useRef<Receipt | null>(null);
  const [outcomeStatus, setOutcomeStatus] = useState<"UNKNOWN" | "COMMITTED" | null>(null);
  const [barrierDialog, setBarrierDialog] = useState(false), barrierOpener = useRef<HTMLElement | null>(null);
  const [barrierReview, setBarrierReview] = useState<{ state: CampaignAgentRead; authority: ClientAuthorityDTO | null;
    targetStub: CampaignAgentRecoveryStub; initialPreferences: Preferences | null } | null>(null);
  const [barrierReviewed, setBarrierReviewed] = useState(false);
  const [staleBarrierKey, setStaleBarrierKey] = useState<string | null>(null), staleBarrierKeyRef = useRef<string | null>(null);
  const authorityRef = useRef<ClientAuthorityDTO | null>(props.planAuthority);
  const [denied, setDenied] = useState(false), deniedRef = useRef(false);
  const [busy, setBusy] = useState(false), busyRef = useRef(false), active = useRef<Flight | null>(null), sequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<CampaignAgentResult | null>(null);
  const drift = !sameBinding(fixed.binding, props.binding) || fixed.actorReference !== props.actorReference
    || fixed.privacyEpoch !== props.privacyEpoch;
  const privateDenied = denied || drift;
  function emit() {
    callbacks.current.onRecoveryState({ pending: !journalReadyRef.current || pendingRef.current !== null || stubRef.current !== null || knownReceiptRef.current !== null,
      busy: busyRef.current || !hydratedRef.current,
      dirty: preferencesDirtyRef.current
        || draftRef.current.text.length > 0 || draftRef.current.language.length > 0
        || Object.values(choicesRef.current).some(choice => choice?.checked || choice && choice.references.length > 0),
      denied: deniedRef.current });
  }
  function memoryCapture(next: Captured | null) { pendingRef.current = next; setPending(next); emit(); }
  function memoryStub(next: CampaignAgentRecoveryStub | null) { stubRef.current = next; setStub(next); emit(); }
  function rememberReceipt(receipt: Receipt) {
    knownReceiptRef.current = receipt; setKnownReceipt(receipt);
    const original = originalReceipt(receipt); if (original?.action === "GENERATE_PROFILE") setGenerated(original);
    emit();
  }
  async function capture(next: Captured, flight: Flight) {
    // Publish synchronously before any crypto/storage await, especially a known
    // receipt. A storage failure never changes CONFIRMED back to UNKNOWN.
    memoryCapture(next); if (next.receipt) rememberReceipt(next.receipt);
    try {
      const safeStub = await adapter.stubForPacket(asPacket(next)); ensure(flight); memoryStub(safeStub);
      await adapter.journal.save(asPacket(next), flight.controller.signal); ensure(flight);
      journalReadyRef.current = true; setJournalReady(true);
    } catch (failure) {
      if (same(flight) && !flight.denied) { journalReadyRef.current = false; setJournalReady(false); }
      throw failure;
    }
  }
  function clearChoices() { choicesRef.current = {}; setChoices({}); setReviewDialog(false); emit(); }
  function deny(code = "DENIED") {
    if (deniedRef.current) return; // Parent broadcasts can include this same child.
    // All protected projections are cleared before consuming a denial body.
    deniedRef.current = true; if (active.current) active.current.denied = true; active.current?.controller.abort(); sequence.current++;
    readRef.current = null; setRead(null); setRows([]); setPage(null); retainedSources.current.clear(); setSourceOptions([]); setSourceRetry(null);
    pendingRef.current = null; setPending(null); stubRef.current = null; setStub(null);
    knownReceiptRef.current = null; setKnownReceipt(null); setOutcomeStatus(null); setBarrierDialog(false); setBarrierReview(null); setBarrierReviewed(false);
    staleBarrierKeyRef.current = null; setStaleBarrierKey(null);
    authorityRef.current = null; journalReadyRef.current = false; setJournalReady(false); setGenerated(null); setPosition(newPosition());
    draftRef.current = { text: "", language: "" }; setDraft(draftRef.current);
    preferencesRef.current = { input: "TEXT", output: "TEXT" }; setPreferences(preferencesRef.current); setPreferencesDirty(false); preferencesDirtyRef.current = false;
    choicesRef.current = {}; setChoices({}); setReviewDialog(false); setHistorical(false); setPageHistorical(false);
    try { adapter.journal.clear(true); } catch { /* Private memory is still cleared; unresolved durable stub is never released. */ }
    setDenied(true); setError(code); emit(); callbacks.current.onDeny(); heading.current?.focus();
  }
  const privacyActions = useLifecycleCallbacks({ deny });
  const recoveryActions = useLifecycleCallbacks({ emit, restore });
  const registerPrivateDenial = props.registerPrivateDenial;
  useEffect(() => registerPrivateDenial(status => privacyActions.current.deny(status === 401 ? "UNAUTHENTICATED" : "DENIED")),
    [registerPrivateDenial, privacyActions]);
  useEffect(() => {
    mounted.current = true;
    const lifetime = { mounted, sequence, active }; let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      recoveryActions.current.restore();
    });
    return () => { disposed = true; disposeFlight(lifetime); };
    // Root keeps adapter/identity stable for the mounted route. Remount on changes.
  }, [recoveryActions]);
  useEffect(() => { if (drift && !deniedRef.current) queueMicrotask(() => privacyActions.current.deny()); }, [drift, privacyActions]);
  function same(flight: Flight) { return mounted.current && active.current === flight && flight.sequence === sequence.current; }
  function ensure(flight: Flight) {
    if (!same(flight) || flight.denied || flight.controller.signal.aborted || deniedRef.current
      || !sameBinding(fixed.binding, callbacks.current.binding) || fixed.privacyEpoch !== callbacks.current.privacyEpoch)
      throw new UiError("CANCELLED");
  }
  async function payload(response: Response, flight: Flight) {
    ensure(flight);
    if (denialStatuses.has(response.status)) { flight.denied = true; deny(response.status === 401 ? "UNAUTHENTICATED" : "DENIED"); throw new UiError("DENIED", response.status); }
    if (!response.ok) {
      let code = response.status === 503 ? "RETRY_REQUIRED" : "REQUEST_FAILED";
      try { const body = await readCampaignAgentResponse(response, flight.controller.signal); if (body && typeof body === "object" && "error" in body
        && body.error && typeof body.error === "object" && "code" in body.error && typeof body.error.code === "string"
        && explicitErrors.has(body.error.code)) code = body.error.code; } catch { /* Known status stays authoritative. */ }
      ensure(flight); throw new UiError(code, response.status);
    }
    const body = await readCampaignAgentResponse(response, flight.controller.signal); ensure(flight);
    if (!body || typeof body !== "object" || Array.isArray(body) || !("data" in body)) throw new UiError("INVALID_RESPONSE");
    return body.data;
  }
  async function run(operation: (flight: Flight) => Promise<void>, boot = false) {
    if ((!hydratedRef.current && !boot) || active.current || deniedRef.current || drift || !mounted.current) return;
    const flight: Flight = { controller: new AbortController(), sequence: ++sequence.current, denied: false, timedOut: false };
    active.current = flight; busyRef.current = true; setBusy(true); setError(null); emit();
    const timeout = setTimeout(() => { flight.timedOut = true; flight.controller.abort(); }, 30000);
    try { await operation(flight); ensure(flight); }
    catch (failure) { if (same(flight) && !flight.denied) {
      const code = failure instanceof UiError ? failure.code : failure && typeof failure === "object" && "code" in failure
        && typeof failure.code === "string" && explicitErrors.has(failure.code) ? failure.code : "NETWORK";
      setError(flight.timedOut ? "TIMEOUT" : flight.controller.signal.aborted ? "CANCELLED" : code);
    } }
    finally { clearTimeout(timeout); if (active.current === flight) { active.current = null; busyRef.current = false;
      if (mounted.current) { setBusy(false); emit(); } } }
  }
  function restore() {
    if (privateDenied) return;
    void run(async flight => {
      // load itself refetches current authorized key and decrypts. No business
      // request is sent on mount, including a restored UNKNOWN or barrier packet.
      const restored = await adapter.journal.load(flight.controller.signal); ensure(flight);
      memoryStub(restored.stub);
      const recovered = restored.packet ? adapter.captureFromPacket(restored.packet)
        : restored.stub?.kind === "RECOVERY_BARRIER" ? await adapter.barrierFromStub(restored.stub) : null;
      ensure(flight);
      memoryCapture(recovered);
      if (recovered?.kind === "COMMAND" && recovered.command.action === "APPEND_TEXT"
        && draftRef.current.text === "" && draftRef.current.language === "") {
        draftRef.current = { text: recovered.command.payload.originalText.text, language: recovered.command.payload.originalText.language ?? "" };
        setDraft(draftRef.current); emit();
      }
      if (recovered?.receipt) rememberReceipt(recovered.receipt);
      journalReadyRef.current = true; setJournalReady(true);
    }, true).finally(() => {
      if (mounted.current && !deniedRef.current) { hydratedRef.current = true; setHydrated(true); emit(); }
    });
  }
  async function currentRead(flight: Flight, capturedReceipt?: Receipt) {
    const permission = await adapter.getPlan(fixed.binding, flight.controller.signal); ensure(flight);
    authorityRef.current = permission ? adapter.decodePlan(await payload(permission, flight), fixed.binding) : null;
    if (fixed.binding.scope.kind === "CLIENT" && !authorityRef.current) throw new UiError("INVALID_RESPONSE");
    const next = await adapter.decodeRead(await payload(await adapter.getState(fixed.binding, flight.controller.signal), flight), fixed.binding);
    const nextRows = await adapter.reviewRows(next); ensure(flight);
    const previous = readRef.current, changed = previous === null
      || JSON.stringify(previous.current.snapshot) !== JSON.stringify(next.current.snapshot)
      || previous.retained?.revision !== next.retained?.revision;
    if (capturedReceipt && (next.retained === null || next.retained.id !== capturedReceipt.agentId
      || next.retained.revision < capturedReceipt.agentRevision || next.current.snapshot.campaignRevision < capturedReceipt.campaignRevision
      || next.current.snapshot.planningRevision < capturedReceipt.planningRevision)) throw new UiError("INVALID_RESPONSE");
    readRef.current = next; setRead(next); setRows(nextRows); setHistorical(false);
    if (changed) clearChoices();
    if (!preferencesDirty && next.retained) { preferencesRef.current = next.retained.preferences; setPreferences(next.retained.preferences); }
    ensure(flight); emit(); heading.current?.focus();
    return next;
  }
  function refresh() { if (privateDenied) return; setHistorical(true); void run(async flight => {
    const receipt = knownReceiptRef.current ?? pendingRef.current?.receipt;
    if (receipt) {
      await callbacks.current.onCommitted(receipt, flight.controller.signal); ensure(flight);
      const next = await currentRead(flight, receipt); ensure(flight);
      const saved = pendingRef.current;
      if (!saved || saved.kind === "RECOVERY_BARRIER" || saved.receipt && adapter.acknowledges(saved.command, saved.receipt, next)) releaseKnown(flight, receipt);
      else memoryCapture({ ...saved, reviewed: true });
    } else await currentRead(flight);
  }); }
  function releaseKnown(flight: Flight, receipt: Receipt) {
    ensure(flight);
    if (knownReceiptRef.current !== receipt || !readRef.current || readRef.current.retained === null
      || readRef.current.retained.revision < receipt.agentRevision) throw new UiError("UNRESOLVED_REQUEST");
    // The only clear(false) boundary: validated known receipt plus a current
    // authorized read (or confirmed barrier plus that read). Never CONFLICT alone.
    adapter.journal.clear(false); ensure(flight);
    const saved = pendingRef.current;
    if (saved?.kind === "COMMAND" && ["INITIALIZE", "SET_PREFERENCES"].includes(saved.command.action)
      && "preferences" in saved.command.payload
      && preferencesRef.current.input === saved.command.payload.preferences.input
      && preferencesRef.current.output === saved.command.payload.preferences.output
      && readRef.current.retained.preferences.input === saved.command.payload.preferences.input
      && readRef.current.retained.preferences.output === saved.command.payload.preferences.output) {
      preferencesDirtyRef.current = false; setPreferencesDirty(false);
    }
    if (saved?.kind === "COMMAND" && saved.command.action === "APPEND_TEXT"
      && draftRef.current.text === saved.command.payload.originalText.text && (draftRef.current.language || null) === saved.command.payload.originalText.language) {
      draftRef.current = { text: "", language: "" }; setDraft(draftRef.current);
    }
    knownReceiptRef.current = null; setKnownReceipt(null); memoryCapture(null); memoryStub(null); setOutcomeStatus(null);
    staleBarrierKeyRef.current = null; setStaleBarrierKey(null);
    journalReadyRef.current = true; setJournalReady(true); clearChoices(); emit();
  }
  async function sourceRead(flight: Flight, intent: SourceCapture) {
    const next = await adapter.decodeSources(await payload(await adapter.getSources(fixed.binding, intent.position.after, flight.controller.signal), flight),
      fixed.binding, intent.agentId, intent.position.after); ensure(flight);
    for (const source of next.sources) {
      const old = retainedSources.current.get(source.id);
      if (old && old.sourceHash !== source.sourceHash) throw new UiError("INVALID_RESPONSE");
    }
    next.sources.forEach(source => retainedSources.current.set(source.id, source));
    setSourceOptions([...retainedSources.current.values()]);
    setPage(next); setPosition(intent.position); setSourceRetry(null); setPageHistorical(false); heading.current?.focus();
  }
  function sources(next: PagePosition = newPosition()) {
    const agentId = readRef.current?.retained?.id; if (!agentId || privateDenied || pendingRef.current || stubRef.current) return;
    const intent = { agentId, position: { after: next.after, history: [...next.history] } };
    setSourceRetry(intent); setPageHistorical(true); void run(flight => sourceRead(flight, intent));
  }
  async function sendCaptured(flight: Flight, saved: Captured) {
    if (saved.phase !== "UNKNOWN") throw new UiError("UNRESOLVED_REQUEST");
    try {
      // Every initial send AND exact retry requires completed encrypted storage.
      // A failed/cancelled save never falls back to memory-only dispatch.
      await capture(saved, flight); ensure(flight);
      const confirmed: Captured = saved.kind === "COMMAND"
        ? { ...saved, receipt: adapter.decodeReceipt(await payload(await adapter.sendCommand(saved.body, flight.controller.signal), flight), saved.command), phase: "CONFIRMED", reviewed: false }
        : { ...saved, receipt: adapter.decodeBarrierReceipt(await payload(await adapter.sendBarrier(saved.body, flight.controller.signal), flight), saved.command), phase: "CONFIRMED", reviewed: false };
      ensure(flight); await capture(confirmed, flight);
      const receipt = confirmed.receipt!;
      await callbacks.current.onCommitted(receipt, flight.controller.signal); ensure(flight);
      const next = await currentRead(flight, receipt);
      if (confirmed.kind === "RECOVERY_BARRIER" || confirmed.kind === "COMMAND" && adapter.acknowledges(confirmed.command, confirmed.receipt!, next)) releaseKnown(flight, receipt);
      else memoryCapture({ ...confirmed, reviewed: true });
    } catch (failure) {
      if (same(flight) && !flight.denied && pendingRef.current?.phase === "UNKNOWN" && failure instanceof UiError
        && [400, 409, 422].includes(failure.status ?? 0)) {
        if (saved.kind === "RECOVERY_BARRIER" && failure.code === "STALE_VERSION" && failure.status === 409) {
          staleBarrierKeyRef.current = saved.command.operationKey; setStaleBarrierKey(saved.command.operationKey);
        }
        await capture({ ...saved, phase: "CONFLICT", reviewed: false }, flight);
      }
      throw failure;
    }
  }
  function checkOutcome() {
    if (privateDenied || busyRef.current) return;
    void run(async flight => {
      let safeStub = stubRef.current;
      if (!safeStub && pendingRef.current) { safeStub = await adapter.stubForPacket(asPacket(pendingRef.current)); ensure(flight); memoryStub(safeStub); }
      if (!safeStub) throw new UiError("UNRESOLVED_REQUEST");
      const result = await adapter.decodeOutcome(await payload(await adapter.getOutcome(safeStub, flight.controller.signal), flight), safeStub); ensure(flight);
      setOutcomeStatus(result.status);
      if (result.status === "UNKNOWN") { await currentRead(flight); return; } // Never release on absence.
      rememberReceipt(result.receipt); // Known history survives every following await.
      const saved = pendingRef.current;
      if (saved) {
        const known: Captured = saved.kind === "COMMAND"
          ? { ...saved, receipt: adapter.decodeReceipt(result.receipt, saved.command), phase: "CONFIRMED", reviewed: false }
          : { ...saved, receipt: adapter.decodeBarrierReceipt(result.receipt, saved.command), phase: "CONFIRMED", reviewed: false };
        await capture(known, flight);
      }
      await callbacks.current.onCommitted(result.receipt, flight.controller.signal); ensure(flight);
      const known = knownReceiptRef.current;
      if (!known) throw new UiError("UNRESOLVED_REQUEST");
      await currentRead(flight, known); releaseKnown(flight, known);
    });
  }
  function reviewBarrier(opener: HTMLElement) {
    if (privateDenied || busyRef.current || knownReceiptRef.current || !stubRef.current) return;
    if (stubRef.current.kind === "RECOVERY_BARRIER" && (pendingRef.current?.kind !== "RECOVERY_BARRIER"
      || staleBarrierKeyRef.current !== stubRef.current.operationKey || outcomeStatus !== "UNKNOWN")) return;
    barrierOpener.current = opener;
    void run(async flight => {
      const targetStub = stubRef.current!;
      const current = await currentRead(flight); ensure(flight);
      if (stubRef.current !== targetStub) throw new UiError("UNRESOLVED_REQUEST");
      if (targetStub.kind === "RECOVERY_BARRIER" && (!pendingRef.current || !adapter.permitsBarrierHandoff(pendingRef.current, current)
        || staleBarrierKeyRef.current !== targetStub.operationKey)) throw new UiError("UNRESOLVED_REQUEST");
      setBarrierReview({ state: current, authority: authorityRef.current, targetStub,
        initialPreferences: current.retained ? null : preferencesRef.current });
      setBarrierReviewed(false); setBarrierDialog(true);
    });
  }
  function confirmBarrier() {
    if (!barrierReview || !barrierReviewed || privateDenied || busyRef.current || knownReceiptRef.current
      || stubRef.current !== barrierReview.targetStub) return;
    const reviewed = barrierReview;
    void run(async flight => {
      const original = adapter.parseBarrier({ operationKey: crypto.randomUUID(), scope: fixed.binding.scope, campaignId: fixed.binding.campaignId,
        expectedAgentRevision: reviewed.state.retained?.revision ?? 0, expectedSnapshot: reviewed.state.current.snapshot,
        ...(fixed.binding.scope.kind === "CLIENT" ? { expectedAuthority: reviewed.authority } : {}),
        target: adapter.originalTarget(reviewed.targetStub), initialPreferences: reviewed.initialPreferences });
      const saved: Captured = { kind: "RECOVERY_BARRIER", command: original, body: JSON.stringify(original), phase: "UNKNOWN", receipt: null, reviewed: false };
      // Legal journal handoff preserves the exact original target in this new
      // barrier's technical stub. No clear(false), target retry or silent rekey.
      memoryCapture(saved); setBarrierDialog(false); setBarrierReview(null); setHistorical(true);
      await sendCaptured(flight, saved);
    });
  }
  function command(action: CampaignAgentCommand["action"], actionPayload: unknown) {
    const current = readRef.current;
    if (!current || !hydratedRef.current || !journalReadyRef.current || pendingRef.current || stubRef.current || knownReceiptRef.current
      || busyRef.current || privateDenied || !props.canWrite || props.blocked || historical) return;
    if (fixed.binding.scope.kind === "CLIENT" && (!authorityRef.current || authorityRef.current.capability !== "plan"
      || authorityRef.current.clientId !== fixed.binding.scope.clientId)) return;
    void run(async flight => {
      const original = adapter.parseCommand({ operationKey: crypto.randomUUID(), scope: fixed.binding.scope, campaignId: fixed.binding.campaignId,
        expectedAgentRevision: current.retained?.revision ?? 0, expectedSnapshot: current.current.snapshot,
        ...(fixed.binding.scope.kind === "CLIENT" ? { expectedAuthority: authorityRef.current } : {}), action, payload: actionPayload });
      const saved: Captured = { kind: "COMMAND", command: original, body: JSON.stringify(original), phase: "UNKNOWN", receipt: null, reviewed: false };
      memoryCapture(saved); setHistorical(true); setReviewDialog(false); await sendCaptured(flight, saved);
    });
  }
  function saveText(event: FormEvent) { event.preventDefault();
    if (!draftRef.current.text.trim()) return;
    command("APPEND_TEXT", { originalText: { text: draftRef.current.text, language: draftRef.current.language || null } });
  }
  function changePreferences(next: Preferences) { preferencesRef.current = next; setPreferences(next); setPreferencesDirty(true); preferencesDirtyRef.current = true; emit(); }
  function changeDraft(next: typeof draft) { draftRef.current = next; setDraft(next); emit(); }
  function changeChoice(field: CampaignAgentFieldKey, next: Choice) { choicesRef.current = { ...choicesRef.current, [field]: next }; setChoices(choicesRef.current); emit(); }
  function confirmFields() {
    if (!rows.length || !rows.every(row => row.present && choicesRef.current[row.field]?.checked)) return;
    command("CONFIRM_FIELDS", { fields: rows.map(row => ({ field: row.field, valueHash: row.valueHash,
      source: choicesRef.current[row.field]!.references.length
        ? { kind: "CUSTOMER_TEXT", references: [...choicesRef.current[row.field]!.references].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
        : { kind: "CUSTOMER_FIELD_CHOICE", capturedValueHash: row.valueHash } })) });
  }
  const initialized = read?.retained !== null && read?.retained !== undefined;
  const unresolved = pending !== null || stub !== null || knownReceipt !== null;
  const locked = !hydrated || !journalReady || privateDenied || busy || unresolved || props.blocked || !props.canWrite || historical;
  const editableDraft = hydrated && !privateDenied && !busy && !props.blocked && props.canWrite;
  const complete = rows.length === 30 && rows.every(row => row.present);
  const reviewedCount = rows.filter(row => row.present && choices[row.field]?.checked).length;
  const preferencesAvailable = !locked && read !== null;
  const exactProfile = generated?.briefId !== null && generated?.briefId !== undefined && generated.briefVersion !== null
    && props.generatedProfile?.briefId === generated.briefId && props.generatedProfile.briefVersion === generated.briefVersion;
  function rowValue(row: ReviewRow) {
    if (!read || !row.present) return <span className="text-destructive">{copy("لم تُحفظ قيمة بعد", "No saved value yet")}</span>;
    return campaignFieldValue(row.field, read.current.fields[row.field], isAr);
  }
  function reviewSources(choice: Choice | undefined) {
    return choice?.references.length ? <ul className="space-y-2">{choice.references.map(reference => <li key={reference.id}>
      <p className="text-sm text-muted-foreground">{copy("كلمات محفوظة اخترتها", "Saved words you selected")}</p>
      <p dir="auto" lang={sourceOptions.find(source => source.id === reference.id)?.originalText.language ?? undefined}
        className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{sourceOptions.find(source => source.id === reference.id)?.originalText.text}</p>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">{copy("اختياري الصريح لهذه القيمة", "My explicit choice of this value")}</p>;
  }
  const coverageCopy = read?.coverage === "CURRENT" ? copy("الحقول الحالية مؤكدة", "Current fields confirmed")
    : read?.coverage === "STALE" ? copy("مراجعة سابقة؛ التفاصيل تغيّرت", "Earlier review; details changed")
      : read?.coverage === "NOT_INITIALIZED" ? copy("المقابلة لم تبدأ", "Interview not started") : copy("بانتظار مراجعتك", "Waiting for your review");
  return <Card dir={isAr ? "rtl" : "ltr"} className="min-w-0" data-campaign-agent-interview aria-busy={busy}>
    <CardHeader><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0 space-y-2">
      <CardTitle><h2 ref={heading} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{copy("من فكرتك إلى ملف الحملة", "From your idea to a campaign profile")}</h2></CardTitle>
      <CardDescription className="text-base leading-7">{copy("احفظ وصفك بكلماتك، أكمل التفاصيل، ثم أكّد القيم التي راجعتها.", "Save your description in your words, complete the details, then confirm the values you reviewed.")}</CardDescription>
    </div><InfameBrandPattern compact className="shrink-0" /></div>
      <div className="flex flex-wrap gap-2"><Badge variant="secondary">{copy("إرشاد يدوي", "Manual guidance")}</Badge>
        {read && !privateDenied && <Badge variant="outline">{coverageCopy}</Badge>}</div>
    </CardHeader>
    <CardContent className="grid min-w-0 gap-5">
      <p className="text-base leading-7 text-muted-foreground">{copy("المساعد الذكي والوسائط والصوت غير متاحة في هذه المرحلة. خياراتك تُحفظ دون تشغيل ميكروفون أو إرسالها إلى مزوّد.", "The AI assistant, media and voice are unavailable in this phase. Preferences are saved without starting a microphone or sending them to a provider.")}</p>
      {error && <p role="alert" className="rounded-lg border border-destructive p-4 text-base text-destructive">{errorCopy(error, copy)}</p>}
      {privateDenied ? <p className="text-base">{copy("أُخفيت الكلمات والقيم الخاصة. جدّد الدخول وافتح الحملة مجددًا.", "Private words and values have been hidden. Renew your session and reopen the campaign.")}</p> : <>
        {!hydrated && <p role="status">{copy("جارٍ استعادة طلبك السابق…", "Restoring your earlier request…")}</p>}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!hydrated || busy} onClick={refresh}>{read ? copy("اقرأ الحالة الحالية", "Read current state") : copy("تحميل المقابلة", "Load interview")}</Button>
          {!journalReady && hydrated && <Button type="button" variant="outline" disabled={busy} onClick={restore}>{copy("أعد استعادة الطلب المحفوظ", "Retry saved-request restoration")}</Button>}
          {busy && <Button type="button" variant="outline" onClick={() => { active.current?.controller.abort(); heading.current?.focus(); }}>{copy("إيقاف الانتظار", "Stop waiting")}</Button>}</div>
        {busy && <p role="status">{copy("جارٍ انتظار الرد الفعلي…", "Waiting for the actual response…")}</p>}
        {historical && read && <p className="text-sm text-muted-foreground">{copy("هذا آخر عرض صالح؛ لم يُؤكَّد تحديثه الحالي.", "This is the last valid view; its current refresh is unconfirmed.")}</p>}
        {unresolved && <section className="space-y-3 rounded-lg border border-border p-4" data-agent-recovery-panel aria-label={copy("استعادة طلب المقابلة", "Interview request recovery")}>
          <p className="text-base">{knownReceipt ? copy("وصل إيصال محفوظ. الاستعادة تقرأ الحالة فقط؛ لن تُكرّر الإجراء.", "A retained receipt was received. Recovery reads current state only; it will not repeat the action.")
            : !pending && stub ? copy("تعذّر فتح الطلب المشفّر. احتفظنا بمرجع الاستعادة؛ تحقق من نتيجته قبل المتابعة.", "The encrypted request could not be opened. Its recovery reference remains; check the outcome before continuing.")
              : pending?.phase === "UNKNOWN" ? copy("نتيجة الطلب غير مؤكدة. احتفظنا بالمفتاح والمدخلات نفسها.", "This request's outcome is unknown. Its exact key and inputs are retained.")
                : copy("تعذر تنفيذ الطلب المحفوظ. تحقّق من نتيجته وراجع الحالة؛ لا يبدأ طلب جديد تلقائيًا.", "The saved request could not execute. Check its outcome and current state; no new request starts automatically.")}</p>
          {outcomeStatus === "UNKNOWN" && <p role="status" className="text-base">{copy("لم نجد إيصالًا محفوظًا. قد يصل الطلب السابق لاحقًا؛ تظل المتابعة محمية حتى تختار إجراء الاستعادة.", "No retained receipt was found. The earlier request may arrive later; further work stays protected until you choose a recovery action.")}</p>}
          <div className="flex flex-wrap gap-2">{pending?.phase === "UNKNOWN" && !knownReceipt && <Button type="button" disabled={busy}
            onClick={() => { const saved = pendingRef.current; if (saved?.phase === "UNKNOWN") void run(flight => sendCaptured(flight, saved)); }}>{pending.kind === "RECOVERY_BARRIER"
              ? copy("أعد طلب الحاجز نفسه", "Retry exact barrier request") : copy("أعد الطلب نفسه", "Retry exact request")}</Button>}
            {!knownReceipt && <Button type="button" variant="outline" disabled={busy} onClick={checkOutcome}>{copy("تحقق من نتيجة الطلب", "Check request outcome")}</Button>}
            <Button type="button" variant="outline" disabled={busy} onClick={refresh}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>
            {!knownReceipt && stub && (stub.kind === "COMMAND" || staleBarrierKey === stub.operationKey && outcomeStatus === "UNKNOWN") && <Button type="button" variant="outline" disabled={busy}
              onClick={event => reviewBarrier(event.currentTarget)}>{copy("راجع إنهاء الطلب السابق", "Review abandoning earlier request")}</Button>}
            {knownReceipt && pending?.reviewed && <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async flight => {
              const receipt = knownReceiptRef.current; if (!receipt) throw new UiError("UNRESOLVED_REQUEST");
              await callbacks.current.onCommitted(receipt, flight.controller.signal); ensure(flight); await currentRead(flight, receipt); releaseKnown(flight, receipt);
            })}>{copy("راجعت التفاصيل؛ احتفظ بكلماتي", "Reviewed details; keep my words")}</Button>}
          </div>
        </section>}
        {read && <>
          <fieldset disabled={!preferencesAvailable} className="min-w-0 space-y-4"><legend className="mb-3 text-base font-medium">{copy("طريقة المشاركة والرد", "How you contribute and receive replies")}</legend>
            <fieldset className="min-w-0"><legend className="mb-2 text-base">{copy("الإدخال", "Input")}</legend><div className="grid gap-2 sm:grid-cols-2">
              {([ ["TEXT", MessageSquare, copy("كتابة", "Text")], ["MEDIA", Paperclip, copy("وسائط — غير متاحة حاليًا", "Media — currently unavailable")],
                ["VOICE_MESSAGE", Mic, copy("رسالة صوتية — غير متاحة حاليًا", "Voice message — currently unavailable")],
                ["LIVE_VOICE", AudioLines, copy("صوت مباشر — غير متاح حاليًا", "Live voice — currently unavailable")] ] as const).map(([value, Icon, label]) => <label key={value}
                  className="flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 text-base has-[:checked]:bg-accent/50">
                  <input type="radio" name={ids + "-input"} value={value} checked={preferences.input === value} onChange={() => changePreferences({ ...preferencesRef.current, input: value })}
                    className="size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" />
                  <Icon aria-hidden="true" className="size-5 shrink-0" /><span className="min-w-0 break-words">{label}</span></label>)}
            </div></fieldset>
            <fieldset className="min-w-0"><legend className="mb-2 text-base">{copy("الرد", "Output")}</legend><div className="grid gap-2 sm:grid-cols-3">
              {([ ["TEXT", copy("نص", "Text")], ["VOICE", copy("صوت — غير متاح حاليًا", "Voice — currently unavailable")],
                ["TEXT_AND_VOICE", copy("نص وصوت — النص متاح", "Text and voice — text available")] ] as const).map(([value, label]) => <label key={value}
                  className="flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 text-base has-[:checked]:bg-accent/50">
                  <input type="radio" name={ids + "-output"} value={value} checked={preferences.output === value}
                    onChange={() => changePreferences({ ...preferencesRef.current, output: value })}
                    className="size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" /><span className="min-w-0 break-words">{label}</span></label>)}
            </div></fieldset>
            <Button type="button" disabled={!preferencesAvailable || initialized && !preferencesDirty}
              onClick={() => command(initialized ? "SET_PREFERENCES" : "INITIALIZE", { preferences: preferencesRef.current })}>{initialized ? copy("احفظ اختياراتي", "Save my preferences") : copy("ابدأ المقابلة اليدوية", "Start manual interview")}</Button>
          </fieldset>
          {initialized && <>
            {preferences.input !== "TEXT" && <p className="rounded-lg border p-3 text-base">{copy("حُفظ تفضيلك؛ يمكنك الآن المتابعة بالكتابة. لا توجد وسائط أو تسجيل صوتي فعّال.", "Your preference is saved; continue with text for now. Media and audio recording are unavailable.")}</p>}
            <form onSubmit={saveText} className="min-w-0 space-y-3" aria-label={copy("كلماتك الأصلية للحملة", "Your original campaign words")}><fieldset disabled={!editableDraft} className="min-w-0 space-y-3">
              <label htmlFor={ids + "-words"} className="block space-y-2"><span className="text-base font-medium">{copy("احكِ لنا عن الحملة", "Tell us about the campaign")}</span>
              </label>
              <div data-studio-composer-adaptation className="min-w-0 rounded-[10px] border border-input bg-background p-3 focus-within:ring-2 focus-within:ring-ring">
                  <Textarea id={ids + "-words"} value={draft.text} rows={5} maxLength={20000} dir="auto" lang={draft.language || undefined}
                    className="min-w-0 resize-y border-0 text-base shadow-none focus-visible:ring-0" aria-describedby={ids + "-words-help"}
                    onChange={event => changeDraft({ ...draftRef.current, text: event.target.value })} />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p id={ids + "-words-help"} className="min-w-0 text-sm text-muted-foreground">
                    {copy("كلمات محفوظة دون استخراج تلقائي", "Saved words without automatic extraction")}</p><Button type="submit" disabled={locked || !draft.text.trim()}>
                    <Send aria-hidden="true" className="size-4" />{copy("احفظ كلماتي", "Save my words")}</Button></div>
              </div>
              <label htmlFor={ids + "-language"} className="block space-y-2"><span className="text-base">{copy("لغة الكلمات الأصلية — اختيارية", "Original words' language — optional")}</span>
                <Input id={ids + "-language"} value={draft.language} maxLength={100} dir="ltr" className="text-base" placeholder="ar / en"
                  onChange={event => changeDraft({ ...draftRef.current, language: event.target.value })} /></label>
              <p className="text-sm leading-6 text-muted-foreground">{copy("تبقى الكلمات والمسافات ولغتها كما أدخلتها. تغيير لغة الواجهة لا يترجم وصفك.", "Words, whitespace and declared language remain as entered. Changing the interface language does not translate your description.")}</p>
            </fieldset></form>
            <section className="min-w-0 space-y-3" aria-label={copy("الكلمات المحفوظة", "Saved words")}><h3 className="text-base font-medium">{copy("كلماتك المحفوظة", "Your saved words")}</h3>
              <Button type="button" variant="outline" disabled={busy || unresolved} onClick={() => sources()}>{copy("حمّل الكلمات المحفوظة", "Load saved words")}</Button>
              {pageHistorical && page && <p className="text-sm text-muted-foreground">{copy("صفحة محفوظة سابقة؛ لم تتأكد القراءة الجديدة.", "Earlier saved page; the new read is unconfirmed.")}</p>}
              {sourceRetry && !busy && <Button type="button" variant="outline" onClick={() => { const intent = sourceRetry; void run(flight => sourceRead(flight, intent)); }}>{copy("أعد قراءة الصفحة نفسها", "Retry this exact page")}</Button>}
              {page && <><ol className="m-0 grid min-w-0 list-none gap-4 p-0">{page.sources.map((source, index) => <li key={source.id}
                className="min-w-0 rounded-lg bg-muted/40 p-4" data-agent-text-source><p className="mb-2 text-sm font-medium">{copy("كلمات أصلية محفوظة", "Saved original words")} · {sourceOptions.findIndex(item => item.id === source.id) + 1 || index + 1}</p>
                <p dir="auto" lang={source.originalText.language ?? undefined} className="whitespace-pre-wrap break-words text-base leading-7 [overflow-wrap:anywhere]">{source.originalText.text}</p>
                <p className="mt-2 text-sm text-muted-foreground"><bdi dir="ltr">{source.createdAt}</bdi>{source.originalText.language && <> · <bdi>{source.originalText.language}</bdi></>}</p>
              </li>)}</ol>{page.sources.length === 0 && <p className="text-base text-muted-foreground">{copy("لم تُحفظ كلمات بعد.", "No words saved yet.")}</p>}
                <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || unresolved || !position.history.length}
                  onClick={() => sources({ after: position.history.at(-1)!, history: position.history.slice(0, -1) })}>{copy("الكلمات السابقة", "Previous words")}</Button>
                  <Button type="button" variant="outline" disabled={busy || unresolved || !page.nextCursor}
                    onClick={() => sources({ after: page.nextCursor, history: [...position.history, position.after] })}>{copy("الكلمات التالية", "Next words")}</Button></div>
              </>}
            </section>
            <section className="min-w-0 space-y-4 border-t border-border pt-5" aria-label={copy("مراجعة تفاصيل الحملة الثلاثين", "Review all 30 campaign fields")}>
              <h3 className="text-base font-medium">{copy("راجع تفاصيل الحملة", "Review campaign details")}</h3>
              <p className="text-base leading-7 text-muted-foreground">{copy("هذه القيم من حقولك المحفوظة. عدّل التفاصيل في النموذج ثم أعد قراءتها هنا. لا تُؤكّد القيمة الناقصة أو الافتراضية دون مراجعتك.", "These values come from your saved fields. Edit details in the form, then read them here again. Review missing or default values before confirming.")}</p>
              <p role="status" className="text-base">{copy("راجعت", "Reviewed")} {reviewedCount} / 30</p>
              <Button type="button" variant="outline" disabled={locked || !Object.values(choices).some(choice => choice?.checked || choice && choice.references.length > 0)}
                onClick={() => { clearChoices(); callbacks.current.onReviewDiscard?.(); }}>{copy("ألغِ هذه المراجعة لتعديل التفاصيل", "Discard this review to edit details")}</Button>
              <fieldset disabled={locked} className="grid min-w-0 gap-4"><legend className="sr-only">{copy("القيم الحالية ومصادرها", "Current values and their sources")}</legend>
                {rows.map((row, index) => <article key={row.field} className="min-w-0 space-y-3 rounded-lg border border-border p-4" data-agent-review-field={row.field}>
                  <h4 className="text-base font-medium">{index + 1}. {campaignFieldLabels[row.field][isAr ? 0 : 1]}</h4><div className="min-w-0 text-base leading-7 [overflow-wrap:anywhere]">{rowValue(row)}</div>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 text-base"><Checkbox disabled={locked || !row.present} checked={choices[row.field]?.checked === true}
                    onCheckedChange={value => changeChoice(row.field, { checked: value === true, references: choicesRef.current[row.field]?.references ?? [] })} />
                    <span>{copy("راجعت هذه القيمة وأؤكّدها", "I reviewed and confirm this value")}</span></label>
                  <details inert={!hydrated || locked} className="min-w-0"><summary className="min-h-12 cursor-pointer py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{copy("اربط كلمات محفوظة — اختياري", "Link saved words — optional")}</summary>
                    <p className="mb-2 text-sm text-muted-foreground">{copy("اقرأ الكلمات الكاملة في قائمة الكلمات المحفوظة أعلاه. دون اختيار كلمات، يسجّل النظام اختيارك الصريح للقيمة. ربط الكلمات لا يثبت استنتاجًا آليًا.", "Read the complete words in the saved-words list above. With no linked words, your explicit field choice is recorded. Linking words does not prove automated extraction.")}</p>
                    <div className="grid min-w-0 gap-3">{sourceOptions.map((source, sourceIndex) => { const selected = choices[row.field]?.references.some(reference => reference.id === source.id) ?? false;
                      return <label key={source.id} className="flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-md border border-input p-3"><Checkbox checked={selected}
                        disabled={locked || !row.present || !selected && (choices[row.field]?.references.length ?? 0) >= 4}
                        onCheckedChange={value => { const old = choicesRef.current[row.field] ?? { checked: false, references: [] }; changeChoice(row.field,
                          { ...old, checked: false, references: value === true ? [...old.references, { id: source.id, sourceHash: source.sourceHash }]
                            : old.references.filter(reference => reference.id !== source.id) }); }} />
                        <span className="min-w-0 break-words text-base [overflow-wrap:anywhere]">{copy("الكلمات المحفوظة", "Saved words")} {sourceIndex + 1}<br />
                          <bdi dir="ltr" className="text-sm text-muted-foreground">{source.createdAt}</bdi>{source.originalText.language && <> · <bdi>{source.originalText.language}</bdi></>}</span></label>; })}</div>
                    {!sourceOptions.length && <p>{copy("حمّل الكلمات المحفوظة لربطها. يمكنك تأكيد اختيارك الصريح للقيمة دون كلمات.", "Load saved words to link them. You can confirm your explicit field choice without linked words.")}</p>}
                  </details>
                </article>)}
              </fieldset>
              <Button type="button" disabled={locked || !complete || reviewedCount !== 30} onClick={event => { reviewOpener.current = event.currentTarget; setReviewDialog(true); }}>{copy("راجع تأكيد التفاصيل الثلاثين", "Review confirmation of all 30 details")}</Button>
              {!complete && <p className="text-base text-muted-foreground">{copy("أكمل القيم الناقصة في نموذج التفاصيل أولًا.", "Complete missing values in the details form first.")}</p>}
              <Button type="button" disabled={locked || read.coverage !== "CURRENT" || read.retained?.confirmation.kind !== "REVIEWED_SET"}
                onClick={() => { const review = readRef.current?.retained?.confirmation; if (review?.kind === "REVIEWED_SET") command("GENERATE_PROFILE", { confirmationBatchId: review.confirmationBatchId }); }}>{copy("جهّز ملف الحملة للمراجعة", "Prepare campaign profile for review")}</Button>
              <p className="text-sm leading-6 text-muted-foreground">{copy("تجهيز الملف ينشئ نسخة غير معتمدة. إرسالها واعتماد المالك خطوتان منفصلتان.", "Preparing a profile creates an unapproved version. Submitting it and owner approval are separate steps.")}</p>
            </section>
          </>}
        </>}
        {generated?.briefId && <section className="min-w-0 space-y-3 rounded-lg border border-border p-4" aria-label={copy("ملف الحملة الناتج", "Generated campaign profile")}
          data-agent-profile-id={generated.briefId} data-agent-profile-version={generated.briefVersion}>
          <h3 className="text-base font-medium">{copy("نسخة ملف الحملة الناتجة", "Generated campaign profile version")}</h3>
          <p className="text-sm text-muted-foreground">{copy("إيصال محفوظ للنسخة", "Retained receipt for version")} {generated.briefVersion}. {copy("هذه النسخة لا تثبت اعتمادًا أو جاهزية تجارية.", "This version does not establish approval or commercial readiness.")}</p>
          {exactProfile ? props.generatedProfile!.content : <p>{copy("حمّل ملف هذه النسخة المحددة من الحملة. لا نستبدله بنسخة أخرى عند تغيّر الحالة.", "Load this exact profile version from the campaign. A different version will not replace it when current state changes.")}</p>}
        </section>}
      </>}
    </CardContent>
    <Dialog open={barrierDialog && !privateDenied} onOpenChange={setBarrierDialog}><DialogContent dir={isAr ? "rtl" : "ltr"}
      className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none motion-reduce:transition-none" showCloseButton={false}
      onCloseAutoFocus={event => { event.preventDefault(); if (barrierOpener.current?.isConnected) barrierOpener.current.focus(); else heading.current?.focus(); }}>
      <DialogHeader><DialogTitle>{copy("راجع إنهاء الطلب السابق", "Review abandoning earlier request")}</DialogTitle>
        <DialogDescription>{copy("نتحقق من آخر حالة محفوظة ونمنع الطلب المتأخر من إضافة عمل جديد. إذا حُفظ طلبك بالفعل، يبقى سجله وتفاصيله محفوظين.", "We check the latest saved state and prevent a late request from adding new work. If your request already saved, its record and details remain.")}</DialogDescription></DialogHeader>
      {barrierReview && <div className="min-w-0 space-y-4">
        <p dir="auto" className="whitespace-pre-wrap break-words text-base [overflow-wrap:anywhere]">{barrierReview.state.current.fields.title ?? copy("الحملة الحالية", "Current campaign")}</p>
        <p className="text-base leading-7">{copy("لن يغيّر هذا الإجراء كلمات الحملة أو يعتمد الملف. راجع اختيارك قبل متابعة التحرير.", "This action does not change campaign words or approve the profile. Review your choice before continuing to edit.")}</p>
        {barrierReview.initialPreferences && <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-base font-medium">{copy("اختيارات المقابلة عند البدء", "Interview preferences when starting")}</legend>
          <label className="grid gap-2 text-base"><span>{copy("الإدخال", "Input")}</span><select className="min-h-12 min-w-0 rounded-[10px] border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            value={barrierReview.initialPreferences.input} onChange={event => { const input = event.target.value as Preferences["input"]; setBarrierReview(previous => previous?.initialPreferences
              ? { ...previous, initialPreferences: { ...previous.initialPreferences, input } } : previous); setBarrierReviewed(false); }}>
            <option value="TEXT">{copy("كتابة", "Text")}</option><option value="MEDIA">{copy("وسائط — غير متاحة حاليًا", "Media — currently unavailable")}</option>
            <option value="VOICE_MESSAGE">{copy("رسالة صوتية — غير متاحة حاليًا", "Voice message — currently unavailable")}</option><option value="LIVE_VOICE">{copy("صوت مباشر — غير متاح حاليًا", "Live voice — currently unavailable")}</option>
          </select></label>
          <label className="grid gap-2 text-base"><span>{copy("الرد", "Output")}</span><select className="min-h-12 min-w-0 rounded-[10px] border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            value={barrierReview.initialPreferences.output} onChange={event => { const output = event.target.value as Preferences["output"]; setBarrierReview(previous => previous?.initialPreferences
              ? { ...previous, initialPreferences: { ...previous.initialPreferences, output } } : previous); setBarrierReviewed(false); }}>
            <option value="TEXT">{copy("نص", "Text")}</option><option value="VOICE">{copy("صوت — غير متاح حاليًا", "Voice — currently unavailable")}</option>
            <option value="TEXT_AND_VOICE">{copy("نص وصوت — النص متاح", "Text and voice — text available")}</option>
          </select></label></fieldset>}
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 text-base"><Checkbox checked={barrierReviewed} disabled={busy}
          onCheckedChange={value => setBarrierReviewed(value === true)} /><span>{copy("راجعت الحالة واختيارات المتابعة", "I reviewed the state and continuation choices")}</span></label>
      </div>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setBarrierDialog(false)}>{copy("تابع المراجعة", "Keep reviewing")}</Button>
        <Button type="button" disabled={busy || !barrierReviewed || !barrierReview} onClick={confirmBarrier}>{copy("أكّد الحاجز واحتفظ بكلماتي", "Confirm barrier and keep my words")}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={reviewDialog && !privateDenied} onOpenChange={setReviewDialog}><DialogContent dir={isAr ? "rtl" : "ltr"}
      className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none motion-reduce:transition-none" showCloseButton={false}
      onCloseAutoFocus={event => { event.preventDefault(); if (reviewOpener.current?.isConnected) reviewOpener.current.focus(); else heading.current?.focus(); }}>
      <DialogHeader><DialogTitle>{copy("أكّد التفاصيل التي راجعتها", "Confirm the details you reviewed")}</DialogTitle>
        <DialogDescription>{copy("تُحفظ القيم الثلاثون ومصادرها كدفعة واحدة. لا تُعتمد الحملة بهذه الخطوة.", "All 30 values and their sources are saved as one batch. This step does not approve the campaign.")}</DialogDescription></DialogHeader>
      <ol className="m-0 grid min-w-0 list-none gap-4 p-0">{rows.map((row, index) => <li key={row.field} className="min-w-0 space-y-2 border-t border-border pt-3">
        <h3 className="text-base font-medium">{index + 1}. {campaignFieldLabels[row.field][isAr ? 0 : 1]}</h3><div className="min-w-0 text-base [overflow-wrap:anywhere]">{rowValue(row)}</div>{reviewSources(choices[row.field])}
      </li>)}</ol>
      <DialogFooter className="flex-wrap"><Button type="button" variant="outline" onClick={() => setReviewDialog(false)}>{copy("تابع المراجعة", "Keep reviewing")}</Button>
        <Button type="button" disabled={locked || !complete || reviewedCount !== 30} onClick={confirmFields}>{copy("أؤكّد التفاصيل الثلاثين", "Confirm all 30 details")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </Card>;
}
