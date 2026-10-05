"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClientGrantsSchema, type ClientCapabilities, type ClientGrantsDTO } from "@/lib/organizations/contracts";
import { CapabilitySummary, DelegationLabel, PermissionFields, SnapshotTime, WorkflowFeedback, WorkflowLink, emptyCapabilities, readOrganizationData, useOrganizationWorkflow } from "./organization-workflow";
import styles from "./organization-settings.module.css";
export function ClientGrantManagement({ clientId, initial, initialError, after }: { clientId: string; initial: ClientGrantsDTO | null; initialError?: string; after?: string }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [membershipId, setMembershipId] = useState(""), [grantRevision, setGrantRevision] = useState<number | null>(null), [editing, setEditing] = useState(false);
  const [capabilities, setCapabilities] = useState<ClientCapabilities>(emptyCapabilities());
  const [editorClientRevision, setEditorClientRevision] = useState<number | null>(null);
  function clearEditor() { setMembershipId(""); setGrantRevision(null); setEditing(false); setCapabilities(emptyCapabilities()); setEditorClientRevision(null); }
  const flow = useOrganizationWorkflow({ initial, initialError, onConfirmed: clearEditor, read: async () => {
    const data = await readOrganizationData(`/api/organization-clients/${encodeURIComponent(clientId)}/grants${after ? `?after=${encodeURIComponent(after)}` : ""}`, ClientGrantsSchema);
    if (data.client.id !== clientId) throw new Error("LOAD_FAILED"); return data;
  } });
  const snapshot = flow.snapshot;
  const selectedGrant = snapshot?.grants.find(row => row.membership.id === membershipId);
  const editorChanged = Boolean(snapshot && ((editorClientRevision !== null && editorClientRevision !== snapshot.client.revision)
    || (editing && (selectedGrant?.grant.revision !== grantRevision || !selectedGrant.canReceiveGrant))
    || Object.entries(capabilities).some(([key, value]) => value && !snapshot.savedCapabilities?.[key as keyof ClientCapabilities])));
  const disabled = flow.blocked || !snapshot?.canManageGrants || editorChanged;
  return <div className={styles.page}>
    <header className={styles.header}><h1>{copy("صلاحيات فريق العميل", "Client team permissions")}</h1><WorkflowLink flow={flow} href="/brand/settings/agency-access">{copy("وصول الوكالات", "Agency access")}</WorkflowLink></header>
    {snapshot && <p dir="auto" className={styles.intro}>{snapshot.organization.name}</p>}
    <p className={styles.intro}>{copy("الصلاحية الفعلية هي تقاطع التفويض الحالي وصلاحيات العضو النشط. السجلات المحفوظة لا تمنح وصولًا عند سحب التفويض.", "Effective permissions are the intersection of current authorization and an active member's grant. Saved records confer no access after authorization is withdrawn.")}</p>
    <WorkflowFeedback flow={flow} />
    <Button variant="outline" onClick={() => void flow.refresh()} disabled={flow.busy || flow.denied}>{copy("تحديث البيانات", "Refresh data")}</Button>
    {snapshot && <Card className={styles.card}><h2>{copy("التفويض الحالي", "Current authorization")}</h2><p><DelegationLabel value={snapshot.delegation} /></p><CapabilitySummary value={snapshot.savedCapabilities} />
      {!snapshot.canManageGrants && <p>{copy("تعديل الصلاحيات غير متاح حاليًا. يمكن للشركة سحب وصول الوكالة من إعداداتها.", "Permission changes are currently unavailable. The company can withdraw agency access from its settings.")}</p>}
    </Card>}
    {snapshot && <Card className={styles.card}><h2>{editing ? copy("تعديل صلاحيات العضو", "Edit member permissions") : copy("إضافة صلاحيات لعضو", "Grant permissions to a member")}</h2>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!disabled) void flow.send({ action: "SET_GRANT", resourceId: clientId, command: { operationKey: crypto.randomUUID(), expectedClientRevision: snapshot.client.revision, membershipId, expectedGrantRevision: grantRevision, capabilities } }); }}>
        {editorChanged && <p role="alert" className={styles.error}>{copy("تغيّر التفويض أو سجل الصلاحية أو أهلية العضو. امسح الاختيار ثم راجع الصلاحيات الحالية قبل الحفظ.", "Authorization, the grant record or member eligibility changed. Clear the selection and review current permissions before saving.")}</p>}
        <label htmlFor="grant-membership-reference">{copy("مرجع العضوية", "Membership reference")}</label><Input id="grant-membership-reference" required maxLength={200} value={membershipId} onChange={event => { setMembershipId(event.target.value); setEditorClientRevision(snapshot.client.revision); }} disabled={disabled || editing} dir="ltr" autoComplete="off" />
        <p className={styles.intro}>{copy("استخدم مرجع عضوية نشطة من إدارة المؤسسة. لا تكفي مشاركة مرجع الحساب لمنح صلاحيات.", "Use an active membership reference from organization management. Sharing an account reference alone is insufficient.")}</p>
        <PermissionFields prefix="grant" value={capabilities} onChange={value => { setCapabilities(value); setEditorClientRevision(snapshot.client.revision); }} disabled={disabled} ceiling={snapshot.savedCapabilities} />
        <div className={styles.actions}><Button type="submit" disabled={disabled || !membershipId}>{copy("حفظ صلاحيات العضو", "Save member permissions")}</Button><Button type="button" variant="outline" disabled={flow.blocked} onClick={clearEditor}>{copy("مسح الاختيار", "Clear selection")}</Button></div>
      </form></Card>}
    <Card className={styles.card} aria-busy={flow.busy}><h2>{copy("الصلاحيات المحفوظة والفعلية", "Saved and effective permissions")}</h2>{snapshot && <SnapshotTime value={snapshot.asOf} />}
      {snapshot?.grants.length === 0 && <p>{copy("لا توجد صلاحيات لأعضاء في هذه الصفحة.", "No member grants on this page.")}</p>}
      {snapshot?.grants.map(row => <div key={row.grant.id} className={styles.row} data-grant-id={row.grant.id}><div><h3>{copy("عضوية الفريق", "Team membership")}</h3><span className={styles.reference} dir="ltr">{row.membership.id}</span>
        <p>{copy("المحفوظة", "Saved")}</p><CapabilitySummary value={row.grant.capabilities} /><p>{copy("الفعلية الآن", "Effective now")}</p><CapabilitySummary value={row.effectiveCapabilities} />
        <p>{row.grant.active ? copy("سجل صلاحية نشط", "Active grant record") : copy("سجل صلاحية مسحوب", "Withdrawn grant record")}</p></div>
        <div className={styles.actions}><Button variant="outline" disabled={flow.blocked || !snapshot.canManageGrants || !row.canReceiveGrant} onClick={() => { setMembershipId(row.membership.id); setGrantRevision(row.grant.revision); setEditing(true); setEditorClientRevision(snapshot.client.revision);
          setCapabilities(Object.fromEntries(Object.entries(row.grant.capabilities).map(([key, value]) => [key, value && Boolean(snapshot.savedCapabilities?.[key as keyof ClientCapabilities])])) as ClientCapabilities); }}>{copy("تعديل الصلاحيات", "Edit permissions")}</Button>
          {row.grant.active && <Button variant="outline" disabled={disabled} onClick={() => void flow.send({ action: "REVOKE_GRANT", resourceId: row.grant.id, command: { operationKey: crypto.randomUUID(), expectedRevision: row.grant.revision } })}>{copy("سحب الصلاحيات", "Revoke permissions")}</Button>}
        </div></div>)}
      {snapshot?.nextCursor && <WorkflowLink flow={flow} href={`/brand/organization-clients/${encodeURIComponent(clientId)}/grants?after=${encodeURIComponent(snapshot.nextCursor)}`}>{copy("التالي", "Next")}</WorkflowLink>}
      {after && <WorkflowLink flow={flow} href={`/brand/organization-clients/${encodeURIComponent(clientId)}/grants`}>{copy("أول صفحة", "First page")}</WorkflowLink>}
    </Card>
  </div>;
}
