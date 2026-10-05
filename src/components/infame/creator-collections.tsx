"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  COLLECTION_LIMITS, CollectionCommandSchema, CollectionCommandResultSchema, CollectionHeadersPageSchema,
  CollectionEntriesPageSchema, CollectionComparisonSchema, type CollectionScope, type CollectionHeadersPage,
  CollectionNameOriginalSchema, CollectionNoteOriginalSchema,
  type CollectionEntriesPage, type CollectionComparison, type CollectionHeader, type CollectionEntry,
  type CollectionCommand, type CollectionCommandResult, type CollectionAction,
} from "@/lib/collections/contracts";
import { ClientAuthoritySchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import type { DiscoveryCountryOptions } from "@/lib/discovery/presentation";
import { useI18n } from "@/lib/i18n";
import { CreatorDiscoveryCard } from "./creator-discovery-card";
import styles from "./creator-collections.module.css";

type ReadIntent =
  | { kind: "HEADERS"; archived: boolean; after: string | null; history: (string | null)[] }
  | { kind: "ENTRIES"; collectionId: string; after: string | null; history: (string | null)[] }
  | { kind: "COMPARISON"; collectionId: string; entryIds: string[] };
type CapturedCommand = {
  command: CollectionCommand; body: string; archived: boolean;
  phase: "unknown" | "confirmed" | "conflict"; reviewed: boolean;
  receipt?: CollectionCommandResult;
};
type NameDraft = { text: string; language: string; revision: number };
type InvalidFields = { prefix: string; text: boolean; language: boolean } | null;
type FocusTarget = "page" | "comparison" | "rename" | "note";
type NoteDraft = NameDraft & { entryId: string; clear: boolean };
class UiFailure extends Error {
  constructor(public readonly code: string, public readonly status?: number) { super(code); }
}
const denialCodes = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"];
const safeCodes = new Set(["STALE_VERSION", "OPERATION_KEY_REUSED", "ARCHIVED", "INVALID_STATE",
  "REVISION_EXHAUSTED", "CAPACITY_REACHED", "CREATOR_UNAVAILABLE", "ALREADY_SAVED", "VALIDATION", "RETRY_REQUIRED"]);
function sameScope(left: CollectionScope | null, right: CollectionScope | null) {
  return left !== null && right !== null && left.kind === right.kind
    && (left.kind === "OWN_BRAND" ? right.kind === "OWN_BRAND" && left.brandId === right.brandId
      : right.kind === "CLIENT" && left.clientId === right.clientId);
}
function scopeParams(scope: CollectionScope) {
  return new URLSearchParams(scope.kind === "OWN_BRAND"
    ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId });
}
function responseData(body: unknown): unknown {
  return body !== null && typeof body === "object" && !Array.isArray(body) && "data" in body ? body.data : null;
}
function validReceipt(captured: CapturedCommand, result: CollectionCommandResult) {
  const command = captured.command;
  if (result.action !== command.action || result.revision !== command.expectedParentRevision + 1
    || result.archived !== (command.action === "SET_ARCHIVED" ? command.payload.archived : captured.archived)
    || command.action !== "CREATE" && result.collectionId !== command.collectionId) return false;
  if (command.action === "REMOVE_ENTRY" || command.action === "EDIT_NOTE") return result.entryId === command.payload.entryId;
  return command.action === "ADD_ENTRY" ? result.entryId !== null : result.entryId === null;
}
function OriginalFields({ prefix, text, language, onText, onLanguage, disabled, note = false, clear = false, onClear, invalid }: {
  prefix: string; text: string; language: string; onText: (value: string) => void; onLanguage: (value: string) => void;
  disabled: boolean; note?: boolean; clear?: boolean; onClear?: (value: boolean) => void;
  invalid?: InvalidFields;
}) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  return <div className={styles.fields}>
    <div className={styles.field}>
      <label htmlFor={prefix + "-text"}>{note ? copy("الملاحظة الخاصة", "Private note") : copy("اسم القائمة", "List name")}</label>
      {note ? <Textarea id={prefix + "-text"} dir="auto" maxLength={2000} value={text} disabled={disabled || clear}
        onChange={event => onText(event.target.value)} aria-invalid={invalid?.prefix === prefix && invalid.text}
        aria-describedby={prefix + "-help"} />
        : <Input id={prefix + "-text"} dir="auto" maxLength={200} value={text} disabled={disabled}
          onChange={event => onText(event.target.value)} aria-invalid={invalid?.prefix === prefix && invalid.text}
          aria-describedby={prefix + "-help"} />}
      <p id={prefix + "-help"} className={styles.help}>{note
        ? copy("تُحفظ كلماتك ومسافاتها كما كتبتها، حتى عندما يصبح الملف العام غير متاح.", "Your words and whitespace are saved as entered, including when the public profile becomes unavailable.")
        : copy("يُحفظ الاسم بلغته الأصلية، دون ترجمة تلقائية.", "The name is saved in its original language, without automatic translation.")}</p>
    </div>
    <div className={styles.field}>
      <label htmlFor={prefix + "-language"}>{copy("لغة النص (اختياري)", "Text language (optional)")}</label>
      <Input id={prefix + "-language"} dir="ltr" maxLength={100} value={language} disabled={disabled}
        placeholder="ar, en, ar-SA" aria-invalid={invalid?.prefix === prefix && invalid.language}
        onChange={event => onLanguage(event.target.value)} />
      <p className={styles.help}>{copy("اكتب رمز اللغة الذي اخترته للنص، أو اتركه فارغًا.", "Enter the language tag you chose for this text, or leave it blank.")}</p>
    </div>
    {note && onClear && <label className={styles.check}>
      <input type="checkbox" checked={clear} disabled={disabled} onChange={event => onClear(event.target.checked)} />
      <span>{copy("مسح الملاحظة المحفوظة", "Clear the saved note")}</span>
    </label>}
  </div>;
}

export function CreatorCollectionsScreen({ scope, initialPage, initialError = null, planAuthority, countryOptions }: {
  scope: CollectionScope | null; initialPage: CollectionHeadersPage | null; initialError?: string | null;
  planAuthority: ClientAuthorityDTO | null; countryOptions: DiscoveryCountryOptions;
}) {
  const { lang, isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [fixedScope] = useState(scope);
  const initialDenied = denialCodes.includes(initialError ?? "");
  const initialValid = !initialDenied && sameScope(fixedScope, initialPage?.context.scope ?? null)
    ? CollectionHeadersPageSchema.safeParse(initialPage) : null;
  const [headers, setHeaders] = useState<CollectionHeadersPage | null>(initialValid?.success ? initialValid.data : null);
  const [entries, setEntries] = useState<CollectionEntriesPage | null>(null);
  const [comparison, setComparison] = useState<CollectionComparison | null>(null);
  const [authority, setAuthority] = useState<ClientAuthorityDTO | null>(planAuthority?.capability === "plan"
    && fixedScope?.kind === "CLIENT" && planAuthority.clientId === fixedScope.clientId ? planAuthority : null);
  const renewPlan = useRef(authority !== null);
  const [denied, setDenied] = useState(initialDenied), [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? ""), [saved, setSaved] = useState(false);
  const [headerPosition, setHeaderPosition] = useState({ archived: false, after: null as string | null, history: [] as (string | null)[] });
  const [entryPosition, setEntryPosition] = useState({ after: null as string | null, history: [] as (string | null)[] });
  const [selected, setSelected] = useState<string[]>([]);
  const [createDraft, setCreateDraft] = useState({ text: "", language: "" });
  const [renameDraft, setRenameDraft] = useState<NameDraft | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [invalidFields, setInvalidFields] = useState<InvalidFields>(null);
  const [pending, setPending] = useState<CapturedCommand | null>(null);
  const [readRetry, setReadRetry] = useState<ReadIntent | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; sequence: number } | null>(null);
  const pendingRef = useRef<CapturedCommand | null>(null), readRef = useRef<ReadIntent | null>(null);
  const flight = useRef(false), controller = useRef<AbortController | null>(null), mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null), formRegion = useRef<HTMLDivElement>(null);
  const comparisonHeading = useRef<HTMLHeadingElement>(null), renameOpener = useRef<HTMLElement | null>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
  const noteOpener = useRef<HTMLElement | null>(null), focusSequence = useRef(0);
  const editorOpen = useRef({ rename: false, note: false });
  const scopeChanged = scope !== null || fixedScope !== null ? !sameScope(scope, fixedScope) : false;
  const protectedDenied = denied || scopeChanged;
  const canWrite = !protectedDenied && (fixedScope?.kind === "OWN_BRAND" || authority?.capability === "plan");
  const blocked = busy || protectedDenied || pending !== null || headers === null;
  const countryNames = Object.fromEntries(countryOptions[lang].map(country => [country.code, country.name]));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); controller.current = null; flight.current = false; };
  }, []);
  const comparisonIdentity = comparison && !protectedDenied
    ? comparison.collection.id + ":" + comparison.collection.revision + ":" + comparison.entries.map(entry => entry.entryId).join(",") : null;
  useEffect(() => {
    if (comparisonIdentity !== null) comparisonHeading.current?.focus();
  }, [comparisonIdentity]);
  useEffect(() => {
    if (!focusRequest) return;
    const opener = focusRequest.target === "comparison" ? compareButton.current : focusRequest.target === "rename" ? renameOpener.current
      : focusRequest.target === "note" ? noteOpener.current : heading.current;
    if (opener?.isConnected && !opener.hasAttribute("disabled")) opener.focus();
    else heading.current?.focus();
  }, [focusRequest]);

  function restoreFocus(target: FocusTarget) { setFocusRequest({ target, sequence: ++focusSequence.current }); }
  function closeEditor(target: "rename" | "note") {
    if (flight.current || pendingRef.current) return;
    editorOpen.current[target] = false;
    if (target === "rename") setRenameDraft(null); else setNoteDraft(null);
    restoreFocus(target);
  }

  function updatePending(next: CapturedCommand | null) { pendingRef.current = next; setPending(next); }
  function updateRead(next: ReadIntent | null) { readRef.current = next; setReadRetry(next); }
  function deny(status: number) {
    setHeaders(null); setEntries(null); setComparison(null); setAuthority(null); setSelected([]);
    setCreateDraft({ text: "", language: "" }); setRenameDraft(null); setNoteDraft(null);
    editorOpen.current = { rename: false, note: false };
    setInvalidFields(null);
    setHeaderPosition({ archived: false, after: null, history: [] }); setEntryPosition({ after: null, history: [] });
    updatePending(null); updateRead(null); setSaved(false); setDenied(true);
    setError(status === 401 ? "UNAUTHENTICATED" : status === 404 ? "NOT_FOUND" : "FORBIDDEN");
  }
  function current(abort: AbortController) { return mounted.current && controller.current === abort && !abort.signal.aborted; }
  async function request(url: string, abort: AbortController, init?: RequestInit): Promise<unknown> {
    const response = await fetch(url, { ...init, cache: "no-store", signal: abort.signal });
    if (!mounted.current || controller.current !== abort) throw new UiFailure("CANCELLED");
    // Never parse a denial body while an older private snapshot remains visible.
    if ([401, 403, 404].includes(response.status)) { deny(response.status); throw new UiFailure("DENIED", response.status); }
    if (!current(abort)) throw new UiFailure("CANCELLED");
    if (!response.ok) {
      let code = response.status === 503 ? "RETRY_REQUIRED" : "REQUEST_FAILED";
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
          && "code" in body.error && typeof body.error.code === "string" && safeCodes.has(body.error.code)) code = body.error.code;
      } catch { /* Status remains authoritative; never render arbitrary server text. */ }
      throw new UiFailure(code, response.status);
    }
    const body: unknown = await response.json();
    if (!current(abort)) throw new UiFailure("CANCELLED");
    return responseData(body);
  }
  async function renewAuthority(abort: AbortController) {
    if (fixedScope?.kind !== "CLIENT" || !renewPlan.current) return;
    const data = await request("/api/organization-clients/" + encodeURIComponent(fixedScope.clientId) + "/authority?capability=plan", abort);
    const parsed = ClientAuthoritySchema.safeParse(data);
    if (!parsed.success || parsed.data.capability !== "plan" || parsed.data.clientId !== fixedScope.clientId) throw new UiFailure("INVALID_RESPONSE");
    setAuthority(parsed.data);
  }
  async function readHeaders(intent: Extract<ReadIntent, { kind: "HEADERS" }>, abort: AbortController) {
    if (!fixedScope) throw new UiFailure("VALIDATION");
    const params = scopeParams(fixedScope); params.set("archived", String(intent.archived)); params.set("limit", "20");
    if (intent.after) params.set("after", intent.after);
    const data = await request("/api/collections?" + params.toString(), abort);
    const parsed = CollectionHeadersPageSchema.safeParse(data);
    if (!parsed.success || !sameScope(fixedScope, parsed.data.context.scope)
      || parsed.data.collections.some((row, index, rows) => row.archived !== intent.archived
        || intent.after !== null && row.id <= intent.after || index > 0 && row.id <= rows[index - 1]!.id)
      || parsed.data.nextCursor !== null && parsed.data.nextCursor !== parsed.data.collections.at(-1)?.id) throw new UiFailure("INVALID_RESPONSE");
    return parsed.data;
  }
  async function readEntries(intent: Extract<ReadIntent, { kind: "ENTRIES" }>, abort: AbortController) {
    if (!fixedScope) throw new UiFailure("VALIDATION");
    const params = scopeParams(fixedScope); params.set("collectionId", intent.collectionId); params.set("limit", "12");
    if (intent.after) params.set("after", intent.after);
    const data = await request("/api/collections/entries?" + params.toString(), abort);
    const parsed = CollectionEntriesPageSchema.safeParse(data);
    if (!parsed.success || !sameScope(fixedScope, parsed.data.context.scope) || parsed.data.collection.id !== intent.collectionId
      || parsed.data.entries.some((row, index, rows) => intent.after !== null && row.entryId <= intent.after
        || index > 0 && row.entryId <= rows[index - 1]!.entryId)
      || parsed.data.nextCursor !== null && parsed.data.nextCursor !== parsed.data.entries.at(-1)?.entryId) throw new UiFailure("INVALID_RESPONSE");
    return parsed.data;
  }
  async function readComparison(intent: Extract<ReadIntent, { kind: "COMPARISON" }>, abort: AbortController) {
    if (!fixedScope) throw new UiFailure("VALIDATION");
    const data = await request("/api/collections/comparison", abort, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: fixedScope, collectionId: intent.collectionId, entryIds: intent.entryIds }) });
    const parsed = CollectionComparisonSchema.safeParse(data);
    if (!parsed.success || !sameScope(fixedScope, parsed.data.context.scope) || parsed.data.collection.id !== intent.collectionId
      || parsed.data.entries.length !== intent.entryIds.length
      || parsed.data.entries.some((entry, index) => entry.entryId !== intent.entryIds[index])) throw new UiFailure("INVALID_RESPONSE");
    return parsed.data;
  }
  async function run(work: (abort: AbortController) => Promise<void>) {
    if (flight.current || protectedDenied || !fixedScope) return;
    flight.current = true; setBusy(true); setError(""); setSaved(false);
    const abort = new AbortController(); controller.current = abort;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 30_000);
    try { await work(abort); }
    catch (failure) {
      if (mounted.current && controller.current === abort && !(failure instanceof UiFailure && failure.code === "DENIED")) {
        setError(timedOut ? "TIMEOUT" : abort.signal.aborted ? "CANCELLED" : failure instanceof UiFailure ? failure.code : "NETWORK");
      }
    } finally {
      clearTimeout(timer);
      if (mounted.current && controller.current === abort) { controller.current = null; flight.current = false; setBusy(false); }
    }
  }
  async function load(intent: ReadIntent) {
    if (flight.current || protectedDenied || pendingRef.current?.phase === "unknown") return;
    if (intent.kind === "ENTRIES" && entries?.collection.id !== intent.collectionId
      && (editorOpen.current.rename || editorOpen.current.note || renameDraft !== null || noteDraft !== null)) {
      setError("CLOSE_EDITOR"); return;
    }
    updateRead(intent);
    await run(async abort => {
      if (intent.kind === "HEADERS") {
        const page = await readHeaders(intent, abort); await renewAuthority(abort);
        setHeaders(page); setHeaderPosition({ archived: intent.archived, after: intent.after, history: intent.history });
      } else if (intent.kind === "ENTRIES") {
        const page = await readEntries(intent, abort); await renewAuthority(abort);
        setEntries(page); setComparison(null); setEntryPosition({ after: intent.after, history: intent.history });
        if (entries?.collection.id !== page.collection.id) {
          setSelected([]); setRenameDraft(null); setNoteDraft(null); editorOpen.current = { rename: false, note: false };
        }
        restoreFocus("page");
      } else {
        const page = await readComparison(intent, abort); setComparison(page);
      }
      updateRead(null);
      const captured = pendingRef.current;
      if (captured?.phase === "conflict") updatePending({ ...captured, reviewed: true });
      if (captured?.phase === "confirmed") await completeRecovery(captured, abort);
    });
  }
  async function reloadAfterCommand(captured: CapturedCommand, receipt: CollectionCommandResult, abort: AbortController) {
    const entryIntent: Extract<ReadIntent, { kind: "ENTRIES" }> = {
      kind: "ENTRIES", collectionId: receipt.collectionId, after: null, history: [],
    };
    const nextEntries = await readEntries(entryIntent, abort);
    if (nextEntries.collection.revision < receipt.revision) throw new UiFailure("INVALID_RESPONSE");
    const headerIntent: Extract<ReadIntent, { kind: "HEADERS" }> = { kind: "HEADERS", ...headerPosition };
    const nextHeaders = await readHeaders(headerIntent, abort);
    await renewAuthority(abort);
    setEntries(nextEntries); setHeaders(nextHeaders); setEntryPosition({ after: null, history: [] }); setComparison(null);
    const removedEntryId = captured.command.action === "REMOVE_ENTRY" ? captured.command.payload.entryId : null;
    setSelected(previous => captured.command.action === "CREATE" ? [] : removedEntryId
      ? previous.filter(id => id !== removedEntryId) : previous);
    if (captured.command.action === "CREATE") setCreateDraft({ text: "", language: "" });
    if (captured.command.action === "RENAME") { setRenameDraft(null); editorOpen.current.rename = false; }
    if (captured.command.action === "EDIT_NOTE" || captured.command.action === "REMOVE_ENTRY") { setNoteDraft(null); editorOpen.current.note = false; }
    updatePending(null); updateRead(null); setSaved(true); restoreFocus("page");
  }
  async function completeRecovery(captured: CapturedCommand, abort: AbortController) {
    // A confirmed receipt is retained only as history. Recovery reads the
    // resource addressed by that receipt; it never repeats a confirmed POST.
    const parsed = CollectionCommandResultSchema.safeParse(captured.receipt);
    if (!parsed.success) throw new UiFailure("INVALID_RESPONSE");
    await reloadAfterCommand(captured, parsed.data, abort);
  }
  async function send(captured: CapturedCommand) {
    if (flight.current || protectedDenied || pendingRef.current && pendingRef.current !== captured) return;
    updatePending(captured);
    await run(async abort => {
      try {
        const data = await request("/api/collections/commands", abort, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: captured.body,
        });
        const parsed = CollectionCommandResultSchema.safeParse(data);
        if (!parsed.success || !validReceipt(captured, parsed.data)) throw new UiFailure("INVALID_RESPONSE");
        const confirmed = { ...captured, phase: "confirmed" as const, receipt: parsed.data };
        updatePending(confirmed);
        await reloadAfterCommand(confirmed, parsed.data, abort);
      } catch (failure) {
        if (pendingRef.current?.phase !== "confirmed" && failure instanceof UiFailure && failure.status !== undefined && failure.status >= 400 && failure.status < 500
          && failure.code !== "DENIED") updatePending({ ...captured, phase: "conflict", reviewed: false });
        throw failure;
      }
    });
  }
  function fresh(action: CollectionAction, payload: unknown, parent: CollectionHeader | null) {
    if (flight.current || pendingRef.current || !canWrite || !fixedScope || !headers) return;
    const parsed = CollectionCommandSchema.safeParse({
      operationKey: crypto.randomUUID(), scope: fixedScope, action, payload,
      expectedParentRevision: action === "CREATE" ? 0 : parent?.revision,
      ...(action === "CREATE" ? {} : { collectionId: parent?.id }),
      ...(fixedScope.kind === "CLIENT" ? { expectedAuthority: authority } : {}),
    });
    if (!parsed.success) { setError("VALIDATION"); formRegion.current?.querySelector<HTMLElement>("input, textarea")?.focus(); return; }
    const captured: CapturedCommand = { command: parsed.data, body: JSON.stringify(parsed.data), archived: parent?.archived ?? false,
      phase: "unknown", reviewed: false };
    void send(captured);
  }
  function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (renameDraft || noteDraft) return;
    if (!validateOriginal("collection-create", createDraft.text, createDraft.language)) return;
    fresh("CREATE", { nameOriginal: { text: createDraft.text, language: createDraft.language || null } }, null);
  }
  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!entries || !renameDraft) return;
    if (renameDraft.revision !== entries.collection.revision) { setError("STALE_EDITOR"); return; }
    if (!validateOriginal("collection-rename", renameDraft.text, renameDraft.language)) return;
    fresh("RENAME", { nameOriginal: { text: renameDraft.text, language: renameDraft.language || null } }, entries.collection);
  }
  function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!entries || !noteDraft) return;
    if (noteDraft.revision !== entries.collection.revision) { setError("STALE_EDITOR"); return; }
    if (!validateOriginal("collection-note", noteDraft.clear ? null : noteDraft.text, noteDraft.language, true)) return;
    fresh("EDIT_NOTE", { entryId: noteDraft.entryId,
      noteOriginal: { text: noteDraft.clear ? null : noteDraft.text, language: noteDraft.language || null } }, entries.collection);
  }
  function validateOriginal(prefix: string, text: string | null, language: string, note = false) {
    const parsed = (note ? CollectionNoteOriginalSchema : CollectionNameOriginalSchema).safeParse({ text, language: language || null });
    if (parsed.success) { setInvalidFields(null); return true; }
    const invalid = { prefix, text: parsed.error.issues.some(issue => issue.path[0] === "text"),
      language: parsed.error.issues.some(issue => issue.path[0] === "language") };
    setInvalidFields(invalid); setError("VALIDATION");
    document.getElementById(prefix + (invalid.text ? "-text" : "-language"))?.focus();
    return false;
  }
  function navigate(event: MouseEvent<HTMLElement>) {
    if ((flight.current || pendingRef.current) && event.target instanceof Element && event.target.closest("a")) event.preventDefault();
  }
  function selectEntry(id: string, checked: boolean) {
    if (flight.current || pendingRef.current) return;
    setComparison(null);
    setSelected(previous => checked ? previous.includes(id) ? previous
      : previous.length < COLLECTION_LIMITS.comparison ? [...previous, id] : previous : previous.filter(value => value !== id));
  }
  const visibleHeaders = protectedDenied ? null : headers, visibleEntries = protectedDenied ? null : entries;
  const visibleComparison = protectedDenied ? null : comparison;
  const errorText = protectedDenied
    ? error === "UNAUTHENTICATED" ? copy("سجّل الدخول مجددًا لعرض قوائمك.", "Sign in again to view your lists.")
      : copy("لم يعد هذا الوصول متاحًا. اختر الشركة أو العميل من جديد.", "This access is no longer available. Select your company or client again.")
    : error === "STALE_VERSION" || error === "STALE_EDITOR" ? copy("تغيّرت القائمة أو الصلاحيات. حدّث البيانات وراجع كلماتك قبل بدء طلب جديد.", "The list or permissions changed. Refresh and review your words before starting a new request.")
    : error === "VALIDATION" ? copy("راجع الاسم والملاحظة ورمز اللغة والحدود الموضحة.", "Review the name, note, language tag and stated limits.")
    : error === "CLOSE_EDITOR" ? copy("أغلق محرر الاسم أو الملاحظة أولًا قبل استعادة تحميل قائمة أخرى. كلماتك والتحميل السابق محفوظان.", "Close the name or note editor before retrying another list. Your words and the saved load request are retained.")
    : error === "ARCHIVED" ? copy("استعد القائمة قبل تعديلها.", "Restore the list before editing it.")
    : error === "TIMEOUT" ? copy("استغرق الطلب وقتًا طويلًا. احتفظنا بالمدخلات وطلب الحفظ نفسه.", "The request timed out. Your inputs and the same save request are retained.")
    : error === "CANCELLED" ? copy("أُلغي الانتظار. قد يكون الحفظ وصل للخادم؛ استخدم استعادة الطلب نفسه.", "Waiting was cancelled. The save may have reached the server; recover the same request.")
    : copy("تعذر إكمال الطلب. البيانات السابقة وكلماتك باقية؛ يمكنك الاستعادة.", "The request could not complete. Previous data and your words are retained; you can recover.");
  const browseHref = fixedScope?.kind === "CLIENT"
    ? "/brand/creators?clientId=" + encodeURIComponent(fixedScope.clientId) : "/brand/creators";
  const currentEntryIntent: ReadIntent | null = visibleEntries
    ? { kind: "ENTRIES", collectionId: visibleEntries.collection.id, ...entryPosition } : null;
  const currentHeaderIntent: ReadIntent = { kind: "HEADERS", ...headerPosition };
  function entryCard(entry: CollectionEntry, compare = false) {
    const name = entry.creator?.displayName ?? copy("صانع غير متاح حاليًا", "Creator currently unavailable");
    const editing = !compare && noteDraft?.entryId === entry.entryId;
    return <div className={styles.entry} key={entry.entryId}>
      {!compare && <div className={styles.entryTools}>
        <label className={styles.check}>
          <input type="checkbox" checked={selected.includes(entry.entryId)} disabled={blocked
            || !selected.includes(entry.entryId) && selected.length >= COLLECTION_LIMITS.comparison}
            onChange={event => selectEntry(entry.entryId, event.target.checked)} />
          <span>{copy("اختيار للمقارنة:", "Select for comparison:")} <bdi dir="auto">{name}</bdi></span>
        </label>
      </div>}
      {entry.creator ? <CreatorDiscoveryCard creator={entry.creator} lang={lang} countryNames={countryNames}
        headingIdPrefix={"collection-" + (compare ? "comparison-" : "entry-") + entry.entryId} />
        : <div className={styles.unavailable}><h3>{name}</h3><p>{copy(
          "الملف العام غير متاح الآن. تبقى ملاحظتك الخاصة محفوظة دون عرض هوية قديمة.",
          "The public profile is unavailable now. Your private note remains saved.")}</p></div>}
      <div className={styles.note}>
        <h3>{copy("ملاحظتك الخاصة", "Your private note")}</h3>
        <p dir="auto" lang={entry.noteOriginal.language ?? undefined} className={styles.original}>{entry.noteOriginal.text
          ?? copy("لا توجد ملاحظة محفوظة.", "No saved note.")}</p>
        {!compare && canWrite && !visibleEntries?.collection.archived && <div className={styles.actions}>
          <Button variant="outline" disabled={blocked || noteDraft !== null && !editing}
            onClick={event => { if (flight.current || pendingRef.current || !entries) return;
              noteOpener.current = event.currentTarget; editorOpen.current.note = true; setNoteDraft({
              entryId: entry.entryId, text: entry.noteOriginal.text ?? "", language: entry.noteOriginal.language ?? "",
              clear: entry.noteOriginal.text === null, revision: entries.collection.revision,
            }); }}>{copy("تعديل الملاحظة", "Edit note")}</Button>
          <Button variant="outline" disabled={blocked || noteDraft !== null}
            onClick={() => fresh("REMOVE_ENTRY", { entryId: entry.entryId }, entries?.collection ?? null)}>{copy("إزالة من القائمة", "Remove from list")}</Button>
        </div>}
        {editing && noteDraft && <form onSubmit={submitNote} className={styles.editor}>
          <OriginalFields prefix="collection-note" note text={noteDraft.text} language={noteDraft.language} clear={noteDraft.clear}
            disabled={blocked} invalid={invalidFields} onText={text => setNoteDraft({ ...noteDraft, text, clear: false })}
            onLanguage={language => setNoteDraft({ ...noteDraft, language })} onClear={clear => setNoteDraft({ ...noteDraft, clear })} />
          {noteDraft.revision !== visibleEntries?.collection.revision && <p className={styles.help}>{copy("تغيّرت النسخة؛ راجع الملاحظة مع القائمة الحالية.", "The revision changed; review your note against the current list.")}</p>}
          <div className={styles.actions}>
            <Button type="submit" disabled={blocked || noteDraft.revision !== visibleEntries?.collection.revision}>{copy("حفظ الملاحظة", "Save note")}</Button>
            {noteDraft.revision !== visibleEntries?.collection.revision && <Button variant="outline" type="button" disabled={blocked}
              onClick={() => visibleEntries && setNoteDraft({ ...noteDraft, revision: visibleEntries.collection.revision })}>{copy("راجعت النسخة الحالية", "I reviewed the current revision")}</Button>}
            <Button variant="outline" type="button" disabled={blocked} onClick={() => closeEditor("note")}>{copy("إغلاق المحرر", "Close editor")}</Button>
          </div>
        </form>}
      </div>
    </div>;
  }

  return <section className={styles.page} aria-labelledby="creator-collections-heading" aria-busy={busy}
    onClickCapture={navigate} onAuxClickCapture={navigate}>
    <header className={styles.header}>
      <div><h1 id="creator-collections-heading" className={styles.title} ref={heading} tabIndex={-1}>{copy("قوائم صنّاع المحتوى", "Creator lists")}</h1>
        <p className={styles.subtitle}>{copy("قوائم خاصة وملاحظاتك الأصلية ومقارنة يدوية حتى 12 اختيارًا.", "Private lists, your original notes and manual comparison of up to 12 selections.")}</p>
        {fixedScope && <Badge variant="secondary" className={styles.scope}>{fixedScope.kind === "OWN_BRAND"
          ? copy("قوائم شركتي", "My company lists") : copy("قوائم العميل المختار", "Selected client lists")}</Badge>}
      </div>
      <div className={styles.actions}>
        <Button variant="outline" disabled={busy || protectedDenied || pending?.phase === "unknown"}
          onClick={() => void load(currentEntryIntent ?? currentHeaderIntent)}>{copy("تحديث البيانات", "Refresh data")}</Button>
        <Button asChild variant="outline"><Link href={browseHref} prefetch={false}>{copy("استكشف صنّاع المحتوى", "Browse creators")}</Link></Button>
      </div>
    </header>
    <nav className={styles.links} aria-label={copy("سياق القوائم", "List context")}>
      {fixedScope?.kind === "CLIENT" && <Link href="/brand/collections" prefetch={false}>{copy("قوائم شركتي", "My company lists")}</Link>}
      <Link href="/brand/organizations" prefetch={false}>{copy("اختيار جهة أو عميل", "Choose organization or client")}</Link>
      <Link href="/brand/settings" prefetch={false}>{copy("إعدادات الشركة", "Company settings")}</Link>
    </nav>
    <p role="status" aria-live="polite" aria-atomic="true" className={styles.status}>{busy
      ? copy("جارٍ حفظ الطلب أو تحميل البيانات الحالية…", "Saving the request or loading current data…")
      : saved ? copy("تم تأكيد الحفظ وتحميل البيانات الحالية.", "The save was confirmed and current data loaded.") : ""}</p>
    {busy && <Button variant="outline" onClick={() => controller.current?.abort()}>{copy("إلغاء الانتظار", "Cancel waiting")}</Button>}
    {error && <div className={styles.feedback} role="alert"><p>{errorText}</p></div>}
    {protectedDenied ? <div className={styles.panel}><p>{copy("اختر سياقًا مسموحًا أو سجّل الدخول مجددًا.", "Choose an authorized context or sign in again.")}</p>
      <Button asChild><Link href="/login">{copy("تسجيل الدخول", "Sign in")}</Link></Button></div> : <>
      {!fixedScope && <div className={styles.panel}>{copy("أكمل ملف شركتك لبدء قائمة خاصة.", "Complete your company profile to start a private list.")}</div>}
      {pending && <div className={styles.feedback}>
        <p>{pending.phase === "confirmed"
          ? copy("وصل تأكيد الحفظ. نحتاج تحميل الحالة الحالية لإكمال الاستعادة.", "The save receipt arrived. Load current data to finish recovery.")
          : pending.phase === "conflict" ? copy("رفض الخادم هذا الطلب. احتفظنا بكلماتك؛ حدّث ثم راجع قبل طلب جديد.", "The server rejected this request. Your words are retained; refresh and review before a new request.")
          : copy("نتيجة الحفظ غير مؤكدة. الاستعادة تستخدم نفس الطلب دون تكرار التغيير.", "The save outcome is uncertain. Recovery uses the same request without duplicating the change.")}</p>
        <div className={styles.actions}>
          {pending.phase === "unknown" && <Button disabled={busy} onClick={() => pendingRef.current && void send(pendingRef.current)}>{copy("استعادة طلب الحفظ نفسه", "Recover the same save request")}</Button>}
          {pending.phase === "confirmed" && <Button disabled={busy} onClick={() => void run(abort => pendingRef.current ? completeRecovery(pendingRef.current, abort) : Promise.resolve())}>{copy("تحميل الحالة الحالية", "Load current state")}</Button>}
          {pending.phase === "conflict" && <><Button disabled={busy} variant="outline" onClick={() => void load(currentEntryIntent ?? currentHeaderIntent)}>{copy("تحميل للمراجعة", "Reload for review")}</Button>
            <Button disabled={busy || !pending.reviewed} variant="outline" onClick={() => updatePending(null)}>{copy("راجعت؛ إنهاء الطلب المرفوض", "Reviewed; dismiss rejected request")}</Button></>}
        </div>
      </div>}
      {readRetry && !pending && <div className={styles.actions}><Button disabled={busy} onClick={() => readRef.current && void load(readRef.current)}>{copy("إعادة محاولة التحميل نفسه", "Retry the same load")}</Button></div>}
      {!visibleHeaders && fixedScope && !busy && !pending && <div className={styles.panel}><p>{copy("لم تُحمّل القوائم بعد.", "Lists have not loaded yet.")}</p>
        <Button onClick={() => void load(currentHeaderIntent)}>{copy("تحميل القوائم", "Load lists")}</Button></div>}
      {visibleHeaders && <div className={styles.tableCard}>
        <div className={styles.tableHeader}><h2>{copy("قوائمك", "Your lists")}</h2><div className={styles.actions}>
          <Button variant={!headerPosition.archived ? "secondary" : "outline"} disabled={blocked} aria-pressed={!headerPosition.archived}
            onClick={() => void load({ kind: "HEADERS", archived: false, after: null, history: [] })}>{copy("الحالية", "Active")}</Button>
          <Button variant={headerPosition.archived ? "secondary" : "outline"} disabled={blocked} aria-pressed={headerPosition.archived}
            onClick={() => void load({ kind: "HEADERS", archived: true, after: null, history: [] })}>{copy("المؤرشفة", "Archived")}</Button>
        </div></div>
        <div className={styles.columnLabels} aria-hidden="true"><span>{copy("القائمة", "List")}</span><span>{copy("الحالة", "Status")}</span><span>{copy("الإجراءات", "Actions")}</span></div>
        {visibleHeaders.collections.length === 0 ? <p className={styles.empty}>{headerPosition.archived
          ? copy("لا توجد قوائم مؤرشفة في هذه الصفحة.", "No archived lists on this page.")
          : copy("لا توجد قوائم في هذه الصفحة. أنشئ قائمة ثم احفظ صنّاع المحتوى من الاستكشاف.", "No lists on this page. Create a list, then save creators from discovery.")}</p>
          : visibleHeaders.collections.map(collection => <div className={styles.row} key={collection.id}>
            <h3 dir="auto" lang={collection.nameOriginal.language ?? undefined}>{collection.nameOriginal.text}</h3>
            <Badge variant="secondary" className={styles.scope}>{collection.archived ? copy("مؤرشفة", "Archived") : copy("حالية", "Active")}</Badge>
            <Button variant="outline" disabled={blocked || renameDraft !== null || noteDraft !== null}
              onClick={() => void load({ kind: "ENTRIES", collectionId: collection.id, after: null, history: [] })}>{copy("فتح القائمة", "Open list")}</Button>
          </div>)}
        <div className={styles.pagination}><Button variant="outline" disabled={blocked || headerPosition.history.length === 0}
          onClick={() => void load({ kind: "HEADERS", archived: headerPosition.archived,
            after: headerPosition.history.at(-1) ?? null, history: headerPosition.history.slice(0, -1) })}>{copy("السابق", "Previous")}</Button>
          <Button variant="outline" disabled={blocked || visibleHeaders.nextCursor === null}
            onClick={() => void load({ kind: "HEADERS", archived: headerPosition.archived, after: visibleHeaders.nextCursor,
              history: [...headerPosition.history, headerPosition.after] })}>{copy("التالي", "Next")}</Button></div>
      </div>}
      {visibleHeaders && canWrite && <div className={styles.panel} ref={formRegion}><h2>{copy("قائمة جديدة", "New list")}</h2>
        <form onSubmit={submitCreate}><OriginalFields prefix="collection-create" text={createDraft.text} language={createDraft.language}
          disabled={blocked} invalid={invalidFields} onText={text => setCreateDraft({ ...createDraft, text })} onLanguage={language => setCreateDraft({ ...createDraft, language })} />
          <Button type="submit" disabled={blocked || renameDraft !== null || noteDraft !== null}>{copy("إنشاء القائمة", "Create list")}</Button></form>
      </div>}
      {visibleHeaders && !canWrite && <p className={styles.help}>{copy("هذا السياق يسمح بالعرض فقط؛ التعديل يحتاج صلاحية التخطيط الحالية.", "This context permits viewing only; editing requires current plan permission.")}</p>}
      {visibleEntries && !visibleComparison && <section className={styles.list} aria-labelledby="opened-collection-heading">
        <div className={styles.panel}><header className={styles.header}>
          <div><h2 id="opened-collection-heading" dir="auto" lang={visibleEntries.collection.nameOriginal.language ?? undefined}>{visibleEntries.collection.nameOriginal.text}</h2>
            <Badge variant="secondary" className={styles.scope}>{visibleEntries.collection.archived ? copy("قائمة مؤرشفة", "Archived list") : copy("قائمة حالية", "Active list")}</Badge></div>
          <Button variant="outline" disabled={blocked || renameDraft !== null || noteDraft !== null}
            onClick={() => { if (flight.current || pendingRef.current) return;
              setEntries(null); setComparison(null); setSelected([]); restoreFocus("page"); }}>{copy("العودة للقوائم", "Back to lists")}</Button>
        </header>
          {canWrite && <div className={styles.actions}>
            {!visibleEntries.collection.archived && <Button variant="outline" disabled={blocked || renameDraft !== null || noteDraft !== null}
              onClick={event => { if (flight.current || pendingRef.current) return;
                renameOpener.current = event.currentTarget; editorOpen.current.rename = true;
                setRenameDraft({ text: visibleEntries.collection.nameOriginal.text,
                  language: visibleEntries.collection.nameOriginal.language ?? "", revision: visibleEntries.collection.revision }); }}>{copy("تغيير الاسم", "Rename")}</Button>}
            <Button variant="outline" disabled={blocked || renameDraft !== null || noteDraft !== null}
              onClick={() => fresh("SET_ARCHIVED", { archived: !visibleEntries.collection.archived }, visibleEntries.collection)}>{visibleEntries.collection.archived
                ? copy("استعادة القائمة", "Restore list") : copy("أرشفة القائمة", "Archive list")}</Button>
          </div>}
          {renameDraft && <form onSubmit={submitRename} className={styles.editor}>
            <OriginalFields prefix="collection-rename" text={renameDraft.text} language={renameDraft.language} disabled={blocked} invalid={invalidFields}
              onText={text => setRenameDraft({ ...renameDraft, text })} onLanguage={language => setRenameDraft({ ...renameDraft, language })} />
            <div className={styles.actions}><Button type="submit" disabled={blocked || renameDraft.revision !== visibleEntries.collection.revision}>{copy("حفظ الاسم", "Save name")}</Button>
              {renameDraft.revision !== visibleEntries.collection.revision && <Button type="button" variant="outline" disabled={blocked}
                onClick={() => setRenameDraft({ ...renameDraft, revision: visibleEntries.collection.revision })}>{copy("راجعت النسخة الحالية", "I reviewed the current revision")}</Button>}
              <Button type="button" variant="outline" disabled={blocked} onClick={() => closeEditor("rename")}>{copy("إغلاق المحرر", "Close editor")}</Button></div>
          </form>}
          <p className={styles.help}>{copy("الاختيار والمقارنة يدويان. لا تُنشئ القائمة ترتيبًا للحملات أو عروض تعاون.", "Selection and comparison are manual. Lists do not create campaign rankings or collaboration offers.")}</p>
          <div className={styles.actions}><Button disabled={blocked || selected.length === 0} ref={compareButton}
            onClick={() => void load({ kind: "COMPARISON", collectionId: visibleEntries.collection.id, entryIds: [...selected] })}>{copy("مقارنة المختارين", "Compare selected")} ({selected.length}/12)</Button>
            <Button variant="outline" disabled={blocked || selected.length === 0} onClick={() => { setSelected([]); setComparison(null); }}>{copy("مسح الاختيار", "Clear selection")}</Button></div>
        </div>
        {visibleEntries.entries.length === 0 ? <div className={styles.panel}><p>{copy("لا يوجد صنّاع محتوى محفوظون في هذه الصفحة.", "No saved creators on this page.")}</p>
          <Button asChild variant="outline"><Link href={browseHref} prefetch={false}>{copy("استكشف واحفظ في القائمة", "Browse and save to the list")}</Link></Button></div>
          : visibleEntries.entries.map(entry => entryCard(entry))}
        <div className={styles.pagination}><Button variant="outline" disabled={blocked || entryPosition.history.length === 0}
          onClick={() => void load({ kind: "ENTRIES", collectionId: visibleEntries.collection.id, after: entryPosition.history.at(-1) ?? null,
            history: entryPosition.history.slice(0, -1) })}>{copy("السابق", "Previous")}</Button>
          <Button variant="outline" disabled={blocked || visibleEntries.nextCursor === null}
            onClick={() => void load({ kind: "ENTRIES", collectionId: visibleEntries.collection.id, after: visibleEntries.nextCursor,
              history: [...entryPosition.history, entryPosition.after] })}>{copy("التالي", "Next")}</Button></div>
      </section>}
      {visibleComparison && <section className={styles.list} aria-labelledby="collection-comparison-heading">
        <div className={styles.panel}><h2 id="collection-comparison-heading" className={styles.comparisonHeading} ref={comparisonHeading} tabIndex={-1}>{copy("مقارنة الاختيارات", "Selected comparison")}</h2>
          <p className={styles.help}>{copy("بنفس ترتيب اختيارك، مع البيانات العامة الحالية وملاحظاتك الخاصة.", "In your selection order, with current public facts and your private notes.")}</p>
          <Button variant="outline" disabled={blocked} onClick={() => { if (flight.current || pendingRef.current) return;
            setComparison(null); restoreFocus("comparison"); }}>{copy("إغلاق المقارنة", "Close comparison")}</Button></div>
        {visibleComparison.entries.map(entry => entryCard(entry, true))}
      </section>}
    </>}
  </section>;
}
