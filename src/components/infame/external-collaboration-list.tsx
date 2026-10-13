"use client";
import { GuardedLink as Link } from "@/components/shells/navigation-guard";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useCollaborationLeaveGuard } from "./use-collaboration-leave-guard";
import { ExternalCollaborationListSchema, ExternalCollaborationResultSchema, type ExternalCollaborationList } from "@/lib/external-collaborations/schemas";

export function ExternalCollaborationListScreen({ initial }: { initial: ExternalCollaborationList }) {
  const router = useRouter();
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [data, setData] = useState(initial), [archived, setArchived] = useState(false), [busy, setBusy] = useState(false);
  const [client, setClient] = useState(""), [campaign, setCampaign] = useState(""), [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null), locked = useRef(false);
  const [retry, setRetry] = useState(false);
  useCollaborationLeaveGuard(Boolean(client || campaign || retry || busy), copy("لديك بيانات غير محفوظة أو طلب غير مؤكد. مغادرة الصفحة؟", "You have unsaved information or an unconfirmed request. Leave this page?"));
  async function load(nextArchive: boolean, after?: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/external-collaborations?archived=" + nextArchive + (after ? "&after=" + encodeURIComponent(after) : ""), { cache: "no-store" });
      if (response.status === 401 || response.status === 403) { setData({ ...initial, collaborations: [], nextCursor: null }); throw new Error("AUTH"); }
      if (!response.ok) throw new Error("READ");
      const next = ExternalCollaborationListSchema.parse((await response.json()).data);
      setData(previous => ({ ...next, collaborations: after ? [...previous.collaborations, ...next.collaborations.filter(row => !previous.collaborations.some(old => old.id === row.id))] : next.collaborations }));
      setArchived(nextArchive);
    } catch { setError(copy("تعذر تحميل التعاونات. حاول مرة أخرى.", "Could not load collaborations. Please retry.")); }
    finally { locked.current = false; setBusy(false); }
  }
  async function create() {
    if (locked.current) return;
    if (!pending.current) pending.current = JSON.stringify({ action: "CREATE", operationKey: crypto.randomUUID(), expectedRevision: 0,
      payload: { details: { schemaVersion: 1, clientDisplay: { text: client, language: null }, campaignDisplay: { text: campaign, language: null },
        declaredValue: null, period: null, notes: null, brief: null, checklist: [] } } });
    locked.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/external-collaborations", { method: "POST", headers: { "content-type": "application/json" }, body: pending.current });
      if (!response.ok) {
        if (response.status < 500) { pending.current = null; setRetry(false); }
        throw new Error("SAVE");
      }
      const saved = ExternalCollaborationResultSchema.parse((await response.json()).data);
      pending.current = null; setRetry(false); setClient(""); setCampaign("");
      router.push("/creator/collaborations/" + encodeURIComponent(saved.collaborationId));
    } catch {
      setRetry(pending.current !== null);
      setError(copy("تعذر تأكيد الحفظ. أعد المحاولة بنفس البيانات بأمان.", "Could not confirm the save. Retry safely with the same information."));
    } finally { locked.current = false; setBusy(false); }
  }
  const statuses: Record<string, string> = { DRAFT: copy("مسودة", "Draft"), PLANNED: copy("مخطط", "Planned"), IN_PROGRESS: copy("قيد التنفيذ", "In progress"), COMPLETED: copy("مكتمل", "Completed"), CANCELLED: copy("ملغي", "Cancelled") };
  return <div className="mx-auto max-w-[1000px] space-y-6">
    <header><h1 className="text-2xl font-bold">{copy("تعاوناتي الخارجية", "External collaborations")}</h1><p className="mt-2 text-sm text-muted-foreground">{copy("نظّم تعاوناتك خارج إنفيم، بملاحظات وملفات خاصة بك. الحالات والقيم تسجلها أنت.", "Organize collaborations outside Infame with your private notes and files. You report their status and value.")}</p></header>
    <Card className="p-5"><form onSubmit={event => { event.preventDefault(); void create(); }} className="space-y-4">
      <h2 className="text-lg font-semibold">{copy("تعاون جديد", "New collaboration")}</h2>
      <fieldset disabled={busy || retry} className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm"><span>{copy("اسم العميل", "Client name")}</span><Input required maxLength={200} value={client} onChange={event => setClient(event.target.value)} /></label>
        <label className="space-y-2 text-sm"><span>{copy("اسم الحملة", "Campaign name")}</span><Input required maxLength={200} value={campaign} onChange={event => setCampaign(event.target.value)} /></label>
      </fieldset>
      <Button type="submit" disabled={busy}>{busy ? copy("جارٍ الحفظ…", "Saving…") : retry ? copy("إعادة نفس الطلب", "Retry same request") : copy("إنشاء التعاون", "Create collaboration")}</Button>
    </form></Card>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button variant={archived ? "outline" : "secondary"} disabled={busy} onClick={() => void load(false)}>{copy("الحالية", "Current")}</Button><Button variant={archived ? "secondary" : "outline"} disabled={busy} onClick={() => void load(true)}>{copy("الأرشيف", "Archived")}</Button><Button variant="ghost" disabled={busy} onClick={() => void load(archived)}>{copy("تحديث", "Refresh")}</Button></div>
    <div aria-busy={busy} className="grid gap-4 sm:grid-cols-2">{data.collaborations.map(row => <Card key={row.id} className="min-w-0 p-5">
      <p className="text-xs text-muted-foreground">{statuses[row.status]}</p><h2 className="mt-2 break-words font-semibold"><Link className="underline-offset-4 hover:underline" href={"/creator/collaborations/" + encodeURIComponent(row.id)}>{row.campaignDisplay.text}</Link></h2>
      <p className="mt-1 break-words text-sm text-muted-foreground">{row.clientDisplay.text}</p><p className="mt-4 text-sm">{copy("المهام", "Checklist")}: {row.checklist.done}/{row.checklist.total} · {copy("الملفات", "Files")}: {row.attachmentCount}</p>
    </Card>)}</div>
    {!data.collaborations.length ? <Card className="p-8 text-center text-muted-foreground">{copy("لا توجد تعاونات هنا بعد.", "No collaborations here yet.")}</Card> : null}
    {data.nextCursor ? <Button variant="outline" disabled={busy} onClick={() => void load(archived, data.nextCursor!)}>{copy("عرض المزيد", "Load more")}</Button> : null}
  </div>;
}
