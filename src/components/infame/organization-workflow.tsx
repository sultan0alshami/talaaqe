"use client";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ClientGrantSchema, MembershipSchema, OrganizationClientSchema, type ClientCapabilities } from "@/lib/organizations/contracts";
import styles from "./organization-settings.module.css";

export type OrganizationUiCommand = { action: "PROPOSE_MEMBER" | "REVOKE_MEMBERSHIP" | "WITHDRAW_MEMBERSHIP" | "PROPOSE_CLIENT" | "ASSOCIATE_OWNED_BRAND" | "AUTHORIZE_CLIENT" | "REVOKE_CLIENT" | "WITHDRAW_CLIENT_PROPOSAL" | "SET_GRANT" | "REVOKE_GRANT"; resourceId: string; command: Record<string, unknown> };
const MembershipResult = z.object({ membership: MembershipSchema, replayed: z.boolean() }).strict();
const ClientResult = z.object({ client: OrganizationClientSchema, replayed: z.boolean() }).strict();
const GrantResult = z.object({ grant: ClientGrantSchema, replayed: z.boolean() }).strict();
function validReply(command: OrganizationUiCommand, data: unknown) {
  if (["PROPOSE_MEMBER", "REVOKE_MEMBERSHIP", "WITHDRAW_MEMBERSHIP"].includes(command.action)) {
    const result = MembershipResult.safeParse(data);
    return result.success && (command.action === "PROPOSE_MEMBER" ? result.data.membership.organizationId === command.resourceId
      && result.data.membership.userId === command.command.targetUserId && result.data.membership.state === "PENDING"
      : result.data.membership.id === command.resourceId && result.data.membership.state === "REVOKED"
        && result.data.membership.revision === Number(command.command.expectedRevision) + 1);
  }
  if (["SET_GRANT", "REVOKE_GRANT"].includes(command.action)) {
    const result = GrantResult.safeParse(data);
    return result.success && (command.action === "SET_GRANT" ? result.data.grant.clientId === command.resourceId
      && result.data.grant.membershipId === command.command.membershipId && result.data.grant.active
      && result.data.grant.revision === (command.command.expectedGrantRevision === null ? 1 : Number(command.command.expectedGrantRevision) + 1)
      && Object.entries(result.data.grant.capabilities).every(([key, value]) => value === (command.command.capabilities as ClientCapabilities)[key as keyof ClientCapabilities])
      : result.data.grant.id === command.resourceId && !result.data.grant.active && result.data.grant.revision === Number(command.command.expectedRevision) + 1);
  }
  const result = ClientResult.safeParse(data);
  return result.success && (["PROPOSE_CLIENT", "ASSOCIATE_OWNED_BRAND"].includes(command.action)
    ? result.data.client.organizationId === command.resourceId && result.data.client.brandId === command.command.brandId
      && result.data.client.state === (command.action === "PROPOSE_CLIENT" ? "PENDING" : "ACTIVE")
    : result.data.client.id === command.resourceId && result.data.client.revision === Number(command.command.expectedRevision) + 1
      && result.data.client.state === (command.action === "AUTHORIZE_CLIENT" ? "ACTIVE" : "REVOKED"));
}

export function useOrganizationWorkflow<T>({ initial, initialError, read, onConfirmed }: {
  initial: T | null; initialError?: string; read: () => Promise<T>; onConfirmed?: () => void;
}) {
  const [snapshot, setSnapshot] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(initialError ?? "");
  const [denied, setDenied] = useState(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(initialError ?? ""));
  const [pending, setPending] = useState<OrganizationUiCommand | null>(null), [confirmed, setConfirmed] = useState(false), [saved, setSaved] = useState(false);
  const mutex = useRef(false), captured = useRef<OrganizationUiCommand | null>(null), confirmation = useRef(false);
  function deny() { setSnapshot(null); setDenied(true); captured.current = null; confirmation.current = false; setPending(null); setConfirmed(false); setSaved(false); }
  async function reload() {
    try {
      const next = await read(); setSnapshot(next); setError("");
      if (confirmation.current && captured.current) {
        captured.current = null; confirmation.current = false; setPending(null); setConfirmed(false); setSaved(true); onConfirmed?.();
      }
    } catch (failure) {
      if (failure instanceof Error && failure.message === "ACCESS_DENIED") { deny(); setError("ACCESS_DENIED"); }
      else setError("LOAD_FAILED");
    }
  }
  async function refresh() {
    if (mutex.current || denied) return; mutex.current = true; setBusy(true);
    try { await reload(); } finally { mutex.current = false; setBusy(false); }
  }
  async function send(command: OrganizationUiCommand) {
    if (mutex.current || denied || confirmation.current || (captured.current && captured.current !== command)) return;
    mutex.current = true; captured.current = command; confirmation.current = false;
    setBusy(true); setPending(command); setConfirmed(false); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/organizations/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      if ([401, 403, 404].includes(response.status)) { deny(); setError("ACCESS_DENIED"); return; }
      if (!response.ok) {
        if (response.status < 500) { captured.current = null; setPending(null); }
        setError(response.status === 409 ? "STALE_VERSION" : "SAVE_FAILED"); return;
      }
      if (!validReply(command, (await response.json()).data)) throw new Error("SAVE_FAILED");
      confirmation.current = true; setConfirmed(true); await reload();
    } catch { setError("SAVE_FAILED"); }
    finally { mutex.current = false; setBusy(false); }
  }
  function guardNavigation(event: MouseEvent<HTMLAnchorElement>) { if (mutex.current || captured.current) event.preventDefault(); }
  return { snapshot: denied ? null : snapshot, busy, error, denied, pending, confirmed, saved, blocked: busy || pending !== null || denied || snapshot === null,
    refresh, send, retry: () => captured.current && void send(captured.current), guardNavigation };
}
export type OrganizationWorkflow = ReturnType<typeof useOrganizationWorkflow<unknown>>;
export async function readOrganizationData<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if ([401, 403, 404].includes(response.status)) throw new Error("ACCESS_DENIED");
  if (!response.ok) throw new Error("LOAD_FAILED");
  const parsed = schema.safeParse((await response.json()).data);
  if (!parsed.success) throw new Error("LOAD_FAILED");
  return parsed.data;
}
export function WorkflowFeedback({ flow }: { flow: OrganizationWorkflow }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  return <>
    {flow.error && <p role="alert" className={styles.error}>{flow.denied ? copy("لم يعد هذا الوصول متاحًا. ارجع إلى الإعدادات أو سجّل الدخول مجددًا.", "This access is no longer available. Return to settings or sign in again.")
      : flow.error === "STALE_VERSION" ? copy("تغيّرت البيانات. حدّثها وراجع الإجراء قبل المحاولة.", "The record changed. Refresh and review the action before trying again.")
      : copy("تعذّر إكمال الطلب. احتفظنا بالبيانات؛ يمكنك إعادة المحاولة.", "The request could not complete. Your data is retained; you can retry.")}</p>}
    {flow.pending && !flow.busy && !flow.confirmed && <Button onClick={flow.retry}>{copy("إعادة محاولة الطلب نفسه", "Retry the same request")}</Button>}
    {flow.pending && !flow.busy && flow.confirmed && <p>{copy("تم حفظ الطلب. حدّث البيانات لإكمال الاستعادة.", "Your request was saved. Refresh the data to finish recovery.")}</p>}
    {flow.denied && <Button asChild><Link href="/login">{copy("تسجيل الدخول", "Sign in")}</Link></Button>}
    <p role="status" aria-live="polite" className={styles.status}>{flow.busy ? copy("جارٍ حفظ الطلب أو تحميله…", "Saving or loading…") : flow.saved ? copy("تم حفظ الطلب وتحديث البيانات.", "Request saved and data refreshed.") : ""}</p>
  </>;
}
export function WorkflowLink({ flow, href, children }: { flow: OrganizationWorkflow; href: string; children: ReactNode }) {
  return flow.busy || flow.pending ? <Button disabled variant="outline">{children}</Button> : <Button asChild variant="outline"><Link prefetch={false} onClick={flow.guardNavigation} onAuxClick={flow.guardNavigation} href={href}>{children}</Link></Button>;
}
export const capabilityLabels = {
  view: ["عرض بيانات العميل", "View client data"], plan: ["التخطيط للحملات", "Plan campaigns"], approveShortlist: ["اعتماد قائمة المؤثرين", "Approve creator shortlist"],
  reviewContent: ["مراجعة المحتوى", "Review content"], signCustomer: ["توقيع اتفاق العميل", "Sign customer agreement"], financial: ["الإجراءات المالية", "Financial actions"], manageGrants: ["إدارة صلاحيات الفريق", "Manage team permissions"],
} as const;
export const emptyCapabilities = (): ClientCapabilities => ({ view: false, plan: false, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false });
export function PermissionFields({ value, onChange, disabled, ceiling, prefix }: { value: ClientCapabilities; onChange: (value: ClientCapabilities) => void; disabled: boolean; ceiling?: ClientCapabilities | null; prefix: string }) {
  const { isAr } = useI18n();
  return <fieldset className={styles.permissions} disabled={disabled}><legend>{isAr ? "الصلاحيات المحددة" : "Explicit permissions"}</legend>
    {(Object.keys(capabilityLabels) as Array<keyof ClientCapabilities>).map(key => <label key={key} htmlFor={`${prefix}-${key}`}>
      <input id={`${prefix}-${key}`} type="checkbox" checked={value[key]} disabled={disabled || (ceiling != null && !ceiling[key])} onChange={event => onChange({ ...value, [key]: event.target.checked })} />
      <span>{capabilityLabels[key][isAr ? 0 : 1]}{ceiling != null && !ceiling[key] ? (isAr ? " (غير مفوّضة)" : " (not delegated)") : ""}</span>
    </label>)}
  </fieldset>;
}
export function CapabilitySummary({ value }: { value: ClientCapabilities | null }) {
  const { isAr } = useI18n();
  const enabled = value ? (Object.keys(value) as Array<keyof ClientCapabilities>).filter(key => value[key]) : [];
  return <p>{enabled.length ? enabled.map(key => capabilityLabels[key][isAr ? 0 : 1]).join(" · ") : isAr ? "لا توجد صلاحيات" : "No permissions"}</p>;
}
export function SnapshotTime({ value }: { value: string }) { const { isAr } = useI18n(); return <time className={styles.timestamp} dateTime={value}>{new Date(value).toLocaleString(isAr ? "ar-SA" : "en-GB", { timeZone: "UTC" })} UTC</time>; }
export function DelegationLabel({ value }: { value: string }) {
  const { isAr } = useI18n();
  const labels: Record<string, [string, string]> = { PENDING: ["بانتظار موافقة الشركة", "Awaiting company approval"], CURRENT: ["تفويض حالي", "Current authorization"], RENEWAL_REQUIRED: ["التفويض غير متاح", "Authorization unavailable"], REVOKED: ["تفويض مسحوب", "Authorization withdrawn"] };
  return <span>{labels[value]?.[isAr ? 0 : 1] ?? ""}</span>;
}
