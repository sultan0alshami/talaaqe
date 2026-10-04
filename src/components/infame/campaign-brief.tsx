"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import styles from "./campaign-brief.module.css";

export type BriefRequirementRow = { key: string; label: string; value: ReactNode };

// Only presentation groups: every row from the existing requirement projection
// remains visible, including empty preferences and future ungrouped fields.
const summaryKeys = ["title", "summary", "productService", "goal", "originalLanguage"];
const scopeKeys = ["marketCountryCodes", "targetAgeBuckets", "targetGenders", "targetCountryCodes", "targetCityKeys", "deliverables"];
const contentKeys = ["tone", "noGoTopics", "usageRights", "kpis", "assumptions"];
const budgetKeys = ["budget", "period", "desiredCreatorCount", "impressionsTarget"];
const nicheKeys = ["nicheSlugs", "contentLanguages", "dialects"];
const criteriaKeys = ["preferredTiers", "physicalPresenceRequired", "presenceCountryCodes", "travelAllowed", "dataVerificationRequired", "preferredLicencePolicyIds"];
const questionKeys = ["openQuestions"];
const groupedKeys = new Set([...summaryKeys, ...scopeKeys, ...contentKeys, ...budgetKeys, ...nicheKeys, ...criteriaKeys, ...questionKeys]);

function Rows({ rows }: { rows: BriefRequirementRow[] }) {
  return <dl className={styles.rows}>{rows.map(row => <div key={row.key} className={`${styles.row} ${row.key === "deliverables" ? styles.deliverables : ""}`}>
    <dt>{row.label}</dt><dd>{row.value}</dd>
  </div>)}</dl>;
}

export function CampaignBrief({ title, version, status, rows, children }: {
  title: string;
  version: number;
  status: ReactNode;
  rows: BriefRequirementRow[];
  children: ReactNode;
}) {
  const { isAr } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const select = (keys: string[]) => keys.flatMap(key => rows.filter(row => row.key === key));
  const other = rows.filter(row => !groupedKeys.has(row.key));
  return <article className={styles.snapshot}>
    <header className={styles.snapshotHeader}>
      <div>
        <h2 dir="auto" className={styles.title}>{title}</h2>
        <h3 className={styles.version}>{copy("نسخة الموجز", "Brief version")} {version}</h3>
      </div>
      <p className={styles.status}>{status}</p>
    </header>
    <div className={styles.columns}>
      <div className={styles.column}>
        <section className={styles.card} aria-label={copy("الملخص والهدف", "Summary and objective")}><Rows rows={select(summaryKeys)} /></section>
        <section className={styles.card} aria-label={copy("نطاق الحملة والمحتوى المطلوب", "Campaign scope and deliverables")}><Rows rows={select(scopeKeys)} /></section>
        <section className={styles.card} aria-label={copy("متطلبات المحتوى", "Content requirements")}><Rows rows={select(contentKeys)} /></section>
        {!!other.length && <section className={styles.card} aria-label={copy("تفاصيل إضافية", "Additional requirements")}><Rows rows={other} /></section>}
      </div>
      <aside className={styles.column} aria-label={copy("ميزانية الحملة وشروطها", "Campaign budget and criteria")}>
        <section className={styles.budget}><Rows rows={select(budgetKeys)} /></section>
        <section className={`${styles.card} ${styles.railCard}`} aria-label={copy("التخصصات واللغات", "Niches and languages")}><Rows rows={select(nicheKeys)} /></section>
        <section className={`${styles.card} ${styles.railCard}`} aria-label={copy("معايير صناع المحتوى", "Creator criteria")}><Rows rows={select(criteriaKeys)} /></section>
        <section className={`${styles.card} ${styles.questions}`} aria-label={copy("الأسئلة المفتوحة", "Open questions")}><Rows rows={select(questionKeys)} /></section>
      </aside>
    </div>
    <div className={styles.review}>{children}</div>
  </article>;
}
