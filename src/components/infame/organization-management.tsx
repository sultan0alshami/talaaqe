"use client";
import { useState } from "react";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OrganizationAssociationsSchema, OrganizationMembersSchema } from "@/lib/organizations/contracts";
import { CapabilitySummary, DelegationLabel, SnapshotTime, WorkflowFeedback, WorkflowLink, readOrganizationData, useOrganizationWorkflow } from "./organization-workflow";
import styles from "./organization-settings.module.css";

export const OrganizationManagementSnapshotSchema = z.object({ members: OrganizationMembersSchema, associations: OrganizationAssociationsSchema }).strict();
export type OrganizationManagementSnapshot = z.infer<typeof OrganizationManagementSnapshotSchema>;
export function OrganizationManagement({ organizationId, initial, initialError, membersAfter, clientsAfter }: {
  organizationId: string; initial: OrganizationManagementSnapshot | null; initialError?: string; membersAfter?: string; clientsAfter?: string;
}) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [targetUserId, setTargetUserId] = useState(""), [brandId, setBrandId] = useState("");
  const flow = useOrganizationWorkflow({ initial, initialError, onConfirmed: () => { setTargetUserId(""); setBrandId(""); }, read: async () => {
    const base = `/api/organizations/${encodeURIComponent(organizationId)}`;
    const [members, associations] = await Promise.all([
      readOrganizationData(`${base}/members${membersAfter ? `?after=${encodeURIComponent(membersAfter)}` : ""}`, OrganizationMembersSchema),
      readOrganizationData(`${base}/associations${clientsAfter ? `?after=${encodeURIComponent(clientsAfter)}` : ""}`, OrganizationAssociationsSchema),
    ]);
    if (members.organization.id !== organizationId || associations.organization.id !== organizationId) throw new Error("LOAD_FAILED");
    return { members, associations };
  } });
  const snapshot = flow.snapshot;
  const revision = snapshot ? Math.max(snapshot.members.organization.revision, snapshot.associations.organization.revision) : 0;
  const path = (memberCursor?: string | null, clientCursor?: string | null) => {
    const query = new URLSearchParams(); if (memberCursor) query.set("membersAfter", memberCursor); if (clientCursor) query.set("clientsAfter", clientCursor);
    return `/brand/organizations/${encodeURIComponent(organizationId)}/manage${query.size ? `?${query}` : ""}`;
  };
  return <div className={styles.page}>
    <header className={styles.header}><h1>{copy("إدارة المؤسسة", "Manage organization")}</h1><WorkflowLink flow={flow} href="/brand/organizations">{copy("المؤسسات", "Organizations")}</WorkflowLink></header>
    {snapshot && <p dir="auto" className={styles.intro}>{snapshot.members.organization.name}</p>}
    <p className={styles.intro}>{copy("اطلب مرجع الحساب من الشخص أو الشركة مباشرة. طلب العضوية وتفويض العميل وصلاحيات الفريق موافقات مستقلة.", "Ask the person or company for their account reference directly. Membership, client authorization and team permissions are separate approvals.")}</p>
    <WorkflowFeedback flow={flow} />
    <Button variant="outline" onClick={() => void flow.refresh()} disabled={flow.busy || flow.denied}>{copy("تحديث البيانات", "Refresh data")}</Button>
    {!flow.denied && <Card className={styles.card}><h2>{copy("دعوة حساب معروف للفريق", "Invite a known account to the team")}</h2>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!flow.blocked) void flow.send({ action: "PROPOSE_MEMBER", resourceId: organizationId,
        command: { operationKey: crypto.randomUUID(), expectedOrganizationRevision: revision, targetUserId } }); }}>
        <label htmlFor="team-account-reference">{copy("مرجع حساب العضو", "Member account reference")}</label><Input id="team-account-reference" value={targetUserId} onChange={event => setTargetUserId(event.target.value)} required maxLength={200} disabled={flow.blocked} autoComplete="off" dir="ltr" />
        <p className={styles.intro}>{copy("سيظهر الطلب في حساب العضو؛ لا تصبح العضوية نشطة حتى يقبلها.", "The request appears in the member's account; membership becomes active after they accept.")}</p>
        <Button disabled={flow.blocked || !targetUserId} type="submit">{copy("طلب العضوية", "Request membership")}</Button>
      </form></Card>}
    <Card className={styles.card} aria-busy={flow.busy}><h2>{copy("أعضاء الفريق", "Team members")}</h2>
      {snapshot && <SnapshotTime value={snapshot.members.asOf} />}
      {snapshot?.members.members.length === 0 && <p>{copy("لا يوجد أعضاء في هذه الصفحة.", "No members on this page.")}</p>}
      {snapshot?.members.members.map(row => <div key={row.membership.id} className={styles.row} data-membership-id={row.membership.id}>
        <div><h3 dir="auto">{row.displayName ?? copy("حساب بانتظار الموافقة أو غير متاح", "Pending or unavailable account")}</h3>
          <p>{row.protectedOwner ? copy("مالك المؤسسة — عضوية محمية", "Organization owner — protected membership") : row.membership.state === "ACTIVE" ? copy("عضوية نشطة", "Active membership") : row.membership.state === "PENDING" ? copy("بانتظار قبول العضو", "Awaiting member acceptance") : copy("عضوية مسحوبة", "Membership withdrawn")}</p>
          <span className={styles.reference} dir="ltr">{row.membership.userId}</span><p>{copy("مرجع العضوية للصلاحيات", "Membership reference for permissions")}</p><span className={styles.reference} dir="ltr">{row.membership.id}</span></div>
        {!row.protectedOwner && row.membership.state !== "REVOKED" && <Button variant="outline" disabled={flow.blocked} onClick={() => void flow.send({ action: "REVOKE_MEMBERSHIP", resourceId: row.membership.id, command: { operationKey: crypto.randomUUID(), expectedRevision: row.membership.revision } })}>{copy("سحب العضوية", "Revoke membership")}</Button>}
      </div>)}
      {snapshot?.members.nextCursor && <WorkflowLink flow={flow} href={path(snapshot.members.nextCursor, clientsAfter)}>{copy("الأعضاء التاليون", "Next members")}</WorkflowLink>}
      {membersAfter && <WorkflowLink flow={flow} href={path(null, clientsAfter)}>{copy("أول صفحة للأعضاء", "First members page")}</WorkflowLink>}
    </Card>
    {!flow.denied && <Card className={styles.card}><h2>{copy("طلب تفويض من شركة", "Request authorization from a company")}</h2>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!flow.blocked) void flow.send({ action: "PROPOSE_CLIENT", resourceId: organizationId, command: { operationKey: crypto.randomUUID(), expectedOrganizationRevision: revision, brandId } }); }}>
        <label htmlFor="client-brand-reference">{copy("مرجع الشركة", "Company reference")}</label><Input id="client-brand-reference" required maxLength={200} value={brandId} onChange={event => setBrandId(event.target.value)} disabled={flow.blocked} autoComplete="off" dir="ltr" />
        <p className={styles.intro}>{copy("توافق الشركة من إعدادات وصول الوكالات. لا يكشف الطلب بياناتها ولا يمنح الفريق صلاحيات.", "The company approves from its agency-access settings. A request reveals no company data and grants no team permissions.")}</p>
        <Button type="submit" disabled={flow.blocked || !brandId}>{copy("طلب تفويض العميل", "Request client authorization")}</Button>
      </form></Card>}
    <Card className={styles.card} aria-busy={flow.busy}><h2>{copy("تفويضات العملاء", "Client authorizations")}</h2>
      {snapshot && <SnapshotTime value={snapshot.associations.asOf} />}
      {snapshot?.associations.associations.length === 0 && <p>{copy("لا توجد تفويضات في هذه الصفحة.", "No authorizations on this page.")}</p>}
      {snapshot?.associations.associations.map(row => <div key={row.client.id} className={styles.row} data-association-id={row.client.id}><div>
        <h3 dir="auto">{row.brandName ?? copy("شركة بمرجع معروف", "Company with a known reference")}</h3><span className={styles.reference} dir="ltr">{row.client.brandId}</span>
        <p><DelegationLabel value={row.delegation} /></p><CapabilitySummary value={row.savedCapabilities} /></div>
        <div className={styles.actions}>{row.canManageGrants && <WorkflowLink flow={flow} href={`/brand/organization-clients/${encodeURIComponent(row.client.id)}/grants`}>{copy("إدارة الصلاحيات", "Manage permissions")}</WorkflowLink>}
          {row.client.state === "PENDING" && <Button variant="outline" disabled={flow.blocked} onClick={() => void flow.send({ action: "WITHDRAW_CLIENT_PROPOSAL", resourceId: row.client.id, command: { operationKey: crypto.randomUUID(), expectedRevision: row.client.revision } })}>{copy("سحب طلب التفويض", "Withdraw authorization request")}</Button>}
        </div></div>)}
      {snapshot?.associations.nextCursor && <WorkflowLink flow={flow} href={path(membersAfter, snapshot.associations.nextCursor)}>{copy("العملاء التاليون", "Next clients")}</WorkflowLink>}
      {clientsAfter && <WorkflowLink flow={flow} href={path(membersAfter, null)}>{copy("أول صفحة للعملاء", "First clients page")}</WorkflowLink>}
    </Card>
  </div>;
}
