"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OrganizationClientsSchema, type OrganizationClientsDTO, type OrganizationDTO } from "@/lib/organizations/contracts";
import styles from "./organization-settings.module.css";

export function OrganizationClients({ organizationId, organization, initial, initialError, after }: {
  organizationId: string; organization: OrganizationDTO | null; initial: OrganizationClientsDTO | null; initialError?: string; after?: string;
}) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [snapshot, setSnapshot] = useState(initial), [currentOrganization, setOrganization] = useState(organization);
  const [error, setError] = useState(initialError ?? ""), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false);
  const mutex = useRef(false);
  async function refresh() {
    if (mutex.current || denied) return; mutex.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/clients${after ? `?after=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" });
      if ([401, 403, 404].includes(response.status)) { setSnapshot(null); setOrganization(null); setDenied(true); setError("ACCESS_DENIED"); return; }
      if (!response.ok) throw new Error("LOAD_FAILED");
      const parsed = OrganizationClientsSchema.safeParse((await response.json()).data);
      if (!parsed.success || parsed.data.organizationId !== organizationId) throw new Error("LOAD_FAILED");
      setSnapshot(parsed.data); setError("");
    } catch { setError("LOAD_FAILED"); }
    finally { mutex.current = false; setBusy(false); }
  }
  return <div className={styles.page}>
    <header className={styles.header}><h1>{copy("عملاء المؤسسة", "Organization clients")}</h1>
      <Button asChild variant="outline"><Link prefetch={false} href="/brand/organizations">{copy("المؤسسات", "Organizations")}</Link></Button></header>
    {currentOrganization && <p className={styles.intro} dir="auto">{currentOrganization.name}</p>}
    {error && <p className={styles.error} role="alert">{denied || error === "NOT_FOUND" ? copy("لم يعد لديك وصول إلى هذه المؤسسة.", "You no longer have access to this organization.") : copy("تعذّر تحميل العملاء. يمكنك إعادة المحاولة.", "Clients could not be loaded. You can retry.")}</p>}
    <Card className={styles.card} aria-busy={busy}>
      <div className={styles.header}><h2>{copy("العملاء المصرّح لك بعرضهم", "Clients you may view")}</h2>
        <Button variant="outline" onClick={() => void refresh()} disabled={busy || denied}>{copy("تحديث", "Refresh")}</Button></div>
      <p className={styles.intro}>{copy("العضوية أو ملكية الوكالة لا تمنح صلاحيات للعملاء تلقائيًا. العرض والتخطيط والموافقة والتوقيع والدفع صلاحيات منفصلة.", "Membership or agency ownership does not automatically grant client permissions. Viewing, planning, approval, signing and payment are separate permissions.")}</p>
      <p role="status" aria-live="polite" className={styles.status}>{busy ? copy("جارٍ تحميل العملاء…", "Loading clients…") : ""}</p>
      {snapshot && <time dateTime={snapshot.asOf} className={styles.timestamp}>{new Date(snapshot.asOf).toLocaleString(isAr ? "ar-SA" : "en-GB", { timeZone: "UTC" })} UTC</time>}
      {snapshot?.clients.length === 0 && <p>{copy("لا توجد صلاحية عرض نشطة لأي عميل.", "You have no active permission to view a client.")}</p>}
      {snapshot?.clients.map(client => <div className={styles.row} key={client.id} data-organization-client-id={client.id}>
        <div><h3 dir="auto">{client.brandName}</h3><p>{copy("تفويض عرض نشط", "Active viewing permission")}</p></div>
        <Button asChild variant="outline"><Link prefetch={false} href={`/brand/collections?clientId=${encodeURIComponent(client.id)}`}>{copy("قوائم صنّاع المحتوى", "Creator collections")}</Link></Button>
        <Button asChild variant="outline"><Link prefetch={false} href={`/brand/context?clientId=${encodeURIComponent(client.id)}`}>{copy("سياق العلامة", "Brand context")}</Link></Button>
        <Button asChild variant="outline"><Link prefetch={false} href={`/brand/campaigns?clientId=${encodeURIComponent(client.id)}`}>{copy("الحملات", "Campaigns")}</Link></Button>
      </div>)}
      {snapshot?.nextCursor && <Button asChild variant="outline"><Link prefetch={false} href={`/brand/organizations/${encodeURIComponent(organizationId)}?after=${encodeURIComponent(snapshot.nextCursor)}`}>{copy("التالي", "Next")}</Link></Button>}
    </Card>
  </div>;
}
