"use client";
// Public "For providers" page (public-screens spec §5, prototype lines 364–398).
import Link from "next/link";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

export function ForCreatorsScreen() {
  const { t } = useI18n();

  return (
    <div className={styles.information} style={{ maxWidth: 1180, margin: "0 auto", padding: "76px 24px 96px" }}>
      <div style={{ textAlign: "center", maxWidth: 700, margin: "0 auto 52px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--classic-accent-ink)", marginBottom: 12 }}>
          {t.fpKicker}
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, margin: "0 0 18px", color: "var(--classic-deep)", lineHeight: 1.4 }}>
          {t.fpTitle}
        </h1>
        <p style={{ fontSize: 16.5, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.fpLead}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 48 }}>
        {t.fpBenefits.map((b, i) => (
          <div
            key={i}
            style={{
              background: "var(--classic-card)",
              border: "1px solid var(--classic-border)",
              borderRadius: 18,
              padding: 28,
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "var(--classic-tint)",
                color: "var(--classic-ink)",
                fontSize: 13,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              ✓
            </span>
            <div>
              <div style={{ fontSize: 16.5, fontWeight: 700, marginBottom: 5 }}>{b.t}</div>
              <div style={{ fontSize: 14, color: "var(--classic-muted)", lineHeight: 1.8 }}>{b.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, marginBottom: 48 }}>
        {t.fpSteps.map((st, i) => (
          <div
            key={i}
            style={{
              background: "linear-gradient(160deg, var(--classic-ink), var(--classic-deep))",
              borderRadius: 18,
              padding: "28px 24px",
              color: "var(--classic-inverse)",
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                background: "rgba(255,255,255,.14)",
                color: "var(--classic-yellow)",
                fontSize: 15,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              {i + 1}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{st.t}</div>
            <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.75)", lineHeight: 1.8 }}>{st.d}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center" }}>
        <Link
          href="/classic/signup?role=creator"
          className="hover:opacity-90"
          style={{
            display: "inline-block",
            background: "var(--classic-accent-ink)",
            color: "var(--classic-inverse)",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: 700,
            padding: "15px 34px",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(14,122,129,.3)",
            textDecoration: "none",
          }}
        >
          {t.joinCta}
        </Link>
      </div>
    </div>
  );
}
