"use client";
// Admin projects table (provider-admin spec §6). Read-only.
import type { ProjectStatus } from "@prisma/client";
import { useI18n } from "@/lib/i18n";
import { fmtBudget, fmtDate } from "@/lib/format";
import { StatusChip } from "@/components/ui/status-chip";

type ProjectRow = {
  id: string;
  titleAr: string;
  titleEn: string;
  clientAr: string;
  clientEn: string;
  categoryAr: string | null;
  categoryEn: string | null;
  status: ProjectStatus;
  budgetMin: number | null;
  budgetMax: number | null;
  createdAt: string;
};

const GRID = "2fr 1fr 1fr 1fr 1fr";

export function ProjectsScreen({ projects }: { projects: ProjectRow[] }) {
  const { t, pick } = useI18n();

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>{t.aProjectsTitle}</h1>
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 18, overflow: "hidden" }}>
        <div
          style={{
            padding: "13px 24px",
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 12,
            background: "var(--background)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--muted-foreground)",
          }}
        >
          <span>{t.thProject}</span>
          <span>{t.thClient}</span>
          <span>{t.thBudget}</span>
          <span>{t.thStatus}</span>
          <span>{t.thDate}</span>
        </div>
        {projects.length === 0 && (
          <div style={{ padding: "22px 24px", fontSize: 13.5, color: "var(--muted-foreground)" }}>—</div>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className="hover:bg-[var(--background)]"
            style={{
              padding: "15px 24px",
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 12,
              alignItems: "center",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{pick(p.titleAr, p.titleEn)}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                {p.categoryAr ? pick(p.categoryAr, p.categoryEn ?? p.categoryAr) : "—"}
              </div>
            </div>
            <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{pick(p.clientAr, p.clientEn)}</span>
            <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{fmtBudget(p.budgetMin, p.budgetMax)}</span>
            <div>
              <StatusChip status={p.status} />
            </div>
            <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{fmtDate(p.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
