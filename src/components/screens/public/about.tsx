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

const kicker: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#14969E",
  letterSpacing: ".05em",
  marginBottom: 10,
};

const pointCard: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: "24px 22px",
};

const DOT_COLORS = ["#14969E", "#1B3568", "#C6A15B", "#0E7A81"];

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

      {/* ── Vision & impact ─────────────────────────────────────── */}
      <div style={{ textAlign: "center", maxWidth: 720, margin: "84px auto 0" }}>
        <div style={kicker}>{t.aboutImpactKicker}</div>
        <h2 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 14px", color: "#14213A", lineHeight: 1.45 }}>
          {t.aboutImpactTitle}
        </h2>
        <p style={{ fontSize: 16, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{t.aboutImpactLead}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 30 }}>
        {[
          { label: t.aboutShortT, body: t.aboutShort, color: "#14969E", bg: "#E8F5F6" },
          { label: t.aboutLongT, body: t.aboutLong, color: "#1B3568", bg: "#EEF3FB" },
        ].map((c) => (
          <div key={c.label} style={card}>
            <span
              style={{
                display: "inline-block",
                background: c.bg,
                color: c.color,
                fontSize: 12.5,
                fontWeight: 700,
                padding: "5px 14px",
                borderRadius: 999,
                marginBottom: 16,
              }}
            >
              {c.label}
            </span>
            <p style={{ fontSize: 15, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{c.body}</p>
          </div>
        ))}
      </div>

      {/* ── Vision 2030 alignment ───────────────────────────────── */}
      <div style={{ textAlign: "center", margin: "84px auto 0", maxWidth: 720 }}>
        <div style={kicker}>{t.aboutV2030Sub}</div>
        <h2 style={{ fontSize: 27, fontWeight: 700, margin: 0, color: "#14213A" }}>{t.aboutV2030T}</h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, marginTop: 28 }}>
        {t.aboutV2030.map((v, i) => (
          <div key={i} style={pointCard}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                background: DOT_COLORS[i % DOT_COLORS.length],
                transform: "rotate(45deg)",
                marginBottom: 16,
              }}
            />
            <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "#1B3568" }}>{v.t}</div>
            <div style={{ fontSize: 13.5, color: "#7684A0", lineHeight: 1.8 }}>{v.d}</div>
          </div>
        ))}
      </div>

      {/* ── Mega-events ─────────────────────────────────────────── */}
      <div style={{ textAlign: "center", margin: "84px auto 0", maxWidth: 760 }}>
        <h2 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 12px", color: "#14213A" }}>{t.aboutEventsT}</h2>
        <p style={{ fontSize: 15.5, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{t.aboutEventsLead}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 28 }}>
        {t.aboutEvents.map((e, i) => (
          <div
            key={i}
            style={{
              background:
                i === 0
                  ? "linear-gradient(150deg, #1B3568, #0F5E64)"
                  : "linear-gradient(150deg, #14213A, #1B3568 70%, #14969E 150%)",
              borderRadius: 20,
              padding: "30px 30px 32px",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <span
              style={{
                alignSelf: "flex-start",
                background: "rgba(255,255,255,.15)",
                color: "#7FE3E9",
                fontSize: 20,
                fontWeight: 700,
                padding: "6px 16px",
                borderRadius: 12,
                letterSpacing: ".02em",
              }}
            >
              {i === 0 ? "2030" : "2034"}
            </span>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{e.t}</div>
            <p style={{ fontSize: 14.5, margin: 0, lineHeight: 1.85, opacity: 0.88 }}>{e.d}</p>
          </div>
        ))}
      </div>
      <p
        style={{
          textAlign: "center",
          fontSize: 15,
          fontWeight: 600,
          color: "#0E7A81",
          margin: "22px auto 0",
          maxWidth: 640,
          lineHeight: 1.9,
        }}
      >
        {t.aboutEventsNote}
      </p>

      {/* ── Empowering individuals + future education ───────────── */}
      <div style={{ textAlign: "center", margin: "84px auto 0", maxWidth: 760 }}>
        <h2 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 12px", color: "#14213A" }}>{t.aboutPeopleT}</h2>
        <p style={{ fontSize: 15.5, color: "#4A5A76", margin: 0, lineHeight: 1.9 }}>{t.aboutPeopleLead}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, marginTop: 28 }}>
        {t.aboutPeople.map((p, i) => (
          <div key={i} style={pointCard}>
            <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "#1B3568" }}>{p.t}</div>
            <div style={{ fontSize: 13.5, color: "#7684A0", lineHeight: 1.8 }}>{p.d}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 22,
          background: "#FDF9F0",
          border: "1px solid #EFE2C6",
          borderRadius: 20,
          padding: "30px 32px",
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            background: "#C6A15B",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 700,
            padding: "6px 16px",
            borderRadius: 999,
            flexShrink: 0,
          }}
        >
          {t.aboutSkillsBadge}
        </span>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#8A6D33" }}>{t.aboutSkillsT}</div>
          <p style={{ fontSize: 15, color: "#6E5A31", margin: 0, lineHeight: 1.95 }}>{t.aboutSkills}</p>
        </div>
      </div>
    </div>
  );
}
