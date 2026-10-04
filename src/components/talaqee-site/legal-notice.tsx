"use client";

import Link from "next/link";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

export function LegalNotice({ kind }: { kind: "terms" | "privacy" }) {
  const { t, isAr } = useI18n();
  const title = kind === "terms" ? t.footerTerms : t.footerPrivacy;
  return <article className={styles.information} style={{ maxWidth: 1180, margin: "0 auto", padding: "76px 24px 96px" }}>
    <header style={{ maxWidth: 760, margin: "0 auto 56px", textAlign: "center" }}>
      <h1 style={{ fontSize: 40, fontWeight: 700, margin: "0 0 18px", lineHeight: 1.4 }}>{title}</h1>
    </header>
    <div style={{ maxWidth: 760, margin: "0 auto", background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 20, padding: 34 }}>
      <p>{isAr ? "النسخة المعتمدة من هذه الوثيقة لم تُنشر بعد. هذا الموقع متاح لمراجعة تجربة إنفيم." : "The approved version of this document has not been published. This website is available for reviewing the Infame experience."}</p>
      <Link href="/classic/contact" style={{ color: "var(--classic-ink)", textDecoration: "underline", display: "inline-flex", minHeight: 44, alignItems: "center" }}>{t.footerContact}</Link>
    </div>
  </article>;
}
