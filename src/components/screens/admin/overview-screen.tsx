"use client";
// Admin overview (provider-admin spec §4): stat rows, top-categories chart,
// pending provider approvals with real approve/reject mutations.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtWhen } from "@/lib/format";

type PendingProvider = {
  id: string;
  nameAr: string;
  nameEn: string;
  roleAr: string;
  roleEn: string;
  cityAr: string;
  cityEn: string;
  date: string;
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: 24,
};

const BAR_COLORS = ["#14969E", "#1B3568", "#C6A15B", "#14969E", "#1B3568", "#C6A15B"];

export function OverviewScreen({
  users,
  clients,
  providers,
  projects,
  weekly,
  briefs,
  pending,
  matchRate,
  topCats,
  pendingProviders,
}: {
  users: number;
  clients: number;
  providers: number;
  projects: number;
  weekly: number;
  briefs: number;
  pending: number;
  matchRate: number;
  topCats: { ar: string; en: string; v: number }[];
  pendingProviders: PendingProvider[];
}) {
  const { t, lang, pick } = useI18n();
  const router = useRouter();
  const [resolved, setResolved] = useState<Record<string, "a" | "r">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/providers/${id}/${action}`, { method: "POST" });
      if (res.ok) {
        setResolved((r) => ({ ...r, [id]: action === "approve" ? "a" : "r" }));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const stats1 = [
    { label: t.aUsers, v: fmtNum(users) },
    { label: t.aClients, v: fmtNum(clients) },
    { label: t.aProviders, v: fmtNum(providers) },
    { label: t.aProjects, v: fmtNum(projects) },
  ];
  const stats2 = [
    { label: t.aWeekly, v: fmtNum(weekly), bg: "#fff", bd: "#E4E9F1", lc: "#7684A0", vc: "#1B3568" },
    { label: t.aBriefs, v: fmtNum(briefs), bg: "#E8F5F6", bd: "#C6E7E9", lc: "#0E7A81", vc: "#0E7A81" },
    { label: t.aPending, v: fmtNum(pending), bg: "#FDF9F0", bd: "#EFE2C6", lc: "#8A6D33", vc: "#8A6D33" },
    { label: t.aMatchRate, v: `${matchRate}%`, bg: "#EEF3FB", bd: "#D5DDE9", lc: "#1B3568", vc: "#1B3568" },
  ];
  const maxCat = Math.max(...topCats.map((c) => c.v), 1);
  // "Last updated" line rebuilt live: keep the dict prefix, swap the frozen time.
  const lastUpdated = `${t.adminSub.split(":")[0]}: ${fmtWhen(new Date(), lang)}`;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{t.adminTitle}</h1>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 13.5 }}>{lastUpdated}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        {stats1.map((s) => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 27, fontWeight: 700, color: "#1B3568" }}>{s.v}</div>
            <div style={{ fontSize: 11.5, color: "#2FA36B", marginTop: 3 }}>{t.monthGrowth}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 26 }}>
        {stats2.map((s) => (
          <div
            key={s.label}
            style={{ background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 16, padding: 20 }}
          >
            <div style={{ fontSize: 13, color: s.lc, marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 27, fontWeight: 700, color: s.vc }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
        {/* Top categories bar chart */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>{t.aTopCats}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {topCats.map((c, i) => (
              <div key={c.en}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, color: "#2C3A54" }}>{pick(c.ar, c.en)}</span>
                  <span style={{ color: "#93A1B8" }}>{fmtNum(c.v)}</span>
                </div>
                <div style={{ height: 9, background: "#F0F3F8", borderRadius: 999, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((c.v / maxCat) * 100)}%`,
                      background: BAR_COLORS[i % BAR_COLORS.length],
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending provider approvals */}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{t.aPendingTitle}</div>
          {pendingProviders.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "#93A1B8" }}>—</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pendingProviders.map((pd) => {
                const st = resolved[pd.id];
                return (
                  <div
                    key={pd.id}
                    style={{
                      border: "1px solid #EEF1F6",
                      borderRadius: 12,
                      padding: "13px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{pick(pd.nameAr, pd.nameEn)}</div>
                      <div style={{ fontSize: 12, color: "#93A1B8" }}>
                        {pick(pd.roleAr, pd.roleEn)} · {pick(pd.cityAr, pd.cityEn)} · {fmtDate(pd.date)}
                      </div>
                    </div>
                    {!st && (
                      <>
                        <button
                          onClick={() => decide(pd.id, "approve")}
                          disabled={busy === pd.id}
                          className="hover:bg-[#D7EEDF]"
                          style={{
                            background: "#E9F6EF",
                            color: "#1F7A4D",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "6px 14px",
                            borderRadius: 999,
                            opacity: busy === pd.id ? 0.6 : 1,
                          }}
                        >
                          {t.approve}
                        </button>
                        <button
                          onClick={() => decide(pd.id, "reject")}
                          disabled={busy === pd.id}
                          className="hover:bg-[#F6DEDA]"
                          style={{
                            background: "#FBEDEB",
                            color: "#B0433A",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "6px 14px",
                            borderRadius: 999,
                            opacity: busy === pd.id ? 0.6 : 1,
                          }}
                        >
                          {t.reject}
                        </button>
                      </>
                    )}
                    {st === "a" && (
                      <span style={{ color: "#1F7A4D", fontSize: 12.5, fontWeight: 700 }}>{t.approvedLbl}</span>
                    )}
                    {st === "r" && (
                      <span style={{ color: "#B0433A", fontSize: 12.5, fontWeight: 700 }}>{t.rejectedLbl}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
