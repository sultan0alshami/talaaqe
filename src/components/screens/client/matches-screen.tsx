"use client";
// Recommended providers screen (client-screens spec §4, behaviors §6.1).
// Request-proposal flips optimistically to the persistent success block.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { scoreColor, type MatchDTO } from "@/lib/domain";
import { fmtBudget } from "@/lib/format";

export function MatchesScreen({
  matches,
  projectId,
  titleAr,
  titleEn,
}: {
  matches: MatchDTO[];
  projectId: string | null;
  titleAr: string;
  titleEn: string;
}) {
  const { t, pick } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();

  const [requested, setRequested] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      matches.map((m) => [m.id, m.status === "PROPOSAL_REQUESTED" || m.status === "PROPOSAL_SENT"])
    )
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // ── Empty state (spec §5.11 pattern) ────────────────────────────
  if (!projectId || matches.length === 0) {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E4E9F1",
            borderRadius: 18,
            padding: "48px 32px",
            textAlign: "center",
          }}
        >
          <p style={{ margin: "0 0 18px", fontSize: 14.5, color: "#7684A0" }}>{t.matchesSub}</p>
          <button
            onClick={() => router.push("/client/brief")}
            className="hover:bg-[#E1E9F6]"
            style={{
              background: "#EEF3FB",
              color: "#1B3568",
              border: "none",
              cursor: "pointer",
              fontSize: 13.5,
              fontWeight: 700,
              padding: "11px 22px",
              borderRadius: 10,
            }}
          >
            {t.pdViewBrief}
          </button>
        </div>
      </div>
    );
  }

  const request = async (id: string) => {
    if (pending[id] || requested[id]) return;
    setPending((p) => ({ ...p, [id]: true }));
    setRequested((r) => ({ ...r, [id]: true })); // optimistic flip
    showToast(t.proposalSent);
    try {
      const res = await fetch(`/api/matches/${id}/request-proposal`, { method: "POST" });
      if (!res.ok) setRequested((r) => ({ ...r, [id]: false }));
    } catch {
      setRequested((r) => ({ ...r, [id]: false }));
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 6 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: "#14969E",
            letterSpacing: ".04em",
            marginBottom: 6,
          }}
        >
          ✦ {pick(titleAr, titleEn)}
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 700, margin: "0 0 4px" }}>{t.matchesTitle}</h1>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{t.matchesSub}</p>
      </div>
      <div
        style={{
          background: "#F2F7F9",
          border: "1px solid #DCEBEE",
          borderRadius: 12,
          padding: "10px 18px",
          fontSize: 12.5,
          color: "#0E7A81",
          margin: "16px 0 22px",
          display: "inline-block",
        }}
      >
        ⓘ {t.matchBasis}
      </div>

      {/* Match cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {matches.map((m) => {
          const p = m.provider;
          const isRequested = !!requested[m.id];
          return (
            <div
              key={m.id}
              className="hover:shadow-[0_10px_28px_rgba(20,40,80,.08)] hover:border-[#C6E7E9]"
              style={{
                background: "#fff",
                border: "1px solid #E4E9F1",
                borderRadius: 18,
                padding: "22px 24px",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 20,
                alignItems: "center",
              }}
            >
              {/* Column A — avatar + score */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: 16,
                    background: p.avatarColor,
                    color: "#fff",
                    fontSize: 23,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {p.avatarInitial}
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(m.matchScore) }}>
                    {m.matchScore}%
                  </div>
                  <div style={{ fontSize: 10.5, color: "#93A1B8" }}>{t.matchScore}</div>
                </div>
              </div>

              {/* Column B — info */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontSize: 16.5, fontWeight: 700 }}>{pick(p.nameAr, p.nameEn)}</span>
                  <span
                    style={{
                      background: "#F0F3F8",
                      color: "#4A5A76",
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: "2px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {pick(p.typeAr, p.typeEn)}
                  </span>
                  {p.verified && (
                    <span
                      style={{
                        background: "#E9F6EF",
                        color: "#1F7A4D",
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "2px 10px",
                        borderRadius: 999,
                      }}
                    >
                      {t.verifiedBadge}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13.5, color: "#7684A0", marginBottom: 10 }}>
                  {pick(p.roleAr, p.roleEn)} · {pick(p.cityAr, p.cityEn)} · ★ {p.rating} · {p.years}{" "}
                  {t.yearsExp} · {fmtBudget(p.priceMin, p.priceMax)} {t.perProject}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {p.skills.map((sk, i) => (
                    <span
                      key={i}
                      dir="ltr"
                      style={{
                        background: "#EEF3FB",
                        color: "#1B3568",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "3px 11px",
                        borderRadius: 999,
                      }}
                    >
                      {sk}
                    </span>
                  ))}
                </div>
                <div
                  style={{
                    background: "#F2F7F9",
                    borderInlineStart: "3px solid #14969E",
                    borderRadius: 8,
                    padding: "9px 14px",
                    fontSize: 13,
                    color: "#2C5B60",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{t.whyMatch}</span>{" "}
                  {pick(m.reasonAr, m.reasonEn)}
                </div>
              </div>

              {/* Column C — actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 140 }}>
                {!isRequested ? (
                  <button
                    onClick={() => void request(m.id)}
                    disabled={!!pending[m.id]}
                    className="hover:bg-[#24437F]"
                    style={{
                      background: "#1B3568",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13.5,
                      fontWeight: 700,
                      padding: "11px 18px",
                      borderRadius: 10,
                    }}
                  >
                    {t.requestProposal}
                  </button>
                ) : (
                  <div
                    style={{
                      background: "#E9F6EF",
                      color: "#1F7A4D",
                      fontSize: 13,
                      fontWeight: 700,
                      padding: "11px 18px",
                      borderRadius: 10,
                      textAlign: "center",
                    }}
                  >
                    {t.proposalRequested} ✓
                  </div>
                )}
                <button
                  onClick={() => showToast(t.demoOnly)}
                  className="hover:border-[#1B3568]"
                  style={{
                    background: "#fff",
                    color: "#1B3568",
                    border: "1.5px solid #D5DDE9",
                    cursor: "pointer",
                    fontSize: 13.5,
                    fontWeight: 600,
                    padding: "10px 18px",
                    borderRadius: 10,
                  }}
                >
                  {t.viewProfile}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
