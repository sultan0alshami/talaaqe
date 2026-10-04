"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import type { DealDTO } from "@/lib/deals/service";
import { useDealCopy } from "./deal-copy";

export function DealList({
  initialDeals,
  initialCursor,
  role,
}: {
  initialDeals: DealDTO[];
  initialCursor: string | null;
  role: "BRAND" | "CREATOR";
}) {
  const { copy, status, errorCopy } = useDealCopy();
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
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          {copy("تعاون واضح من العرض للتقييم", "From offer to feedback")}
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          {copy("الصفقات", "Deals")}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          {copy(
            "عروضك واتفاقاتك مع الطرف الآخر، مع نسخ الشروط وحالة التأكيد والتسليم.",
            "Your offers and agreements with the other party, including term versions, confirmations and delivery status.",
          )}
        </p>
      </header>
      {deals.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-xl font-semibold">
              {copy("ما عندك صفقات حتى الآن", "No deals yet")}
            </h2>
            <p className="text-muted-foreground">
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
            <Button asChild>
              <Link
                href={
                  role === "BRAND" ? "/brand/campaigns" : "/creator/onboarding"
                }
              >
                {role === "BRAND"
                  ? copy("افتح الحملات", "Open campaigns")
                  : copy("أكمل ملفك", "Complete your profile")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Card>
                <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      {status(deal.status)}
                    </p>
                    <h2 className="text-xl font-semibold">
                      {copy("صفقة", "Deal")}{" "}
                      <bdi dir="ltr" className="break-all text-base">
                        {deal.id}
                      </bdi>
                    </h2>
                    <p>
                      <bdi dir="ltr">
                        {formatMoneyDecimal(deal.currentOffer.terms.amount)}{" "}
                        {deal.currentOffer.terms.amount.currencyCode}
                      </bdi>{" "}
                      · {copy("نسخة العرض", "Offer version")}{" "}
                      {deal.currentOffer.version}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {copy("موجز الحملة", "Campaign brief")}{" "}
                      {deal.briefVersion}
                    </p>
                  </div>
                  <Button variant="outline" asChild>
                    <Link
                      href={`/${role.toLowerCase()}/deals/${encodeURIComponent(deal.id)}`}
                    >
                      {copy("افتح الصفقة", "Open deal")}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive p-4 text-destructive"
        >
          {errorCopy(error)}
        </p>
      )}
      {cursor && (
        <Button variant="outline" onClick={more} disabled={busy}>
          {busy
            ? copy("جاري التحميل…", "Loading…")
            : copy("حمّل المزيد", "Load more")}
        </Button>
      )}
    </div>
  );
}
