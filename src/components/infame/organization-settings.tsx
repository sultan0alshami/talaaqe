"use client";
import { useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MembershipSchema, OrganizationDirectorySchema, OrganizationSchema, type OrganizationDirectoryDTO } from "@/lib/organizations/contracts";
import styles from "./organization-settings.module.css";

const CreateResult = z.object({ organization: OrganizationSchema, replayed: z.boolean() }).strict();
const MembershipResult = z.object({ membership: MembershipSchema, replayed: z.boolean() }).strict();
type PendingCommand = { action: "CREATE" | "ACCEPT_MEMBERSHIP" | "WITHDRAW_MEMBERSHIP"; resourceId?: string; command: Record<string, unknown> };
export function OrganizationSettings({ initial, initialError, after }: { initial: OrganizationDirectoryDTO | null; initialError?: string; after?: string }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [snapshot, setSnapshot] = useState(initial), [error, setError] = useState(initialError ?? ""), [busy, setBusy] = useState(false);
  const [name, setName] = useState(""), [kind, setKind] = useState<"BUSINESS" | "AGENCY">("BUSINESS"), [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingCommand | null>(null), [denied, setDenied] = useState(false);
  const [awaitingReload, setAwaitingReload] = useState(false);
  const mutex = useRef(false), commandRef = useRef<PendingCommand | null>(null);
  const confirmed = useRef(false);
  function guardNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (mutex.current || commandRef.current) event.preventDefault();
  }
  function deny() { setSnapshot(null); setDenied(true); setPending(null); commandRef.current = null; confirmed.current = false; setAwaitingReload(false); setNotice(""); }
  async function readDirectory() {
    const response = await fetch(`/api/organizations${after ? `?after=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" });
    if ([401, 403, 404].includes(response.status)) { deny(); throw new Error("ACCESS_DENIED"); }
    if (!response.ok) throw new Error("LOAD_FAILED");
    const parsed = OrganizationDirectorySchema.safeParse((await response.json()).data);
    if (!parsed.success) throw new Error("LOAD_FAILED");
    setSnapshot(parsed.data); setError("");
    if (confirmed.current && commandRef.current) {
      const savedAction = commandRef.current.action;
      if (savedAction === "CREATE") setName("");
      commandRef.current = null; confirmed.current = false; setAwaitingReload(false); setPending(null);
      setNotice(savedAction === "CREATE" ? "CREATED" : "ACCEPTED");
    }
  }
  async function refresh() {
    if (mutex.current) return; mutex.current = true; setBusy(true);
    try { await readDirectory(); } catch { setError("LOAD_FAILED"); }
    finally { mutex.current = false; setBusy(false); }
  }
  async function send(command: PendingCommand) {
    if (mutex.current || denied || confirmed.current || (commandRef.current && commandRef.current !== command)) return;
    mutex.current = true; setBusy(true); setError(""); setNotice("");
    commandRef.current = command; confirmed.current = false; setAwaitingReload(false); setPending(command);
    try {
      const response = await fetch("/api/organizations/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      if ([401, 403, 404].includes(response.status)) { deny(); setError("ACCESS_DENIED"); return; }
      if (!response.ok) {
        if (response.status < 500) { commandRef.current = null; setPending(null); }
        setError(response.status === 409 ? "STALE_VERSION" : "SAVE_FAILED"); return;
      }
      const body = await response.json();
      const parsed = (command.action === "CREATE" ? CreateResult : MembershipResult).safeParse(body.data);
      if (!parsed.success) throw new Error("SAVE_FAILED");
      if (command.action === "CREATE") {
        const saved = CreateResult.parse(body.data).organization;
        if (saved.name !== command.command.nameOriginal || saved.kind !== command.command.kind) throw new Error("SAVE_FAILED");
      } else {
        const saved = MembershipResult.parse(body.data).membership;
        if (saved.id !== command.resourceId || saved.revision !== Number(command.command.expectedRevision) + 1
          || saved.state !== (command.action === "ACCEPT_MEMBERSHIP" ? "ACTIVE" : "REVOKED")) throw new Error("SAVE_FAILED");
      }
      confirmed.current = true; setAwaitingReload(true);
      try { await readDirectory(); } catch { setError("LOAD_FAILED"); }
    } catch { setError("SAVE_FAILED"); }
    finally { mutex.current = false; setBusy(false); }
  }
  const blocked = busy || pending !== null || denied;
  return <div className={styles.page}>
    <header className={styles.header}><h1>{copy("المؤسسات والفريق", "Organizations and team")}</h1>
      {busy || pending ? <Button disabled variant="outline">{copy("الإعدادات", "Settings")}</Button> : <Button asChild variant="outline"><Link onClick={guardNavigation} onAuxClick={guardNavigation} prefetch={false} href="/brand/settings">{copy("الإعدادات", "Settings")}</Link></Button>}</header>
    <p className={styles.intro}>{copy("أنشئ مؤسسة أو وكالة، ووافق على عضويتك. يحتاج كل عميل إلى تفويض مستقل وصلاحيات محددة.", "Create a business or agency and accept your memberships. Each client needs its own authorization and explicit permissions.")}</p>
    {error && <p role="alert" className={styles.error}>{denied ? copy("انتهى وصولك. سجّل الدخول مجددًا.", "Your access has ended. Sign in again.") : error === "STALE_VERSION" ? copy("تغيّرت البيانات. حدّث الصفحة ثم راجع الإجراء.", "The record changed. Refresh and review your action.") : copy("تعذّر إكمال الطلب. بياناتك محفوظة ويمكنك إعادة المحاولة.", "The request could not complete. Your data is retained; you can retry.")}</p>}
    {pending && !busy && !awaitingReload && <Button onClick={() => commandRef.current && void send(commandRef.current)}>{copy("إعادة محاولة الطلب نفسه", "Retry the same request")}</Button>}
    {pending && !busy && awaitingReload && <p>{copy("تم حفظ الطلب. حدّث البيانات لإكمال الاستعادة.", "Your request was saved. Refresh the data to finish recovery.")}</p>}
    {denied && <Button asChild><Link href="/login">{copy("تسجيل الدخول", "Sign in")}</Link></Button>}
    <p role="status" aria-live="polite" className={styles.status}>{busy ? copy("جارٍ حفظ الطلب أو تحميله…", "Saving or loading…") : notice === "CREATED" ? copy("تم إنشاء المؤسسة.", "Organization created.") : notice === "ACCEPTED" ? copy("تم حفظ طلب العضوية.", "Membership request saved.") : ""}</p>
    {!denied && <Card className={styles.card}><h2>{copy("إنشاء مؤسسة", "Create organization")}</h2>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!blocked) void send({ action: "CREATE", command: { operationKey: crypto.randomUUID(), nameOriginal: name, kind } }); }}>
        <label htmlFor="organization-name">{copy("اسم المؤسسة", "Organization name")}</label>
        <Input id="organization-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={blocked} autoComplete="organization" />
        <label htmlFor="organization-kind">{copy("نوع المؤسسة", "Organization type")}</label>
        <select id="organization-kind" value={kind} disabled={blocked} onChange={event => setKind(event.target.value as "BUSINESS" | "AGENCY")}>
          <option value="BUSINESS">{copy("شركة", "Business")}</option><option value="AGENCY">{copy("وكالة", "Agency")}</option>
        </select>
        <Button type="submit" disabled={blocked || !name.trim()}>{copy("إنشاء المؤسسة", "Create organization")}</Button>
      </form></Card>}
    <Card className={styles.card} aria-busy={busy}><div className={styles.header}><h2>{copy("عضوياتي", "My memberships")}</h2>
      <Button variant="outline" onClick={() => void refresh()} disabled={busy || denied}>{copy("تحديث", "Refresh")}</Button></div>
      {snapshot && <time dateTime={snapshot.asOf} className={styles.timestamp}>{new Date(snapshot.asOf).toLocaleString(isAr ? "ar-SA" : "en-GB", { timeZone: "UTC" })} UTC</time>}
      {snapshot?.organizations.length === 0 && <p>{copy("لا توجد عضويات نشطة أو بانتظار قبولك.", "You have no active memberships or memberships awaiting your acceptance.")}</p>}
      {snapshot?.organizations.map(({ organization, membership, isOwner, available }) => <div className={styles.row} key={organization.id} data-organization-id={organization.id}>
        <div><h3 dir="auto">{organization.name}</h3><p>{organization.kind === "AGENCY" ? copy("وكالة", "Agency") : copy("شركة", "Business")} · {membership.state === "PENDING" ? copy("بانتظار قبولك", "Awaiting your acceptance") : copy("عضوية نشطة", "Active membership")}</p></div>
        <div className={styles.actions}>{!available && <p>{isOwner ? copy("المؤسسة غير متاحة. عضوية المالك محمية.", "Organization unavailable. The owner membership is protected.") : copy("المؤسسة غير متاحة؛ يمكنك سحب عضويتك.", "Organization unavailable; you may withdraw your membership.")}</p>}
          {membership.state === "PENDING" ? <Button disabled={blocked || !available} onClick={() => void send({ action: "ACCEPT_MEMBERSHIP", resourceId: membership.id, command: { operationKey: crypto.randomUUID(), expectedRevision: membership.revision } })}>{copy("قبول العضوية", "Accept membership")}</Button>
          : !available ? null
          : blocked ? <Button disabled variant="outline">{copy("عرض العملاء", "View clients")}</Button> : <Button asChild variant="outline"><Link onClick={guardNavigation} onAuxClick={guardNavigation} prefetch={false} href={`/brand/organizations/${encodeURIComponent(organization.id)}`}>{copy("عرض العملاء", "View clients")}</Link></Button>}
          {isOwner && available && (blocked ? <Button disabled variant="outline">{copy("إدارة المؤسسة", "Manage organization")}</Button> : <Button asChild variant="outline"><Link onClick={guardNavigation} onAuxClick={guardNavigation} prefetch={false} href={`/brand/organizations/${encodeURIComponent(organization.id)}/manage`}>{copy("إدارة المؤسسة", "Manage organization")}</Link></Button>)}
          {!isOwner && <Button variant="outline" disabled={blocked} onClick={() => void send({ action: "WITHDRAW_MEMBERSHIP", resourceId: membership.id, command: { operationKey: crypto.randomUUID(), expectedRevision: membership.revision } })}>{membership.state === "PENDING" ? copy("رفض العضوية", "Decline membership") : copy("مغادرة المؤسسة", "Leave organization")}</Button>}
        </div>
      </div>)}
      {snapshot?.nextCursor && (blocked ? <Button disabled variant="outline">{copy("التالي", "Next")}</Button> : <Button asChild variant="outline"><Link onClick={guardNavigation} onAuxClick={guardNavigation} prefetch={false} href={`/brand/organizations?after=${encodeURIComponent(snapshot.nextCursor)}`}>{copy("التالي", "Next")}</Link></Button>)}
    </Card>
  </div>;
}
