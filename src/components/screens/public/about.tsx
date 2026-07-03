"use client";
// Public About page (public-screens spec §3, prototype lines 290–323).
import Image from "next/image";
import { useI18n } from "@/lib/i18n";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 20,
  padding: 34,
};

export function AboutScreen() {
  const { t } = useI18n();

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "76px 24px 96px" }}>
      <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto 56px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#14969E", letterSpacing: ".05em", marginBottom: 12 }}>
          {t.aboutKicker}
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, margin: "0 0 18px", color: "#14213A", lineHeight: 1.4 }}>
          {t.aboutTitle}
        </h1>
        <p style={{ fontSize: 16.5, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{t.aboutLead}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <div style={card}>
          <div style={{ width: 12, height: 12, borderRadius: 4, background: "#14969E", transform: "rotate(45deg)", marginBottom: 18 }} />
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t.aboutMissionT}</div>
          <p style={{ fontSize: 15, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{t.aboutMission}</p>
        </div>
        <div style={card}>
          <div style={{ width: 12, height: 12, borderRadius: 4, background: "#C6A15B", transform: "rotate(45deg)", marginBottom: 18 }} />
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t.aboutVisionT}</div>
          <p style={{ fontSize: 15, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{t.aboutVision}</p>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, #14213A, #1B3568 60%, #0F5E64 140%)",
          borderRadius: 20,
          padding: "40px 44px",
          color: "#fff",
          marginBottom: 56,
          display: "flex",
          alignItems: "center",
          gap: 28,
          flexWrap: "wrap",
        }}
      >
        <div style={{ background: "#fff", borderRadius: 14, padding: 10, flexShrink: 0 }}>
          <Image src="/assets/logo-mark.png" alt="" width={44} height={43} style={{ objectFit: "contain", display: "block" }} />
        </div>
        <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.9, margin: 0, flex: 1, minWidth: 280 }}>
          {t.positioning}
        </p>
      </div>

      <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 26px", textAlign: "center" }}>{t.aboutValuesT}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {t.aboutVals.map((v, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 18, padding: "26px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#1B3568" }}>{v.t}</div>
            <div style={{ fontSize: 13.5, color: "#7684A0", lineHeight: 1.8 }}>{v.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
