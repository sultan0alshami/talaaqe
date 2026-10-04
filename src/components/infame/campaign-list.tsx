"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { listCampaigns } from "@/lib/campaigns/service";

type CampaignListDTO = Awaited<ReturnType<typeof listCampaigns>>;
const statuses: Record<string, [string, string]> = {
  DRAFT: ["مسودة", "Draft"],
  BRIEF_GENERATED: ["موجز للمراجعة", "Brief ready for review"],
  BRIEF_APPROVED: ["موجز معتمد", "Brief approved"],
  SHORTLISTED: ["تم إعداد القائمة", "Shortlisted"],
  IN_DEALS: ["صفقات جارية", "Deals in progress"],
  COMPLETED: ["مكتملة", "Completed"],
  CANCELLED: ["ملغاة", "Cancelled"],
};
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
    <section className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {copy("مساحة العلامة التجارية", "Brand workspace")}
          </p>
          <h1 className="text-3xl font-semibold">
            {copy("حملاتك", "Your campaigns")}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {copy(
              "ارجع لمسودتك، راجع الموجز واعتمد النسخة اللي تمثل حملتك.",
              "Resume your draft, review the brief and approve the version that represents your campaign.",
            )}
          </p>
        </div>
        {!profileRequired && (
          <Button asChild size="lg">
            <Link href="/brand/campaigns/new">
              <Plus aria-hidden="true" />
              {copy("حملة جديدة", "New campaign")}
            </Link>
          </Button>
        )}
      </div>
      {profileRequired ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {copy("عرّف بشركتك أولًا", "Introduce your company first")}
            </CardTitle>
            <CardDescription className="text-base">
              {copy(
                "احفظ ملف شركتك الخاص، وبعدها تقدر تبدأ حملة. ما يلزم نشر الملف لإنشاء مسودة.",
                "Save your private company profile, then start a campaign. Public profile publication is not required for a draft.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href="/brand/onboarding">
                {copy("أكمل ملف الشركة", "Complete company profile")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : !list?.campaigns.length ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {copy("فكرتك تبدأ هنا", "Your idea starts here")}
            </CardTitle>
            <CardDescription className="text-base">
              {copy(
                "ما عندك حملات محفوظة بعد. ابدأ بالمعلومات المتاحة وكملها لاحقًا.",
                "No saved campaigns yet. Start with the information you have and complete it later.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href="/brand/campaigns/new">
                {copy("ابدأ أول حملة", "Start your first campaign")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle dir="auto" className="break-words text-xl">
                    {campaign.title ||
                      copy("حملة بدون اسم بعد", "Campaign not named yet")}
                  </CardTitle>
                  <CardDescription className="text-base">
                    {statuses[campaign.status]?.[isAr ? 0 : 1] ??
                      campaign.status}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {copy("آخر تحديث", "Last updated")}:{" "}
                    <time dateTime={campaign.updatedAt}>
                      {new Intl.DateTimeFormat(isAr ? "ar" : "en", {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(new Date(campaign.updatedAt))}
                    </time>{" "}
                    · UTC
                  </p>
                  {campaign.currentBriefVersion && (
                    <p className="text-base">
                      {copy("نسخة الموجز المعتمدة", "Approved brief version")}{" "}
                      {campaign.currentBriefVersion}
                    </p>
                  )}
                  <Button asChild size="lg" variant="outline">
                    <Link
                      href={`/brand/campaigns/${encodeURIComponent(campaign.id)}`}
                    >
                      {copy("افتح الحملة", "Open campaign")}
                      <span className="sr-only">
                        : {campaign.title || copy("بدون اسم", "Unnamed")}
                      </span>
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <div aria-live="polite">
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
        <Button variant="outline" size="lg" disabled={busy} onClick={loadMore}>
          {failed
            ? copy("حاول مرة ثانية", "Try again")
            : copy("حمّل المزيد", "Load more")}
        </Button>
      )}
    </section>
  );
}
