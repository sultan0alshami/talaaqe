"use client";

/**
 * Licensed source concepts: file-upload-02 local selection/drop/file rows;
 * chat-bubble-01 inline composer arrangement. See docs/SHADCN_RESEARCH.md.
 * No simulated transfer, widget history, demo Sent, provider or voice behavior.
 */
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { z } from "zod";
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, FileTextIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfameBrandPattern } from "@/components/infame/brand-pattern";
import { useI18n } from "@/lib/i18n";
import { PlanningScopeSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { ClientAuthoritySchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import {
  ContextReferenceItemSchema, ContextReferenceItemsSchema, ContextReferenceResponseSchema,
  ContextReferenceCommandResultSchema, ContextReviewReferenceResponseSchema, CampaignReviewReferenceResponseSchema,
  type ContextReferenceManifest, type ContextReferenceResponse, type ContextReferenceCommandResult,
} from "@/lib/brand-context/reference-contracts";

export type ReferenceEditorState = { dirty: boolean; pending: boolean; busy: boolean; discard: () => void };
export type ReferenceStateRegistrar = (read: () => ReferenceEditorState) => () => void;
export type ContextReferenceFilesProps = {
  scope: PlanningScope; contextId: string; contextRevision: number;
  planAuthority: ClientAuthorityDTO | null; archived: boolean; disabled: boolean;
  onParentChanged: () => void; onDeny: () => void;
  registerStateReader: ReferenceStateRegistrar;
  onStateChange: (state: Pick<ReferenceEditorState, "dirty" | "pending" | "busy">) => void;
};
export type OwnerReviewReferenceFilesProps = { submissionId: string; onDeny: () => void } & (
  { lane: "CONTEXT_REVIEW"; contextId: string }
  | { lane: "CAMPAIGN_REVIEW"; campaignId: string; contextVersionId: string | null }
);
export type ContextReferenceVersionFilesProps = {
  scope: PlanningScope; contextId: string; versionId: string; onDeny: () => void;
};
type Copy = (ar: string, en: string) => string;
type Item = z.infer<typeof ContextReferenceItemSchema>;
type Original = Item["notesOriginal"];
type FileItem = Extract<ContextReferenceManifest, { kind: "MANIFEST" }>["items"][number];
type ReadManifest = ContextReferenceManifest | { kind: "NO_CONTEXT" };
type AtomicRead = ContextReferenceResponse & { contextId: string; revision: number; inputRevision: number; archived: boolean };
type Selection = { file: File; labelOriginal: Item["labelOriginal"]; notesOriginal: Item["notesOriginal"] };
type Draft = { items: Item[]; baseline: string; parentRevision: number; referenceRevision: number };
type WireBase = { operationKey: string; scope: PlanningScope; contextId: string; expectedRevision: number;
  expectedReferenceRevision: number; expectedAuthority?: ClientAuthorityDTO };
type WireCommand = WireBase & ({ action: "UPLOAD"; payload: Pick<Item, "labelOriginal" | "notesOriginal"> }
  | { action: "REPLACE"; payload: { items: Item[] } });
type Pending = { command: WireCommand; body: string | FormData; file: File | null; source: AtomicRead;
  phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT"; receipt: ContextReferenceCommandResult | null;
  reviewed: AtomicRead | null };
type Task = { controller: AbortController; generation: number; denied: boolean };
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const denialStatuses = new Set([401, 403, 404]);
const errorCodes = new Set(["VALIDATION", "STALE_VERSION", "STALE_AUTHORITY", "OPERATION_KEY_REUSED", "ARCHIVED",
  "INVALID_STATE", "REVISION_EXHAUSTED", "CAPABILITY_UNAVAILABLE", "RETRY_REQUIRED", "RATE_LIMITED"]);
const atomicFields = z.object({ contextId: z.string().min(1).max(200), revision: z.number().int().positive().max(2147483646),
  inputRevision: z.number().int().positive().max(2147483646), archived: z.boolean() });
class Failure extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) throw new Failure("INVALID_RESPONSE"); return result.data;
}
function unwrap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("data" in value)) throw new Failure("INVALID_RESPONSE");
  return value.data;
}
function errorCode(value: unknown, status: number) {
  if (value && typeof value === "object" && "error" in value && value.error && typeof value.error === "object"
    && "code" in value.error && typeof value.error.code === "string" && errorCodes.has(value.error.code)) return value.error.code;
  return status === 503 ? "CAPABILITY_UNAVAILABLE" : "REQUEST_FAILED";
}
function scopeKey(scope: PlanningScope) { return scope.kind === "OWN_BRAND" ? "OWN_BRAND:" + scope.brandId : "CLIENT:" + scope.clientId; }
function sameScope(a: PlanningScope, b: PlanningScope) { return scopeKey(a) === scopeKey(b); }
function query(scope: PlanningScope, contextId: string, versionId?: string) {
  const result = new URLSearchParams(scope.kind === "OWN_BRAND" ? { scope: scope.kind, brandId: scope.brandId }
    : { scope: scope.kind, clientId: scope.clientId });
  result.set("contextId", contextId); if (versionId !== undefined) result.set("versionId", versionId); return result;
}
function authorityMatches(a: ClientAuthorityDTO, b: ClientAuthorityDTO | null) {
  const keys = ["organizationId", "clientId", "brandId", "membershipId", "grantId", "organizationRevision",
    "membershipRevision", "clientRevision", "grantRevision"] as const;
  return b !== null && keys.every(key => a[key] === b[key]);
}
function itemsOf(references: ReadManifest): FileItem[] { return references.kind === "MANIFEST" ? references.items : []; }
function referenceRevision(references: ContextReferenceManifest) { return references.kind === "MANIFEST" ? references.revision : 0; }
function metadata(items: readonly Item[]): Item[] {
  return items.map(item => ({ bindingId: item.bindingId, labelOriginal: { ...item.labelOriginal }, notesOriginal: { ...item.notesOriginal } }));
}
function fingerprint(items: readonly Item[]) { return JSON.stringify(metadata(items)); }
function draftFor(read: AtomicRead): Draft { const items = metadata(itemsOf(read.references));
  return { items, baseline: fingerprint(items), parentRevision: read.revision, referenceRevision: referenceRevision(read.references) }; }
function isDirty(draft: Draft | null) { return draft !== null && fingerprint(draft.items) !== draft.baseline; }
function sameManifest(a: ReadManifest, b: ReadManifest) { return JSON.stringify(a) === JSON.stringify(b); }
function validateRead(value: unknown, scope: PlanningScope, contextId: string, prior: AtomicRead | null,
  versionId: string | null = null): AtomicRead {
  const scoped = parse(ContextReferenceResponseSchema, value), atomic = parse(atomicFields, value);
  const read: AtomicRead = { ...scoped, ...atomic };
  if (!sameScope(scope, read.scope) || read.contextId !== contextId || read.versionId !== versionId || read.inputRevision > read.revision
    || referenceRevision(read.references) > read.revision || prior !== null && (read.revision < prior.revision
      || referenceRevision(read.references) < referenceRevision(prior.references))) throw new Failure("INVALID_RESPONSE");
  if (prior !== null && (read.revision === prior.revision && (read.inputRevision !== prior.inputRevision
      || read.archived !== prior.archived || !sameManifest(read.references, prior.references))
    || read.references.kind === "MANIFEST" && prior.references.kind === "MANIFEST"
      && (read.references.id === prior.references.id || read.references.revision === prior.references.revision)
      && !sameManifest(read.references, prior.references))) throw new Failure("INVALID_RESPONSE");
  parse(ContextReferenceItemsSchema, metadata(itemsOf(read.references)));
  return read;
}
function validateReceipt(pending: Pending, value: unknown): ContextReferenceCommandResult {
  const result = parse(ContextReferenceCommandResultSchema, value), command = pending.command;
  if (result.contextId !== command.contextId || result.revision !== command.expectedRevision + 1
    || result.referenceRevision !== command.expectedReferenceRevision + 1
    || (command.action === "UPLOAD") !== (result.bindingId !== null)) throw new Failure("INVALID_RESPONSE");
  if (command.action === "UPLOAD" && itemsOf(pending.source.references).some(item => item.bindingId === result.bindingId)
    || pending.source.references.kind === "MANIFEST" && result.manifestId === pending.source.references.id) throw new Failure("INVALID_RESPONSE");
  if (pending.receipt && ["contextId", "revision", "referenceRevision", "manifestId", "manifestHash", "bindingId"].some(key =>
    pending.receipt?.[key as keyof ContextReferenceCommandResult] !== result[key as keyof ContextReferenceCommandResult])) throw new Failure("INVALID_RESPONSE");
  return result;
}
function validateReconciliation(pending: Pending, current: AtomicRead): "EXACT" | "ADVANCED" {
  const receipt = pending.receipt;
  if (!receipt || current.contextId !== receipt.contextId || current.revision < receipt.revision
    || current.references.kind !== "MANIFEST" || current.references.revision < receipt.referenceRevision) throw new Failure("INVALID_RESPONSE");
  if (current.revision === receipt.revision && (current.inputRevision !== pending.source.inputRevision || current.archived)) throw new Failure("INVALID_RESPONSE");
  if (current.references.revision === receipt.referenceRevision) {
    if (current.references.id !== receipt.manifestId || current.references.hash !== receipt.manifestHash) throw new Failure("INVALID_RESPONSE");
    let expected: Item[];
    if (pending.command.action === "REPLACE") expected = pending.command.payload.items;
    else {
      if (!pending.file || !receipt.bindingId) throw new Failure("INVALID_RESPONSE");
      expected = [...metadata(itemsOf(pending.source.references)), { bindingId: receipt.bindingId, ...pending.command.payload }];
      const uploaded = current.references.items.at(-1);
      if (!uploaded || uploaded.bindingId !== receipt.bindingId || uploaded.contentType !== pending.file.type
        || uploaded.size !== pending.file.size) throw new Failure("INVALID_RESPONSE");
    }
    if (fingerprint(current.references.items) !== fingerprint(expected)) throw new Failure("INVALID_RESPONSE");
    return "EXACT";
  }
  // A later edit may legitimately remove this receipt's uploaded binding.
  return "ADVANCED";
}
function copyError(code: string, copy: Copy, confirmed = false) {
  if (code === "DENIED") return copy("لم تعد هذه الملفات متاحة في جلستك الحالية.", "These files are unavailable in your current session.");
  if (code === "CAPABILITY_UNAVAILABLE") return confirmed
    ? copy("وصل تأكيد الطلب، لكن خدمة الملفات غير متاحة للتحقق من القائمة الحالية. أعد التحقق من الحالة.", "A request receipt was received, but the file service is unavailable to verify the current list. Check current state again.")
    : copy("خدمة الملفات غير متاحة الآن. لم يتم تأكيد أي رفع؛ تبقى المدخلات هنا.", "The file service is unavailable. No upload was confirmed; your inputs remain here.");
  if (code === "VALIDATION") return copy("راجع العنوان ولغة النص والحدود المسموحة للملفات والملاحظات.", "Check the label, text language, file limits and notes.");
  if (code === "PARENT_DRIFT") return copy("تغيّر السياق المحفوظ. راجعه في القسم الأساسي قبل تعديل الملفات؛ كلماتك محفوظة هنا.", "The saved context changed. Review it in the main editor before changing files; your words remain here.");
  if (["STALE_VERSION", "STALE_AUTHORITY", "ARCHIVED", "INVALID_STATE"].includes(code)) return copy("تغيّرت الحالة أو الصلاحية. حمّل الحالة الحالية وراجعها قبل طلب جديد.", "State or permission changed. Load and review current state before a new request.");
  if (code === "TIMEOUT" || code === "CANCELLED") return confirmed
    ? copy("وصل تأكيد الطلب، ثم توقف التحقق من القائمة الحالية. أعد التحقق من الحالة.", "A request receipt was received, then checking the current list stopped. Check current state again.")
    : copy("توقف الانتظار دون تأكيد النتيجة. أعد الطلب نفسه أو تحقق من الحالة الحالية.", "Waiting stopped without confirming the outcome. Retry the same request or check current state.");
  if (code === "INVALID_RESPONSE") return copy("تعذر التحقق من الرد. لم يُعرض الرد غير المتطابق؛ احتُفظ بالمدخلات والطلب الأصلي.", "The response could not be verified. The mismatched response was not shown; inputs and the original request remain.");
  return copy("تعذر تأكيد الحالة الحالية. تبقى آخر قراءة صحيحة ومدخلاتك؛ حاول مجددًا.", "Current state could not be confirmed. The last valid read and your inputs remain; try again.");
}

function usePrivateRequests(onDeny: () => void, onBusyChange?: () => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState<number | null>(null);
  const active = useRef<Task | null>(null), generation = useRef(0), mounted = useRef(true), denial = useRef(onDeny);
  const busyChanged = useRef(onBusyChange);
  const stopRequests = useCallback(() => {
    mounted.current = false; generation.current++; active.current?.controller.abort(); active.current = null;
  }, []);
  useEffect(() => { denial.current = onDeny; busyChanged.current = onBusyChange; }, [onDeny, onBusyChange]);
  useEffect(() => { mounted.current = true; return stopRequests; }, [stopRequests]);
  function current(task: Task) { return mounted.current && active.current === task && generation.current === task.generation; }
  function ensure(task: Task) { if (!current(task) || task.controller.signal.aborted || task.denied) throw new Failure(task.denied ? "DENIED" : "CANCELLED"); }
  function checkStatus(status: number, task: Task) {
    ensure(task);
    if (denialStatuses.has(status)) {
      // Clear every protected projection/File/command/URL before consuming any body.
      task.denied = true; setProgress(null); denial.current(); setError("DENIED"); throw new Failure("DENIED", status);
    }
  }
  async function response(url: string, task: Task) {
    const result = await fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "error", signal: task.controller.signal });
    checkStatus(result.status, task);
    if (!result.ok) {
      let value: unknown = null; try { value = await result.json(); } catch { /* HTTP status remains authoritative. */ }
      ensure(task); throw new Failure(errorCode(value, result.status), result.status);
    }
    return result;
  }
  async function read(url: string, task: Task) {
    const result = await response(url, task), value: unknown = await result.json(); ensure(task); return unwrap(value);
  }
  function send(pending: Pending, task: Task): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); let settled = false;
      function finish(error?: unknown, value?: unknown) {
        if (settled) return; settled = true; task.controller.signal.removeEventListener("abort", abort);
        xhr.onload = null; xhr.onerror = null; xhr.ontimeout = null; xhr.onabort = null; xhr.upload.onprogress = null;
        if (error) reject(error); else resolve(value);
      }
      function abort() { xhr.abort(); finish(new Failure("CANCELLED")); }
      xhr.open("POST", "/api/brand-contexts/references/commands"); xhr.withCredentials = true; xhr.timeout = 30000;
      if (typeof pending.body === "string") xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.onprogress = event => {
        if (current(task) && !task.denied) setProgress(event.lengthComputable && event.total > 0
          ? Math.min(100, Math.floor(event.loaded / event.total * 100)) : null);
      };
      xhr.onerror = () => finish(new Failure("REQUEST_FAILED")); xhr.ontimeout = () => finish(new Failure("TIMEOUT"));
      xhr.onabort = () => finish(new Failure("CANCELLED"));
      xhr.onload = () => {
        try {
          checkStatus(xhr.status, task);
          let value: unknown; try { value = JSON.parse(xhr.responseText); } catch { throw new Failure("INVALID_RESPONSE", xhr.status); }
          ensure(task); if (xhr.status < 200 || xhr.status >= 300) throw new Failure(errorCode(value, xhr.status), xhr.status);
          finish(undefined, unwrap(value));
        } catch (error) { finish(error); }
      };
      task.controller.signal.addEventListener("abort", abort, { once: true });
      if (task.controller.signal.aborted) abort();
      else { try { xhr.send(pending.body); } catch (error) { finish(error); } }
    });
  }
  async function run(work: (task: Task) => Promise<void>) {
    if (!mounted.current || active.current) return;
    const task: Task = { controller: new AbortController(), generation: ++generation.current, denied: false };
    active.current = task; setBusy(true); setError(""); setProgress(null);
    busyChanged.current?.();
    const timeout = setTimeout(() => task.controller.abort(), 30000);
    try { await work(task); ensure(task); }
    catch (error) { if (current(task) && !task.denied) setError(error instanceof Failure ? error.code : "REQUEST_FAILED"); }
    finally { clearTimeout(timeout); if (current(task)) { active.current = null; setBusy(false); setProgress(null); busyChanged.current?.(); } }
  }
  return { busy, error, setError, progress, read, response, send, ensure, run,
    isBusy: () => active.current !== null, cancel: () => active.current?.controller.abort() };
}
function usePrivateObjectURLs() {
  const urls = useRef(new Set<string>());
  function revokeAll() { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }
  useEffect(() => { const current = urls.current; return () => { for (const url of current) URL.revokeObjectURL(url); current.clear(); }; }, []);
  return { urls, revokeAll };
}
type Network = ReturnType<typeof usePrivateRequests>;
async function savePrivateFile(url: string, item: FileItem, net: Network, task: Task, urls: Set<string>) {
  const response = await net.response(url, task);
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== item.contentType) throw new Failure("INVALID_RESPONSE");
  const blob = await response.blob(); net.ensure(task);
  if (blob.size !== item.size || blob.size > MAX_BYTES || blob.type.split(";")[0].toLowerCase() !== item.contentType) throw new Failure("INVALID_RESPONSE");
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[item.contentType];
  const filename = item.labelOriginal.text.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_").slice(0, 150) || "reference";
  const objectURL = URL.createObjectURL(blob); urls.add(objectURL);
  const link = document.createElement("a"); link.href = objectURL; link.download = filename + "." + extension;
  link.hidden = true; document.body.append(link);
  try { net.ensure(task); link.click(); }
  finally { link.remove(); setTimeout(() => { URL.revokeObjectURL(objectURL); urls.delete(objectURL); }, 0); }
}

function OriginalField({ value, onChange, label, disabled, notes = false, invalid = false }: {
  value: Original; onChange: (value: Original) => void; label: string; disabled: boolean; notes?: boolean; invalid?: boolean;
}) {
  const id = useId(), { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const attributes = { id: id + "-text", dir: "auto" as const, value: value.text ?? "", disabled: disabled || notes && value.text === null,
    maxLength: notes ? 2000 : 200, "aria-invalid": invalid, className: "min-h-11 min-w-0 text-base",
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, text: event.target.value }) };
  return <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <div className="grid min-w-0 gap-2"><label htmlFor={id + "-text"} className="font-medium">{label}</label>
      {notes ? <Textarea {...attributes} rows={3} className="min-h-24 min-w-0 max-h-64 resize-y text-base" /> : <Input {...attributes} />}
      {notes && <label htmlFor={id + "-absent"} className="flex min-h-11 items-center gap-2">
        <Checkbox id={id + "-absent"} checked={value.text === null} disabled={disabled}
          onCheckedChange={checked => onChange({ ...value, text: checked === true ? null : "" })} />
        <span>{copy("لم أقدّم ملاحظات", "Notes not supplied")}</span></label>}
    </div>
    <div className="grid min-w-0 content-start gap-2"><label htmlFor={id + "-language"} className="font-medium">{copy("لغة النص الأصلي", "Original text language")}</label>
      <Input id={id + "-language"} dir="ltr" className="min-h-11 text-base" maxLength={100} value={value.language ?? ""}
        disabled={disabled} aria-invalid={invalid} placeholder="ar, en, ar-SA"
        onChange={event => onChange({ ...value, language: event.target.value === "" ? null : event.target.value })} />
      <span className="text-xs text-muted-foreground">{copy("اتركها فارغة إذا لم تكن معروفة.", "Leave blank when unknown.")}</span>
    </div>
  </div>;
}
function ManifestView({ manifest, busy, download }: { manifest: ReadManifest; busy: boolean; download: (item: FileItem) => void }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  if (manifest.kind === "NO_CONTEXT") return <p className="text-muted-foreground">{copy("لم يرتبط هذا الموجز بسياق علامة تجارية.", "This brief was submitted without a brand context.")}</p>;
  if (manifest.kind === "LEGACY_ABSENT") return <p className="text-muted-foreground">{copy("لا توجد قائمة ملفات مسجّلة لهذا السجل التاريخي.", "This historical record has no recorded file manifest.")}</p>;
  if (manifest.items.length === 0) return <p className="text-muted-foreground">{copy("القائمة المحفوظة فارغة.", "The saved file list is empty.")}</p>;
  return <ul className="m-0 grid min-w-0 list-none gap-3 p-0">{manifest.items.map(item => <li key={item.bindingId}
    className="grid min-w-0 gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto]" data-reference-binding={item.bindingId}>
    <div className="min-w-0"><p dir="auto" className="break-words font-medium [overflow-wrap:anywhere]">{item.labelOriginal.text}</p>
      <p className="text-xs text-muted-foreground"><bdi dir="ltr">{item.contentType} · {(item.size / 1024).toLocaleString(isAr ? "ar" : "en", { maximumFractionDigits: 1 })} KiB</bdi></p>
      {item.labelOriginal.language && <p className="text-xs text-muted-foreground"><bdi dir="ltr">{item.labelOriginal.language}</bdi></p>}
      {item.notesOriginal.text === null ? <p className="text-xs text-muted-foreground">{copy("ملاحظات غير مقدّمة", "Notes not supplied")}</p>
        : item.notesOriginal.text === "" ? <p className="text-xs text-muted-foreground">{copy("ملاحظات فارغة", "Empty notes")}</p>
          : <p dir="auto" className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.notesOriginal.text}</p>}
      {item.notesOriginal.language && <p className="text-xs text-muted-foreground"><bdi dir="ltr">{item.notesOriginal.language}</bdi></p>}
    </div>
    <Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal motion-reduce:transition-none" disabled={busy}
      aria-label={copy("تنزيل: ", "Download: ") + item.labelOriginal.text} onClick={() => download(item)}>
      <DownloadIcon className="size-4 shrink-0" aria-hidden="true" />{copy("تنزيل خاص", "Private download")}</Button>
  </li>)}</ul>;
}

export function ContextReferenceFiles(props: ContextReferenceFilesProps) {
  const scope = PlanningScopeSchema.safeParse(props.scope);
  if (!scope.success) return null;
  return <ContextReferenceEditor key={scopeKey(scope.data) + ":" + props.contextId} {...props} scope={scope.data} />;
}
function ContextReferenceEditor(props: ContextReferenceFilesProps) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const { registerStateReader, onStateChange } = props;
  const [fixed] = useState(() => ({ scope: props.scope, contextId: props.contextId }));
  const [snapshot, setSnapshot] = useState<AtomicRead | null>(null), snapshotRef = useRef<AtomicRead | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), draftRef = useRef<Draft | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null), selectionRef = useRef<Selection | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), pendingRef = useRef<Pending | null>(null);
  const [denied, setDenied] = useState(false), [dragging, setDragging] = useState(false), [invalid, setInvalid] = useState(false);
  const [preview, setPreview] = useState<string | null>(null), previewRef = useRef<string | null>(null);
  const [notice, setNotice] = useState(""), [removeConfirmation, setRemoveConfirmation] = useState<Item[] | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null), heading = useRef<HTMLHeadingElement | null>(null), urls = usePrivateObjectURLs();
  const changedNotification = useRef(""), removalFocus = useRef<HTMLElement | null>(null), helpId = useId();
  const publishState = useRef<() => void>(() => {});
  const releasePreview = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = null;
  }, []);
  function updateSnapshot(value: AtomicRead | null) { snapshotRef.current = value; setSnapshot(value); }
  function updateDraft(value: Draft | null) { draftRef.current = value; setDraft(value); publishState.current(); }
  function updateSelection(value: Selection | null) {
    if (selectionRef.current?.file !== value?.file) {
      releasePreview();
      const file = value?.file;
      const nextPreview = file && ["image/png", "image/jpeg", "image/webp"].includes(file.type) ? URL.createObjectURL(file) : null;
      previewRef.current = nextPreview; setPreview(nextPreview);
    }
    selectionRef.current = value; setSelection(value); publishState.current();
  }
  function updatePending(value: Pending | null) { pendingRef.current = value; setPending(value); publishState.current(); }
  function deny() {
    updateSnapshot(null); updateDraft(null); updateSelection(null); updatePending(null); setRemoveConfirmation(null);
    if (fileInput.current) fileInput.current.value = "";
    if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = null; setPreview(null);
    urls.revokeAll(); setDragging(false); setInvalid(false); setNotice(""); setDenied(true); heading.current?.focus(); props.onDeny();
  }
  const net = usePrivateRequests(deny, () => publishState.current());
  function discardLocal() {
    if (pendingRef.current || net.isBusy()) return;
    const read = snapshotRef.current;
    updateDraft(read ? draftFor(read) : null); updateSelection(null); setRemoveConfirmation(null);
    if (fileInput.current) fileInput.current.value = "";
    if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = null; setPreview(null);
    setDragging(false); setInvalid(false); setNotice(""); net.setError("");
  }
  function readEditorState(): ReferenceEditorState {
    return { dirty: selectionRef.current !== null || isDirty(draftRef.current), pending: pendingRef.current !== null,
      busy: net.isBusy(), discard: discardLocal };
  }
  const stateReader = useRef(readEditorState);
  useEffect(() => {
    stateReader.current = readEditorState;
    publishState.current = () => {
      const { dirty, pending, busy } = stateReader.current(); onStateChange({ dirty, pending, busy });
    };
  });
  useEffect(() => {
    const unregister = registerStateReader(() => stateReader.current());
    const { dirty, pending, busy } = stateReader.current(); onStateChange({ dirty, pending, busy });
    return unregister;
  }, [registerStateReader, onStateChange]);
  useEffect(() => releasePreview, [releasePreview]);
  const plan = ClientAuthoritySchema.safeParse(props.planAuthority);
  const clientPlan = plan.success && plan.data.capability === "plan" && fixed.scope.kind === "CLIENT"
    && plan.data.clientId === fixed.scope.clientId && snapshot && authorityMatches(plan.data, snapshot.currentAuthority) ? plan.data : null;
  const parentAligned = snapshot !== null && snapshot.revision === props.contextRevision && snapshot.archived === props.archived;
  const draftAligned = snapshot !== null && draft !== null && draft.parentRevision === snapshot.revision
    && draft.referenceRevision === referenceRevision(snapshot.references);
  const canWrite = !denied && !props.disabled && !props.archived && snapshot !== null && !snapshot.archived && parentAligned && draftAligned
    && (fixed.scope.kind === "OWN_BRAND" || clientPlan !== null);
  const locked = denied || net.busy || pending !== null || removeConfirmation !== null || props.disabled;
  function notifyParent(current: AtomicRead) {
    const token = JSON.stringify({ revision: current.revision, archived: current.archived, authority: current.currentAuthority });
    if (changedNotification.current !== token) { changedNotification.current = token; props.onParentChanged(); }
  }
  async function currentRead(task: Task) {
    const read = validateRead(await net.read("/api/brand-contexts/references?" + query(fixed.scope, fixed.contextId), task),
      fixed.scope, fixed.contextId, snapshotRef.current);
    net.ensure(task); return read;
  }
  function installRead(read: AtomicRead) {
    updateSnapshot(read);
    if (!pendingRef.current && !isDirty(draftRef.current)) updateDraft(draftFor(read));
    if (read.revision !== props.contextRevision || read.archived !== props.archived
      || fixed.scope.kind === "CLIENT" && (!plan.success || !authorityMatches(plan.data, read.currentAuthority))) notifyParent(read);
  }
  async function reconcile(captured: Pending, task: Task) {
    const read = await currentRead(task); net.ensure(task);
    const outcome = validateReconciliation(captured, read);
    installRead(read);
    if (outcome === "EXACT") {
      updateDraft(draftFor(read)); updateSelection(null); updatePending(null); if (fileInput.current) fileInput.current.value = "";
      setNotice(copy("تم تأكيد الطلب من القائمة المحفوظة الحالية.", "The request was confirmed against the current saved file list."));
    } else {
      updatePending({ ...captured, reviewed: read });
      setNotice(copy("تم تأكيد الطلب، ثم تغيّرت قائمة الملفات. راجع القائمة الحالية قبل متابعة التعديل.", "The request was confirmed, then the file list changed. Review the current list before continuing."));
    }
  }
  async function sendCaptured(captured: Pending, task: Task) {
    let receipt: ContextReferenceCommandResult;
    try { receipt = validateReceipt(captured, await net.send(captured, task)); }
    catch (error) {
      if (pendingRef.current === captured && error instanceof Failure && error.status !== undefined && [400, 409, 422].includes(error.status))
        updatePending({ ...captured, phase: "CONFLICT", reviewed: null });
      throw error;
    }
    net.ensure(task);
    const confirmed: Pending = { ...captured, phase: "CONFIRMED", receipt };
    updatePending(confirmed);
    await reconcile(confirmed, task);
  }
  function refresh() { if (denied) return; void net.run(async task => {
    const captured = pendingRef.current;
    if (captured?.phase === "CONFIRMED") { await reconcile(captured, task); return; }
    const read = await currentRead(task); installRead(read);
    if (captured?.phase === "CONFLICT") updatePending({ ...captured, reviewed: read });
    if (captured?.phase === "UNKNOWN") setNotice(copy("هذه قراءة حالية فقط؛ لم تُثبت نتيجة الطلب الأصلي. احتفظنا به لإعادته كما هو.",
      "This is a current read only; it does not prove the original request outcome. The exact request remains available to retry."));
  }); }
  function changeItems(items: Item[]) {
    const current = draftRef.current; if (!current || locked || net.isBusy() || pendingRef.current) return;
    updateDraft({ ...current, items }); setInvalid(false); setNotice(""); net.setError("");
  }
  function selectFile(file: File) {
    if (locked || !canWrite || net.isBusy() || pendingRef.current) return;
    if (!MIME_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) { setInvalid(true); net.setError("VALIDATION"); return; }
    updateSelection({ file, labelOriginal: { text: file.name, language: null }, notesOriginal: { text: null, language: null } });
    setNotice(""); setInvalid(false); net.setError("");
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false);
    if (event.dataTransfer.files.length !== 1) { if (!locked && canWrite) net.setError("VALIDATION"); return; }
    const file = event.dataTransfer.files.item(0); if (file) selectFile(file);
  }
  function capturedBase(read: AtomicRead): WireBase {
    if (!canWrite || net.isBusy() || pendingRef.current || !draftAligned || !parentAligned) throw new Failure("PARENT_DRIFT");
    return { operationKey: crypto.randomUUID(), scope: fixed.scope, contextId: fixed.contextId,
      expectedRevision: read.revision, expectedReferenceRevision: referenceRevision(read.references),
      ...(fixed.scope.kind === "CLIENT" && clientPlan ? { expectedAuthority: { ...clientPlan } } : {}) };
  }
  function start(action: "UPLOAD" | "REPLACE") {
    const read = snapshotRef.current, currentDraft = draftRef.current, selected = selectionRef.current;
    if (!read || !currentDraft || pendingRef.current || net.isBusy()) return;
    try {
      if (action === "UPLOAD" && (isDirty(currentDraft) || !selected || itemsOf(read.references).length >= 20)) throw new Failure("VALIDATION");
      const base = capturedBase(read); let command: WireCommand; let body: string | FormData;
      if (action === "UPLOAD" && selected) {
        if (!MIME_TYPES.has(selected.file.type) || selected.file.size <= 0 || selected.file.size > MAX_BYTES) throw new Failure("VALIDATION");
        const labelOriginal = parse(ContextReferenceItemSchema.shape.labelOriginal, selected.labelOriginal);
        const notesOriginal = parse(ContextReferenceItemSchema.shape.notesOriginal, selected.notesOriginal);
        // Metadata is exactly one JSON part; file is exactly one explicit File part.
        command = { ...base, action: "UPLOAD", payload: { labelOriginal, notesOriginal } };
        body = new FormData(); body.append("command", new Blob([JSON.stringify(command)], { type: "application/json" }));
        body.append("file", selected.file, selected.file.name);
      } else {
        const result = ContextReferenceItemsSchema.safeParse(currentDraft.items); if (!result.success) throw new Failure("VALIDATION");
        command = { ...base, action: "REPLACE", payload: { items: metadata(result.data) } }; body = JSON.stringify(command);
      }
      const captured: Pending = { command, body, file: action === "UPLOAD" && selected ? selected.file : null,
        source: read, phase: "UNKNOWN", receipt: null, reviewed: null };
      updatePending(captured); setInvalid(false); setNotice(""); void net.run(task => sendCaptured(captured, task));
    } catch (error) { setInvalid(true); net.setError(error instanceof Failure && error.code === "PARENT_DRIFT" ? error.code : "VALIDATION"); }
  }
  function saveEdits() {
    const current = draftRef.current, read = snapshotRef.current; if (!current || !read || locked || !canWrite || !isDirty(current)) return;
    const retained = new Set(current.items.map(item => item.bindingId)), removed = itemsOf(read.references).filter(item => !retained.has(item.bindingId));
    if (removed.length > 0) setRemoveConfirmation(metadata(removed)); else start("REPLACE");
  }
  function applyReviewedState(keepLabels: boolean) {
    const captured = pendingRef.current, read = captured?.reviewed ?? snapshotRef.current;
    if (!read || net.isBusy() || denied || captured?.phase === "UNKNOWN" || captured && !captured.reviewed) return;
    const prior = draftRef.current, next = draftFor(read);
    if (keepLabels) {
      const retainedMetadata = new Map((prior?.items ?? []).map(item => [item.bindingId, item]));
      if (captured?.phase === "CONFIRMED" && captured.command.action === "UPLOAD" && captured.receipt?.bindingId) {
        retainedMetadata.set(captured.receipt.bindingId, { bindingId: captured.receipt.bindingId, ...captured.command.payload });
      }
      // The reviewed server list supplies every retained identity and its order.
      // Keeping local words never infers removal of an uploaded or concurrent file.
      updateDraft({ ...next, items: metadata(next.items.map(item => retainedMetadata.get(item.bindingId) ?? item)) });
    } else updateDraft(next);
    if (captured?.phase === "CONFIRMED") updateSelection(null);
    updatePending(null); setNotice(copy("راجعت الحالة الحالية. الكلمات التي اخترتها باقية حتى حفظها.", "Current state was reviewed. Your chosen labels remain until saved."));
  }
  function download(item: FileItem) { if (denied) return; void net.run(task => savePrivateFile(
    "/api/brand-contexts/references/assets/" + encodeURIComponent(item.bindingId) + "?" + query(fixed.scope, fixed.contextId), item, net, task, urls.urls.current)); }
  const removalCount = removeConfirmation?.length ?? 0;
  return <Card className="min-w-0" dir={isAr ? "rtl" : "ltr"} data-context-reference-panel>
    <CardHeader><div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1">
      <CardTitle><h3 ref={heading} tabIndex={-1} className="break-words focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{copy("ملفات السياق الخاصة", "Private context files")}</h3></CardTitle>
      <CardDescription>{copy("صور أو PDF مرجعية تبقى داخل السياق وصلاحياته.", "Reference images or PDFs remain within this context and its permissions.")}</CardDescription>
    </div><InfameBrandPattern compact /></div></CardHeader>
    <CardContent className="grid min-w-0 gap-4">
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={net.busy || denied} onClick={refresh}>
        {snapshot ? copy("تحديث الملفات", "Refresh files") : copy("تحميل الملفات الخاصة", "Load private files")}</Button>
        {net.busy && <Button type="button" variant="ghost" onClick={() => { net.cancel(); heading.current?.focus(); }}>{copy("إيقاف الانتظار", "Stop waiting")}</Button>}</div>
      <div aria-live="polite" aria-atomic="true" className="min-w-0 text-sm">
        {net.busy && <p role="status" className="text-muted-foreground">{pending?.command.action === "UPLOAD"
          ? net.progress === 100 ? copy("أُرسلت البايتات؛ جارٍ التحقق من الحفظ.", "Bytes sent; checking saved state.")
            : net.progress === null ? copy("جارٍ إرسال الملف أو التحقق من الحالة…", "Sending the file or checking current state…")
              : copy("البايتات المرسلة: ", "Bytes sent: ") + net.progress + "%"
          : copy("جارٍ التحقق من الحالة الحالية…", "Checking current state…")}</p>}
        {net.busy && pending?.command.action === "UPLOAD" && <progress max={100} value={net.progress ?? undefined}
          aria-label={copy("تقدم إرسال البايتات، وليس تأكيد الحفظ", "Byte transfer progress, not save confirmation")} className="w-full accent-primary" />}
        {notice && <p role="status" className="break-words [overflow-wrap:anywhere]">{notice}</p>}
      </div>
      {net.error && <p role="alert" className="break-words text-destructive [overflow-wrap:anywhere]">{copyError(net.error, copy, pending?.phase === "CONFIRMED")}</p>}
      {snapshot && !denied && <section className="grid min-w-0 gap-3" aria-label={copy("القائمة المحفوظة الحالية", "Current saved list")}>
        <ManifestView manifest={snapshot.references} busy={net.busy} download={download} />
        {!parentAligned && <p className="text-muted-foreground">{copyError("PARENT_DRIFT", copy)}</p>}
        {!draftAligned && !pending && <div className="grid min-w-0 gap-2"><p className="text-muted-foreground">{copy("حُفظت تعديلات أخرى. راجع القائمة أعلاه واختر الكلمات التي تريد الاحتفاظ بها.", "Other edits were saved. Review the list above and choose which labels to keep.")}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={net.busy} onClick={() => applyReviewedState(true)}>{copy("راجعته؛ احتفظ بتعديلاتي", "Reviewed; keep my edits")}</Button>
            <Button type="button" variant="outline" disabled={net.busy} onClick={() => applyReviewedState(false)}>{copy("استخدم الكلمات المحفوظة", "Use saved labels")}</Button></div></div>}
      </section>}
      {pending && !denied && <section className="grid min-w-0 gap-3 rounded-lg border border-border bg-muted/30 p-3" aria-label={copy("استعادة الطلب", "Request recovery")}>
        <p>{pending.phase === "UNKNOWN" ? copy("نتيجة هذا الطلب غير مؤكدة. يحتفظ بنفس المفتاح والمدخلات والملف الأصلي.", "This request outcome is unknown. Its original key, inputs and File are retained.")
          : pending.phase === "CONFIRMED" ? copy("وصل تأكيد الطلب؛ أي تحقق لاحق يقرأ القائمة الحالية فقط.", "A request receipt was received; further recovery only reads the current list.")
            : copy("رُفض الطلب. اقرأ الحالة الحالية وراجعها قبل بدء طلب جديد.", "The request was rejected. Read and review current state before starting a new request.")}</p>
        <div className="flex flex-wrap gap-2">{pending.phase === "UNKNOWN" && <Button type="button" disabled={net.busy}
          onClick={() => { const captured = pendingRef.current; if (captured?.phase === "UNKNOWN") void net.run(task => sendCaptured(captured, task)); }}>{copy("إعادة الطلب نفسه", "Retry exact request")}</Button>}
          <Button type="button" variant="outline" disabled={net.busy} onClick={refresh}>{copy("تحقق من الحالة الحالية", "Check current state")}</Button>
          {pending.reviewed && pending.phase !== "UNKNOWN" && <><Button type="button" variant="outline" disabled={net.busy} onClick={() => applyReviewedState(true)}>{copy("راجعت القائمة؛ احتفظ بكلماتي", "Reviewed list; keep my labels")}</Button>
            <Button type="button" variant="outline" disabled={net.busy} onClick={() => applyReviewedState(false)}>{copy("راجعت القائمة؛ استخدم المحفوظ", "Reviewed list; use saved labels")}</Button></>}</div>
      </section>}
      {draft && !denied && <section className="grid min-w-0 gap-4" aria-label={copy("تعديل عناوين الملفات وترتيبها", "Edit file labels and order")}>
        {draft.items.length > 0 && <h4 className="font-medium">{copy("العناوين والترتيب", "Labels and order")}</h4>}
        {draft.items.map((item, index) => <div key={item.bindingId} className="grid min-w-0 gap-3 border-t border-border pt-4" data-reference-editor-binding={item.bindingId}>
          <OriginalField label={copy("عنوان المرجع ", "Reference label ") + (index + 1)} value={item.labelOriginal} disabled={locked || !canWrite} invalid={invalid}
            onChange={value => changeItems(draft.items.map(row => row.bindingId === item.bindingId ? { ...row, labelOriginal: { text: value.text ?? "", language: value.language } } : row))} />
          <OriginalField notes label={copy("الملاحظات الأصلية", "Original notes")} value={item.notesOriginal} disabled={locked || !canWrite} invalid={invalid}
            onChange={value => changeItems(draft.items.map(row => row.bindingId === item.bindingId ? { ...row, notesOriginal: value } : row))} />
          <div className="flex flex-wrap gap-2">{([-1, 1] as const).map(direction => <Button key={direction} type="button" variant="outline" size="icon"
            disabled={locked || !canWrite || index + direction < 0 || index + direction >= draft.items.length}
            aria-label={(direction < 0 ? copy("تحريك لأعلى: ", "Move earlier: ") : copy("تحريك لأسفل: ", "Move later: ")) + item.labelOriginal.text}
            onClick={() => { const next = [...draft.items]; [next[index], next[index + direction]] = [next[index + direction]!, next[index]!]; changeItems(next); }}>
            {direction < 0 ? <ArrowUpIcon className="size-4" aria-hidden="true" /> : <ArrowDownIcon className="size-4" aria-hidden="true" />}</Button>)}
            <Button type="button" variant="outline" disabled={locked || !canWrite} onClick={() => changeItems(draft.items.filter(row => row.bindingId !== item.bindingId))}>{copy("إزالة من المسودة", "Remove from draft")}</Button></div>
        </div>)}
        {isDirty(draft) && <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked || !canWrite} onClick={event => { removalFocus.current = event.currentTarget; saveEdits(); }}>{copy("حفظ عناوين الملفات وترتيبها", "Save file labels and order")}</Button>
          <Button type="button" variant="outline" disabled={locked} onClick={() => { const read = snapshotRef.current; if (read) updateDraft(draftFor(read)); }}>{copy("تجاهل تعديلاتي على الملفات", "Discard my file edits")}</Button></div>}
      </section>}
      {snapshot && !denied && <section className="grid min-w-0 gap-3 border-t border-border pt-4" aria-label={copy("إضافة ملف مرجعي خاص", "Add a private reference file")}>
        <div onDragOver={event => { event.preventDefault(); if (!locked && canWrite) setDragging(true); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={drop}
          className={"grid min-w-0 gap-3 rounded-lg border border-dashed border-input p-4 " + (dragging ? "bg-accent/50" : "bg-muted/20")}>
          <div className="flex items-center gap-2"><UploadIcon className="size-5 shrink-0" aria-hidden="true" /><h4 className="font-medium">{copy("إضافة ملف", "Add a file")}</h4></div>
          <p id={helpId} className="text-sm text-muted-foreground">{copy("اختر ملفًا أو أسقطه هنا. PNG، JPEG، WebP أو PDF؛ حتى 10 MiB للملف و20 ملفًا محفوظًا.", "Choose a file or drop it here. PNG, JPEG, WebP or PDF; up to 10 MiB each and 20 saved files.")}</p>
          <label className="grid min-w-0 gap-2"><span className="font-medium">{copy("الملف المرجعي", "Reference file")}</span>
            <Input ref={fileInput} type="file" accept={ACCEPT} multiple={false} className="min-h-12 min-w-0 max-w-full text-base"
              disabled={locked || !canWrite || isDirty(draft) || itemsOf(snapshot.references).length >= 20} aria-describedby={helpId}
              onChange={event => { const file = event.target.files?.item(0); event.target.value = ""; if (file) selectFile(file); }} /></label>
        </div>
        {isDirty(draft) && <p className="text-sm text-muted-foreground">{copy("احفظ تعديلات العناوين والترتيب أو تجاهلها قبل رفع ملف.", "Save or discard label and order edits before uploading a file.")}</p>}
        {selection && <div className="grid min-w-0 gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex min-w-0 items-center gap-3">{preview ? <Image src={preview} alt={copy("معاينة الصورة المختارة محليًا", "Local preview of the selected image")} width={56} height={56} unoptimized className="size-14 shrink-0 rounded-md object-cover" />
            : <FileTextIcon className="size-8 shrink-0" aria-hidden="true" />}<div className="min-w-0"><p dir="auto" className="break-words [overflow-wrap:anywhere]">{selection.file.name}</p>
              <p className="text-xs text-muted-foreground">{copy("اختيار محلي؛ لم يُؤكّد الحفظ بعد.", "Local selection; saving has not been confirmed.")}</p></div></div>
          <OriginalField label={copy("عنوان الملف الأصلي", "Original file label")} value={selection.labelOriginal} disabled={locked || !canWrite} invalid={invalid}
            onChange={value => updateSelection({ ...selection, labelOriginal: { text: value.text ?? "", language: value.language } })} />
          <OriginalField notes label={copy("الملاحظات الأصلية", "Original notes")} value={selection.notesOriginal} disabled={locked || !canWrite} invalid={invalid}
            onChange={value => updateSelection({ ...selection, notesOriginal: value })} />
          <div className="flex flex-wrap gap-2"><Button type="button" disabled={locked || !canWrite || isDirty(draft)} onClick={() => start("UPLOAD")}>{copy("رفع الملف الخاص", "Upload private file")}</Button>
            <Button type="button" variant="outline" disabled={locked} onClick={() => updateSelection(null)}>{copy("إزالة الاختيار المحلي", "Remove local selection")}</Button></div>
        </div>}
        {!canWrite && parentAligned && draftAligned && <p className="text-sm text-muted-foreground">{copy("العرض متاح؛ تعديل الملفات يتطلب سياقًا نشطًا وصلاحية التخطيط الحالية.", "Viewing is available; file edits require an active context and current planning permission.")}</p>}
        <p className="text-xs text-muted-foreground">{copy("عدم تقديم الملاحظات يختلف عن الملاحظات الفارغة. تُحفظ الكلمات والمسافات ولغتها الأصلية كما أدخلتها.", "Absent notes differ from empty notes. Words, whitespace and their original language are saved as entered.")}</p>
      </section>}
    </CardContent>
    <Dialog open={removeConfirmation !== null} onOpenChange={open => { if (!open) setRemoveConfirmation(null); }}>
      <DialogContent dir={isAr ? "rtl" : "ltr"} showCloseButton={false}
        onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => {
          const target = removalFocus.current; if (target?.isConnected) target.focus(); else heading.current?.focus();
        }); }} className="max-h-[85dvh] overflow-y-auto motion-reduce:animate-none motion-reduce:transition-none">
        <DialogHeader><DialogTitle>{copy("تأكيد إزالة الملفات من القائمة الحالية", "Confirm removal from the current file list")}</DialogTitle>
          <DialogDescription>{copy("سيُزال ", "Remove ") + removalCount + copy(" مرجع من قائمة المسودة المحفوظة. تبقى النسخ المقدّمة والتاريخية على حالها.", " reference(s) from the saved draft list. Submitted and historical versions retain their references.")}</DialogDescription></DialogHeader>
        <ul className="grid min-w-0 list-disc gap-2 ps-5">{removeConfirmation?.map(item => <li key={item.bindingId} dir="auto" className="break-words [overflow-wrap:anywhere]">{item.labelOriginal.text}</li>)}</ul>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setRemoveConfirmation(null)}>{copy("إلغاء", "Cancel")}</Button>
          <Button type="button" variant="destructive" disabled={net.busy || !canWrite} onClick={() => { removalFocus.current = heading.current; setRemoveConfirmation(null); start("REPLACE"); }}>{copy("تأكيد الإزالة والحفظ", "Confirm removal and save")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}

type ReadSource = ({ kind: "OWNER"; submissionId: string } & (
  { lane: "CONTEXT_REVIEW"; contextId: string }
  | { lane: "CAMPAIGN_REVIEW"; campaignId: string; contextVersionId: string | null }
))
  | { kind: "VERSION"; scope: PlanningScope; contextId: string; versionId: string };
export function OwnerReviewReferenceFiles(props: OwnerReviewReferenceFilesProps) {
  const source: ReadSource = props.lane === "CONTEXT_REVIEW"
    ? { kind: "OWNER", lane: props.lane, submissionId: props.submissionId, contextId: props.contextId }
    : { kind: "OWNER", lane: props.lane, submissionId: props.submissionId, campaignId: props.campaignId, contextVersionId: props.contextVersionId };
  const identity = props.lane === "CONTEXT_REVIEW" ? props.contextId : props.campaignId + ":" + props.contextVersionId;
  return <ReadOnlyReferenceFiles key={props.lane + ":" + props.submissionId + ":" + identity} source={source} onDeny={props.onDeny} />;
}
export function ContextReferenceVersionFiles(props: ContextReferenceVersionFilesProps) {
  const scope = PlanningScopeSchema.safeParse(props.scope); if (!scope.success) return null;
  return <ReadOnlyReferenceFiles key={scopeKey(scope.data) + ":" + props.contextId + ":" + props.versionId}
    source={{ kind: "VERSION", scope: scope.data, contextId: props.contextId, versionId: props.versionId }} onDeny={props.onDeny} />;
}
function ReadOnlyReferenceFiles({ source, onDeny }: { source: ReadSource; onDeny: () => void }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [fixed] = useState(source), [manifest, setManifest] = useState<ReadManifest | null>(null), [denied, setDenied] = useState(false);
  const manifestRef = useRef<ReadManifest | null>(null);
  const urls = usePrivateObjectURLs(), heading = useRef<HTMLHeadingElement | null>(null);
  function deny() { manifestRef.current = null; setManifest(null); urls.revokeAll(); setDenied(true); heading.current?.focus(); onDeny(); }
  const net = usePrivateRequests(deny);
  function baseURL() { return fixed.kind === "OWNER" ? "/api/" + (fixed.lane === "CONTEXT_REVIEW" ? "brand-contexts" : "planning-campaigns") + "/reviews/references" : "/api/brand-contexts/references"; }
  function readQuery() { return fixed.kind === "OWNER" ? new URLSearchParams({ submissionId: fixed.submissionId }) : query(fixed.scope, fixed.contextId, fixed.versionId); }
  function refresh() { if (denied) return; void net.run(async task => {
    const value = await net.read(baseURL() + "?" + readQuery(), task); let references: ReadManifest;
    if (fixed.kind === "OWNER") {
      if (fixed.lane === "CONTEXT_REVIEW") { const result = parse(ContextReviewReferenceResponseSchema, value);
        if (result.submissionId !== fixed.submissionId || result.contextId !== fixed.contextId) throw new Failure("INVALID_RESPONSE"); references = result.references;
      } else { const result = parse(CampaignReviewReferenceResponseSchema, value);
        if (result.submissionId !== fixed.submissionId || result.campaignId !== fixed.campaignId
          || result.contextVersionId !== fixed.contextVersionId) throw new Failure("INVALID_RESPONSE"); references = result.references; }
    } else references = validateRead(value, fixed.scope, fixed.contextId, null, fixed.versionId).references;
    parse(ContextReferenceItemsSchema, metadata(itemsOf(references)));
    if (manifestRef.current !== null && !sameManifest(manifestRef.current, references)) throw new Failure("INVALID_RESPONSE");
    net.ensure(task); manifestRef.current = references; setManifest(references);
  }); }
  function download(item: FileItem) { if (denied) return; void net.run(task => savePrivateFile(baseURL() + "/assets/" + encodeURIComponent(item.bindingId)
    + "?" + readQuery(), item, net, task, urls.urls.current)); }
  return <Card dir={isAr ? "rtl" : "ltr"} className="min-w-0" data-reference-read-only-panel>
    <CardHeader><CardTitle><h3 ref={heading} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{fixed.kind === "OWNER"
      ? copy("الملفات المقدّمة للمراجعة", "Files submitted for review") : copy("ملفات النسخة المعتمدة", "Approved version files")}</h3></CardTitle>
      <CardDescription>{fixed.kind === "OWNER" ? copy("تُعرض ملفات النسخة المقدّمة نفسها فقط.", "Only files pinned to this exact submission are shown.")
        : copy("تُعرض الملفات المحفوظة مع هذه النسخة المعتمدة.", "Files pinned to this approved version are shown.")}</CardDescription></CardHeader>
    <CardContent className="grid min-w-0 gap-3"><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={net.busy || denied} onClick={refresh}>
      {manifest ? copy("تحديث القراءة", "Refresh read") : copy("تحميل الملفات", "Load files")}</Button>
      {net.busy && <Button type="button" variant="ghost" onClick={() => { net.cancel(); heading.current?.focus(); }}>{copy("إيقاف الانتظار", "Stop waiting")}</Button>}</div>
      {net.busy && <p role="status" className="text-muted-foreground">{copy("جارٍ التحقق من الملفات الخاصة…", "Checking private files…")}</p>}
      {net.error && <p role="alert" className="text-destructive">{copyError(net.error, copy)}</p>}
      {manifest && !denied && <ManifestView manifest={manifest} busy={net.busy} download={download} />}
    </CardContent>
  </Card>;
}
