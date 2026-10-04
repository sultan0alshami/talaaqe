"use client";
// Public About page (public-screens spec §3, prototype lines 290–323).
import { InfameMark } from "./mark";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

const card: React.CSSProperties = {
  background: "var(--classic-card)",
  border: "1px solid var(--classic-border)",
  borderRadius: 20,
  padding: 34,
};

const kicker: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--classic-accent-ink)",

  marginBottom: 10,
};

const pointCard: React.CSSProperties = {
  background: "var(--classic-card)",
  border: "1px solid var(--classic-border)",
  borderRadius: 18,
  padding: "24px 22px",
};

const DOT_COLORS = ["var(--classic-accent-ink)", "var(--classic-ink)", "var(--classic-yellow)", "var(--classic-accent-ink)"];

export function AboutScreen() {
  const { t } = useI18n();

  return (
    <div className={styles.information} style={{ maxWidth: 1180, margin: "0 auto", padding: "76px 24px 96px" }}>
      <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto 56px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--classic-accent-ink)", marginBottom: 12 }}>
          {t.aboutKicker}
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 700, margin: "0 0 18px", color: "var(--classic-deep)", lineHeight: 1.4 }}>
          {t.aboutTitle}
        </h1>
        <p style={{ fontSize: 16.5, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.aboutLead}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <div style={card}>
          <div style={{ width: 12, height: 12, borderRadius: 4, background: "var(--classic-accent-ink)", transform: "rotate(45deg)", marginBottom: 18 }} />
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t.aboutMissionT}</div>
          <p style={{ fontSize: 15, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.aboutMission}</p>
        </div>
        <div style={card}>
          <div style={{ width: 12, height: 12, borderRadius: 4, background: "var(--classic-yellow)", transform: "rotate(45deg)", marginBottom: 18 }} />
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t.aboutVisionT}</div>
          <p style={{ fontSize: 15, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.aboutVision}</p>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, var(--classic-deep), var(--classic-ink) 60%, var(--classic-deep) 140%)",
          borderRadius: 20,
          padding: "40px 44px",
          color: "var(--classic-inverse)",
          marginBottom: 56,
          display: "flex",
          alignItems: "center",
          gap: 28,
          flexWrap: "wrap",
        }}
      >
        <div style={{ background: "var(--classic-card)", borderRadius: 14, padding: 10, flexShrink: 0 }}>
          <InfameMark width={44} height={43} />
        </div>
        <p style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.9, margin: 0, flex: 1, minWidth: 280 }}>
          {t.positioning}
        </p>
      </div>

      <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 26px", textAlign: "center" }}>{t.aboutValuesT}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {t.aboutVals.map((v, i) => (
          <div key={i} style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 18, padding: "26px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "var(--classic-ink)" }}>{v.t}</div>
            <div style={{ fontSize: 13.5, color: "var(--classic-muted)", lineHeight: 1.8 }}>{v.d}</div>
          </div>
        ))}
      </div>

      {/* ── Vision & impact ─────────────────────────────────────── */}
      <div style={{ textAlign: "center", maxWidth: 720, margin: "84px auto 0" }}>
        <div style={kicker}>{t.aboutImpactKicker}</div>
        <h2 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 14px", color: "var(--classic-deep)", lineHeight: 1.45 }}>
          {t.aboutImpactTitle}
        </h2>
        <p style={{ fontSize: 16, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.aboutImpactLead}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 30 }}>
        {[
          { label: t.aboutShortT, body: t.aboutShort, color: "var(--classic-accent-ink)", bg: "var(--classic-tint)" },
          { label: t.aboutLongT, body: t.aboutLong, color: "var(--classic-ink)", bg: "var(--classic-tint)" },
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
            <p style={{ fontSize: 15, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{c.body}</p>
          </div>
        ))}
      </div>

      {/* ── Vision 2030 alignment ───────────────────────────────── */}
      <div style={{ textAlign: "center", margin: "84px auto 0", maxWidth: 720 }}>
        <div style={kicker}>{t.aboutV2030Sub}</div>
        <h2 style={{ fontSize: 27, fontWeight: 700, margin: 0, color: "var(--classic-deep)" }}>{t.aboutV2030T}</h2>
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
            <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "var(--classic-ink)" }}>{v.t}</div>
            <div style={{ fontSize: 13.5, color: "var(--classic-muted)", lineHeight: 1.8 }}>{v.d}</div>
          </div>
        ))}
      </div>

      {/* ── Mega-events ─────────────────────────────────────────── */}
      <div style={{ textAlign: "center", margin: "84px auto 0", maxWidth: 760 }}>
        <h2 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 12px", color: "var(--classic-deep)" }}>{t.aboutEventsT}</h2>
        <p style={{ fontSize: 15.5, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.aboutEventsLead}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 28 }}>
        {t.aboutEvents.map((e, i) => (
          <div
            key={i}
            style={{
              background:
                i === 0
                  ? "linear-gradient(150deg, var(--classic-ink), var(--classic-deep))"
                  : "linear-gradient(150deg, var(--classic-deep), var(--classic-ink) 70%, var(--classic-accent-ink) 150%)",
              borderRadius: 20,
              padding: "30px 30px 32px",
              color: "var(--classic-inverse)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <span
              style={{
                alignSelf: "flex-start",
                background: "rgba(255,255,255,.15)",
                color: "var(--classic-yellow)",
                fontSize: 20,
                fontWeight: 700,
                padding: "6px 16px",
                borderRadius: 12,

              }}
            >
              {t.aboutEventLabels[i]}
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
          color: "var(--classic-accent-ink)",
          margin: "22px auto 0",
          maxWidth: 640,
          lineHeight: 1.9,
        }}
      >
        {t.aboutEventsNote}
      </p>

      {/* ── Empowering individuals + future education ───────────── */}
      <div style={{ textAlign: "center", margin: "84px auto 0", maxWidth: 760 }}>
        <h2 style={{ fontSize: 27, fontWeight: 700, margin: "0 0 12px", color: "var(--classic-deep)" }}>{t.aboutPeopleT}</h2>
        <p style={{ fontSize: 15.5, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.aboutPeopleLead}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, marginTop: 28 }}>
        {t.aboutPeople.map((p, i) => (
          <div key={i} style={pointCard}>
            <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "var(--classic-ink)" }}>{p.t}</div>
            <div style={{ fontSize: 13.5, color: "var(--classic-muted)", lineHeight: 1.8 }}>{p.d}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 22,
          background: "var(--classic-tint)",
          border: "1px solid var(--classic-border)",
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
            background: "var(--classic-yellow)",
            color: "var(--classic-inverse)",
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
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--classic-ink)" }}>{t.aboutSkillsT}</div>
          <p style={{ fontSize: 15, color: "var(--classic-ink)", margin: 0, lineHeight: 1.95 }}>{t.aboutSkills}</p>
        </div>
      </div>
    </div>
  );
}
