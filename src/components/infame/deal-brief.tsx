"use client";

import { useId } from "react";
import type { CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import { useI18n } from "@/lib/i18n";
import { campaignRequirementRows } from "./campaign-field-display";

// Read the already-loaded, owner-approved version belonging to this deal.
// Current execution/eligibility warnings remain in the parent deal screen.
export function DealBrief({ requirements, campaignId, briefVersion }: {
  requirements: CampaignRequirementsDTO | null | undefined;
  campaignId: string;
  briefVersion: number;
}) {
  const { isAr } = useI18n(), id = useId();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const matches = requirements?.campaignId === campaignId && requirements?.version === briefVersion;
  if (!requirements || !matches) return <section aria-labelledby={id} className="space-y-3">
    <h2 id={id}>{copy("موجز الصفقة المعتمد", "Deal’s approved brief")}</h2>
    <p className="text-sm leading-7 text-muted-foreground">{copy("تعذر عرض المتطلبات المعتمدة لهذه النسخة. حمّل الحالة الحالية لمراجعة السياق المتاح.", "Approved requirements for this version could not be displayed. Load current state to review the available context.")}</p>
  </section>;

  const originalFields = new Set(["title", "productService", "summary", "tone", "noGoTopics", "usageRights", "kpis", "assumptions", "openQuestions"]);
  const rows = campaignRequirementRows(requirements, isAr);
  return <section aria-labelledby={id} className="space-y-3">
    <h2 id={id}>{copy("موجز الصفقة المعتمد", "Deal’s approved brief")} · {copy("النسخة", "Version")} <bdi>{requirements.version}</bdi></h2>
    <p className="text-sm leading-7 text-muted-foreground">{copy("هذه المتطلبات المحفوظة للنسخة المعتمدة المرتبطة بالصفقة. شروط العرض والاتفاق وفحوص الجاهزية الحالية مستقلة.", "These are the saved requirements of the approved version linked to this deal. Offer terms, the agreement and current readiness checks remain separate.")}</p>
    <details className="min-w-0 rounded-xl border border-border p-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{copy("متطلبات الموجز المعتمدة", "Approved brief requirements")}</summary>
      <dl className="min-w-0 space-y-4">{rows.map(row => <div key={row.key} data-brief-field={row.key} className="min-w-0 border-b border-border pb-4 last:border-b-0 last:pb-0">
        <dt className="text-xs font-semibold text-muted-foreground">{row.label}</dt>
        <dd className="m-0 mt-1 min-w-0 whitespace-pre-wrap break-words text-sm leading-7" dir="auto" lang={originalFields.has(row.key) ? requirements.originalLanguage ?? undefined : undefined}>{row.value}</dd>
      </div>)}</dl>
    </details>
  </section>;
}
