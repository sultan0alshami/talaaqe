"use client";
// Landing page (public-screens spec §2, prototype lines 61–290).
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { BRIEF, PROVIDERS } from "@/lib/talaqi-data";

const NAVY = "#1B3568";
const TEAL = "#14969E";

export interface LandingCategory {
  id: string;
  nameAr: string;
  nameEn: string;
  count: number;
}

const container: React.CSSProperties = { maxWidth: 1180, margin: "0 auto" };

const ctaLinkBase: React.CSSProperties = {
  display: "inline-block",
  textDecoration: "none",
  cursor: "pointer",
  textAlign: "center",
};

export function LandingScreen({ categories }: { categories: LandingCategory[] }) {
  const { t, isAr, dirOpp, arrowChar, pick } = useI18n();

  // Computed lists (behaviors §7.5)
  const pipeSteps = [t.pipe1, t.pipe2, t.pipe3, t.pipe4, t.pipe5].map((label, i) => ({
    n: i + 1,
    label,
    arrow: i < 4,
  }));
  const tiles = [
    { bg: "#EEF3FB", fg: NAVY },
    { bg: "#E8F5F6", fg: "#0E7A81" },
    { bg: "#F7F0E3", fg: "#8A6D33" },
    { bg: "#E8F5F6", fg: "#0E7A81" },
    { bg: "#EEF3FB", fg: NAVY },
  ];
  const howSteps = t.how.map((h, i) => ({ n: i + 1, t: h.t, d: h.d, tileBg: tiles[i].bg, tileFg: tiles[i].fg }));
  const dots = [TEAL, NAVY, "#C6A15B", TEAL, NAVY, "#C6A15B", TEAL, NAVY];
  const features = t.features.map((f, i) => ({ t: f.t, d: f.d, dot: dots[i] }));
  const plans = t.plans.map((p, i) => ({
    n: p.n,
    p: p.p,
    per: p.per,
    cta: p.cta,
    hot: p.hot,
    href: i === 3 ? "/signup?role=provider" : "/signup?role=client",
    featList: p.feats,
    bg: p.hot ? "linear-gradient(160deg, #1B3568, #0F5E64)" : "#fff",
    fg: p.hot ? "#fff" : "#1A2438",
    border: p.hot ? "1px solid transparent" : "1px solid #E4E9F1",
    check: p.hot ? "#7FE3E9" : TEAL,
    btnBg: p.hot ? "#fff" : "#F0F3F8",
  }));

  // Hero mock strings
  const briefTitle = pick(BRIEF.titleAr, BRIEF.titleEn);
  const heroTimeline = pick(BRIEF.timelineAr, BRIEF.timelineEn);
  const hero = PROVIDERS[0];
  const heroMatchName = pick(hero.ar, hero.en);
  const heroMatchRole = pick(hero.roleAr, hero.roleEn);

  return (
    <div>
      {/* ============ HERO ============ */}
      <div style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #F2F7F9 70%, #F6F8FB 100%)", borderBottom: "1px solid #E4E9F1" }}>
        <div
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
                background: "#E8F5F6",
                border: "1px solid #C6E7E9",
                color: "#0E7A81",
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 999,
                marginBottom: 22,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: TEAL, display: "inline-block" }} />
              {t.heroBadge}
            </div>
            <h1 style={{ fontSize: 46, lineHeight: 1.35, fontWeight: 700, margin: "0 0 18px", color: "#14213A" }}>
              {t.heroTitle1}
              <br />
              <span style={{ color: TEAL }}>{t.heroTitle2}</span>
            </h1>
            <p style={{ fontSize: 17, color: "#4A5A76", margin: "0 0 10px", maxWidth: 540 }}>{t.heroSub}</p>
            <p dir={dirOpp} style={{ fontSize: 13.5, color: "#93A1B8", margin: "0 0 30px", maxWidth: 540 }}>
              {t.heroSubEn}
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link
                href="/signup?role=client"
                className="hover:bg-[#24437F]! hover:-translate-y-px"
                style={{
                  ...ctaLinkBase,
                  background: NAVY,
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 600,
                  padding: "15px 30px",
                  borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(27,53,104,.3)",
                }}
              >
                {t.startCta}
              </Link>
              <Link
                href="/signup?role=provider"
                className="hover:border-[#1B3568]!"
                style={{
                  ...ctaLinkBase,
                  background: "#fff",
                  color: NAVY,
                  border: "1.5px solid #D5DDE9",
                  fontSize: 16,
                  fontWeight: 600,
                  padding: "15px 30px",
                  borderRadius: 12,
                }}
              >
                {t.joinCta}
              </Link>
            </div>
            <div style={{ display: "flex", gap: 36, marginTop: 44 }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: NAVY }}>+380</div>
                <div style={{ fontSize: 13, color: "#7684A0" }}>{t.statBriefs}</div>
              </div>
              <div style={{ width: 1, background: "#E4E9F1" }} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: NAVY }}>+320</div>
                <div style={{ fontSize: 13, color: "#7684A0" }}>{t.statProviders}</div>
              </div>
              <div style={{ width: 1, background: "#E4E9F1" }} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: TEAL }}>87%</div>
                <div style={{ fontSize: 13, color: "#7684A0" }}>{t.statMatch}</div>
              </div>
            </div>
          </div>

          {/* hero pipeline mock */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "tq-rise .7s ease both" }}>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E4E9F1",
                borderRadius: 16,
                padding: "18px 20px",
                boxShadow: "0 12px 32px rgba(20,40,80,.08)",
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
                  background: "#F0F3F8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  color: NAVY,
                  flexShrink: 0,
                }}
              >
                أ
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#93A1B8", marginBottom: 2 }}>{t.pipe1}</div>
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>&quot;{t.chatStarter1}&quot;</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: 2, height: 18, background: "linear-gradient(#14969E, #C6E7E9)" }} />
            </div>
            <div
              style={{
                background: "linear-gradient(135deg, #1B3568, #14969E)",
                borderRadius: 16,
                padding: "18px 20px",
                boxShadow: "0 16px 40px rgba(20,150,158,.28)",
                color: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#7FE3E9",
                    display: "inline-block",
                    animation: "tq-pulse 1.6s infinite",
                  }}
                />
                {t.pipe3} — AI
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{briefTitle}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ background: "rgba(255,255,255,.16)", borderRadius: 999, padding: "3px 12px", fontSize: 12 }}>
                  {t.bBudget}: 4,000–8,000
                </span>
                <span style={{ background: "rgba(255,255,255,.16)", borderRadius: 999, padding: "3px 12px", fontSize: 12 }}>
                  {heroTimeline}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: 2, height: 18, background: "linear-gradient(#C6E7E9, #C6A15B)" }} />
            </div>
            <div
              style={{
                background: "#fff",
                border: "1px solid #E4E9F1",
                borderRadius: 16,
                padding: "16px 20px",
                boxShadow: "0 12px 32px rgba(20,40,80,.08)",
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
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                ع
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{heroMatchName}</div>
                <div style={{ fontSize: 12.5, color: "#7684A0" }}>{heroMatchRole}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#0E7A81" }}>94%</div>
                <div style={{ fontSize: 11, color: "#93A1B8" }}>{t.matchScore}</div>
              </div>
            </div>
          </div>
        </div>

        {/* pipeline strip */}
        <div style={{ ...container, padding: "0 24px 56px" }}>
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
                      background: "rgba(20,150,158,.25)",
                      color: "#7FE3E9",
                      fontSize: 13.5,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {p.n}
                  </span>
                  <span style={{ color: "#fff", fontSize: 14.5, fontWeight: 600 }}>{p.label}</span>
                </div>
                {p.arrow && <span style={{ color: "#3D5378", fontSize: 16 }}>{arrowChar}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============ PROBLEM / SOLUTION ============ */}
      <div style={{ ...container, padding: "88px 24px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "stretch" }}>
          <div style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 20, padding: 36 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#B0433A", letterSpacing: ".04em", marginBottom: 10 }}>
              {t.oldJourney} — {t.oldSteps}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 20px", color: "#14213A" }}>{t.problemTitle}</h2>
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
                  <span style={{ color: "#4A5A76", fontSize: 15 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              background: "linear-gradient(160deg, #1B3568, #0F5E64)",
              borderRadius: 20,
              padding: 36,
              color: "#fff",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7FE3E9", letterSpacing: ".04em", marginBottom: 10 }}>
              {t.newJourney} — {t.newSteps}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 20px" }}>{t.solutionTitle}</h2>
            <p style={{ fontSize: 15.5, lineHeight: 1.9, color: "rgba(255,255,255,.85)", margin: 0 }}>{t.positioning}</p>
            <div style={{ marginTop: "auto", paddingTop: 28 }}>
              <Link
                href="/signup?role=client"
                className="hover:-translate-y-px"
                style={{
                  ...ctaLinkBase,
                  background: "#fff",
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
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "#14213A" }}>{t.howTitle}</h2>
          <p style={{ color: "#7684A0", fontSize: 16, margin: 0 }}>{t.howSub}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 18 }}>
          {howSteps.map((h) => (
            <div
              key={h.n}
              className="transition-all duration-200 hover:shadow-[0_12px_30px_rgba(20,40,80,.1)] hover:-translate-y-[3px]"
              style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 18, padding: "26px 22px", position: "relative" }}
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
              <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "#14213A" }}>{h.t}</div>
              <div style={{ fontSize: 13.5, color: "#7684A0", lineHeight: 1.7 }}>{h.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ VALUE ============ */}
      <div style={{ ...container, padding: "96px 24px 0" }}>
        <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 40px", color: "#14213A", textAlign: "center" }}>{t.valueTitle}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
          <div style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 20, padding: 34 }}>
            <div
              style={{
                display: "inline-block",
                background: "#EEF3FB",
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
          <div style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 20, padding: 34 }}>
            <div
              style={{
                display: "inline-block",
                background: "#F7F0E3",
                color: "#8A6D33",
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
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "#14213A" }}>{t.featuresTitle}</h2>
          <p style={{ color: "#7684A0", fontSize: 16, margin: 0 }}>{t.featuresSub}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
          {features.map((f, i) => (
            <div
              key={i}
              className="transition-all duration-200 hover:border-[#14969E]!"
              style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 18, padding: 24 }}
            >
              <div style={{ width: 12, height: 12, borderRadius: 4, background: f.dot, marginBottom: 16, transform: "rotate(45deg)" }} />
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5, color: "#14213A" }}>{f.t}</div>
              <div style={{ fontSize: 13, color: "#7684A0" }}>{f.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ CATEGORIES ============ */}
      <div id="tq-cats" style={{ ...container, padding: "96px 24px 0", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 42 }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "#14213A" }}>{t.catsTitle}</h2>
          <p style={{ color: "#7684A0", fontSize: 16, margin: 0 }}>{t.catsSub}</p>
        </div>
        {categories.length === 0 ? (
          <p style={{ textAlign: "center", color: "#93A1B8", fontSize: 14, margin: 0 }}>—</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {categories.map((c) => (
              <div
                key={c.id}
                className="hover:border-[#1B3568]! hover:shadow-[0_6px_18px_rgba(20,40,80,.07)]"
                style={{
                  background: "#fff",
                  border: "1px solid #E4E9F1",
                  borderRadius: 14,
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 14.5, fontWeight: 600, color: "#2C3A54" }}>{isAr ? c.nameAr : c.nameEn}</span>
                <span style={{ fontSize: 12, color: "#93A1B8", whiteSpace: "nowrap" }}>
                  {fmtNum(c.count)} {t.catProject}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============ PRICING ============ */}
      <div id="tq-pricing" style={{ ...container, padding: "96px 24px 0", scrollMarginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", color: "#14213A" }}>{t.pricingTitle}</h2>
          <p style={{ color: "#7684A0", fontSize: 16, margin: 0 }}>{t.pricingSub}</p>
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
                    background: "#C6A15B",
                    color: "#fff",
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
            background: "linear-gradient(135deg, #14213A, #1B3568 55%, #14969E 130%)",
            borderRadius: 24,
            padding: "64px 40px",
            textAlign: "center",
            color: "#fff",
          }}
        >
          <h2 style={{ fontSize: 34, fontWeight: 700, margin: "0 0 12px", lineHeight: 1.5 }}>{t.closingTitle}</h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,.75)", margin: "0 0 32px" }}>{t.closingSub}</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/signup?role=client"
              className="hover:-translate-y-px"
              style={{
                ...ctaLinkBase,
                background: "#fff",
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
              href="/signup?role=provider"
              className="hover:bg-[rgba(255,255,255,.2)]!"
              style={{
                ...ctaLinkBase,
                background: "rgba(255,255,255,.12)",
                color: "#fff",
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

// ✓ chip row used in the value grid (teal chip on both columns per prototype).
function ValueRow({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "#E8F5F6",
          color: "#0E7A81",
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
      <span style={{ fontSize: 15.5, color: "#2C3A54", fontWeight: 500 }}>{text}</span>
    </div>
  );
}
