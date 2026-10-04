"use client";
// My projects table (client-screens.md §5, shells §5.2).
import { useRouter } from "next/navigation";
import type { ProjectListItemDTO } from "@/lib/domain";
import { fmtBudget, fmtDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { StatusChip } from "@/components/ui/status-chip";

export function ProjectsScreen({ projects }: { projects: ProjectListItemDTO[] }) {
  const { t, pick, arrowChar } = useI18n();
  const router = useRouter();

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>{t.myProjects}</h1>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
        <div
          style={{
            padding: "13px 24px",
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
            gap: 12,
            background: "var(--background)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--muted-foreground)",
          }}
        >
          <span>{t.thProject}</span>
          <span>{t.thBudget}</span>
          <span>{t.thTimeline}</span>
          <span>{t.thStatus}</span>
          <span>{t.thDate}</span>
        </div>
        {projects.length === 0 ? (
          <div style={{ padding: "22px 24px" }}>
            <div style={{ fontSize: 13.5, color: "var(--muted-foreground)", marginBottom: 12 }}>{t.newProjectSub}</div>
            <button
              onClick={() => router.push("/client/chat")}
              className="hover:bg-[#E1E9F6]!"
              style={{
                background: "var(--muted)",
                color: "var(--foreground)",
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
              className="hover:bg-[var(--background)]"
              style={{
                padding: "16px 24px",
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                gap: 12,
                alignItems: "center",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{pick(p.titleAr, p.titleEn)}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{pick(p.categoryAr, p.categoryEn)}</div>
              </div>
              <span style={{ fontSize: 13.5, color: "var(--muted-foreground)" }}>{fmtBudget(p.budgetMin, p.budgetMax)}</span>
              <span style={{ fontSize: 13.5, color: "var(--muted-foreground)" }}>{pick(p.timelineAr, p.timelineEn) || "—"}</span>
              <div>
                <StatusChip status={p.status} />
              </div>
              <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{fmtDate(p.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
