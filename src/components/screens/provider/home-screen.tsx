"use client";
// Provider dashboard / opportunities (spec provider-admin §1, behaviors §6.3).
// Stats are computed from real data; accept/decline mutate via the REST API
// with optimistic local state + router.refresh().
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { ReasonModal } from "@/components/ui/reason-modal";
import { fmtBudget, fmtNum } from "@/lib/format";
import type { OpportunityDTO } from "@/lib/domain";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: "22px 24px",
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gap: 20,
  alignItems: "center",
};

const resolvedBlock: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: "11px 18px",
  borderRadius: 10,
  textAlign: "center",
};

export function ProviderHomeScreen({
  nameAr,
  nameEn,
  rating,
  opportunities,
  proposalSentCount,
}: {
  nameAr: string;
  nameEn: string;
  rating: number;
  opportunities: OpportunityDTO[];
  proposalSentCount: number;
}) {
  const { t, isAr, pick } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const [override, setOverride] = useState<Record<string, OpportunityDTO["status"]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [declining, setDeclining] = useState<string | null>(null); // matchId awaiting a reason

  const ops = opportunities.map((o) => ({ ...o, status: override[o.matchId] ?? o.status }));
  const matched = ops.filter((o) => o.status === "RECOMMENDED").length;
  const acceptedCount = ops.filter((o) => o.status === "ACCEPTED").length;
  const declinedCount = ops.filter((o) => o.status === "DECLINED").length;
  const responded = acceptedCount + proposalSentCount + declinedCount;
  const acceptRate = responded > 0 ? `${Math.round(((acceptedCount + proposalSentCount) / responded) * 100)}%` : "—";

  const firstName = (pick(nameAr, nameEn) || "").trim().split(/\s+/)[0] || "";
  const welcome = isAr ? `هلا ${firstName} 👋` : `Welcome, ${firstName} 👋`;
  const welcomeSub = isAr
    ? `عندك ${fmtNum(matched)} فرص جديدة تناسب تخصصك`
    : `You have ${fmtNum(matched)} new opportunities matched to your specialty`;

  const stats: { label: string; v: string; color: string }[] = [
    { label: t.pStatOps, v: fmtNum(matched), color: "#14969E" },
    { label: t.pStatActive, v: fmtNum(acceptedCount + proposalSentCount), color: "#1B3568" },
    { label: t.pStatRating, v: `${rating} ★`, color: "#8A6D33" },
    { label: t.pStatResponse, v: acceptRate, color: "#1B3568" },
  ];

  const accept = async (matchId: string) => {
    setBusy((b) => ({ ...b, [matchId]: true }));
    setOverride((o) => ({ ...o, [matchId]: "ACCEPTED" })); // optimistic
    showToast(t.accepted);
    const res = await fetch(`/api/provider/opportunities/${matchId}/accept`, { method: "POST" }).catch(() => null);
    if (!res || !res.ok) {
      setOverride((o) => {
        const { [matchId]: _drop, ...rest } = o;
        return rest;
      });
    } else {
      router.refresh();
    }
    setBusy((b) => ({ ...b, [matchId]: false }));
  };

  const confirmDecline = async (reason: string) => {
    const matchId = declining;
    if (!matchId) return;
    setBusy((b) => ({ ...b, [matchId]: true }));
    const res = await fetch(`/api/provider/opportunities/${matchId}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
    if (res && res.ok) {
      setOverride((o) => ({ ...o, [matchId]: "DECLINED" }));
      setDeclining(null);
      router.refresh();
    } else {
      showToast(isAr ? "ما قدرنا نرسل الاعتذار — جرّب مرة ثانية" : "Couldn't submit — please try again");
    }
    setBusy((b) => ({ ...b, [matchId]: false }));
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{welcome}</h1>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{welcomeSub}</p>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 27, fontWeight: 700, color: s.color }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Section header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 3px" }}>{t.opsTitle}</h2>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 13.5 }}>{t.opsSub}</p>
      </div>

      {/* Opportunity cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {ops.length === 0 && (
          <div style={{ fontSize: 13.5, color: "#7684A0" }}>
            {isAr ? "ما عندك فرص متوافقة الحين — بيوصلك إشعار أول ما تترشّح لمشروع جديد" : "No matched opportunities right now — you will be notified when a new project matches you"}
          </div>
        )}
        {ops.map((op) => {
          const scoreColor = op.score >= 85 ? "#0E7A81" : "#8A6D33";
          return (
            <div key={op.matchId} style={cardStyle}>
              {/* Match score */}
              <div style={{ textAlign: "center", minWidth: 64 }}>
                <div style={{ fontSize: 23, fontWeight: 700, color: scoreColor }}>{op.score}%</div>
                <div style={{ fontSize: 11, color: "#93A1B8" }}>{t.matchScore}</div>
              </div>
              {/* Body */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 3 }}>
                  {pick(op.projectTitleAr, op.projectTitleEn)}
                </div>
                <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 10 }}>
                  {t.clientLabel}: {pick(op.clientAr, op.clientEn)} · {t.budgetLabel}:{" "}
                  {fmtBudget(op.budgetMin, op.budgetMax)} {t.perProject} · {t.timelineLabel}:{" "}
                  {pick(op.timelineAr, op.timelineEn) || "—"}
                </div>
                {op.skills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {op.skills.map((sk) => (
                      <span
                        key={sk}
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
                )}
                {(op.noteAr || op.noteEn) && (
                  <div
                    style={{
                      fontSize: 13,
                      color: "#6E5A31",
                      background: "#FDF9F0",
                      borderRadius: 8,
                      padding: "8px 13px",
                      display: "inline-block",
                    }}
                  >
                    ⓘ {pick(op.noteAr, op.noteEn)}
                  </div>
                )}
              </div>
              {/* Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 130 }}>
                {op.status === "RECOMMENDED" && (
                  <>
                    <button
                      onClick={() => accept(op.matchId)}
                      disabled={!!busy[op.matchId]}
                      className="hover:bg-[#14969E]!"
                      style={{
                        background: "#0E7A81",
                        color: "#fff",
                        border: "none",
                        cursor: busy[op.matchId] ? "default" : "pointer",
                        fontSize: 13.5,
                        fontWeight: 700,
                        padding: "11px 18px",
                        borderRadius: 10,
                        opacity: busy[op.matchId] ? 0.7 : 1,
                      }}
                    >
                      {t.accept}
                    </button>
                    <button
                      onClick={() => setDeclining(op.matchId)}
                      disabled={!!busy[op.matchId]}
                      className="hover:border-[#B0433A]! hover:text-[#B0433A]!"
                      style={{
                        background: "#fff",
                        color: "#7684A0",
                        border: "1.5px solid #E4E9F1",
                        cursor: busy[op.matchId] ? "default" : "pointer",
                        fontSize: 13.5,
                        fontWeight: 600,
                        padding: "10px 18px",
                        borderRadius: 10,
                        opacity: busy[op.matchId] ? 0.7 : 1,
                      }}
                    >
                      {t.decline}
                    </button>
                  </>
                )}
                {op.status === "ACCEPTED" && (
                  <div style={{ ...resolvedBlock, background: "#E9F6EF", color: "#1F7A4D" }}>{t.accepted}</div>
                )}
                {op.status === "DECLINED" && (
                  <div style={{ ...resolvedBlock, background: "#F0F3F8", color: "#93A1B8" }}>{t.declined}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ReasonModal
        open={!!declining}
        title={t.declineTitle}
        sub={t.declineSub}
        placeholder={t.declinePlaceholder}
        confirmLabel={t.declineConfirm}
        cancelLabel={t.declineCancel}
        busy={!!declining && !!busy[declining]}
        onConfirm={confirmDecline}
        onCancel={() => setDeclining(null)}
      />
    </div>
  );
}
