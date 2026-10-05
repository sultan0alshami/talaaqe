"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { ClientAuthoritySchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { CollectionCommandResultSchema, CollectionCommandSchema, CollectionComparisonSchema, CollectionHeadersPageSchema,
  type CollectionCommand, type CollectionHeader, type CollectionHeadersPage, type CollectionScope } from "@/lib/collections/contracts";
import type { PublicDiscoveryCreator } from "@/lib/discovery/contracts";
import styles from "./collection-save.module.css";

const paramsFor = (scope: CollectionScope) => new URLSearchParams(scope.kind === "OWN_BRAND"
  ? { scope: scope.kind, brandId: scope.brandId } : { scope: scope.kind, clientId: scope.clientId });
const sameScope = (left: CollectionScope, right: CollectionScope) => left.kind === right.kind && (left.kind === "OWN_BRAND"
  ? right.kind === "OWN_BRAND" && left.brandId === right.brandId : right.kind === "CLIENT" && left.clientId === right.clientId);

export function CollectionSaveDialog({ creator, scope, planAuthority, onClose, onDenied, onRestoreFocus }: {
  creator: PublicDiscoveryCreator | null; scope: CollectionScope; planAuthority: ClientAuthorityDTO | null;
  onClose: () => void; onDenied: () => void;
  onRestoreFocus: () => void;
}) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [page, setPage] = useState<CollectionHeadersPage | null>(null), [selected, setSelected] = useState("");
  const [note, setNote] = useState(""), [language, setLanguage] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false), [denied, setDenied] = useState(false);
  const [rejected, setRejected] = useState(false);
  const pending = useRef<CollectionCommand | null>(null), flight = useRef(false), aborter = useRef<AbortController | null>(null);
  const creatorId = creator?.id ?? null;
  useEffect(() => () => { aborter.current?.abort(); }, []);
  function clearPrivate() {
    setPage(null); setSelected(""); setNote(""); setLanguage(""); pending.current = null; setUncertain(false);
    setSaved(false); setDenied(true); setError("ACCESS_DENIED"); onDenied();
  }
  async function responseData(url: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await fetch(url, { cache: "no-store", signal, ...(body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }) });
    if ([401, 403, 404].includes(response.status)) { clearPrivate(); throw new Error("ACCESS_DENIED"); }
    if (!response.ok) {
      const value = await response.json().catch(() => null);
      const code = value?.error?.code;
      if (response.status === 409 && ["STALE_VERSION", "ARCHIVED", "ALREADY_SAVED", "CREATOR_UNAVAILABLE", "CAPACITY_REACHED", "OPERATION_KEY_REUSED"].includes(code)) setRejected(true);
      throw new Error(typeof code === "string" ? code : "REQUEST_FAILED");
    }
    const value: unknown = await response.json();
    return value && typeof value === "object" && "data" in value ? value.data : null;
  }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (flight.current || denied) return;
    flight.current = true; setBusy(true); setError("");
    const abort = new AbortController(); aborter.current = abort;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 30_000);
    try { await action(abort.signal); }
    catch (failure) { if (aborter.current === abort) setError(timedOut ? "TIMEOUT" : abort.signal.aborted ? "CANCELLED" : failure instanceof Error ? failure.message : "NETWORK"); }
    finally { clearTimeout(timer); if (aborter.current === abort) { aborter.current = null; flight.current = false; setBusy(false); } }
  }
  async function headers(signal: AbortSignal, after?: string) {
    const params = paramsFor(scope); if (after) params.set("after", after);
    const result = CollectionHeadersPageSchema.safeParse(await responseData("/api/collections?" + params, signal));
    if (!result.success || !sameScope(result.data.context.scope, scope)) throw new Error("INVALID_RESPONSE");
    if (signal.aborted) throw new Error("CANCELLED");
    setPage(result.data); setSelected(""); return result.data;
  }
  useEffect(() => {
    if (!creatorId || pending.current) return;
    setSaved(false); setNote(""); setLanguage(""); setPage(null); setSelected("");
    void run(async signal => { await headers(signal); });
    // Scope is fixed by the server-keyed parent, while opening a creator starts a new picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId]);
  async function save() {
    await run(async signal => {
      let command = pending.current;
      if (!command) {
        if (!creator || !selected) throw new Error("VALIDATION");
        const chosen: CollectionHeader | undefined = page?.collections.find(row => row.id === selected);
        if (!chosen) throw new Error("VALIDATION");
        let authority = planAuthority;
        if (scope.kind === "CLIENT") {
          const current = ClientAuthoritySchema.safeParse(await responseData(`/api/organization-clients/${encodeURIComponent(scope.clientId)}/authority?capability=plan`, signal));
          if (!current.success || current.data.clientId !== scope.clientId || current.data.capability !== "plan") throw new Error("INVALID_RESPONSE");
          authority = current.data;
        }
        const parsed = CollectionCommandSchema.safeParse({ operationKey: crypto.randomUUID(), scope, action: "ADD_ENTRY",
          collectionId: chosen.id, expectedParentRevision: chosen.revision,
          ...(scope.kind === "CLIENT" ? { expectedAuthority: authority } : {}),
          payload: { creatorId: creator.id, noteOriginal: { text: note, language: language || null } } });
        if (!parsed.success) throw new Error("VALIDATION");
        command = parsed.data; pending.current = command; setUncertain(true); setRejected(false);
      }
      if (command.action !== "ADD_ENTRY") throw new Error("INVALID_RESPONSE");
      const receipt = CollectionCommandResultSchema.safeParse(await responseData("/api/collections/commands", signal, command));
      if (!receipt.success || receipt.data.action !== command.action || receipt.data.collectionId !== command.collectionId
        || !receipt.data.entryId || receipt.data.revision !== command.expectedParentRevision + 1 || receipt.data.archived) throw new Error("INVALID_RESPONSE");
      const current = CollectionComparisonSchema.safeParse(await responseData("/api/collections/comparison", signal, {
        scope, collectionId: command.collectionId, entryIds: [receipt.data.entryId],
      }));
      if (!current.success || !sameScope(current.data.context.scope, scope) || current.data.collection.id !== command.collectionId
        || current.data.collection.revision < receipt.data.revision || current.data.entries.length !== 1
        || current.data.entries[0]?.entryId !== receipt.data.entryId) throw new Error("INVALID_RESPONSE");
      if (signal.aborted) throw new Error("CANCELLED");
      pending.current = null; setUncertain(false); setSaved(true); setError("");
    });
  }
  const canSave = scope.kind === "OWN_BRAND" || planAuthority?.capability === "plan";
  const collectionHref = "/brand/collections" + (scope.kind === "CLIENT" ? "?clientId=" + encodeURIComponent(scope.clientId) : "");
  return <Dialog open={creator !== null && !denied} onOpenChange={open => {
    if (!open) { if (flight.current || pending.current) setError("PENDING"); else onClose(); }
  }}><DialogContent className={styles.dialog} dir={isAr ? "rtl" : "ltr"} closeLabel={copy("إغلاق", "Close")}
    onClickCapture={event => { if ((flight.current || pending.current) && event.target instanceof Element && event.target.closest("a")) event.preventDefault(); }}
    onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
    <DialogTitle>{copy("حفظ في قائمة", "Save to collection")}</DialogTitle>
    <DialogDescription>{copy("قائمة خاصة للتخطيط، مع ملاحظاتك بلغتها الأصلية.", "A private planning list with your notes in their original language.")}</DialogDescription>
    {creator && <p dir="auto">{creator.displayName}</p>}
    {saved ? <><p role="status">{copy("تم تسجيل الحفظ والتحقق من القائمة الحالية.", "Save recorded and the current collection checked.")}</p>
      <Button asChild><Link href={collectionHref}>{copy("عرض قوائمي", "View my collections")}</Link></Button>
      <Button variant="outline" onClick={onClose}>{copy("إغلاق", "Close")}</Button></>
      : <>
        <label htmlFor="save-collection">{copy("القائمة", "Collection")}</label>
        <select id="save-collection" value={selected} disabled={busy || uncertain} onChange={event => setSelected(event.target.value)}>
          <option value="">{copy("اختر قائمة", "Choose a collection")}</option>
          {page?.collections.map(row => <option key={row.id} value={row.id}>{row.nameOriginal.text}</option>)}
        </select>
        {page?.collections.length === 0 && <p>{copy("لا توجد قوائم نشطة. أنشئ قائمة أولًا.", "No active collections. Create a collection first.")}</p>}
        <Button asChild variant="outline"><Link href={collectionHref}>{copy("إدارة القوائم", "Manage collections")}</Link></Button>
        {page?.nextCursor && <Button variant="outline" disabled={busy || uncertain} onClick={() => void run(async signal => { await headers(signal, page.nextCursor!); })}>{copy("قوائم أخرى", "More collections")}</Button>}
        <label htmlFor="save-note">{copy("ملاحظة خاصة", "Private note")}</label>
        <Textarea id="save-note" dir="auto" maxLength={2000} value={note} disabled={busy || uncertain} onChange={event => setNote(event.target.value)} />
        <label htmlFor="save-note-language">{copy("لغة الملاحظة (اختياري)", "Note language (optional)")}</label>
        <Input id="save-note-language" dir="ltr" maxLength={100} value={language} disabled={busy || uncertain} onChange={event => setLanguage(event.target.value)} placeholder="ar / en" />
        {uncertain && <p>{copy("الطلب محفوظ. إعادة المحاولة تستخدم نفس الملاحظة والطلب؛ لا تبدأ حفظًا آخر حتى تتحقق من النتيجة.", "The request is retained. Retry uses the same note and request; check the result before starting another save.")}</p>}
        <Button disabled={busy || !canSave || !selected && !uncertain} onClick={() => void save()}>{uncertain ? copy("إعادة محاولة الحفظ نفسه", "Retry the same save") : copy("حفظ", "Save")}</Button>
        {!canSave && <p>{copy("صلاحية العرض لا تسمح بالحفظ لهذا العميل.", "Viewing permission does not allow saving for this client.")}</p>}
      </>}
    {busy && <><p role="status">{copy("جارٍ التحقق…", "Checking…")}</p><Button variant="outline" onClick={() => aborter.current?.abort()}>{copy("إلغاء الانتظار", "Cancel waiting")}</Button></>}
    {error && <div role="alert"><p>{error === "STALE_VERSION" ? copy("تغيّرت القائمة. راجع حالتها الحالية قبل بدء طلب جديد.", "The collection changed. Review its current state before starting a new request.")
      : error === "ALREADY_SAVED" ? copy("الصانع محفوظ بالفعل. راجع القائمة لتعديل ملاحظته.", "The creator is already saved. Open the collection to edit its note.")
      : copy("تعذّر إكمال التحقق. ملاحظتك والطلب باقِيان لإعادة المحاولة.", "The check could not complete. Your note and request are retained for retry.")}</p>
      {!uncertain && !busy && <Button variant="outline" onClick={() => void run(async signal => { await headers(signal); })}>{copy("إعادة تحميل القوائم", "Reload collections")}</Button>}
      {rejected && !busy && <Button variant="outline" onClick={() => {
        void run(async signal => {
          await headers(signal);
          pending.current = null; setUncertain(false); setRejected(false);
        });
      }}>{copy("راجع القوائم وحرّر الطلب المرفوض", "Review collections and release the rejected request")}</Button>}
    </div>}
  </DialogContent></Dialog>;
}
