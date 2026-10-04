"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { countryLabel } from "@/lib/contracts/country-labels";
import type { BrandEvidence } from "@/lib/evidence/client-contracts";
import { useI18n } from "@/lib/i18n";
import { evidenceRead, useEvidenceOperation } from "./evidence-client";
import { Attachment, EvidenceAssetInput, EvidenceFact, EvidenceFeedback, EvidenceField, ReviewNote, evidenceDate, evidenceUtc, type Copy, type EvidenceOperation } from "./creator-evidence-forms";
import styles from "./evidence-owner.module.css";

type BusinessKind = "REPRESENTATIVE" | "BUSINESS_REGISTRATION";
function kindLabel(kind: string, copy: Copy) { return kind === "REPRESENTATIVE" ? copy("صلاحية تمثيل الشركة", "Company representation authority") : kind === "BUSINESS_REGISTRATION" ? copy("تسجيل الشركة", "Business registration") : kind; }
function BusinessProofForm({ kind, data, countryCode, operation, copy }: { kind: BusinessKind; data: BrandEvidence; countryCode: string | null; operation: EvidenceOperation; copy: Copy }) {
  const { isAr } = useI18n();
  const [identifier, setIdentifier] = useState(""), [assetId, setAssetId] = useState(""), [expiresAt, setExpiresAt] = useState(""), [error, setError] = useState<string | null>(null);
  const representative = kind === "REPRESENTATIVE", headingId = representative ? "brand-representative-title" : "brand-registration-title";
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    try {
      if (!countryCode || !identifier.trim() || !data.assets.some(asset => asset.id === assetId && asset.purpose === kind)) throw new Error("SCOPE");
      const expiry = expiresAt ? evidenceUtc(expiresAt) : undefined;
      void operation.command("BUSINESS_SUBMIT", { brandId: data.brandId, kind, jurisdiction: countryCode, identifier, evidenceAssetId: assetId, ...(expiry ? { expiresAt: expiry } : {}) }, undefined,
        () => { setIdentifier(""); setAssetId(""); setExpiresAt(""); });
    } catch { setError(copy("راجع بلد الشركة والمعرّف والوثيقة وتاريخ الانتهاء إن وجد.", "Check company country, reference, document and expiry date if present.")); }
  }
  return <section className={styles.panel} aria-labelledby={headingId} data-evidence-kind={kind}>
    <div className={styles.panelHeader}><h2 id={headingId} className={styles.panelTitle}>{kindLabel(kind, copy)}</h2></div>
    <p className={`${styles.muted} ${styles.description}`}>{representative
      ? copy("أرسل وثيقة تثبت صلاحيتك لتمثيل هذه الشركة. تسجيل الشركة وحده لا يثبت التمثيل.", "Submit a document showing your authority to represent this company. Business registration alone does not prove representation.")
      : copy("أرسل وثيقة تسجيل الشركة ضمن بلدها المحفوظ. هذه المراجعة منفصلة عن صلاحية تمثيل الشركة.", "Submit business registration for the saved company country. This review is separate from representation authority.")}</p>
    <form className={styles.form} onSubmit={submit}>
      <dl className={styles.facts}><EvidenceFact label={copy("بلد الشركة ونطاق الوثيقة", "Company country and document jurisdiction")}>{countryCode ? countryLabel(countryCode, isAr ? "ar" : "en") : copy("غير محدد — أكمله في إعداد الملف", "Not set — complete it in profile setup")}</EvidenceFact></dl>
      <EvidenceField label={representative ? copy("مرجع صلاحية التمثيل", "Representation authority reference") : copy("رقم تسجيل الشركة", "Business registration number")} value={identifier} onChange={setIdentifier} required disabled={operation.blocked} hint={copy("اكتب المعرّف الأصلي كما في الوثيقة. يبقى خاصًا.", "Enter the original reference as shown in the document. It stays private.")} />
      <EvidenceField label={representative ? copy("انتهاء وثيقة التمثيل (UTC، اختياري)", "Representation document expiry (UTC, optional)") : copy("انتهاء وثيقة التسجيل (UTC، اختياري)", "Registration document expiry (UTC, optional)")} value={expiresAt} onChange={setExpiresAt} type="datetime-local" disabled={operation.blocked} hint={copy("اتركه فارغًا إذا لم تحدد الوثيقة تاريخ انتهاء؛ لا تفترض تاريخًا.", "Leave blank if the document has no expiry; do not assume a date.")} />
      <EvidenceAssetInput assets={data.assets} purpose={kind} value={assetId} onChange={setAssetId} operation={operation} label={representative ? copy("وثيقة التمثيل الخاصة", "Private representation document") : copy("وثيقة التسجيل الخاصة", "Private registration document")} />
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      <div><Button type="submit" disabled={operation.blocked || !countryCode || !assetId}>{representative ? copy("إرسال التمثيل للمراجعة", "Submit representation for review") : copy("إرسال التسجيل للمراجعة", "Submit registration for review")}</Button></div>
    </form>
  </section>;
}

export function BrandEvidenceScreen({ initial, initialError, countryCode }: { initial: BrandEvidence | null; initialError?: string; countryCode: string | null }) {
  const { isAr } = useI18n(), copy: Copy = (ar, en) => isAr ? ar : en;
  const [data, setData] = useState(initial), [loadError, setLoadError] = useState(initialError ?? null);
  async function refreshData() { const current = await evidenceRead<BrandEvidence>("/api/evidence"); setData(current); setLoadError(null); }
  const operation = useEvidenceOperation(refreshData);
  return <section className={`${styles.page} ${styles.brand}`}>
    <header className={styles.header}><div><h1 className={styles.title}>{copy("إثباتات الشركة", "Company evidence")}</h1><p className={styles.subtitle}>{copy("وثائق خاصة ومراجعات محفوظة ضمن ملف الشركة.", "Private documents and saved reviews within your company profile.")}</p></div>
      <Button variant="outline" disabled={operation.busy} onClick={() => void operation.refresh()}>{copy("تحديث السجل", "Refresh history")}</Button>
    </header>
    <EvidenceFeedback operation={operation} initialError={loadError} isAr={isAr} />
    {!data ? <div className={`${styles.panel} ${styles.empty}`}><h2>{loadError ? copy("تعذر تحميل إثباتات الشركة", "Company evidence could not be loaded") : copy("أكمل ملف الشركة أولًا", "Complete your company profile first")}</h2><p className={styles.muted}>{copy("احفظ معلومات الشركة وبلدها ثم تابع الوثائق من هنا.", "Save company information and country, then continue documents here.")}</p><div><Button asChild variant="outline"><Link href="/brand/onboarding">{copy("إعداد ملف الشركة", "Set up company profile")}</Link></Button></div></div> : <>
      <section className={styles.identity} aria-label={copy("نطاق إثباتات الشركة", "Company evidence scope")}><div className={styles.avatar} aria-hidden="true">{copy("ش", "C")}</div><div className={styles.identityDetails}><h2 className={styles.name}>{copy("التمثيل والتسجيل خطوتان منفصلتان", "Representation and registration are separate steps")}</h2><p className={`${styles.muted} ${styles.spaced}`}>{copy("الوثائق والمعلومات هنا خاصة. الإرسال لا ينشر الشركة تلقائيًا، والحالة المحفوظة تصف مراجعة سابقة وليست قبولًا حاليًا.", "Documents and information here are private. Submission does not publish the company automatically; saved status describes a previous review, not current acceptance.")}</p></div><Link className={styles.link} href="/brand/onboarding">{copy("إعداد ملف الشركة", "Set up company profile")}</Link></section>
      <div className={styles.panels}>
        <BusinessProofForm kind="REPRESENTATIVE" data={data} countryCode={countryCode} operation={operation} copy={copy} />
        <BusinessProofForm kind="BUSINESS_REGISTRATION" data={data} countryCode={countryCode} operation={operation} copy={copy} />
        <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="brand-evidence-history-title"><div className={styles.panelHeader}><h2 id="brand-evidence-history-title" className={styles.panelTitle}>{copy("سجل إثباتات الشركة الخاص", "Private company evidence history")}</h2></div>
          {data.verifications.length ? <ul className={styles.list}>{data.verifications.map(verification => <li key={verification.id}><article data-evidence-id={verification.id} data-evidence-kind={verification.kind} className={styles.item}>
            <h3 className={styles.itemHeading}>{kindLabel(verification.kind, copy)}</h3><dl className={styles.facts}>
              <EvidenceFact label={copy("المعرّف الأصلي", "Original reference")}><span dir="auto">{verification.identifier}</span></EvidenceFact><EvidenceFact label={copy("بلد الوثيقة", "Document jurisdiction")}><bdi>{verification.jurisdiction}</bdi></EvidenceFact><EvidenceFact label={copy("الحالة المحفوظة", "Saved status")}><bdi>{verification.status}</bdi></EvidenceFact><EvidenceFact label={copy("تاريخ المراجعة", "Review date")}>{evidenceDate(verification.reviewedAt)}</EvidenceFact><EvidenceFact label={copy("انتهاء الوثيقة", "Document expiry")}>{evidenceDate(verification.expiresAt)}</EvidenceFact>
            </dl><ReviewNote note={verification.reviewNote} copy={copy} /><Attachment id={verification.evidenceAssetId} copy={copy} />
          </article></li>)}</ul> : <p className={styles.muted}>{copy("لا توجد إثباتات شركة محفوظة حتى الآن.", "No saved company evidence yet.")}</p>}
        </section>
      </div>
    </>}
  </section>;
}
