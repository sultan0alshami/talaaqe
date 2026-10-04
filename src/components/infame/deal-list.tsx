"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DealDTO } from "@/lib/deals/service";
import { useDealCopy } from "./deal-copy";
import { DashboardDealCard } from "./dashboard-parts";

export function DealList({
  initialDeals,
  initialCursor,
  role,
}: {
  initialDeals: DealDTO[];
  initialCursor: string | null;
  role: "BRAND" | "CREATOR";
}) {
  const { copy, errorCopy } = useDealCopy();
  const [deals, setDeals] = useState(initialDeals),
    [cursor, setCursor] = useState(initialCursor),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  async function more() {
    if (!cursor || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/deals?cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.code ?? "INTERNAL_ERROR");
        return;
      }
      setDeals((previous) => [
        ...previous,
        ...body.data.deals.filter(
          (row: DealDTO) =>
            !previous.some((existing) => existing.id === row.id),
        ),
      ]);
      setCursor(body.data.nextCursor);
    } catch {
      setError("NETWORK_READ");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-[1000px]">
      <header className="mb-[22px]">
        <h1 className="mb-1 text-2xl font-bold">
          {copy("الصفقات", "Deals")}
        </h1>
        <p className="max-w-2xl text-[14.5px] text-muted-foreground">
          {copy(
            "عروضك واتفاقاتك مع الطرف الآخر، مع نسخ الشروط وحالة التأكيد والتسليم.",
            "Your offers and agreements with the other party, including term versions, confirmations and delivery status.",
          )}
        </p>
      </header>
      {deals.length === 0 ? (
        <Card className="gap-3 rounded-[18px] border border-border px-6 py-[22px] ring-0">
            <h2 className="text-base font-bold">
              {copy("ما عندك صفقات حتى الآن", "No deals yet")}
            </h2>
            <p className="text-[13.5px] text-muted-foreground">
              {role === "BRAND"
                ? copy(
                    "ابدأ بحملة وموجز معتمد، ثم راجع الصنّاع المؤهلين لتجهيز عرض.",
                    "Start with a campaign and an approved brief, then review eligible creators to prepare an offer.",
                  )
                : copy(
                    "العروض المرسلة لك تظهر هنا. أكمل ملفك والموافقات المطلوبة ليكون جاهزًا للتعاون.",
                    "Offers sent to you appear here. Complete your profile and required permissions to prepare for collaborations.",
                  )}
            </p>
            <div><Button asChild variant="secondary" className="h-auto min-h-11 rounded-[10px] px-[18px] py-2.5 text-[13px] font-bold">
              <Link
                href={
                  role === "BRAND" ? "/brand/campaigns" : "/creator/onboarding"
                }
              >
                {role === "BRAND"
                  ? copy("افتح الحملات", "Open campaigns")
                  : copy("أكمل ملفك", "Complete your profile")}
              </Link>
            </Button></div>
        </Card>
      ) : (
        <ul className="grid gap-4">
          {deals.map((deal) => (
            <li key={deal.id}>
              <DashboardDealCard role={role} deal={{
                id: deal.id,
                campaignTitle: null,
                status: deal.status,
                amount: deal.currentOffer.terms.amount,
                offerVersion: deal.currentOffer.version,
                briefVersion: deal.briefVersion,
                updatedAt: deal.updatedAt,
              }} />
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-[18px] border border-destructive p-4 text-destructive"
        >
          {errorCopy(error)}
        </p>
      )}
      {cursor && (
        <Button variant="outline" className="mt-4 h-auto min-h-11 rounded-[10px] px-[18px] py-2.5 text-[13.5px] font-semibold" onClick={more} disabled={busy}>
          {busy
            ? copy("جاري التحميل…", "Loading…")
            : copy("حمّل المزيد", "Load more")}
        </Button>
      )}
    </div>
  );
}
