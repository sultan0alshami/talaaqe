"use client";
// Navy public footer (shells spec §2.2).
import { InfameMark } from "./mark";
import Link from "next/link";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

export function PublicFooter() {
  const { t } = useI18n();
  const linkStyle: React.CSSProperties = { fontSize: 13.5, color: "var(--classic-footer-link)", cursor: "pointer", textDecoration: "none" };
  const headStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--classic-footer-muted)", marginBottom: 4 };

  return (
    <footer className={styles.footer} style={{ background: "var(--classic-deep)", color: "var(--classic-inverse)" }}>
      <div className={styles.footerGrid}
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "52px 24px 36px",
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr",
          gap: 40,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ background: "var(--classic-card)", borderRadius: 10, padding: 5, display: "inline-flex" }}>
              <InfameMark width={28} height={27} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 18 }}>{t.brand}</span>
          </div>
          <p style={{ fontSize: 13.5, color: "var(--classic-footer-muted)", maxWidth: 340, margin: 0 }}>{t.positioning}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={headStyle}>{t.footerLinks1}</div>
          <Link href="/classic#tq-how" style={linkStyle}>
            {t.navHow}
          </Link>
          <Link href="/classic#tq-cats" style={linkStyle}>
            {t.navCats}
          </Link>
          <Link href="/classic#tq-pricing" style={linkStyle}>
            {t.navPricing}
          </Link>
          <Link href="/classic/for-brands" style={linkStyle}>
            {t.navClients}
          </Link>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={headStyle}>{t.footerLinks2}</div>
          <Link href="/classic/about" style={linkStyle}>
            {t.footerAbout}
          </Link>
          <Link href="/classic/for-creators" style={linkStyle}>
            {t.navProviders}
          </Link>
          <Link href="/classic/contact" style={linkStyle}>
            {t.footerContact}
          </Link>
          <Link href="/classic/terms" style={linkStyle}>{t.footerTerms}</Link>
          <Link href="/classic/privacy" style={linkStyle}>{t.footerPrivacy}</Link>
          <Link href="/" style={linkStyle}>{t.originalVersion}</Link>
        </div>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            fontSize: 12.5,
            color: "var(--classic-footer-muted)",
          }}
        >
          <span>{t.footerRights}</span>
          <span>{t.footerMade}</span>
        </div>
      </div>
    </footer>
  );
}
