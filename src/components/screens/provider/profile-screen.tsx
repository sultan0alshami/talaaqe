"use client";
// Provider profile (spec provider-admin §2, behaviors §6.5).
// Completion % is computed from 7 real profile fields; facts/skills/portfolio
// come from the provider's own record.
import type { ProviderType } from "@prisma/client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { AVAILABILITY_LABELS, PROVIDER_TYPE_LABELS } from "@/lib/domain";
import { fmtNum } from "@/lib/format";

export type ProviderProfileProps = {
  nameAr: string;
  nameEn: string;
  roleAr: string;
  roleEn: string;
  verified: boolean;
  rating: number;
  providerType: ProviderType;
  cityAr: string;
  cityEn: string;
  years: number;
  languages: string[];
  priceMin: number | null;
  priceMax: number | null;
  availability: string | null;
  avatarColor: string;
  avatarInitial: string;
  skills: string[];
  portfolio: { id: string; title: string; titleEn: string | null }[];
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: 24,
};

export function ProviderProfileScreen(p: ProviderProfileProps) {
  const { t, isAr, pick } = useI18n();
  const { showToast } = useToast();

  // Completion: 7 fields — roleTitle, city, years, price range, availability,
  // skills, portfolio.
  const filled = [
    !!(p.roleAr || p.roleEn),
    !!(p.cityAr || p.cityEn),
    p.years > 0,
    p.priceMin != null && p.priceMax != null,
    !!p.availability,
    p.skills.length > 0,
    p.portfolio.length > 0,
  ].filter(Boolean).length;
  const completion = Math.round((filled / 7) * 100);

  const typeLabel = PROVIDER_TYPE_LABELS[p.providerType];
  const avail = p.availability ? AVAILABILITY_LABELS[p.availability] : null;
  const price =
    p.priceMin != null && p.priceMax != null ? `${fmtNum(p.priceMin)} – ${fmtNum(p.priceMax)}` : "—";

  const facts: { label: string; v: string; ltr?: boolean }[] = [
    { label: t.pfType, v: pick(typeLabel.ar, typeLabel.en) },
    { label: t.pfCity, v: pick(p.cityAr, p.cityEn) || "—" },
    { label: t.pfYears, v: fmtNum(p.years) },
    { label: t.pfLangs, v: p.languages.map((l) => l.toUpperCase()).join(" / ") || "—", ltr: true },
    { label: t.pfPrice, v: price },
    { label: t.pfAvail, v: avail ? pick(avail.ar, avail.en) : "—" },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{t.profileTitle}</h1>
          <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{t.profileSub}</p>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 14, padding: "12px 20px", minWidth: 220 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
            <span style={{ color: "#7684A0" }}>{t.profileCompletion}</span>
            <span style={{ fontWeight: 700, color: "#0E7A81" }}>{completion}%</span>
          </div>
          <div style={{ height: 7, background: "#EEF1F6", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${completion}%`,
                background: "linear-gradient(90deg, #14969E, #1B3568)",
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      </div>

      {/* Identity card */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E4E9F1",
          borderRadius: 18,
          padding: 26,
          marginBottom: 18,
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: p.avatarColor,
            color: "#fff",
            fontSize: 30,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {p.avatarInitial}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 19, fontWeight: 700 }}>{pick(p.nameAr, p.nameEn)}</span>
            {p.verified && (
              <span
                style={{
                  background: "#E9F6EF",
                  color: "#1F7A4D",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "3px 12px",
                  borderRadius: 999,
                }}
              >
                {t.verifiedBadge}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, color: "#7684A0" }}>
            {pick(p.roleAr, p.roleEn)} · ★ {p.rating}
          </div>
        </div>
      </div>

      {/* Facts grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 18 }}>
        {facts.map((f, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 12, color: "#93A1B8", marginBottom: 3 }}>{f.label}</div>
            <div
              dir={f.ltr ? "ltr" : undefined}
              style={{ fontSize: 15, fontWeight: 700, color: "#2C3A54", textAlign: "start" }}
            >
              {f.v}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column panels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* Skills + services */}
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{t.pfSkills}</span>
            <button
              onClick={() => showToast(t.demoOnly)}
              style={{
                background: "#F0F3F8",
                border: "none",
                cursor: "pointer",
                color: "#1B3568",
                fontSize: 12.5,
                fontWeight: 600,
                padding: "5px 13px",
                borderRadius: 999,
              }}
            >
              {t.addSkill}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 22 }}>
            {p.skills.map((sk) => (
              <span
                key={sk}
                dir="ltr"
                style={{
                  background: "#EEF3FB",
                  color: "#1B3568",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "6px 14px",
                  borderRadius: 999,
                }}
              >
                {sk}
              </span>
            ))}
            {p.skills.length === 0 && (
              <span style={{ fontSize: 13, color: "#7684A0" }}>
                {isAr ? "ما أضفت مهارات لين الحين" : "No skills added yet"}
              </span>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{t.pfServices}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {t.servicesItems.map((sv: string, i: number) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: "#2C3A54" }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    background: "#14969E",
                    transform: "rotate(45deg)",
                    flexShrink: 0,
                  }}
                />
                {sv}
              </div>
            ))}
          </div>
        </div>

        {/* Portfolio */}
        <div style={panel}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{t.pfPortfolio}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {p.portfolio.length === 0 && (
              <div style={{ fontSize: 13.5, color: "#7684A0" }}>
                {isAr ? "ما عندك أعمال سابقة لين الحين" : "No portfolio items yet"}
              </div>
            )}
            {p.portfolio.map((pf) => (
              <div
                key={pf.id}
                className="hover:border-[#14969E]!"
                style={{
                  border: "1px solid #E4E9F1",
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background:
                      "repeating-linear-gradient(45deg, #EEF3FB, #EEF3FB 6px, #E1E9F6 6px, #E1E9F6 12px)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#2C3A54" }}>
                  {pick(pf.title, pf.titleEn)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
