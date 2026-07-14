"use client";
// Admin briefs review (provider-admin spec §8). Every row expands into a
// review panel (improvement over the prototype's row-0-only toggle) with a
// quality-score control (PATCH /api/admin/briefs/:id).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { fmtBudget, fmtDate, fmtNum } from "@/lib/format";
import type { BriefDTO } from "@/lib/domain";

type BriefRow = BriefDTO & {
  clientAr: string;
  clientEn: string;
  categoryAr: string | null;
  categoryEn: string | null;
  createdAt: string;
};

const GRID = "2fr 1fr 1fr 1.2fr 1fr auto";

export function BriefsScreen({ briefs }: { briefs: BriefRow[] }) {
  const { t, isAr, pick } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const scoreOf = (b: BriefRow) => scores[b.id] ?? (b.qualityScore != null ? String(b.qualityScore) : "");

  const saveScore = async (b: BriefRow) => {
    const n = Number(scoreOf(b));
    if (!Number.isInteger(n) || n < 0 || n > 100) return;
    setBusy(b.id);
    try {
      const res = await fetch(`/api/admin/briefs/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualityScore: n }),
      });
      if (res.ok) {
        showToast(t.settingsSaved);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{t.briefsTitle}</h1>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{t.briefsSub}</p>
      </div>
      <div style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 18, overflow: "hidden" }}>
        <div
          style={{
            padding: "13px 24px",
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 12,
            background: "#FAFBFD",
            borderBottom: "1px solid #EEF1F6",
            fontSize: 12.5,
            fontWeight: 700,
            color: "#7684A0",
          }}
        >
          <span>{t.thProject}</span>
          <span>{t.thCategory}</span>
          <span>{t.thDate}</span>
          <span>{t.thQuality}</span>
          <span>{t.thStatus}</span>
          <span style={{ width: 76 }} />
        </div>
        {briefs.length === 0 && (
          <div style={{ padding: "22px 24px", fontSize: 13.5, color: "#93A1B8" }}>—</div>
        )}
        {briefs.map((b) => {
          const isOpen = open === b.id;
          const q = b.qualityScore;
          const qColor = q != null && q >= 90 ? "#0E7A81" : "#8A6D33";
          return (
            <div key={b.id}>
              <div
                className="hover:bg-[#FAFBFD]"
                style={{
                  padding: "14px 24px",
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 12,
                  alignItems: "center",
                  borderBottom: "1px solid #F3F5F9",
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{pick(b.titleAr, b.titleEn)}</div>
                  <div style={{ fontSize: 12, color: "#93A1B8" }}>{pick(b.clientAr, b.clientEn)}</div>
                </div>
                <span style={{ fontSize: 13, color: "#4A5A76" }}>
                  {b.categoryAr ? pick(b.categoryAr, b.categoryEn ?? b.categoryAr) : "—"}
                </span>
                <span style={{ fontSize: 13, color: "#93A1B8" }}>{fmtDate(b.createdAt)}</span>
                {q != null ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ flex: 1, height: 6, background: "#F0F3F8", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${q}%`, background: qColor, borderRadius: 999 }} />
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: qColor }}>{q}%</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 12.5, color: "#93A1B8" }}>—</span>
                )}
                <span
                  style={{
                    background: b.approvedByClient ? "#E9F6EF" : "#FDF9F0",
                    color: b.approvedByClient ? "#1F7A4D" : "#8A6D33",
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "3px 12px",
                    borderRadius: 999,
                    justifySelf: "start",
                    whiteSpace: "nowrap",
                  }}
                >
                  {b.approvedByClient ? t.approvedTag : t.pendingTag}
                </span>
                <button
                  onClick={() => setOpen(isOpen ? null : b.id)}
                  className="hover:bg-[#E1E9F6]"
                  style={{
                    background: "#EEF3FB",
                    color: "#1B3568",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "7px 16px",
                    borderRadius: 999,
                    width: 76,
                  }}
                >
                  {isOpen ? t.closeBtn : t.reviewBtn}
                </button>
              </div>
              {isOpen && (
                <div style={{ background: "#FAFBFD", borderBottom: "1px solid #F3F5F9", padding: "20px 24px" }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#93A1B8",
                      letterSpacing: ".05em",
                      marginBottom: 8,
                    }}
                  >
                    {t.bSummary}
                  </div>
                  <p style={{ fontSize: 14, color: "#2C3A54", lineHeight: 1.9, margin: "0 0 14px", maxWidth: 760 }}>
                    {pick(b.summaryAr, b.summaryEn)}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    <span
                      style={{
                        background: "#EEF3FB",
                        color: "#1B3568",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "5px 13px",
                        borderRadius: 999,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.bBudget}: {fmtBudget(b.budgetMin, b.budgetMax)} {t.perProject}
                    </span>
                    <span
                      style={{
                        background: "#E8F5F6",
                        color: "#0E7A81",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "5px 13px",
                        borderRadius: 999,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.bScope}: {fmtNum((isAr ? b.scopeAr : b.scopeEn).length)}
                    </span>
                    {b.requiredSkills.map((sk) => (
                      <span
                        key={sk}
                        dir="ltr"
                        style={{
                          background: "#fff",
                          border: "1px solid #E4E9F1",
                          color: "#4A5A76",
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "5px 13px",
                          borderRadius: 999,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sk}
                      </span>
                    ))}
                  </div>
                  {/* Quality score review control */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#7684A0" }}>{t.thQuality}</span>
                    <input
                      dir="ltr"
                      type="number"
                      min={0}
                      max={100}
                      value={scoreOf(b)}
                      onChange={(e) => setScores((s) => ({ ...s, [b.id]: e.target.value }))}
                      style={{
                        width: 72,
                        border: "1px solid #E4E9F1",
                        borderRadius: 10,
                        padding: "7px 10px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#2C3A54",
                        background: "#fff",
                        outline: "none",
                        textAlign: "center",
                      }}
                    />
                    <button
                      onClick={() => saveScore(b)}
                      disabled={busy === b.id}
                      className="hover:bg-[#24437F]"
                      style={{
                        background: "#1B3568",
                        color: "#fff",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 12.5,
                        fontWeight: 700,
                        padding: "8px 18px",
                        borderRadius: 10,
                        opacity: busy === b.id ? 0.6 : 1,
                      }}
                    >
                      {isAr ? "حفظ" : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
