"use client";
// Public "For clients" page (public-screens spec §4, prototype lines 326–361).
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export function ForClientsScreen() {
  const { t, arrowChar } = useI18n();
  const pipeSteps = [t.pipe1, t.pipe2, t.pipe3, t.pipe4, t.pipe5];

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "76px 24px 96px" }}>
      <div style={{ textAlign: "center", maxWidth: 700, margin: "0 auto 52px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#14969E", letterSpacing: ".05em", marginBottom: 12 }}>
          {t.fcKicker}
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, margin: "0 0 18px", color: "#14213A", lineHeight: 1.4 }}>
          {t.fcTitle}
        </h1>
        <p style={{ fontSize: 16.5, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{t.fcLead}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 48 }}>
        {t.fcBenefits.map((b, i) => (
          <div
            key={i}
            style={{
              background: "#fff",
              border: "1px solid #E4E9F1",
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
                background: "#E8F5F6",
                color: "#0E7A81",
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
              <div style={{ fontSize: 14, color: "#7684A0", lineHeight: 1.8 }}>{b.d}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: "#14213A",
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
                  background: "rgba(20,150,158,.25)",
                  color: "#7FE3E9",
                  fontSize: 13.5,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: "#fff", fontSize: 14.5, fontWeight: 600 }}>{label}</span>
            </div>
            {i < pipeSteps.length - 1 && <span style={{ color: "#3D5378", fontSize: 16 }}>{arrowChar}</span>}
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center" }}>
        <Link
          href="/signup?role=client"
          className="hover:bg-[#24437F]!"
          style={{
            display: "inline-block",
            background: "#1B3568",
            color: "#fff",
            cursor: "pointer",
            fontSize: 16,
            fontWeight: 700,
            padding: "15px 34px",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(27,53,104,.3)",
            textDecoration: "none",
          }}
        >
          {t.startCta}
        </Link>
      </div>
    </div>
  );
}
