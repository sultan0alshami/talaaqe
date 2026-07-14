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
          <span>{t.thClient}</span>
          <span>{t.thBudget}</span>
          <span>{t.thStatus}</span>
          <span>{t.thDate}</span>
        </div>
        {projects.length === 0 && (
          <div style={{ padding: "22px 24px", fontSize: 13.5, color: "#93A1B8" }}>—</div>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className="hover:bg-[#FAFBFD]"
            style={{
              padding: "15px 24px",
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 12,
              alignItems: "center",
              borderBottom: "1px solid #F3F5F9",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{pick(p.titleAr, p.titleEn)}</div>
              <div style={{ fontSize: 12, color: "#93A1B8" }}>
                {p.categoryAr ? pick(p.categoryAr, p.categoryEn ?? p.categoryAr) : "—"}
              </div>
            </div>
            <span style={{ fontSize: 13, color: "#4A5A76" }}>{pick(p.clientAr, p.clientEn)}</span>
            <span style={{ fontSize: 13, color: "#4A5A76" }}>{fmtBudget(p.budgetMin, p.budgetMax)}</span>
            <div>
              <StatusChip status={p.status} />
            </div>
            <span style={{ fontSize: 13, color: "#93A1B8" }}>{fmtDate(p.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
