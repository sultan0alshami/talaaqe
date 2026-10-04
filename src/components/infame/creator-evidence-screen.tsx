"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { CreatorEvidence } from "@/lib/evidence/client-contracts";
import { evidenceRead, useEvidenceOperation } from "./evidence-client";
import { Attachment, CorrectionForm, EvidenceAssetInput, EvidenceFact, EvidenceFeedback, EvidenceSelect, LicenceForm, ReviewNote, SavedMetricValue, ScreenshotForm,
  VisibilitySelect, evidenceDate, evidenceObject, evidenceText, type Copy, type EvidenceAccount, type EvidenceOperation, type Visibility } from "./creator-evidence-forms";
import styles from "./evidence-owner.module.css";

function fieldLabel(field: string, copy: Copy) {
  const labels: Record<string, string> = { followers: copy("المتابعون", "Followers"), averageViews: copy("متوسط المشاهدات", "Average views"), engagementRate: copy("نسبة التفاعل", "Engagement rate"),
    "demographics.age": copy("أعمار الجمهور", "Audience ages"), "demographics.gender": copy("جنس الجمهور", "Audience genders"), "demographics.countries": copy("بلدان الجمهور", "Audience countries"), "demographics.cities": copy("مدن الجمهور", "Audience cities") };
  return labels[field] ?? `${copy("قياس التنسيق", "Format metric")} · ${field.slice(14)}`;
}
function snapshotFields(snapshot: CreatorEvidence["snapshots"][number]) {
  const fields: string[] = [];
  for (const field of ["followers", "averageViews", "engagementRate"] as const) if (snapshot[field] !== null) fields.push(field);
  const dimensions = evidenceObject(snapshot.demographics);
  for (const field of ["age", "gender", "countries", "cities"]) if (dimensions[field] !== undefined && dimensions[field] !== null) fields.push(`demographics.${field}`);
  if (Array.isArray(snapshot.formatMetrics)) for (const row of snapshot.formatMetrics) { const format = evidenceText(evidenceObject(row).format); if (format) fields.push(`formatMetrics.${format}`); }
  return fields;
}

function SnapshotApproval({ snapshot, account, operation, copy }: { snapshot: CreatorEvidence["snapshots"][number]; account: EvidenceAccount; operation: EvidenceOperation; copy: Copy }) {
  const fields = snapshotFields(snapshot), [choices, setChoices] = useState<Record<string, Visibility>>({});
  const savedVisibility = evidenceObject(account.fieldVisibility);
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); const visibility = Object.fromEntries(fields.map(field => [field, choices[field] ?? "PRIVATE"]));
    void operation.command("METRICS_APPROVE", { expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision, visibility }, snapshot.id);
  }}>
    <p className={styles.muted}>{copy("هذه موافقتك على البيانات ومشاركتها؛ لا تغيّر مصدرها إلى إثبات تمت مراجعته. الاختيار الخاص هو الافتراضي لكل حقل.", "This approves your data and sharing; it does not change the source to reviewed evidence. Each field defaults to private.")}</p>
    {fields.map(field => <div key={field}>
      <VisibilitySelect label={`${copy("مشاركة", "Share")} · ${fieldLabel(field, copy)}`} value={choices[field] ?? "PRIVATE"} onChange={value => setChoices(previous => ({ ...previous, [field]: value }))} disabled={operation.blocked} />
      <p className={styles.fileNote}>{copy("إعداد الحقل الحالي على الحساب:", "Current account field setting:")} <bdi>{evidenceText(savedVisibility[field]) ?? "PRIVATE"}</bdi></p>
    </div>)}
    <div><Button type="submit" disabled={operation.blocked || !fields.length}>{copy("موافقة على الإحصاءات والمشاركة", "Approve metrics and sharing")}</Button></div>
  </form>;
}
function CorrectionApproval({ correction, account, operation, copy }: { correction: CreatorEvidence["corrections"][number]; account: EvidenceAccount; operation: EvidenceOperation; copy: Copy }) {
  const [visibility, setVisibility] = useState<Visibility>("PRIVATE");
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); void operation.command("CORRECTION_APPROVE", { expectedRevision: correction.revision, expectedMappingRevision: account.mappingRevision, visibility }, correction.id); }}>
    <VisibilitySelect label={copy("مشاركة التصحيح", "Correction sharing")} value={visibility} onChange={setVisibility} disabled={operation.blocked} />
    <div><Button type="submit" disabled={operation.blocked}>{copy("موافقة على التصحيح والمشاركة", "Approve correction and sharing")}</Button></div>
  </form>;
}
function OwnershipProofForm({ challenge, data, operation, copy }: { challenge: CreatorEvidence["challenges"][number]; data: CreatorEvidence; operation: EvidenceOperation; copy: Copy }) {
  const [assetId, setAssetId] = useState("");
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!data.assets.some(asset => asset.id === assetId && asset.purpose === "OWNERSHIP_PROOF")) return;
    void operation.command("OWNERSHIP_SUBMIT", { expectedRevision: challenge.revision, assetId }, challenge.id, () => setAssetId(""));
  }}>
    <p className={styles.muted}>{copy("أظهر الرمز في الحساب المحدد والتقط إثباتًا واضحًا لهوية الحساب والرمز. لا تتشارك كلمة مرور الحساب. صلاحية الرمز والحساب تُراجع عند الإرسال.", "Show the code on the selected account and capture clear evidence of its identity and code. Do not share the account password. Code expiry and account scope are checked on submission.")}</p>
    <EvidenceAssetInput assets={data.assets} purpose="OWNERSHIP_PROOF" value={assetId} onChange={setAssetId} operation={operation} label={copy("إثبات ملكية الحساب", "Account ownership evidence")} />
    <div><Button type="submit" disabled={operation.blocked || !assetId}>{copy("إرسال إثبات الملكية", "Submit ownership proof")}</Button></div>
  </form>;
}

export function CreatorEvidenceScreen({ initial, initialError, countryCode }: { initial: CreatorEvidence | null; initialError?: string; countryCode: string | null }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [data, setData] = useState(initial), [loadError, setLoadError] = useState(initialError ?? null), [selectedId, setSelectedId] = useState(initial?.accounts[0]?.id ?? "");
  async function refreshData() { const current = await evidenceRead<CreatorEvidence>("/api/evidence"); setData(current); setLoadError(null); }
  const operation = useEvidenceOperation(refreshData);
  const account = data?.accounts.find(row => row.id === selectedId) ?? null;
  const title = copy("إثباتاتي وبياناتي", "My evidence and metrics");
  return <section className={styles.page}>
    <header className={styles.header}><div><h1 className={styles.title}>{title}</h1><p className={styles.subtitle}>{copy("إثبات الحساب والبيانات والمشاركة، ضمن ملفك.", "Account evidence, metrics and sharing within your profile.")}</p></div>
      <Button variant="outline" disabled={operation.busy} onClick={() => void operation.refresh()}>{copy("تحديث السجل", "Refresh history")}</Button>
    </header>
    <EvidenceFeedback operation={operation} initialError={loadError} isAr={isAr} />
    {!data ? <div className={`${styles.panel} ${styles.empty}`}><h2>{loadError ? copy("تعذر تحميل الإثباتات", "Evidence could not be loaded") : copy("أكمل ملفك أولًا", "Complete your profile first")}</h2><p className={styles.muted}>{copy("أضف حسابك ومعلوماتك من إعداد الملف، ثم تابع الإثبات من هنا.", "Add your account and information in profile setup, then continue evidence here.")}</p><div><Button asChild variant="outline"><Link href="/creator/onboarding">{copy("إعداد ملفي", "Set up my profile")}</Link></Button></div></div> : <>
      <section className={styles.identity} aria-label={copy("الحساب المحدد", "Selected account")}>
        <div className={styles.avatar} aria-hidden="true">@</div>
        <div className={styles.identityDetails}><h2 className={styles.name}>{copy("حساب التواصل", "Social account")}</h2><div className={styles.spaced}>
          <EvidenceSelect label={copy("الحساب الذي يخصه الإثبات", "Account covered by evidence")} value={selectedId} onChange={setSelectedId} disabled={operation.blocked} ltr options={[
            { value: "", label: copy("اختر حسابًا محفوظًا", "Choose a saved account") }, ...data.accounts.map(row => ({ value: row.id, label: `${row.platform} · @${row.handle}` })),
          ]} />
        </div></div><Link href="/creator/onboarding" className={styles.link}>{copy("إعداد الحساب والإذن", "Set up account and permission")}</Link>
        <p className={styles.muted}>{copy("تأكيد أن الحساب لك وإذن استخدام بياناته يتمان في إعداد الملف. كل نموذج أدناه يخص الحساب المحدد، باستثناء نطاق الترخيص الذي تختاره صراحةً.", "Account confirmation and data permission are set in profile setup. Each form below covers the selected account, except the explicitly selected licence scope.")}</p>
      </section>
      {!account && <section className={`${styles.panel} ${styles.empty}`}><h2>{copy("اختر حسابًا للمتابعة", "Choose an account to continue")}</h2><p className={styles.muted}>{copy("إذا ما عندك حساب محفوظ، أضفه من إعداد الملف. النصوص غير المرسلة تبقى في النموذج أثناء تحديث السجل.", "If you have no saved account, add it in profile setup. Unsubmitted text stays in the form when history is refreshed.")}</p></section>}
      <div className={styles.panels}>
        {account && <>
          <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="evidence-ownership-title"><div className={styles.panelHeader}><h2 id="evidence-ownership-title" className={styles.panelTitle}>{copy("إثبات ملكية الحساب", "Prove account ownership")}</h2></div>
            <p className={`${styles.muted} ${styles.description}`}>{copy("أنشئ رمزًا لهذا الحساب، ثم أرسل ملف الإثبات الخاص. الحالة المحفوظة تصف المراجعة السابقة؛ ليست ضمانًا لقبول الإثبات حاليًا.", "Create a code for this account, then submit private evidence. Saved status describes prior review; it does not guarantee current acceptance.")}</p>
            <dl className={styles.facts}><EvidenceFact label={copy("الحساب", "Account")}><bdi dir="ltr">{account.platform} · @{account.handle}</bdi></EvidenceFact><EvidenceFact label={copy("حالة المراجعة المحفوظة للحساب", "Saved account review status")}><bdi>{account.ownershipStatus}</bdi></EvidenceFact></dl>
            <Button disabled={operation.blocked} onClick={() => void operation.command("OWNERSHIP_START", { accountId: account.id, expectedMappingRevision: account.mappingRevision, expectedEvidenceRevision: account.evidenceRevision })}>{copy("إنشاء رمز إثبات الملكية", "Create ownership code")}</Button>
            <div className={styles.history}>{data.challenges.filter(row => row.accountId === account.id).length ? <ul className={styles.list}>{data.challenges.filter(row => row.accountId === account.id).map(challenge => <li key={challenge.id}><article data-evidence-id={challenge.id} className={styles.item}>
              <h3 className={styles.itemHeading}>{copy("رمز الملكية المحفوظ", "Saved ownership code")}</h3><bdi dir="ltr" className={styles.code}>{challenge.challengeCode}</bdi>
              <dl className={styles.facts}><EvidenceFact label={copy("الحالة المحفوظة", "Saved status")}><bdi>{challenge.status}</bdi></EvidenceFact><EvidenceFact label={copy("انتهاء الرمز", "Code expiry")}>{evidenceDate(challenge.expiresAt)}</EvidenceFact><EvidenceFact label={copy("وقت الإرسال", "Submitted at")}>{evidenceDate(challenge.submittedAt)}</EvidenceFact><EvidenceFact label={copy("وقت المراجعة", "Reviewed at")}>{evidenceDate(challenge.reviewedAt)}</EvidenceFact><EvidenceFact label={copy("هوية الحساب الأصلية", "Original account identity")}><SavedMetricValue value={challenge.identity} copy={copy} /></EvidenceFact></dl>
              <ReviewNote note={challenge.reviewNote} copy={copy} /><Attachment id={challenge.proofAssetId} copy={copy} />
              {challenge.mappingRevision !== account.mappingRevision && <p className={styles.muted}>{copy("هذا الرمز يخص هوية سابقة للحساب. أنشئ رمزًا للهوية الحالية.", "This code covers a previous account identity. Create a code for the current identity.")}</p>}
              {challenge.status === "PENDING" && !challenge.submittedAt && challenge.mappingRevision === account.mappingRevision && <div className={styles.spaced}><OwnershipProofForm challenge={challenge} data={data} operation={operation} copy={copy} /></div>}
            </article></li>)}</ul> : <p className={styles.muted}>{copy("لا يوجد رمز محفوظ لهذا الحساب حتى الآن.", "No saved code for this account yet.")}</p>}</div>
          </section>
          <ScreenshotForm account={account} assets={data.assets} operation={operation} />
          <CorrectionForm account={account} operation={operation} />
          <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="evidence-metric-history-title"><div className={styles.panelHeader}><h2 id="evidence-metric-history-title" className={styles.panelTitle}>{copy("سجل الإحصاءات الخاص", "Private metrics history")}</h2></div>
            <p className={`${styles.muted} ${styles.description}`}>{copy("كل ملاحظة تحتفظ بمصدرها وتاريخ رصدها. موافقتك لا تجعل SELF_REPORTED مصدرًا موثقًا؛ السجلات المستبعدة تبقى تاريخًا ولا تُعامل كإثبات مقبول.", "Each observation retains its source and observation date. Your approval does not verify SELF_REPORTED evidence; excluded records remain history and are not accepted evidence.")}</p>
            {data.snapshots.filter(row => row.accountId === account.id).length ? <ul className={styles.list}>{data.snapshots.filter(row => row.accountId === account.id).map(snapshot => <li key={snapshot.id}><article data-evidence-id={snapshot.id} className={styles.item}>
              <h3 className={styles.itemHeading}>{copy("ملاحظة إحصاءات محفوظة", "Saved metrics observation")}</h3>
              <dl className={styles.facts}><EvidenceFact label={copy("المصدر المحفوظ", "Saved source")}><bdi>{snapshot.source}</bdi></EvidenceFact><EvidenceFact label={copy("حالة المراجعة المحفوظة", "Saved review status")}><bdi>{snapshot.reviewStatus}</bdi></EvidenceFact><EvidenceFact label={copy("وقت الرصد", "Observed at")}>{evidenceDate(snapshot.observedAt)}</EvidenceFact><EvidenceFact label={copy("وقت الحفظ", "Saved at")}>{evidenceDate(snapshot.importedAt)}</EvidenceFact><EvidenceFact label={copy("وقت الاعتماد المحفوظ", "Saved approval at")}>{evidenceDate(snapshot.approvedAt)}</EvidenceFact><EvidenceFact label={copy("وقت الاستبعاد", "Excluded at")}>{evidenceDate(snapshot.excludedAt)}</EvidenceFact><EvidenceFact label={copy("المتابعون", "Followers")}><SavedMetricValue value={snapshot.followers} copy={copy} /></EvidenceFact><EvidenceFact label={copy("متوسط المشاهدات", "Average views")}><SavedMetricValue value={snapshot.averageViews} copy={copy} /></EvidenceFact><EvidenceFact label={copy("نسبة التفاعل %", "Engagement rate %")}><SavedMetricValue value={snapshot.engagementRate} copy={copy} /></EvidenceFact></dl>
              <details className={styles.disclosure}><summary>{copy("السياق وبيانات الجمهور المحفوظة", "Saved context and audience data")}</summary>
                <p className={`${styles.muted} ${styles.description}`}>{copy("حدود الظهور هنا تخص الملاحظة الأصلية، ولا تعني أن الحقول منشورة. مشاركة الحقول الحالية تُختار بموافقتك المنفصلة على الحساب.", "Visibility limits here belong to the original observation and do not mean the fields are published. Current field sharing is chosen through your separate account approval.")}</p>
                <h4 className={styles.sectionTitle}>{copy("سياق التفاعل", "Engagement context")}</h4><SavedMetricValue value={snapshot.engagementContext} copy={copy} />
                <h4 className={styles.sectionTitle}>{copy("بيانات الجمهور", "Audience data")}</h4><SavedMetricValue value={snapshot.demographics} copy={copy} />
                <h4 className={styles.sectionTitle}>{copy("قياسات التنسيقات", "Format metrics")}</h4><SavedMetricValue value={snapshot.formatMetrics} copy={copy} />
              </details>
              <Attachment id={snapshot.evidenceAssetId} copy={copy} />
              {!!snapshot.reviewHistory.length && <div className={styles.spaced}><h4 className={styles.sectionTitle}>{copy("تاريخ مراجعة الإثبات", "Evidence review history")}</h4><ul className={styles.list}>{snapshot.reviewHistory.map((review, index) => <li key={index} className={styles.item}><p className={styles.itemHeading}><bdi>{review.decision}</bdi> · {evidenceDate(review.reviewedAt)}</p><ReviewNote note={review.note} copy={copy} /></li>)}</ul></div>}
              {!snapshot.excludedAt && snapshot.mappingRevision === account.mappingRevision && ["PENDING", "VERIFIED"].includes(snapshot.reviewStatus) && <details className={styles.disclosure}><summary>{copy("مراجعة البيانات واختيار المشاركة", "Review data and choose sharing")}</summary><SnapshotApproval snapshot={snapshot} account={account} operation={operation} copy={copy} /></details>}
            </article></li>)}</ul> : <p className={styles.muted}>{copy("لا توجد ملاحظات إحصاءات محفوظة لهذا الحساب.", "No saved metrics observations for this account.")}</p>}
          </section>
          <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="evidence-correction-history-title"><div className={styles.panelHeader}><h2 id="evidence-correction-history-title" className={styles.panelTitle}>{copy("سجل التصحيحات الخاص", "Private correction history")}</h2></div>
            {data.corrections.filter(row => row.accountId === account.id).length ? <ul className={styles.list}>{data.corrections.filter(row => row.accountId === account.id).map(correction => <li key={correction.id}><article data-evidence-id={correction.id} className={styles.item}>
              <h3 className={styles.itemHeading}>{fieldLabel(correction.field, copy)}</h3><dl className={styles.facts}><EvidenceFact label={copy("المصدر", "Source")}><bdi>{correction.source}</bdi></EvidenceFact><EvidenceFact label={copy("تاريخ الرصد", "Observation date")}>{evidenceDate(correction.evidenceAt)}</EvidenceFact><EvidenceFact label={copy("موافقتك المحفوظة", "Saved owner approval")}>{evidenceDate(correction.approvedAt)}</EvidenceFact><EvidenceFact label={copy("المشاركة المحفوظة", "Saved sharing")}><bdi>{correction.visibility}</bdi></EvidenceFact></dl>
              <SavedMetricValue value={correction.value} copy={copy} />{correction.context !== null && <details className={styles.disclosure}><summary>{copy("سياق التصحيح المحفوظ", "Saved correction context")}</summary><SavedMetricValue value={correction.context} copy={copy} /></details>}
              {correction.mappingRevision === account.mappingRevision ? <div className={styles.spaced}><CorrectionApproval correction={correction} account={account} operation={operation} copy={copy} /></div> : <p className={styles.muted}>{copy("التصحيح يخص هوية حساب سابقة؛ أضف تصحيحًا جديدًا للهوية الحالية.", "The correction covers a previous account identity; submit a new correction for the current identity.")}</p>}
            </article></li>)}</ul> : <p className={styles.muted}>{copy("لا توجد تصحيحات محفوظة لهذا الحساب.", "No saved corrections for this account.")}</p>}
          </section>
        </>}
        <LicenceForm data={data} operation={operation} countryCode={countryCode} />
        <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="evidence-licence-history-title"><div className={styles.panelHeader}><h2 id="evidence-licence-history-title" className={styles.panelTitle}>{copy("سجل التراخيص الخاص", "Private licence history")}</h2></div>
          <p className={`${styles.muted} ${styles.description}`}>{copy("الحالة المحفوظة تصف السجل السابق فقط. القبول الحالي يعتمد على نطاق الحساب والوثيقة والسياسة والصلاحية في الخادم.", "Saved status describes the historical record only. Current acceptance depends on account scope, document, policy and validity checks on the server.")}</p>
          {data.licences.length ? <ul className={styles.list}>{data.licences.map(licence => <li key={licence.id}><article data-evidence-id={licence.id} className={styles.item}><h3 dir="auto" className={styles.itemHeading}>{licence.issuer}</h3>
            <dl className={styles.facts}><EvidenceFact label={copy("الحالة المحفوظة", "Saved status")}><bdi>{licence.status}</bdi></EvidenceFact><EvidenceFact label={copy("بلد الترخيص", "Licence jurisdiction")}><bdi>{licence.jurisdiction}</bdi></EvidenceFact><EvidenceFact label={copy("حامل الترخيص", "Licence holder")}><span dir="auto">{licence.holderName}</span></EvidenceFact><EvidenceFact label={copy("رقم الترخيص", "Licence number")}><span dir="auto">{licence.licenceNumber}</span></EvidenceFact><EvidenceFact label={copy("نوع الترخيص", "Licence type")}><span dir="auto">{licence.type}</span></EvidenceFact><EvidenceFact label={copy("النطاق الأصلي", "Original scope")}><span dir="auto">{licence.scope}</span></EvidenceFact><EvidenceFact label={copy("بداية الصلاحية", "Valid from")}>{evidenceDate(licence.validFrom)}</EvidenceFact><EvidenceFact label={copy("انتهاء الصلاحية", "Expires at")}>{evidenceDate(licence.expiresAt)}</EvidenceFact><EvidenceFact label={copy("المنصات المشمولة", "Covered platforms")}><bdi dir="ltr">{licence.platformScope.join(" / ")}</bdi></EvidenceFact><EvidenceFact label={copy("المراجعة المحفوظة", "Saved review")}>{evidenceDate(licence.reviewedAt)}</EvidenceFact></dl>
            <h4 className={styles.sectionTitle}>{copy("الحسابات المشمولة", "Covered accounts")}</h4><ul className={styles.list}>{licence.accountIds.map(id => { const saved = data.accounts.find(row => row.id === id); return <li key={id}><bdi dir="ltr">{saved ? `${saved.platform} · @${saved.handle}` : id}</bdi>{saved && <span> · {copy("اسم الحساب الحالي؛ نطاق الهوية الأصلي يُراجع في الخادم", "current account label; original identity scope is checked on the server")}</span>}</li>; })}</ul>
            <ReviewNote note={licence.reviewNote} copy={copy} /><Attachment id={licence.evidenceAssetId} copy={copy} />
          </article></li>)}</ul> : <p className={styles.muted}>{copy("لا توجد تراخيص محفوظة حتى الآن.", "No saved licences yet.")}</p>}
        </section>
      </div>
    </>}
  </section>;
}
