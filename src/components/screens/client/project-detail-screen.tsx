"use client";
// Project detail (client-screens.md §6, shells §5.10).
import { useRouter } from "next/navigation";
import type { ProjectDetailDTO } from "@/lib/domain";
import { COMPLEXITY_LABELS } from "@/lib/domain";
import { fmtBudget, fmtDate, fmtWhen } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { StatusChip } from "@/components/ui/status-chip";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
};

export function ProjectDetailScreen({ project }: { project: ProjectDetailDTO }) {
  const { t, isAr, lang, pick, arrowChar } = useI18n();
  const router = useRouter();

  const brief = project.brief;
  const curStep = project.journeyStep;
  const requested = project.matches.filter(
    (m) => m.status === "PROPOSAL_REQUESTED" || m.status === "PROPOSAL_SENT"
  );

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* Back link */}
      <button
        onClick={() => router.push("/client/projects")}
        className="hover:text-[#1B3568]!"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#7684A0",
          fontSize: 13.5,
          fontWeight: 600,
          padding: 0,
          marginBottom: 14,
        }}
      >
        {t.backToProjects}
      </button>

      {/* Header */}
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
          <h1 style={{ fontSize: 25, fontWeight: 700, margin: "0 0 6px" }}>
            {pick(project.titleAr, project.titleEn)}
          </h1>
          <div style={{ fontSize: 13.5, color: "#7684A0" }}>
            {pick(project.categoryAr, project.categoryEn)} · {fmtDate(project.createdAt)}
          </div>
        </div>
        <StatusChip status={project.status} large />
      </div>

      {/* Stepper card */}
      <div style={{ ...card, padding: "26px 30px", marginBottom: 18 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#93A1B8",
            letterSpacing: ".05em",
            marginBottom: 20,
          }}
        >
          {t.pdStatusT}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          {t.pdSteps.map((label: string, i: number) => {
            const done = i < curStep;
            const active = i === curStep;
            return (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", flex: i < 4 ? 1 : "0 0 auto" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 90 }}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      background: done ? "#14969E" : active ? "#1B3568" : "#fff",
                      color: done || active ? "#fff" : "#93A1B8",
                      border: done || active ? "none" : "2px solid #E4E9F1",
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      color: done || active ? "#14213A" : "#93A1B8",
                      textAlign: "center",
                      lineHeight: 1.4,
                    }}
                  >
                    {label}
                  </span>
                </div>
                {i < 4 && (
                  <div
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 999,
                      background: i < curStep ? "#14969E" : "#EEF1F6",
                      marginTop: 14,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Body grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Brief snapshot */}
          <div style={{ ...card, padding: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>{t.pdBriefT}</span>
              {brief && (
                <button
                  onClick={() => router.push(`/client/brief?project=${project.id}`)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#14969E",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {t.pdViewBrief}
                </button>
              )}
            </div>
            {brief ? (
              <>
                <p style={{ fontSize: 14.5, color: "#4A5A76", lineHeight: 1.9, margin: "0 0 16px" }}>
                  {pick(brief.summaryAr, brief.summaryEn)}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span
                    style={{
                      background: "#EEF3FB",
                      color: "#1B3568",
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: "6px 14px",
                      borderRadius: 999,
                    }}
                  >
                    {t.bBudget}: {fmtBudget(brief.budgetMin, brief.budgetMax)} {t.perProject}
                  </span>
                  <span
                    style={{
                      background: "#E8F5F6",
                      color: "#0E7A81",
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: "6px 14px",
                      borderRadius: 999,
                    }}
                  >
                    {t.bTimeline}: {pick(brief.timelineAr, brief.timelineEn)}
                  </span>
                  <span
                    style={{
                      background: "#F7F0E3",
                      color: "#8A6D33",
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: "6px 14px",
                      borderRadius: 999,
                    }}
                  >
                    {t.bComplexity}: {isAr ? COMPLEXITY_LABELS[brief.complexity].ar : COMPLEXITY_LABELS[brief.complexity].en}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13.5, color: "#7684A0", marginBottom: 12 }}>{t.newProjectSub}</div>
                <button
                  onClick={() => router.push(`/client/chat?project=${project.id}`)}
                  className="hover:bg-[#E1E9F6]!"
                  style={{
                    background: "#EEF3FB",
                    color: "#1B3568",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    padding: "10px 18px",
                    borderRadius: 10,
                  }}
                >
                  {t.cNavNew} {arrowChar}
                </button>
              </>
            )}
          </div>

          {/* Milestones */}
          {brief && brief.milestones.length > 0 && (
            <div style={{ ...card, padding: 24 }}>
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
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#0E7A81" }}>{pick(m.tAr, m.tEn)}</div>
                      <div style={{ fontSize: 14, color: "#4A5A76" }}>{pick(m.dAr, m.dEn)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Providers */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t.pdProvidersT}</div>
            {requested.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {requested.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      gap: 11,
                      alignItems: "center",
                      border: "1px solid #EEF1F6",
                      borderRadius: 12,
                      padding: "11px 14px",
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 11,
                        background: m.provider.avatarColor,
                        color: "#fff",
                        fontSize: 15,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {m.provider.avatarInitial}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {pick(m.provider.nameAr, m.provider.nameEn)}
                      </div>
                      <div style={{ fontSize: 12, color: "#93A1B8" }}>
                        {m.matchScore}% {t.matchScore}
                      </div>
                    </div>
                    <span
                      style={{
                        background: "#E9F6EF",
                        color: "#1F7A4D",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "3px 10px",
                        borderRadius: 999,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.proposalRequested}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13.5, color: "#7684A0", marginBottom: 12 }}>{t.pdNoProviders}</div>
                <button
                  onClick={() => router.push(`/client/matches?project=${project.id}`)}
                  className="hover:bg-[#E1E9F6]!"
                  style={{
                    background: "#EEF3FB",
                    color: "#1B3568",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    padding: "10px 18px",
                    borderRadius: 10,
                  }}
                >
                  {t.pdGoMatches}
                </button>
              </>
            )}
          </div>

          {/* Activity log */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t.pdActivityT}</div>
            {project.activity.length === 0 ? (
              <div style={{ fontSize: 13.5, color: "#7684A0" }}>—</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {project.activity.map((a, i) => (
                  <div key={a.id} style={{ display: "flex", gap: 13 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          background: "#C9D3E2",
                          flexShrink: 0,
                          marginTop: 6,
                        }}
                      />
                      {i < project.activity.length - 1 && (
                        <span style={{ width: 2, flex: 1, background: "#EEF1F6" }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: 16 }}>
                      <div style={{ fontSize: 11.5, color: "#93A1B8" }}>{fmtWhen(a.createdAt, lang)}</div>
                      <div style={{ fontSize: 13.5, color: "#2C3A54" }}>{pick(a.textAr, a.textEn)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
