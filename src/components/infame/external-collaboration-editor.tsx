"use client";
import { GuardedLink as Link } from "@/components/shells/navigation-guard";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { formatMoneyDecimal, parseMoney, SUPPORTED_CURRENCIES } from "@/lib/contracts/money";
import { useCollaborationLeaveGuard } from "./use-collaboration-leave-guard";
import { ExternalCollaborationUpload } from "./external-collaboration-upload";
import { ExternalCollaborationDetailSchema, ExternalCollaborationDetailsSchema, ExternalCollaborationResultSchema,
  canTransitionExternalCollaboration, type ExternalCollaborationDetail } from "@/lib/external-collaborations/schemas";

export function ExternalCollaborationEditor({ initial }: { initial: ExternalCollaborationDetail }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [current, setCurrent] = useState(initial), [draft, setDraft] = useState(initial.collaboration.details);
  const [saving, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(false);
  const [attachmentPending, setAttachmentPending] = useState(false), busy = saving || attachmentPending;
  const [formDirty, setFormDirty] = useState(false);
  const [formEpoch, setFormEpoch] = useState(0);
  const [denied, setDenied] = useState(false), pending = useRef<string | null>(null), locked = useRef(false);
  const root = "/api/external-collaborations/" + encodeURIComponent(current.collaboration.id);
  const dirty = formDirty || JSON.stringify(draft) !== JSON.stringify(current.collaboration.details);
  useCollaborationLeaveGuard(!denied && (dirty || busy || retry), copy("لديك تعديلات أو طلب غير مؤكد. مغادرة الصفحة؟", "You have unsaved edits or an unconfirmed request. Leave this page?"));
  async function refresh() {
    const response = await fetch(root, { cache: "no-store" });
    if (response.status === 401 || response.status === 403) { setDenied(true); throw new Error("AUTH"); }
    if (!response.ok) throw new Error("READ");
    const next = ExternalCollaborationDetailSchema.parse((await response.json()).data); setCurrent(next); return next;
  }
  async function send(action: string, payload: unknown) {
    if (locked.current) return;
    if (!pending.current) pending.current = JSON.stringify({ action, payload, operationKey: crypto.randomUUID(),
      collaborationId: current.collaboration.id, expectedRevision: current.collaboration.revision });
    locked.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/external-collaborations", { method: "POST", headers: { "content-type": "application/json" }, body: pending.current });
      if (response.status === 401 || response.status === 403) setDenied(true);
      if (!response.ok) {
        if (response.status < 500) { pending.current = null; setRetry(false); }
        throw new Error("SAVE");
      }
      ExternalCollaborationResultSchema.parse((await response.json()).data);
      pending.current = null; setRetry(false);
      const next = await refresh(); setDraft(next.collaboration.details); setFormDirty(false);
    } catch { setRetry(pending.current !== null); setError(copy("تعذر إكمال الطلب. احتفظنا بمدخلاتك؛ أعد الطلب أو حمّل الحالة الحالية.", "Could not complete the request. Your entries remain; retry or load the current state.")); }
    finally { locked.current = false; setBusy(false); }
  }
  const statuses: Record<string, string> = { DRAFT: copy("مسودة", "Draft"), PLANNED: copy("مخطط", "Planned"), IN_PROGRESS: copy("قيد التنفيذ", "In progress"), COMPLETED: copy("مكتمل", "Completed"), CANCELLED: copy("ملغي", "Cancelled") };
  if (denied) return <Card className="p-6"><p role="alert">{copy("انتهى الوصول. سجّل الدخول من جديد.", "Access expired. Please sign in again.")}</p><Link href="/login">{copy("تسجيل الدخول", "Sign in")}</Link></Card>;
  return <div className="mx-auto max-w-[1000px] space-y-6">
    <Link href="/creator/collaborations" className="text-sm underline">{copy("تعاوناتي الخارجية", "External collaborations")}</Link>
    <header><h1 className="break-words text-2xl font-bold">{current.collaboration.details.campaignDisplay.text}</h1><p className="mt-2 text-sm text-muted-foreground">{statuses[current.collaboration.status]}{current.collaboration.archived ? copy(" · مؤرشف", " · Archived") : ""}</p></header>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {retry ? <Button disabled={busy} onClick={() => void send("", {})}>{copy("إعادة نفس الطلب", "Retry same request")}</Button> : null}
    <Button variant="outline" disabled={busy || retry} onClick={async () => {
      if (dirty && !window.confirm(copy("استبدال تعديلاتك غير المحفوظة بالحالة الحالية؟", "Replace your unsaved edits with the current saved state?"))) return;
      setBusy(true); try { setDraft((await refresh()).collaboration.details); setFormDirty(false); setFormEpoch(value => value + 1); setError(null); } catch { setError(copy("تعذر التحديث.", "Could not refresh.")); } finally { setBusy(false); }
    }}>{copy("تحميل الحالة الحالية", "Load current state")}</Button>
    <Card className="p-5"><form key={current.collaboration.revision + ":" + formEpoch} className="space-y-4" onChange={() => setFormDirty(true)} onSubmit={event => { event.preventDefault();
      try {
        const fields = new FormData(event.currentTarget), amount = String(fields.get("amount") ?? ""), currency = String(fields.get("currency")), start = String(fields.get("start") ?? ""), end = String(fields.get("end") ?? "");
        const details = { ...draft, declaredValue: amount === "" ? null : parseMoney(amount, currency), period: !start && !end ? null : {
          startsAt: new Date(start + "Z").toISOString(), endsAt: new Date(end + "Z").toISOString(), timeZone: String(fields.get("timezone")) } };
        const checked = ExternalCollaborationDetailsSchema.safeParse(details);
        if (!checked.success) throw new Error("VALIDATION");
        setDraft(checked.data); void send("SAVE_DETAILS", { details: checked.data });
      } catch { setError(copy("راجع المبلغ والتواريخ والحقول المطلوبة.", "Check the amount, dates and required fields.")); } }}>
      <fieldset disabled={busy || retry || current.collaboration.archived} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">{(["clientDisplay", "campaignDisplay"] as const).map(key => <label key={key} className="space-y-2 text-sm"><span>{key === "clientDisplay" ? copy("اسم العميل", "Client name") : copy("اسم الحملة", "Campaign name")}</span><Input required maxLength={200} value={draft[key].text} onChange={event => setDraft({ ...draft, [key]: { ...draft[key], text: event.target.value } })} /></label>)}</div>
        {(["brief", "notes"] as const).map(key => <label key={key} className="block space-y-2 text-sm"><span>{key === "brief" ? copy("موجز التعاون", "Collaboration brief") : copy("ملاحظات خاصة", "Private notes")}</span><Textarea rows={5} maxLength={key === "brief" ? 20000 : 10000} value={draft[key]?.text ?? ""} onChange={event => setDraft({ ...draft, [key]: event.target.value ? { text: event.target.value, language: draft[key]?.language ?? null } : null })} /></label>)}
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm"><span>{copy("القيمة المعلنة (اختياري)", "Declared value (optional)")}</span><Input name="amount" inputMode="decimal" defaultValue={draft.declaredValue ? formatMoneyDecimal(draft.declaredValue) : ""} placeholder="0.00" /></label>
          <label className="space-y-2 text-sm"><span>{copy("العملة", "Currency")}</span><select name="currency" defaultValue={draft.declaredValue?.currencyCode ?? "SAR"} className="min-h-11 w-full rounded-md border bg-background px-3">{SUPPORTED_CURRENCIES.map(code => <option key={code}>{code}</option>)}</select></label></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm"><span>{copy("البداية بتوقيت UTC (اختياري)", "Start in UTC (optional)")}</span><Input name="start" type="datetime-local" step="1" defaultValue={draft.period ? new Date(draft.period.startsAt).toISOString().slice(0, 19) : ""} /></label><label className="space-y-2 text-sm"><span>{copy("النهاية بتوقيت UTC (اختياري)", "End in UTC (optional)")}</span><Input name="end" type="datetime-local" step="1" defaultValue={draft.period ? new Date(draft.period.endsAt).toISOString().slice(0, 19) : ""} /></label></div>
        <label className="block space-y-2 text-sm"><span>{copy("المنطقة الزمنية للتعاون", "Collaboration time zone")}</span><Input name="timezone" defaultValue={draft.period?.timeZone ?? "Asia/Riyadh"} placeholder="Asia/Riyadh" dir="ltr" /></label>
        <section className="space-y-3"><h2 className="font-semibold">{copy("قائمة المهام", "Checklist")}</h2>{draft.checklist.map((item, index) => <div key={item.id} className="flex items-center gap-2">
          <input type="checkbox" aria-label={copy("إكمال المهمة", "Complete task") + " " + (index + 1)} checked={item.done} onChange={event => setDraft({ ...draft, checklist: draft.checklist.map(old => old.id === item.id ? { ...old, done: event.target.checked } : old) })} className="size-5 shrink-0" />
          <Input aria-label={copy("المهمة", "Task") + " " + (index + 1)} required maxLength={500} value={item.label.text} onChange={event => setDraft({ ...draft, checklist: draft.checklist.map(old => old.id === item.id ? { ...old, label: { ...old.label, text: event.target.value } } : old) })} />
          <Button type="button" variant="ghost" onClick={() => setDraft({ ...draft, checklist: draft.checklist.filter(old => old.id !== item.id) })}>{copy("حذف", "Remove")}</Button>
        </div>)}<Button type="button" variant="outline" disabled={draft.checklist.length >= 30} onClick={() => setDraft({ ...draft, checklist: [...draft.checklist, { id: crypto.randomUUID(), label: { text: "", language: null }, done: false }] })}>{copy("إضافة مهمة", "Add task")}</Button></section>
        <Button type="submit" disabled={!dirty}>{busy ? copy("جارٍ الحفظ…", "Saving…") : copy("حفظ التعديلات", "Save changes")}</Button>
      </fieldset>
    </form></Card>
    <Card className="space-y-3 p-5"><h2 className="font-semibold">{copy("حالة التعاون", "Collaboration status")}</h2><div className="flex flex-wrap gap-2">{Object.entries(statuses).filter(([status]) => canTransitionExternalCollaboration(current.collaboration.status, status)).map(([status, label]) => <Button key={status} variant="outline" disabled={busy || retry || dirty || current.collaboration.archived} onClick={() => void send("SET_STATUS", { status })}>{label}</Button>)}<Button variant="secondary" disabled={busy || retry || dirty} onClick={() => void send(current.collaboration.archived ? "RESTORE" : "ARCHIVE", {})}>{current.collaboration.archived ? copy("استعادة", "Restore") : copy("أرشفة", "Archive")}</Button></div></Card>
    <Card className="space-y-3 p-5"><h2 className="font-semibold">{copy("الملفات الخاصة", "Private files")}</h2>{current.attachments.map(file => <div key={file.id} className="flex flex-wrap items-center justify-between gap-3"><a className="break-words text-sm underline" href={root + "/attachments/" + encodeURIComponent(file.id)}>{file.label.text}</a><Button variant="outline" disabled={busy || retry || dirty || current.collaboration.archived} onClick={() => void send("REMOVE_ATTACHMENT", { attachmentId: file.id })}>{copy("إزالة", "Remove")}</Button></div>)}{!current.attachments.length ? <p className="text-sm text-muted-foreground">{copy("لا توجد ملفات مرفقة.", "No files attached.")}</p> : null}
      <ExternalCollaborationUpload id={current.collaboration.id} revision={current.collaboration.revision} disabled={saving || retry || dirty || current.collaboration.archived || current.attachments.length >= 20}
        onPending={setAttachmentPending} onDenied={() => setDenied(true)} onSaved={async () => { const next = await refresh(); setDraft(next.collaboration.details); }} />
    </Card>
  </div>;
}
