"use client";
import { useState } from "react";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OwnBrandAssociationsSchema, OwnOrganizationReferencesSchema, type ClientCapabilities } from "@/lib/organizations/contracts";
import { CapabilitySummary, DelegationLabel, PermissionFields, SnapshotTime, WorkflowFeedback, WorkflowLink, emptyCapabilities, readOrganizationData, useOrganizationWorkflow, type OrganizationWorkflow } from "./organization-workflow";
import styles from "./organization-settings.module.css";
export const BrandAgencySnapshotSchema = z.object({ references: OwnOrganizationReferencesSchema, associations: OwnBrandAssociationsSchema }).strict();
export type BrandAgencySnapshot = z.infer<typeof BrandAgencySnapshotSchema>;
type Association = z.infer<typeof OwnBrandAssociationsSchema>["associations"][number];
function AssociationConsent({ row, flow }: { row: Association; flow: OrganizationWorkflow }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [capabilities, setCapabilities] = useState<ClientCapabilities>(row.savedCapabilities ?? emptyCapabilities());
  return <div className={styles.form} data-association-id={row.client.id}>
    <h3 dir="auto">{row.organization.name}</h3><p><DelegationLabel value={row.delegation} /></p>
    <p>{copy("الصلاحيات المحفوظة", "Saved permissions")}</p><CapabilitySummary value={row.savedCapabilities} />
    {row.client.state === "REVOKED" && <p className={styles.intro}>{copy("لمنح وصول جديد، اطلب من الوكالة إرسال طلب تفويض جديد ثم راجعه.", "For new access, ask the agency to submit a new authorization request, then review it.")}</p>}
    {row.canAuthorize && <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!flow.blocked) void flow.send({ action: "AUTHORIZE_CLIENT", resourceId: row.client.id, command: { operationKey: crypto.randomUUID(), expectedRevision: row.client.revision, capabilities } }); }}>
      <PermissionFields prefix={`consent-${row.client.id}`} value={capabilities} onChange={setCapabilities} disabled={flow.blocked} />
      <p className={styles.intro}>{copy("حدّد ما يمكن للوكالة تفويضه لأعضاء فريقها. لا يحصل أي عضو على صلاحية تلقائيًا.", "Choose what the agency may delegate to its team. Members receive no permission automatically.")}</p>
      <Button type="submit" disabled={flow.blocked}>{copy("حفظ التفويض المحدد", "Save explicit authorization")}</Button>
    </form>}
    <div className={styles.actions}>
      <WorkflowLink flow={flow} href={`/brand/organization-clients/${encodeURIComponent(row.client.id)}/grants`}>{copy("مراجعة صلاحيات الفريق", "Review team permissions")}</WorkflowLink>
      {row.canRevoke && <Button variant="outline" disabled={flow.blocked} onClick={() => void flow.send({ action: "REVOKE_CLIENT", resourceId: row.client.id, command: { operationKey: crypto.randomUUID(), expectedRevision: row.client.revision } })}>{copy("سحب وصول الوكالة", "Withdraw agency access")}</Button>}
    </div>
  </div>;
}
export function BrandAgencyAccess({ initial, initialError, after }: { initial: BrandAgencySnapshot | null; initialError?: string; after?: string }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const flow = useOrganizationWorkflow({ initial, initialError, read: async () => {
    const [references, associations] = await Promise.all([readOrganizationData("/api/organizations/references", OwnOrganizationReferencesSchema),
      readOrganizationData(`/api/brand/organization-associations${after ? `?after=${encodeURIComponent(after)}` : ""}`, OwnBrandAssociationsSchema)]);
    if (references.brandId !== associations.brandId) throw new Error("LOAD_FAILED");
    return { references, associations };
  } });
  return <div className={styles.page}>
    <header className={styles.header}><h1>{copy("وصول الوكالات والفريق", "Agency and team access")}</h1><WorkflowLink flow={flow} href="/brand/settings">{copy("الإعدادات", "Settings")}</WorkflowLink></header>
    <p className={styles.intro}>{copy("كل شركة تتحكم في وصول الوكالات إليها. يمكنك سحب الوصول حتى إن لم يعد التفويض أو حساب الوكالة متاحًا.", "Each company controls agency access. You can withdraw access even when the authorization or agency account is unavailable.")}</p>
    <WorkflowFeedback flow={flow} />
    <Button variant="outline" onClick={() => void flow.refresh()} disabled={flow.busy || flow.denied}>{copy("تحديث البيانات", "Refresh data")}</Button>
    {flow.snapshot && <Card className={styles.card}><h2>{copy("مراجع حسابك للمشاركة", "Your shareable account references")}</h2><SnapshotTime value={flow.snapshot.references.asOf} />
      <p>{copy("مرجع حسابك لطلبات العضوية", "Your account reference for membership requests")}</p><span className={styles.reference} dir="ltr" data-own-user-reference>{flow.snapshot.references.userId}</span>
      <p>{copy("مرجع شركتك لطلبات التفويض", "Your company reference for authorization requests")}</p><span className={styles.reference} dir="ltr" data-own-brand-reference>{flow.snapshot.references.brandId ?? copy("لم يتم إنشاء ملف الشركة بعد.", "Your company profile has not been created yet.")}</span>
      <p className={styles.intro}>{copy("مشاركة المرجع لا تمنح أي صلاحية. وافق فقط على الطلبات التي تعرف أصحابها.", "Sharing a reference grants no permission. Approve only requests from people you know.")}</p>
      {flow.snapshot.references.brandId === null && <WorkflowLink flow={flow} href="/brand/onboarding">{copy("إعداد ملف الشركة", "Set up company profile")}</WorkflowLink>}
      <WorkflowLink flow={flow} href="/brand/organizations">{copy("عضوياتي ومؤسساتي", "My memberships and organizations")}</WorkflowLink>
    </Card>}
    <Card className={styles.card} aria-busy={flow.busy}><h2>{copy("الوكالات المرتبطة بشركتك", "Agencies associated with your company")}</h2>
      {flow.snapshot && <SnapshotTime value={flow.snapshot.associations.asOf} />}
      {flow.snapshot?.associations.associations.length === 0 && <p>{copy("لا توجد طلبات أو تفويضات للوكالات في هذه الصفحة.", "No agency requests or authorizations on this page.")}</p>}
      {flow.snapshot?.associations.associations.map(row => <AssociationConsent key={`${row.client.id}:${row.client.revision}`} row={row} flow={flow} />)}
      {flow.snapshot?.associations.nextCursor && <WorkflowLink flow={flow} href={`/brand/settings/agency-access?after=${encodeURIComponent(flow.snapshot.associations.nextCursor)}`}>{copy("التالي", "Next")}</WorkflowLink>}
      {after && <WorkflowLink flow={flow} href="/brand/settings/agency-access">{copy("أول صفحة", "First page")}</WorkflowLink>}
    </Card>
  </div>;
}
