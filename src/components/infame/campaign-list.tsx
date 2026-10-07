"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DashboardCampaignRows } from "./dashboard-parts";
import type { listCampaigns } from "@/lib/campaigns/service";

type CampaignListDTO = Awaited<ReturnType<typeof listCampaigns>>;
export function CampaignList({
  initialList,
  profileRequired = false,
}: {
  initialList: CampaignListDTO | null;
  profileRequired?: boolean;
}) {
  const { isAr } = useI18n(),
    copy = (ar: string, en: string) => (isAr ? ar : en);
  const [list, setList] = useState(initialList),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  async function loadMore() {
    if (!list?.nextCursor || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(
        `/api/campaigns?cursor=${encodeURIComponent(list.nextCursor)}`,
        { cache: "no-store" },
      );
      const result: { data?: CampaignListDTO } = await response.json();
      if (!response.ok || !result.data) throw new Error("Request failed");
      const next = result.data;
      setList((previous) => ({
        campaigns: [
          ...(previous?.campaigns ?? []),
          ...next.campaigns.filter(
            (row) => !previous?.campaigns.some((prior) => prior.id === row.id),
          ),
        ],
        nextCursor: next.nextCursor,
      }));
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-[1000px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-bold">
            {copy("حملاتك", "Your campaigns")}
          </h1>
          <p className="max-w-2xl text-[14.5px] text-muted-foreground">
            {copy(
              "ارجع لمسودتك، راجع الموجز واعتمد النسخة اللي تمثل حملتك.",
              "Resume your draft, review the brief and approve the version that represents your campaign.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11 rounded-[10px]">
          <Link href="/brand/campaigns/reviews">{copy("مراجعة الموجزات", "Review briefs")}</Link>
        </Button>
        {!profileRequired && (
          <Button asChild className="h-auto min-h-11 rounded-[10px] px-[18px] py-[11px] text-[13.5px] font-bold">
            <Link href="/brand/campaigns/new">
              <Plus aria-hidden="true" />
              {copy("حملة جديدة", "New campaign")}
            </Link>
          </Button>
        )}
        </div>
      </div>
      {profileRequired ? (
        <Card className="gap-3 rounded-[18px] border border-border px-6 py-[22px] ring-0">
            <h2 className="text-base font-bold">
              {copy("عرّف بشركتك أولًا", "Introduce your company first")}
            </h2>
            <p className="text-[13.5px] text-muted-foreground">
              {copy(
                "احفظ ملف شركتك الخاص، وبعدها تقدر تبدأ حملة. ما يلزم نشر الملف لإنشاء مسودة.",
                "Save your private company profile, then start a campaign. Public profile publication is not required for a draft.",
              )}
            </p>
          <div>
            <Button asChild className="h-auto min-h-11 rounded-[10px] px-[18px] py-2.5 text-[13px] font-bold">
              <Link href="/brand/onboarding">
                {copy("أكمل ملف الشركة", "Complete company profile")}
              </Link>
            </Button>
          </div>
        </Card>
      ) : !list?.campaigns.length ? (
        <Card className="gap-3 rounded-[18px] border border-border px-6 py-[22px] ring-0">
            <h2 className="text-base font-bold">
              {copy("فكرتك تبدأ هنا", "Your idea starts here")}
            </h2>
            <p className="text-[13.5px] text-muted-foreground">
              {copy(
                "ما عندك حملات محفوظة بعد. ابدأ بالمعلومات المتاحة وكملها لاحقًا.",
                "No saved campaigns yet. Start with the information you have and complete it later.",
              )}
            </p>
          <div>
            <Button asChild variant="secondary" className="h-auto min-h-11 rounded-[10px] px-[18px] py-2.5 text-[13px] font-bold">
              <Link href="/brand/campaigns/new">
                {copy("ابدأ أول حملة", "Start your first campaign")}
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="gap-0 rounded-[18px] border border-border py-0 ring-0">
          <DashboardCampaignRows campaigns={list.campaigns} />
        </Card>
      )}
      <div aria-live="polite" className="mt-4">
        {busy && (
          <p className="flex items-center gap-2 text-base">
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {copy("تحميل الحملات…", "Loading campaigns…")}
          </p>
        )}
        {failed && (
          <p role="alert" className="text-base text-destructive">
            {copy(
              "تعذر تحميل المزيد. حملاتك الظاهرة باقية؛ حاول مرة ثانية.",
              "More campaigns could not be loaded. Your visible campaigns remain; try again.",
            )}
          </p>
        )}
      </div>
      {list?.nextCursor && (
        <Button variant="outline" className="mt-3 h-auto min-h-11 rounded-[10px] px-[18px] py-2.5 text-[13.5px] font-semibold" disabled={busy} onClick={loadMore}>
          {failed
            ? copy("حاول مرة ثانية", "Try again")
            : copy("حمّل المزيد", "Load more")}
        </Button>
      )}
    </section>
  );
}
