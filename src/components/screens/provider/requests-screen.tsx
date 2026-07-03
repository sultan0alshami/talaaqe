"use client";
// Provider proposal requests (spec provider-admin §3, behaviors §6.4).
// Send-proposal / decline mutate via the REST API with optimistic state.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { ReasonModal } from "@/components/ui/reason-modal";
import { fmtAgo, fmtBudget } from "@/lib/format";
import type { OpportunityDTO } from "@/lib/domain";

const resolvedBlock: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: "11px 18px",
  borderRadius: 10,
  textAlign: "center",
};

export function ProviderRequestsScreen({ requests }: { requests: OpportunityDTO[] }) {
  const { t, isAr, lang, pick } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const [override, setOverride] = useState<Record<string, OpportunityDTO["status"]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [declining, setDeclining] = useState<string | null>(null); // matchId awaiting a reason

  const rows = requests.map((r) => ({ ...r, status: override[r.matchId] ?? r.status }));

  const send = async (matchId: string) => {
    setBusy((b) => ({ ...b, [matchId]: true }));
    setOverride((o) => ({ ...o, [matchId]: "PROPOSAL_SENT" }));
    showToast(t.reqSentLbl);
    const res = await fetch(`/api/provider/requests/${matchId}/send-proposal`, { method: "POST" }).catch(() => null);
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

  // A reason is required; the opportunities decline route also accepts
  // PROPOSAL_REQUESTED matches.
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
      showToast(isAr ? "تعذّر إرسال الاعتذار — حاول مجددًا" : "Couldn't submit — please try again");
    }
    setBusy((b) => ({ ...b, [matchId]: false }));
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{t.requestsTitle}</h1>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{t.requestsSub}</p>
      </div>

      {/* Request cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 13.5, color: "#7684A0" }}>
            {isAr ? "لا توجد طلبات عروض واردة حاليًا" : "No incoming proposal requests right now"}
          </div>
        )}
        {rows.map((rq) => (
          <div
            key={rq.matchId}
            style={{
              background: "#fff",
              border: "1px solid #E4E9F1",
              borderRadius: 18,
              padding: "22px 24px",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 20,
              alignItems: "center",
            }}
          >
            {/* Body */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{pick(rq.projectTitleAr, rq.projectTitleEn)}</span>
                <span
                  style={{
                    background: "#E8F5F6",
                    color: "#0E7A81",
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "2px 11px",
                    borderRadius: 999,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.reqReceived} {fmtAgo(rq.createdAt, lang)}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 10 }}>
                {t.clientLabel}: {pick(rq.clientAr, rq.clientEn)} · {t.budgetLabel}:{" "}
                {fmtBudget(rq.budgetMin, rq.budgetMax)} {t.perProject} · {t.timelineLabel}:{" "}
                {pick(rq.timelineAr, rq.timelineEn) || "—"}
              </div>
              {(rq.noteAr || rq.noteEn) && (
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
                  ⓘ {pick(rq.noteAr, rq.noteEn)}
                </div>
              )}
            </div>
            {/* Actions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 140 }}>
              {rq.status === "PROPOSAL_REQUESTED" && (
                <>
                  <button
                    onClick={() => send(rq.matchId)}
                    disabled={!!busy[rq.matchId]}
                    className="hover:bg-[#24437F]!"
                    style={{
                      background: "#1B3568",
                      color: "#fff",
                      border: "none",
                      cursor: busy[rq.matchId] ? "default" : "pointer",
                      fontSize: 13.5,
                      fontWeight: 700,
                      padding: "11px 18px",
                      borderRadius: 10,
                      opacity: busy[rq.matchId] ? 0.7 : 1,
                    }}
                  >
                    {t.reqSend}
                  </button>
                  <button
                    onClick={() => setDeclining(rq.matchId)}
                    disabled={!!busy[rq.matchId]}
                    className="hover:border-[#B0433A]! hover:text-[#B0433A]!"
                    style={{
                      background: "#fff",
                      color: "#7684A0",
                      border: "1.5px solid #E4E9F1",
                      cursor: busy[rq.matchId] ? "default" : "pointer",
                      fontSize: 13.5,
                      fontWeight: 600,
                      padding: "10px 18px",
                      borderRadius: 10,
                      opacity: busy[rq.matchId] ? 0.7 : 1,
                    }}
                  >
                    {t.decline}
                  </button>
                </>
              )}
              {rq.status === "PROPOSAL_SENT" && (
                <div style={{ ...resolvedBlock, background: "#E9F6EF", color: "#1F7A4D" }}>{t.reqSentLbl}</div>
              )}
              {rq.status === "DECLINED" && (
                <div style={{ ...resolvedBlock, background: "#F0F3F8", color: "#93A1B8" }}>{t.declined}</div>
              )}
            </div>
          </div>
        ))}
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
