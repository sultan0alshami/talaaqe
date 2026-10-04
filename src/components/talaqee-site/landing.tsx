"use client";
// Landing page (public-screens spec §2, prototype lines 61–290).
import Link from "next/link";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

const NAVY = "var(--classic-ink)";
const TEAL = "var(--classic-accent-ink)";

export interface LandingCategory {
  id: string;
  nameAr: string;
  nameEn: string;
}

const container: React.CSSProperties = { maxWidth: 1180, margin: "0 auto" };

const ctaLinkBase: React.CSSProperties = {
  display: "inline-block",
  textDecoration: "none",
  cursor: "pointer",
  textAlign: "center",
};

export function LandingScreen({ categories }: { categories: LandingCategory[] }) {
  const { t, isAr, dirOpp, arrowChar } = useI18n();

  // Computed lists (behaviors §7.5)
  const pipeSteps = [t.pipe1, t.pipe2, t.pipe3, t.pipe4, t.pipe5].map((label, i) => ({
    n: i + 1,
    label,
    arrow: i < 4,
  }));
  const tiles = [
    { bg: "var(--classic-tint)", fg: NAVY },
    { bg: "var(--classic-tint)", fg: "var(--classic-accent-ink)" },
    { bg: "var(--classic-tint)", fg: "var(--classic-ink)" },
    { bg: "var(--classic-tint)", fg: "var(--classic-accent-ink)" },
    { bg: "var(--classic-tint)", fg: NAVY },
  ];
  const howSteps = t.how.map((h, i) => ({ n: i + 1, t: h.t, d: h.d, tileBg: tiles[i].bg, tileFg: tiles[i].fg }));
  const dots = [TEAL, NAVY, "var(--classic-yellow)", TEAL, NAVY, "var(--classic-yellow)", TEAL, NAVY];
  const features = t.features.map((f, i) => ({ t: f.t, d: f.d, dot: dots[i] }));
  const plans = t.plans.map((p, i) => ({
    n: p.n,
    p: p.p,
    per: p.per,
    cta: p.cta,
    hot: p.hot,
    href: i === 3 ? "/classic/signup?role=creator" : "/classic/signup?role=brand",
    featList: p.feats,
    bg: p.hot ? "linear-gradient(160deg, var(--classic-ink), var(--classic-deep))" : "var(--classic-card)",
    fg: p.hot ? "var(--classic-inverse)" : "var(--classic-ink)",
    border: p.hot ? "1px solid transparent" : "1px solid var(--classic-border)",
    check: p.hot ? "var(--classic-yellow)" : TEAL,
    btnBg: p.hot ? "var(--classic-card)" : "var(--classic-tint)",
  }));

  return (
    <div className={styles.landing}>
      {/* ============ HERO ============ */}
      <div style={{ background: "linear-gradient(180deg, #FFFFFF 0%, var(--classic-wash) 70%, var(--classic-page) 100%)", borderBottom: "1px solid var(--classic-border)" }}>
        <div className={styles.hero}
          style={{
            ...container,
            padding: "84px 24px 72px",
            display: "grid",
            gridTemplateColumns: "1.1fr .9fr",
            gap: 56,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "var(--classic-tint)",
                border: "1px solid var(--classic-border)",
                color: "var(--classic-accent-ink)",
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 999,
                marginBottom: 22,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--classic-yellow)", display: "inline-block" }} />
              {t.heroBadge}
            </div>
            <h1 style={{ fontSize: 46, lineHeight: 1.35, fontWeight: 700, margin: "0 0 18px", color: "var(--classic-deep)" }}>
              {t.heroTitle1}
              <br />
              <span style={{ color: TEAL }}>{t.heroTitle2}</span>
            </h1>
            <p style={{ fontSize: 17, color: "var(--classic-body)", margin: "0 0 10px", maxWidth: 540 }}>{t.heroSub}</p>
            <p dir={dirOpp} style={{ fontSize: 13.5, color: "var(--classic-muted)", margin: "0 0 30px", maxWidth: 540 }}>
              {t.heroSubEn}
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link
                href="/classic/signup?role=brand"
                className="hover:opacity-90 hover:-translate-y-px"
                style={{
                  ...ctaLinkBase,
                  background: NAVY,
                  color: "var(--classic-inverse)",
                  fontSize: 16,
                  fontWeight: 600,
                  padding: "15px 30px",
                  borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(18,18,20,.3)",
                }}
              >
                {t.startCta}
              </Link>
              <Link
                href="/classic/signup?role=creator"
                className="hover:border-[var(--classic-ink)]!"
                style={{
                  ...ctaLinkBase,
                  background: "var(--classic-card)",
                  color: NAVY,
                  border: "1.5px solid var(--classic-border)",
                  fontSize: 16,
                  fontWeight: 600,
                  padding: "15px 30px",
                  borderRadius: 12,
                }}
              >
                {t.joinCta}
              </Link>
            </div>
            <div className={styles.productFacts} style={{ display: "flex", gap: 36, marginTop: 44 }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: NAVY }}>{t.statValue1}</div>
                <div style={{ fontSize: 13, color: "var(--classic-muted)" }}>{t.statBriefs}</div>
              </div>
              <div style={{ width: 1, background: "var(--classic-border)" }} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: NAVY }} dir="ltr">{t.statValue2}</div>
                <div style={{ fontSize: 13, color: "var(--classic-muted)" }}>{t.statProviders}</div>
              </div>
              <div style={{ width: 1, background: "var(--classic-border)" }} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: TEAL }}>{t.statValue3}</div>
                <div style={{ fontSize: 13, color: "var(--classic-muted)" }}>{t.statMatch}</div>
              </div>
            </div>
          </div>

          {/* hero pipeline mock */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "tq-rise .7s ease both" }} aria-label={t.exampleLabel}>
            <p style={{ fontSize: 12, color: "var(--classic-muted)", margin: 0 }}>{t.exampleLabel}</p>
            <div
              style={{
                background: "var(--classic-card)",
                border: "1px solid var(--classic-border)",
                borderRadius: 16,
                padding: "18px 20px",
                boxShadow: "0 12px 32px rgba(18,18,20,.08)",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: "var(--classic-tint)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  color: NAVY,
                  flexShrink: 0,
                }}
              >
                1
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--classic-muted)", marginBottom: 2 }}>{t.pipe1}</div>
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>&quot;{t.chatStarter1}&quot;</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: 2, height: 18, background: "linear-gradient(var(--classic-accent-ink), var(--classic-border))" }} />
            </div>
            <div
              style={{
                background: "linear-gradient(135deg, var(--classic-ink), var(--classic-accent-ink))",
                borderRadius: 16,
                padding: "18px 20px",
                boxShadow: "0 16px 40px rgba(18,18,20,.28)",
                color: "var(--classic-inverse)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--classic-yellow)",
                    display: "inline-block",
                  }}
                />
                {t.pipe3}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{t.exampleTitle}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ background: "rgba(255,255,255,.16)", borderRadius: 999, padding: "3px 12px", fontSize: 12 }}>
                  {t.bBudget}: {t.exampleBudget}
                </span>
                <span style={{ background: "rgba(255,255,255,.16)", borderRadius: 999, padding: "3px 12px", fontSize: 12 }}>
                  {t.examplePeriod}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: 2, height: 18, background: "linear-gradient(var(--classic-border), var(--classic-yellow))" }} />
            </div>
            <div
              style={{
                background: "var(--classic-card)",
                border: "1px solid var(--classic-border)",
                borderRadius: 16,
                padding: "16px 20px",
                boxShadow: "0 12px 32px rgba(18,18,20,.08)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: NAVY,
                  color: "var(--classic-inverse)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                3
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t.exampleCreator}</div>
                <div style={{ fontSize: 12.5, color: "var(--classic-muted)" }}>{t.exampleCreatorRole}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--classic-accent-ink)" }}>{t.exampleStatus}</div>
                <div style={{ fontSize: 11, color: "var(--classic-muted)" }}>{t.matchScore}</div>
              </div>
            </div>
          </div>
        </div>

        {/* pipeline strip */}
        <div style={{ ...container, padding: "0 24px 56px" }}>
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
            }}
          >
            {pipeSteps.map((p) => (
              <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                    {p.n}
                  </span>
                  <span style={{ color: "var(--classic-inverse)", fontSize: 14.5, fontWeight: 600 }}>{p.label}</span>
                </div>
                {p.arrow && <span style={{ color: "var(--classic-footer-muted)", fontSize: 16 }}>{arrowChar}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============ PROBLEM / SOLUTION ============ */}
      <div style={{ ...container, padding: "88px 24px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "stretch" }}>
          <div style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 20, padding: 36 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#B0433A", marginBottom: 10 }}>
              {t.oldJourney} — {t.oldSteps}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 20px", color: "var(--classic-deep)" }}>{t.problemTitle}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {t.problems.map((text, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "#FBEDEB",
                      color: "#B0433A",
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 3,
                    }}
                  >
                    ✕
                  </span>
                  <span style={{ color: "var(--classic-body)", fontSize: 15 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              background: "linear-gradient(160deg, var(--classic-ink), var(--classic-deep))",
              borderRadius: 20,
              padding: 36,
              color: "var(--classic-inverse)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--classic-yellow)", marginBottom: 10 }}>
              {t.newJourney} — {t.newSteps}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 20px" }}>{t.solutionTitle}</h2>
            <p style={{ fontSize: 15.5, lineHeight: 1.9, color: "rgba(255,255,255,.85)", margin: 0 }}>{t.positioning}</p>
            <div style={{ marginTop: "auto", paddingTop: 28 }}>
              <Link
                href="/classic/signup?role=brand"
                className="hover:-translate-y-px"
                style={{
                  ...ctaLinkBase,
                  background: "var(--classic-card)",
                  color: NAVY,
                  fontSize: 15,
                  fontWeight: 700,
                  padding: "13px 26px",
                  borderRadius: 11,
                }}
              >
                {t.startCta}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ============ HOW IT WORKS ============ */}
      <div id="tq-how" style={{ ...container, padding: "96px 24px 0", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "var(--classic-deep)" }}>{t.howTitle}</h2>
          <p style={{ color: "var(--classic-muted)", fontSize: 16, margin: 0 }}>{t.howSub}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 18 }}>
          {howSteps.map((h) => (
            <div
              key={h.n}
              className="transition-all duration-200 hover:shadow-[0_12px_30px_rgba(18,18,20,.1)] hover:-translate-y-[3px]"
              style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 18, padding: "26px 22px", position: "relative" }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: h.tileBg,
                  color: h.tileFg,
                  fontSize: 16,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                {h.n}
              </div>
              <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "var(--classic-deep)" }}>{h.t}</div>
              <div style={{ fontSize: 13.5, color: "var(--classic-muted)", lineHeight: 1.7 }}>{h.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ VALUE ============ */}
      <div style={{ ...container, padding: "96px 24px 0" }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 40px", color: "var(--classic-deep)", textAlign: "center" }}>{t.valueTitle}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
          <div style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 20, padding: 34 }}>
            <div
              style={{
                display: "inline-block",
                background: "var(--classic-tint)",
                color: NAVY,
                fontSize: 13,
                fontWeight: 700,
                padding: "6px 16px",
                borderRadius: 999,
                marginBottom: 20,
              }}
            >
              {t.forClients}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {t.clientVals.map((text, i) => (
                <ValueRow key={i} text={text} />
              ))}
            </div>
          </div>
          <div style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 20, padding: 34 }}>
            <div
              style={{
                display: "inline-block",
                background: "var(--classic-tint)",
                color: "var(--classic-ink)",
                fontSize: 13,
                fontWeight: 700,
                padding: "6px 16px",
                borderRadius: 999,
                marginBottom: 20,
              }}
            >
              {t.forProviders}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {t.providerVals.map((text, i) => (
                <ValueRow key={i} text={text} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ============ FEATURES ============ */}
      <div id="tq-features" style={{ ...container, padding: "96px 24px 0", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "var(--classic-deep)" }}>{t.featuresTitle}</h2>
          <p style={{ color: "var(--classic-muted)", fontSize: 16, margin: 0 }}>{t.featuresSub}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
          {features.map((f, i) => (
            <div
              key={i}
              className="transition-all duration-200 hover:border-[var(--classic-accent-ink)]!"
              style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 18, padding: 24 }}
            >
              <div style={{ width: 12, height: 12, borderRadius: 4, background: f.dot, marginBottom: 16, transform: "rotate(45deg)" }} />
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5, color: "var(--classic-deep)" }}>{f.t}</div>
              <div style={{ fontSize: 13, color: "var(--classic-muted)" }}>{f.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ CATEGORIES ============ */}
      <div id="tq-cats" style={{ ...container, padding: "96px 24px 0", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 42 }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "var(--classic-deep)" }}>{t.catsTitle}</h2>
          <p style={{ color: "var(--classic-muted)", fontSize: 16, margin: 0 }}>{t.catsSub}</p>
        </div>
        {categories.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--classic-muted)", fontSize: 14, margin: 0 }}>—</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {categories.map((c) => (
              <Link href="/classic/for-brands"
                key={c.id}
                className="hover:border-[var(--classic-ink)]! hover:shadow-[0_6px_18px_rgba(18,18,20,.07)]"
                style={{
                  background: "var(--classic-card)",
                  border: "1px solid var(--classic-border)",
                  borderRadius: 14,
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  cursor: "pointer", textDecoration: "none",
                }}
              >
                <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--classic-ink)" }}>{isAr ? c.nameAr : c.nameEn}</span>
                <span style={{ fontSize: 12, color: "var(--classic-muted)", whiteSpace: "nowrap" }}>
                  {t.catProject}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ============ PRICING ============ */}
      <div id="tq-pricing" style={{ ...container, padding: "96px 24px 0", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "var(--classic-deep)" }}>{t.pricingTitle}</h2>
          <p style={{ color: "var(--classic-muted)", fontSize: 16, margin: 0 }}>{t.pricingSub}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18, alignItems: "stretch" }}>
          {plans.map((pl, i) => (
            <div
              key={i}
              style={{
                background: pl.bg,
                border: pl.border,
                borderRadius: 20,
                padding: "30px 26px",
                display: "flex",
                flexDirection: "column",
                position: "relative",
                color: pl.fg,
              }}
            >
              {pl.hot && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    insetInlineStart: 24,
                    background: "var(--classic-yellow)",
                    color: "var(--classic-ink)",
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "4px 14px",
                    borderRadius: 999,
                  }}
                >
                  {t.popular}
                </div>
              )}
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{pl.n}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 22 }}>
                <span style={{ fontSize: 36, fontWeight: 700 }}>{pl.p}</span>
                <span style={{ fontSize: 13, opacity: 0.65 }}>{pl.per}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 26 }}>
                {pl.featList.map((text, fi) => (
                  <div key={fi} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5 }}>
                    <span style={{ color: pl.check, fontWeight: 700 }}>✓</span>
                    <span style={{ opacity: 0.88 }}>{text}</span>
                  </div>
                ))}
              </div>
              <Link
                href={pl.href}
                className="hover:opacity-[.92]"
                style={{
                  ...ctaLinkBase,
                  marginTop: "auto",
                  background: pl.btnBg,
                  color: NAVY,
                  border: "none",
                  fontSize: 14,
                  fontWeight: 700,
                  padding: 12,
                  borderRadius: 11,
                }}
              >
                {pl.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* ============ CLOSING CTA ============ */}
      <div style={{ ...container, padding: "96px 24px" }}>
        <div
          style={{
            background: "linear-gradient(135deg, var(--classic-deep), var(--classic-ink) 55%, var(--classic-accent-ink) 130%)",
            borderRadius: 24,
            padding: "64px 40px",
            textAlign: "center",
            color: "var(--classic-inverse)",
          }}
        >
          <h2 style={{ fontSize: 34, fontWeight: 700, margin: "0 0 12px", lineHeight: 1.5 }}>{t.closingTitle}</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,.75)", margin: "0 0 32px" }}>{t.closingSub}</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/classic/signup?role=brand"
              className="hover:-translate-y-px"
              style={{
                ...ctaLinkBase,
                background: "var(--classic-card)",
                color: NAVY,
                fontSize: 16,
                fontWeight: 700,
                padding: "15px 32px",
                borderRadius: 12,
              }}
            >
              {t.startCta}
            </Link>
            <Link
              href="/classic/signup?role=creator"
              className="hover:bg-[rgba(255,255,255,.2)]!"
              style={{
                ...ctaLinkBase,
                background: "rgba(255,255,255,.12)",
                color: "var(--classic-inverse)",
                border: "1px solid rgba(255,255,255,.35)",
                fontSize: 16,
                fontWeight: 600,
                padding: "15px 32px",
                borderRadius: 12,
              }}
            >
              {t.joinCta}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Check chip row retained from the original value grid.
function ValueRow({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "var(--classic-tint)",
          color: "var(--classic-accent-ink)",
          fontSize: 12,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        ✓
      </span>
      <span style={{ fontSize: 15.5, color: "var(--classic-ink)", fontWeight: 500 }}>{text}</span>
    </div>
  );
}
