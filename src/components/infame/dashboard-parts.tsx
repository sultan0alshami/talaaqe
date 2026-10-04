import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";

// Original Talaqee home-screen card geometry, composed with reviewed primitives.
export function DashboardStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <Card className="gap-0 rounded-2xl border border-border p-5 ring-0">
      <p className="mb-1.5 text-[13px] text-muted-foreground">{label}</p>
      <div className="break-words text-[27px] font-bold leading-snug">
        {value}
      </div>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </Card>
  );
}
export function DashboardSection({
  title,
  href,
  action,
  children,
}: {
  title: string;
  href: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 rounded-[18px] border border-border py-0 ring-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-[18px]">
        <h2 className="text-base font-bold">{title}</h2>
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline"
        >
          {action}{" "}
          <span aria-hidden="true" className="rtl:rotate-180">
            →
          </span>
        </Link>
      </div>
      <div className="px-6 py-[22px]">{children}</div>
    </Card>
  );
}
