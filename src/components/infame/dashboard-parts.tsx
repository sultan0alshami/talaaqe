"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatMoneyDecimal, type Money } from "@/lib/contracts/money";
import { useDealCopy } from "./deal-copy";

export type DashboardCampaign = {
  id: string;
  title: string | null;
  status: string;
  currentBriefVersion: number | null;
  updatedAt: string;
};
export type DashboardDeal = {
  id: string;
  campaignTitle: string | null;
  status: string;
  amount: Money;
  offerVersion: number;
  updatedAt: string;
  briefVersion?: number;
};

export const campaignStatuses: Record<string, [string, string]> = {
  DRAFT: ["مسودة", "Draft"],
  BRIEF_GENERATED: ["موجز للمراجعة", "Brief ready for review"],
  BRIEF_APPROVED: ["موجز معتمد", "Brief approved"],
  SHORTLISTED: ["تم إعداد القائمة", "Shortlisted"],
  IN_DEALS: ["صفقات جارية", "Deals in progress"],
  COMPLETED: ["مكتملة", "Completed"],
  CANCELLED: ["ملغاة", "Cancelled"],
};

function DashboardDate({ value }: { value: string }) {
  const { isAr } = useI18n();
  return (
    <span>
      <time dateTime={value}>
        {new Intl.DateTimeFormat(isAr ? "ar" : "en", {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(value))}
      </time>{" "}
      <bdi>UTC</bdi>
    </span>
  );
}

// Retained project rows: 15/16 × 24 px, compact metadata and a single panel.
export function DashboardCampaignRows({
  campaigns,
  compact = false,
}: {
  campaigns: DashboardCampaign[];
  compact?: boolean;
}) {
  const { isAr } = useI18n();
  const copy = (ar: string, en: string) => (isAr ? ar : en);
  const columns = compact
    ? "sm:grid-cols-[2fr_1fr_1fr_1fr]"
    : "sm:grid-cols-[2fr_1fr_1fr_1fr_1fr]";
  return (
    <div role="table" aria-label={copy("الحملات", "Campaigns")} aria-colcount={compact ? 4 : 5}>
      <div role="row" className={compact ? "sr-only" : `sr-only sm:not-sr-only sm:grid sm:gap-3 sm:border-b sm:border-border sm:bg-muted sm:px-6 sm:py-[13px] sm:text-[12.5px] sm:font-bold sm:text-muted-foreground ${columns}`}>
        {[
          copy("الحملة", "Campaign"),
          copy("الموجز", "Brief"),
          copy("آخر تحديث", "Last updated"),
          copy("الحالة", "Status"),
          ...(!compact ? [copy("التفاصيل", "Details")] : []),
        ].map((heading, index) => <div key={heading} role="columnheader" aria-colindex={index + 1}>{heading}</div>)}
      </div>
      {campaigns.map((campaign) => {
        const title = campaign.title || copy("حملة بدون اسم بعد", "Campaign not named yet");
        const href = `/brand/campaigns/${encodeURIComponent(campaign.id)}`;
        return (
          <div key={campaign.id} role="row" data-campaign-id={campaign.id} className={`grid items-center gap-3 border-b border-border px-6 last:border-b-0 ${compact ? "py-[15px]" : "py-4"} ${columns}`}>
            <div role="cell" className="min-w-0">
              <Link href={href} dir="auto" className="block min-h-11 max-w-full break-words py-2 text-[14.5px] font-semibold underline-offset-4 hover:underline">{title}</Link>
            </div>
            <div role="cell" className="text-[13.5px] text-muted-foreground">
              <span className="sm:sr-only">{copy("الموجز", "Brief")}: </span>
              {campaign.currentBriefVersion === null
                ? copy("غير معتمد", "Not approved")
                : <><span>{copy("نسخة", "Version")} </span><bdi>{campaign.currentBriefVersion}</bdi></>}
            </div>
            <div role="cell" className="text-[13px] text-muted-foreground"><DashboardDate value={campaign.updatedAt} /></div>
            <div role="cell"><span className="inline-flex rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-accent-foreground">{campaignStatuses[campaign.status]?.[isAr ? 0 : 1] ?? campaign.status}</span></div>
            {!compact && <div role="cell"><Link href={href} className="inline-flex min-h-11 items-center text-[13px] font-semibold underline-offset-4 hover:underline">{copy("افتح الحملة", "Open campaign")}<span className="sr-only">: {title}</span></Link></div>}
          </div>
        );
      })}
    </div>
  );
}

// Retained provider opportunity geometry; the side number is a real offer version.
export function DashboardDealCard({ deal, role }: { deal: DashboardDeal; role: "BRAND" | "CREATOR" }) {
  const { copy, status } = useDealCopy();
  const title = deal.campaignTitle || `${copy("صفقة", "Deal")} #${deal.id.slice(0, 8)}`;
  return (
    <Card className="grid gap-5 rounded-[18px] border border-border px-6 py-[22px] ring-0 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <div className="flex items-center gap-3 sm:block sm:min-w-16 sm:text-center">
        <p className="text-[23px] font-bold leading-snug"><bdi>{deal.offerVersion}</bdi></p>
        <p className="text-[11px] text-muted-foreground">{copy("نسخة العرض", "Offer version")}</p>
      </div>
      <div className="min-w-0">
        <h2 dir="auto" className="mb-[3px] break-words text-base font-bold">{title}</h2>
        <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <bdi dir="ltr">{formatMoneyDecimal(deal.amount)} {deal.amount.currencyCode}</bdi>
          <span aria-hidden="true">·</span>
          <DashboardDate value={deal.updatedAt} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-accent px-[11px] py-[3px] text-xs font-semibold text-accent-foreground">{status(deal.status)}</span>
          {deal.briefVersion !== undefined && <span className="rounded-full bg-muted px-[11px] py-[3px] text-xs font-semibold">{copy("موجز الحملة", "Campaign brief")} <bdi>{deal.briefVersion}</bdi></span>}
        </div>
      </div>
      <div className="sm:min-w-[130px]">
        <Button variant="outline" asChild className="h-auto min-h-11 w-full rounded-[10px] px-[18px] py-2.5 text-[13.5px] font-semibold">
          <Link href={`/${role.toLowerCase()}/deals/${encodeURIComponent(deal.id)}`} aria-label={`${copy("افتح الصفقة", "Open deal")}: ${deal.id}`}>{copy("افتح الصفقة", "Open deal")}</Link>
        </Button>
      </div>
    </Card>
  );
}

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
  flush = false,
}: {
  title: string;
  href: string;
  action: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <Card className="gap-0 rounded-[18px] border border-border py-0 ring-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-[18px]">
        <h2 className="text-base font-bold">{title}</h2>
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-2 text-[13.5px] font-semibold underline-offset-4 hover:underline"
        >
          {action}{" "}
          <span aria-hidden="true" className="rtl:rotate-180">
            →
          </span>
        </Link>
      </div>
      <div className={flush ? "" : "px-6 py-[22px]"}>{children}</div>
    </Card>
  );
}
