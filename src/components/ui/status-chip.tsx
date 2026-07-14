"use client";
import type { ProjectStatus } from "@prisma/client";
import { statusChip } from "@/lib/domain";
import { useI18n } from "@/lib/i18n";

export function StatusChip({ status, large = false }: { status: ProjectStatus; large?: boolean }) {
  const { t } = useI18n();
  const chip = statusChip(status);
  return (
    <span
      style={{
        fontSize: large ? 13 : 12,
        fontWeight: large ? 700 : 600,
        padding: large ? "7px 18px" : "4px 12px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: chip.bg,
        color: chip.fg,
        display: "inline-block",
      }}
    >
      {String(t[chip.labelKey])}
    </span>
  );
}
