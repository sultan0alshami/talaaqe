"use client";
// Admin matching analytics (provider-admin spec §9): KPI row, score
// distribution, weekly column chart, revenue cards.
import { useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { ANALYTICS } from "@/lib/talaqi-data";

const DIST_COLORS = ["#14969E", "#1B3568", "#C6A15B", "#93A1B8"];

const whiteCard16: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 16,
  padding: 22,
};

const whiteCard18: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: 24,
};

export function AnalyticsScreen({
  avg,
  accept,
  timeAr,
  timeEn,
  dist,
  weekly,
  rev,
}: {
  avg: number;
  accept: number;
  timeAr: string;
  timeEn: string;
  dist: { rAr: string; rEn: string; v: number }[];
  weekly: number[];
  rev: { mrr: string; subs: string; growth: string };
}) {
  const { t, isAr, pick } = useI18n();

  const distMax = Math.max(...dist.map((d) => d.v), 1);
  const wMax = Math.max(...weekly, 1);
  const days = isAr ? ANALYTICS.weekly.daysAr : ANALYTICS.weekly.daysEn;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{t.anTitle}</h1>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{t.anSub}</p>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 18 }}>
        <div
          style={{
            background: "linear-gradient(150deg, #1B3568, #0F5E64)",
            borderRadius: 16,
            padding: 22,
            color: "#fff",
          }}
        >
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 6 }}>{t.anAvgScore}</div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{avg}%</div>
        </div>
        <div style={whiteCard16}>
          <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 6 }}>{t.anAccept}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#0E7A81" }}>{accept}%</div>
        </div>
        <div style={whiteCard16}>
          <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 6 }}>{t.anTime}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#1B3568" }}>{pick(timeAr, timeEn)}</div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}>
        <div style={whiteCard18}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>{t.anDistT}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {dist.map((d, i) => (
              <div key={d.rEn}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, color: "#2C3A54" }}>{pick(d.rAr, d.rEn)}</span>
                  <span style={{ color: "#93A1B8" }}>{fmtNum(d.v)}%</span>
                </div>
                <div style={{ height: 9, background: "#F0F3F8", borderRadius: 999, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((d.v / distMax) * 100)}%`,
                      background: DIST_COLORS[i % DIST_COLORS.length],
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...whiteCard18, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>{t.anWeeklyT}</div>
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 12, minHeight: 150 }}>
            {weekly.map((v, i) => (
              <div
                key={i}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#1B3568" }}>{fmtNum(v)}</span>
                <div
                  style={{
                    width: "100%",
                    maxWidth: 34,
                    height: Math.max(12, Math.round((v / wMax) * 120)),
                    background: v === wMax ? "#1B3568" : "#8ED4D9",
                    borderRadius: "8px 8px 3px 3px",
                  }}
                />
                <span style={{ fontSize: 11, color: "#93A1B8" }}>{days[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Revenue */}
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{t.anRevT}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <div style={whiteCard16}>
          <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 6 }}>{t.revMrr}</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1B3568" }}>
            {rev.mrr} <span style={{ fontSize: 13, fontWeight: 500, color: "#93A1B8" }}>{t.perProject}</span>
          </div>
        </div>
        <div style={whiteCard16}>
          <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 6 }}>{t.revSubs}</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#1B3568" }}>{rev.subs}</div>
        </div>
        <div style={{ background: "#F7F0E3", border: "1px solid #EFE2C6", borderRadius: 16, padding: 22 }}>
          <div style={{ fontSize: 13, color: "#8A6D33", marginBottom: 6 }}>{t.revGrowth}</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#8A6D33" }}>{rev.growth}</div>
        </div>
      </div>
    </div>
  );
}
