import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReachBand } from "@/lib/commercial/contracts";
import type { PublicDiscoveryAccount, PublicDiscoveryCreator } from "@/lib/discovery/contracts";
import type { Lang } from "@/lib/lang";
import styles from "./creator-discovery.module.css";

const platformLabels: Record<PublicDiscoveryAccount["platform"], [string, string]> = {
  INSTAGRAM: ["إنستغرام", "Instagram"],
  TIKTOK: ["تيك توك", "TikTok"],
  YOUTUBE: ["يوتيوب", "YouTube"],
  SNAPCHAT: ["سناب شات", "Snapchat"],
  X: ["إكس", "X"],
};
// Display intervals for the frozen infame-reach-v2 DTO; classification stays in the shared contract.
const reachBands: Record<ReachBand, { labels: [string, string]; minimum: string; maximumExclusive: string | null }> = {
  NANO: { labels: ["نانو", "Nano"], minimum: "1000", maximumExclusive: "10000" },
  MICRO: { labels: ["مايكرو", "Micro"], minimum: "10000", maximumExclusive: "100000" },
  MID: { labels: ["متوسط", "Mid"], minimum: "100000", maximumExclusive: "500000" },
  MACRO: { labels: ["ماكرو", "Macro"], minimum: "500000", maximumExclusive: "1000000" },
  MEGA: { labels: ["ميغا", "Mega"], minimum: "1000000", maximumExclusive: null },
};

export function CreatorDiscoveryCard({ creator, lang, countryNames, actions, headingIdPrefix = "discovery" }: {
  creator: PublicDiscoveryCreator; lang: Lang; countryNames: Readonly<Record<string, string>>;
  actions?: ReactNode;
  headingIdPrefix?: string;
}) {
  const isAr = lang === "ar";
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const labelIndex = isAr ? 0 : 1;
  const country = creator.residenceCountryCode
    ? countryNames[creator.residenceCountryCode] ?? creator.residenceCountryCode
    : copy("غير معروف", "Unknown");
  const followers = (value: string) => new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(BigInt(value));
  const followerInterval = (band: ReachBand | null) => {
    if (band === null) return copy(
      `أقل من ${followers(reachBands.NANO.minimum)} متابع`,
      `Fewer than ${followers(reachBands.NANO.minimum)} followers`,
    );
    const { minimum, maximumExclusive } = reachBands[band];
    return maximumExclusive === null
      ? copy(`${followers(minimum)} متابع فأكثر`, `${followers(minimum)} or more followers`)
      : copy(
        `من ${followers(minimum)} إلى أقل من ${followers(maximumExclusive)} متابع`,
        `${followers(minimum)} to fewer than ${followers(maximumExclusive)} followers`,
      );
  };
  const observationDate = (value: string) => new Intl.DateTimeFormat(lang, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(new Date(value));
  const headingId = `${headingIdPrefix}-${creator.handle}`;

  return <article className={styles.discoveryCard} lang={lang} dir={isAr ? "rtl" : "ltr"} aria-labelledby={headingId}>
    <div className={styles.summary}>
      <div className={styles.avatarColumn}>
        <div className={styles.avatar} aria-hidden="true">{Array.from(creator.displayName.trim())[0] ?? "@"}</div>
      </div>
      <div className={styles.identity}>
        <h2 id={headingId} dir="auto" className={styles.name}>{creator.displayName}</h2>
        <p className={styles.handle}><bdi dir="ltr">@{creator.handle}</bdi></p>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{copy("بلد الإقامة", "Residence country")}</dt>
            <dd><bdi dir="auto">{country}</bdi></dd>
          </div>
          <div className={styles.fact}>
            <dt>{copy("اللغات", "Languages")}</dt>
            <dd>{creator.languages.length
              ? creator.languages.map((language, index) => <span key={`${language}-${index}`}>
                {index > 0 && <span aria-hidden="true"> · </span>}<bdi dir="auto">{language}</bdi>
              </span>)
              : copy("غير مذكورة", "Not shared")}</dd>
          </div>
        </dl>
        {creator.nicheSlugs.length > 0 && <ul className={styles.chips} aria-label={copy("المجالات", "Niches")}>
          {creator.nicheSlugs.map((niche, index) => <li key={`${niche}-${index}`}>
            <Badge variant="secondary" className={styles.chip}><bdi dir="auto">{niche}</bdi></Badge>
          </li>)}
        </ul>}
        {creator.bio.length > 0 && <p className={styles.bio} dir="auto">{creator.bio}</p>}
        <p className={styles.sourceNote}>{copy(
          "معلومات عامة شاركها الصانع. أعداد المتابعين تصف تاريخ الرصد الموضح وقد تتغير بعده.",
          "Public facts shared by the creator. Follower counts describe the stated observation date and may have changed since then.",
        )}</p>
      </div>
      <div className={styles.actions}>
        <Button asChild variant="outline">
          <Link href={`/@${encodeURIComponent(creator.handle)}`} prefetch={false} aria-label={copy(
            `اعرض الملف الشخصي: ${creator.displayName}`,
            `View profile: ${creator.displayName}`,
          )}>{copy("اعرض الملف الشخصي", "View profile")}</Link>
        </Button>
        {actions}
      </div>
    </div>
    <details className={styles.details}>
      <summary>{copy("الحسابات العامة وبيانات المتابعين", "Public accounts and follower observations")}</summary>
      {creator.accounts.length === 0
        ? <p className={styles.noAccounts}>{copy("لا توجد حسابات عامة موثّقة متاحة حاليًا.", "No public verified accounts are currently available.")}</p>
        : <ul className={styles.accountList}>{creator.accounts.map((account, index) => {
          const observation = account.followersObservation;
          return <li className={styles.account} key={`${account.platform}-${account.handle}-${index}`}>
            <h3 className={styles.accountHeading}>{platformLabels[account.platform][labelIndex]} <bdi dir="auto">{account.handle}</bdi></h3>
            <p className={styles.ownership}>{copy("ملكية الحساب موثّقة", "Account ownership verified")}</p>
            <dl className={styles.accountFacts}>
              <div>
                <dt>{copy("المتابعون", "Followers")}</dt>
                <dd>{observation ? <bdi>{followers(observation.followers)}</bdi> : copy("غير معروف", "Unknown")}</dd>
              </div>
              {observation && <>
                <div>
                  <dt>{copy("المصدر", "Source")}</dt>
                  <dd>{copy("لقطة شاشة راجعها مسؤول", "Admin-reviewed screenshot")}</dd>
                </div>
                <div>
                  <dt>{copy("تاريخ الرصد", "Observed at")}</dt>
                  <dd><time dateTime={observation.observedAt}>{observationDate(observation.observedAt)}</time> <bdi dir="ltr">UTC</bdi></dd>
                </div>
                <div>
                  <dt>{copy("فئة متابعي هذا الحساب", "Per-account follower band")}</dt>
                  <dd>{observation.band ? reachBands[observation.band].labels[labelIndex] : copy("دون حد التصنيف", "Below the classification threshold")}</dd>
                </div>
                <div>
                  <dt>{copy("نطاق المتابعين", "Follower interval")}</dt>
                  <dd>{followerInterval(observation.band)}</dd>
                </div>
              </>}
            </dl>
            {!observation && <p className={styles.accountNote}>{copy(
              "لا توجد بيانات متابعين عامة موثّقة وحديثة متاحة؛ العدد غير معروف.",
              "No current public verified follower observation is available; the count is unknown.",
            )}</p>}
          </li>;
        })}</ul>}
    </details>
  </article>;
}
