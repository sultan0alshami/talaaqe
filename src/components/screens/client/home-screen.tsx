"use client";
// Client dashboard home (client-screens.md §1, shells §5.1/§5.3).
import { useRouter } from "next/navigation";
import type { ProjectListItemDTO } from "@/lib/domain";
import { fmtBudget, fmtNum } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { StatusChip } from "@/components/ui/status-chip";

export function HomeScreen({
  firstNameAr,
  firstNameEn,
  activeCount,
  briefsCount,
  proposalsCount,
  projects,
}: {
  firstNameAr: string;
  firstNameEn: string;
  activeCount: number;
  briefsCount: number;
  proposalsCount: number;
  projects: ProjectListItemDTO[];
}) {
  const { t, isAr, pick, arrowChar } = useI18n();
  const router = useRouter();

  const firstName = isAr ? firstNameAr : firstNameEn;
  const hoursSaved = Math.round(briefsCount * 6.5);

  const stats: { label: string; v: string; color: string }[] = [
    { label: t.statActive, v: fmtNum(activeCount), color: "#1B3568" },
    { label: t.statBriefsDone, v: fmtNum(briefsCount), color: "#14969E" },
    { label: t.statProposals, v: fmtNum(proposalsCount), color: "#1B3568" },
    { label: t.statSaved, v: `${fmtNum(hoursSaved)}+`, color: "#8A6D33" },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* Page header */}
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
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>
            {isAr ? `مرحبًا ${firstName} 👋` : `Welcome, ${firstName} 👋`}
          </h1>
          <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{t.welcomeSub}</p>
        </div>
      </div>

      {/* CTA banner */}
      <div
        style={{
          background: "linear-gradient(120deg, #1B3568, #14969E 140%)",
          borderRadius: 18,
          padding: "26px 30px",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 20,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>{t.newProjectCta}</div>
          <div style={{ fontSize: 13.5, opacity: 0.8 }}>{t.newProjectSub}</div>
        </div>
        <button
          onClick={() => router.push("/client/chat")}
          className="hover:-translate-y-[1px]"
          style={{
            background: "#fff",
            color: "#1B3568",
            border: "none",
            cursor: "pointer",
            fontSize: 15,
            fontWeight: 700,
            padding: "13px 26px",
            borderRadius: 11,
            boxShadow: "0 6px 18px rgba(0,0,0,.15)",
          }}
        >
          {t.newProjectCta} ✦
        </button>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 26 }}>
        {stats.map((s, i) => (
          <div
            key={i}
            style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 16, padding: 20 }}
          >
            <div style={{ fontSize: 13, color: "#7684A0", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 27, fontWeight: 700, color: s.color }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Recent projects card */}
      <div style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 18, overflow: "hidden" }}>
        <div
          style={{
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #EEF1F6",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700 }}>{t.myProjects}</span>
          <button
            onClick={() => router.push("/client/projects")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#14969E",
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {t.viewAll} {arrowChar}
          </button>
        </div>
        {projects.length === 0 ? (
          <div style={{ padding: "22px 24px" }}>
            <div style={{ fontSize: 13.5, color: "#7684A0", marginBottom: 12 }}>{t.newProjectSub}</div>
            <button
              onClick={() => router.push("/client/chat")}
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
              {t.newProjectCta} {arrowChar}
            </button>
          </div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/client/projects/${p.id}`)}
              className="hover:bg-[#FAFBFD]"
              style={{
                padding: "15px 24px",
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                gap: 12,
                alignItems: "center",
                borderBottom: "1px solid #F3F5F9",
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{pick(p.titleAr, p.titleEn)}</div>
                <div style={{ fontSize: 12.5, color: "#93A1B8" }}>{pick(p.categoryAr, p.categoryEn)}</div>
              </div>
              <div style={{ fontSize: 13.5, color: "#4A5A76" }}>{fmtBudget(p.budgetMin, p.budgetMax)}</div>
              <div style={{ fontSize: 13.5, color: "#4A5A76" }}>{pick(p.timelineAr, p.timelineEn) || "—"}</div>
              <div>
                <StatusChip status={p.status} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
