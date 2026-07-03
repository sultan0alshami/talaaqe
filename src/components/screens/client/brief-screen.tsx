"use client";
// Project brief screen (client-screens spec §3, behaviors §5).
// Title/summary/budget become inputs in edit mode; save = PATCH brief.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { COMPLEXITY_LABELS, type BriefDTO } from "@/lib/domain";
import { fmtBudget } from "@/lib/format";
import { BRIEF } from "@/lib/talaqi-data";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: 26,
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  color: "#93A1B8",
  letterSpacing: ".05em",
  marginBottom: 8,
};
const darkDivider: React.CSSProperties = {
  height: 1,
  background: "rgba(255,255,255,.15)",
  margin: "16px 0",
};
const darkLabel: React.CSSProperties = { fontSize: 12.5, opacity: 0.7, marginBottom: 4 };

export function BriefScreen({
  brief: initialBrief,
  projectId,
}: {
  brief: BriefDTO | null;
  projectId: string | null;
}) {
  const { t, isAr, pick, arrowChar } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();

  const [brief, setBrief] = useState<BriefDTO | null>(initialBrief);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", budgetMin: "", budgetMax: "" });
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);

  // ── Empty state (spec §5.11 pattern) ────────────────────────────
  if (!brief || !projectId) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ ...card, padding: "48px 32px", textAlign: "center" }}>
          <p style={{ margin: "0 0 18px", fontSize: 14.5, color: "#7684A0" }}>{t.newProjectSub}</p>
          <button
            onClick={() => router.push("/client/chat")}
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
            {t.newProjectCta} ✦
          </button>
        </div>
      </div>
    );
  }

  const titleView = pick(brief.titleAr, brief.titleEn);
  const summaryView = pick(brief.summaryAr, brief.summaryEn);
  const scope = isAr ? brief.scopeAr : brief.scopeEn;
  const deliverables = isAr ? brief.deliverablesAr : brief.deliverablesEn;
  const criteria = isAr ? brief.criteriaAr : brief.criteriaEn;
  const missing = isAr ? brief.missingAr : brief.missingEn;
  const complexityLabel = pick(
    COMPLEXITY_LABELS[brief.complexity].ar,
    COMPLEXITY_LABELS[brief.complexity].en
  );

  const toggleEdit = async () => {
    if (!editing) {
      setForm({
        title: titleView,
        summary: summaryView,
        budgetMin: String(brief.budgetMin),
        budgetMax: String(brief.budgetMax),
      });
      setEditing(true);
      return;
    }
    if (saving) return;
    // Save: PATCH only the changed fields.
    const patch: Record<string, string | number> = {};
    if (form.title.trim() && form.title.trim() !== titleView) patch.title = form.title.trim();
    if (form.summary.trim() && form.summary.trim() !== summaryView)
      patch.summary = form.summary.trim();
    const bMin = parseInt(form.budgetMin, 10);
    const bMax = parseInt(form.budgetMax, 10);
    if (Number.isFinite(bMin) && bMin > 0 && bMin !== brief.budgetMin) patch.budgetMin = bMin;
    if (Number.isFinite(bMax) && bMax > 0 && bMax !== brief.budgetMax) patch.budgetMax = bMax;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/brief`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.brief) {
        setBrief(data.brief as BriefDTO);
        showToast(t.settingsSaved);
        setEditing(false);
      }
    } catch {
      // keep edit mode open on failure
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (approving) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/brief/approve`, { method: "POST" });
      if (res.ok) {
        setEditing(false);
        showToast(t.briefApprovedToast);
        router.push(`/client/matches?project=${projectId}`);
        return;
      }
    } catch {
      // fall through
    }
    setApproving(false);
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "#14969E",
              letterSpacing: ".04em",
              marginBottom: 6,
            }}
          >
            ✦ {t.briefKicker}
          </div>
          {!editing ? (
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>{titleView}</h1>
          ) : (
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              style={{
                fontSize: 22,
                fontWeight: 700,
                border: "1.5px solid #14969E",
                borderRadius: 10,
                padding: "8px 14px",
                width: 480,
                maxWidth: "100%",
                outline: "none",
              }}
            />
          )}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "#E9F6EF",
              color: "#1F7A4D",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "4px 14px",
              borderRadius: 999,
              marginTop: 10,
            }}
          >
            ● {t.briefReady}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => void toggleEdit()}
            disabled={saving}
            className="hover:border-[#1B3568]"
            style={{
              background: "#fff",
              color: "#1B3568",
              border: "1.5px solid #D5DDE9",
              cursor: "pointer",
              fontSize: 13.5,
              fontWeight: 600,
              padding: "11px 20px",
              borderRadius: 10,
            }}
          >
            {editing ? t.briefSaveEdit : "✎ " + t.briefEdit}
          </button>
          <button
            onClick={() => void approve()}
            disabled={approving}
            className="hover:bg-[#24437F]"
            style={{
              background: "#1B3568",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 13.5,
              fontWeight: 700,
              padding: "11px 22px",
              borderRadius: 10,
              boxShadow: "0 6px 16px rgba(27,53,104,.25)",
            }}
          >
            {t.briefApprove} {arrowChar}
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 18,
          alignItems: "start",
        }}
      >
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Summary & objective */}
          <div style={card}>
            <div style={sectionLabel}>{t.bSummary}</div>
            {!editing ? (
              <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.9, color: "#2C3A54" }}>
                {summaryView}
              </p>
            ) : (
              <textarea
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                rows={4}
                style={{
                  width: "100%",
                  border: "1.5px solid #14969E",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 14.5,
                  lineHeight: 1.8,
                  outline: "none",
                  marginBottom: 18,
                  resize: "vertical",
                }}
              />
            )}
            <div style={sectionLabel}>{t.bObjective}</div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.9, color: "#4A5A76" }}>
              {pick(brief.objectiveAr, brief.objectiveEn)}
            </p>
          </div>

          {/* Scope + deliverables */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{t.bScope}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {scope.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#EEF3FB",
                      color: "#1B3568",
                      fontSize: 11.5,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 3,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 14.5, color: "#2C3A54" }}>{s}</span>
                </div>
              ))}
            </div>
            <div style={{ height: 1, background: "#EEF1F6", margin: "20px 0" }} />
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{t.bDeliverables}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {deliverables.map((d, i) => (
                <span
                  key={i}
                  style={{
                    background: "#F2F7F9",
                    border: "1px solid #DCEBEE",
                    color: "#0E7A81",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "6px 14px",
                    borderRadius: 999,
                  }}
                >
                  {d}
                </span>
              ))}
            </div>
          </div>

          {/* Milestones timeline */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{t.bMilestones}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {brief.milestones.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: "50%",
                        background: "#14969E",
                        flexShrink: 0,
                        marginTop: 5,
                      }}
                    />
                    {i < brief.milestones.length - 1 && (
                      <span style={{ width: 2, flex: 1, background: "#DCEBEE" }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: 18 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0E7A81" }}>
                      {pick(m.tAr, m.tEn)}
                    </div>
                    <div style={{ fontSize: 14, color: "#4A5A76" }}>{pick(m.dAr, m.dEn)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Dark gradient card */}
          <div
            style={{
              background: "linear-gradient(150deg, #1B3568, #0F5E64)",
              borderRadius: 18,
              padding: 24,
              color: "#fff",
            }}
          >
            <div style={darkLabel}>{t.bBudget}</div>
            {!editing ? (
              <div style={{ fontSize: 25, fontWeight: 700 }}>
                {fmtBudget(brief.budgetMin, brief.budgetMax)}{" "}
                <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.7 }}>
                  {pick(BRIEF.budgetUnitAr, BRIEF.budgetUnitEn)}
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                {(["budgetMin", "budgetMax"] as const).map((key) => (
                  <input
                    key={key}
                    type="number"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 12px",
                      width: "100%",
                      minWidth: 0,
                      outline: "none",
                    }}
                  />
                ))}
              </div>
            )}
            <div style={darkDivider} />
            <div style={darkLabel}>{t.bTimeline}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {pick(brief.timelineAr, brief.timelineEn)}
            </div>
            <div style={darkDivider} />
            <div style={{ ...darkLabel, marginBottom: 8 }}>
              {t.bComplexity}: {complexityLabel}
            </div>
            <div
              style={{
                height: 7,
                background: "rgba(255,255,255,.18)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${brief.complexityPct}%`,
                  background: "#C6A15B",
                  borderRadius: 999,
                }}
              />
            </div>
          </div>

          {/* Skills */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t.bSkills}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {brief.requiredSkills.map((sk, i) => (
                <span
                  key={i}
                  dir="ltr"
                  style={{
                    background: "#EEF3FB",
                    color: "#1B3568",
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: "5px 13px",
                    borderRadius: 999,
                  }}
                >
                  {sk}
                </span>
              ))}
            </div>
          </div>

          {/* Provider type + criteria */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t.bProviderType}</div>
            <div style={{ fontSize: 14, color: "#4A5A76", marginBottom: 16 }}>
              {pick(brief.providerTypeAr, brief.providerTypeEn)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{t.bCriteria}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {criteria.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 9,
                    alignItems: "flex-start",
                    fontSize: 13.5,
                    color: "#4A5A76",
                  }}
                >
                  <span style={{ color: "#14969E", fontWeight: 700 }}>✓</span>
                  {c}
                </div>
              ))}
            </div>
          </div>

          {/* Open questions (amber) — hidden when empty */}
          {missing.length > 0 && (
            <div
              style={{
                background: "#FDF9F0",
                border: "1px solid #EFE2C6",
                borderRadius: 18,
                padding: 22,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: "#8A6D33", marginBottom: 10 }}>
                {t.bMissing}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {missing.map((q, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: "#6E5A31" }}>
                    ؟ {q}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
