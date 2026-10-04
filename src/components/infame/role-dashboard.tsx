"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DashboardSection,
  DashboardStat,
  DashboardCampaignRows,
  DashboardDealCard,
  type DashboardCampaign,
  type DashboardDeal,
} from "@/components/infame/dashboard-parts";

export type RecentCampaign = DashboardCampaign;
export type RecentDeal = DashboardDeal;
export type RoleDashboardProps = {
  name: string;
  role: "CREATOR" | "BRAND";
  emailVerified: boolean;
  state: string;
  deals: number;
  campaigns: number;
  recentCampaigns?: RecentCampaign[];
  recentDeals?: RecentDeal[];
  pendingDeals?: number;
  activeDeals?: number;
  completedDeals?: number;
};

export function RoleDashboard({
  name,
  role,
  emailVerified,
  state,
  deals,
  campaigns,
  recentCampaigns,
  recentDeals,
  pendingDeals,
  activeDeals,
  completedDeals,
}: RoleDashboardProps) {
  const { isAr } = useI18n();
  const [sending, setSending] = useState(false),
    [verification, setVerification] = useState<
      | "wait"
      | "fixture"
      | "unavailable"
      | "sent"
      | "verified"
      | "network"
      | null
    >(null);
  const copy = (ar: string, en: string) => (isAr ? ar : en);
  const message =
    verification === "wait"
      ? copy(
          "انتظر دقيقة قبل المحاولة التالية.",
          "Wait a minute before trying again.",
        )
      : verification === "fixture"
        ? copy(
            "رسالة التأكيد محفوظة في صندوق الاختبار المحلي.",
            "Your verification message is in the local test inbox.",
          )
        : verification === "unavailable"
          ? copy(
              "إرسال البريد غير متاح حاليًا. ملفك محفوظ كملف خاص.",
              "Email delivery is currently unavailable. Your profile remains saved privately.",
            )
          : verification === "sent"
            ? copy("تم إرسال رابط التأكيد.", "A verification link was sent.")
            : verification === "verified"
              ? copy("بريدك الإلكتروني مؤكّد.", "Your email is verified.")
              : verification === "network"
                ? copy(
                    "تعذر الاتصال. جرّب مرة ثانية.",
                    "We couldn't connect. Try again.",
                  )
                : "";
  const home = role === "CREATOR" ? "/creator" : "/brand";
  const published = state === "PUBLISHED";
  const profileLabel = published
    ? copy("منشور", "Published")
    : copy("خاص", "Private");
  const count = (value: number | undefined) => value === undefined
    ? <span aria-label={copy("غير معروف", "Unknown")}>—</span>
    : <bdi>{value}</bdi>;
  async function verifyEmail() {
    setSending(true);
    setVerification(null);
    try {
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) {
        setVerification(response.status === 429 ? "wait" : "network");
        return;
      }
      setVerification(
        result.verified === true
          ? "verified"
          : result.delivery === "fixture"
            ? "fixture"
            : result.delivery === "unavailable"
              ? "unavailable"
              : "sent",
      );
    } catch {
      setVerification("network");
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="mx-auto w-full max-w-[1000px]">
      <div className="mb-[22px]">
        <h1 className="mb-1 break-words text-2xl font-bold">
          {copy("هلا", "Welcome,")} <bdi>{name}</bdi>{" "}
          <span aria-hidden="true">👋</span>
        </h1>
        <p className="text-[14.5px] text-muted-foreground">
          {role === "BRAND"
            ? copy(
                "تابع حملات علامتك التجارية وتعاوناتك من مكان واحد.",
                "Manage your brand's campaigns and collaborations in one place.",
              )
            : copy(
                "تابع ملفك وتعاوناتك من مكان واحد.",
                "Manage your profile and collaborations in one place.",
              )}
        </p>
      </div>
      {role === "BRAND" && (
        <div className="mb-[22px] flex flex-wrap items-center gap-5 rounded-[18px] bg-foreground px-6 py-[26px] text-background sm:px-[30px]">
          <div className="min-w-0 flex-1 basis-60">
            <h2 className="mb-1 text-[19px] font-bold">
              {copy("ابدأ حملتك الجديدة", "Start your next campaign")}
            </h2>
            <p className="text-[13.5px] opacity-80">
              {copy(
                "حدّد هدفك وميزانيتك ومتطلباتك، ثم راجع الملخص واعتمده.",
                "Set your goal, budget and requirements, then review and approve the brief.",
              )}
            </p>
          </div>
          <Button
            asChild
            className="h-auto min-h-11 rounded-[11px] px-[26px] py-[13px] text-[15px] font-bold shadow-md"
          >
            <Link href="/brand/campaigns/new">
              {copy("حملة جديدة", "New campaign")}{" "}
              <span aria-hidden="true">✦</span>
            </Link>
          </Button>
        </div>
      )}
      <div
        className="mb-[26px] grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {role === "BRAND" && (
          <DashboardStat
            label={copy("الحملات", "Campaigns")}
            value={<bdi>{campaigns}</bdi>}
          />
        )}
        <DashboardStat
          label={copy("عروض بانتظار الرد", "Offers awaiting a response")}
          value={count(pendingDeals)}
        />
        <DashboardStat
          label={copy("تعاونات جارية", "Active collaborations")}
          value={count(activeDeals)}
        />
        <DashboardStat
          label={copy("تعاونات مكتملة", "Completed collaborations")}
          value={count(completedDeals)}
        />
        {role === "CREATOR" && <DashboardStat label={copy("كل التعاونات", "All collaborations")} value={<bdi>{deals}</bdi>} />}
      </div>
      <div className="space-y-[22px]">
        {role === "BRAND" ? (
        <DashboardSection
          title={copy("آخر الحملات", "Recent campaigns")}
          href="/brand/campaigns"
          action={copy("عرض الكل", "View all")}
          flush={!!recentCampaigns?.length}
        >
          {recentCampaigns?.length ? <DashboardCampaignRows campaigns={recentCampaigns} compact /> : <>
          <p className="mb-3 text-[13.5px] text-muted-foreground">
            {campaigns === 0
              ? copy(
                    "ما عندك حملات حتى الآن. ابدأ بالهدف والمتطلبات، واحفظ تقدمك أثناء إعداد الحملة.",
                    "You have no campaigns yet. Start with your goal and requirements and save your progress as you prepare.",
                  )
              : copy(
                    "راجع الحملات المحفوظة والملخصات المعتمدة من قائمة حملاتك.",
                    "Open your campaigns to review saved requirements and approved briefs.",
                  )}
          </p>
          <Button
            asChild
            variant="secondary"
            className="h-auto min-h-11 rounded-[10px] px-[18px] py-2.5 text-[13px] font-bold"
          >
            <Link
              href={campaigns === 0 ? "/brand/campaigns/new" : "/brand/campaigns"}
            >
              {campaigns === 0
                  ? copy("حملة جديدة", "New campaign")
                  : copy("حملاتي", "Campaigns")}
            </Link>
          </Button>
          </>}
        </DashboardSection>
        ) : (
          <section aria-labelledby="creator-collaborations-title">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="creator-collaborations-title" className="mb-[3px] text-lg font-bold">{copy("العروض والتعاونات", "Offers and collaborations")}</h2>
                <p className="text-[13.5px] text-muted-foreground">{copy("راجع عروضك وسجل التفاوض والاتفاقيات.", "Review your offers, negotiation history and agreements.")}</p>
              </div>
              <Link href="/creator/deals" className="inline-flex min-h-11 items-center gap-2 text-[13.5px] font-semibold underline-offset-4 hover:underline">{copy("عرض الكل", "View all")}<span aria-hidden="true" className="rtl:rotate-180">→</span></Link>
            </div>
            {recentDeals?.length ? <ul className="space-y-4">{recentDeals.map((deal) => <li key={deal.id}><DashboardDealCard deal={deal} role="CREATOR" /></li>)}</ul> : (
              <Card className="gap-3 rounded-[18px] border border-border px-6 py-[22px] ring-0">
                <p className="text-[13.5px] text-muted-foreground">{deals === 0 ? copy("ما عندك تعاونات مرتبطة بحسابك حتى الآن. أكمل ملفك وراجع حساباتك قبل مشاركة ملفك.", "You have no collaborations linked to your account yet. Complete your profile and review your accounts before sharing it.") : copy("راجع عروضك وسجل التفاوض والاتفاقيات من قائمة الصفقات.", "Open your deals to review offers, negotiation history and agreements.")}</p>
                <div><Button asChild variant="secondary" className="h-auto min-h-11 rounded-[10px] px-[18px] py-2.5 text-[13px] font-bold"><Link href={deals === 0 ? "/creator/onboarding" : "/creator/deals"}>{deals === 0 ? copy("إكمال الملف", "Complete profile") : copy("الصفقات", "Deals")}</Link></Button></div>
              </Card>
            )}
          </section>
        )}
        <DashboardSection
          title={copy("ملفك", "Your profile")}
          href={home + "/onboarding"}
          action={copy("إكمال وتعديل الملف", "Complete and edit profile")}
        >
          <p className="mb-2 text-[13px] font-semibold">{profileLabel} · {emailVerified ? copy("البريد الإلكتروني مؤكّد", "Email verified") : copy("البريد الإلكتروني غير مؤكّد", "Email unverified")}</p>
          <p className="text-sm text-muted-foreground">
            {published
              ? copy(
                  "ملفك منشور. يمكنك مراجعة معلوماتك وتعديلها قبل تحديث الملف.",
                  "Your profile is published. You can review and edit your information before updating it.",
                )
              : copy(
                  "ملفك محفوظ بشكل خاص. أكمل معلوماتك وراجعها قبل النشر.",
                  "Your profile is saved privately. Complete and review your information before publishing.",
                )}
          </p>
          {role === "BRAND" && (
            <Button
              asChild
              variant="secondary"
              className="mt-3 rounded-[10px] px-[18px] font-bold"
            >
              <Link href="/brand/deals">
                {copy("الصفقات", "Deals")} <bdi>({deals})</bdi>
              </Link>
            </Button>
          )}
        </DashboardSection>
        {!emailVerified && (
          <Card className="gap-3 rounded-[18px] border border-border p-[22px] ring-0">
            <h2 className="text-base font-bold">
              {copy("أكّد بريدك الإلكتروني", "Verify your email")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {copy(
                "تأكيد البريد خطوة مستقلة عن إثبات ملكية حساباتك.",
                "Email verification is separate from proving ownership of your accounts.",
              )}
            </p>
            <div>
              <Button
                onClick={verifyEmail}
                disabled={sending}
                className="rounded-[10px] px-[18px]"
              >
                {copy("طلب رابط التأكيد", "Request verification link")}
              </Button>
            </div>
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
          </Card>
        )}
      </div>
    </section>
  );
}
