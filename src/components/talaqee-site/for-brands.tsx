"use client";
// Public "For clients" page (public-screens spec §4, prototype lines 326–361).
import Link from "next/link";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

export function ForBrandsScreen() {
  const { t, arrowChar } = useI18n();
  const pipeSteps = [t.pipe1, t.pipe2, t.pipe3, t.pipe4, t.pipe5];

  return (
    <div className={styles.information} style={{ maxWidth: 1180, margin: "0 auto", padding: "76px 24px 96px" }}>
      <div style={{ textAlign: "center", maxWidth: 700, margin: "0 auto 52px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--classic-accent-ink)", marginBottom: 12 }}>
          {t.fcKicker}
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, margin: "0 0 18px", color: "var(--classic-deep)", lineHeight: 1.4 }}>
          {t.fcTitle}
        </h1>
        <p style={{ fontSize: 16.5, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.fcLead}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 48 }}>
        {t.fcBenefits.map((b, i) => (
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
                color: "var(--classic-accent-ink)",
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

      <div
        style={{
          background: "var(--classic-deep)",
          borderRadius: 18,
          padding: "22px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 48,
        }}
      >
        {pipeSteps.map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: "rgba(18,18,20,.25)",
                  color: "var(--classic-yellow)",
                  fontSize: 13.5,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: "var(--classic-inverse)", fontSize: 14.5, fontWeight: 600 }}>{label}</span>
            </div>
            {i < pipeSteps.length - 1 && <span style={{ color: "var(--classic-footer-muted)", fontSize: 16 }}>{arrowChar}</span>}
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center" }}>
        <Link
          href="/classic/signup?role=brand"
          className="hover:opacity-90"
          style={{
            display: "inline-block",
            background: "var(--classic-ink)",
            color: "var(--classic-inverse)",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: 700,
            padding: "15px 34px",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(18,18,20,.3)",
            textDecoration: "none",
          }}
        >
          {t.startCta}
        </Link>
      </div>
    </div>
  );
}
