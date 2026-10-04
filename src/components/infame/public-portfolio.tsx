"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { countryLabel } from "@/lib/contracts/country-labels";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import { NICHE_BY_SLUG } from "@/lib/contracts/taxonomy";
import type { publicCreator, publicBrand } from "@/lib/onboarding/profiles";
import styles from "./public-portfolio.module.css";

type Creator = NonNullable<Awaited<ReturnType<typeof publicCreator>>>;
type Brand = NonNullable<Awaited<ReturnType<typeof publicBrand>>>;
const formats: Record<string, [string, string]> = {
  STORY: ["ستوري", "Story"], POST: ["منشور", "Post"], REEL: ["ريل", "Reel"],
  LIVE: ["بث مباشر", "Live"], CAMPAIGN: ["باقة حملة", "Campaign package"],
  VIDEO: ["فيديو", "Video"], SHORT: ["فيديو قصير", "Short"],
};

// Talaqee's profile composition consumes only the authorized public projection.
export function PublicPortfolio({ creator, brand }: { creator?: Creator; brand?: Brand }) {
  const { isAr } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const profile = creator ?? brand;
  if (!profile) return null;
  const name = creator?.displayName ?? brand!.name;
  const unknown = copy("غير منشور", "Not published");
  const country = profile.countryCode ? countryLabel(profile.countryCode, isAr ? "ar" : "en") : unknown;
  const nicheLabel = (slug: string) => NICHE_BY_SLUG[slug]?.[isAr ? "labelAr" : "labelEn"] ?? slug;
  const facts: { label: string; value: ReactNode; ltr?: boolean }[] = creator ? [
    { label: copy("بلد الإقامة", "Residence country"), value: country },
    { label: copy("لغات المحتوى", "Content languages"), value: creator.languages.length ? creator.languages.join(" / ") : unknown, ltr: !!creator.languages.length },
    { label: copy("التخصصات", "Niches"), value: creator.nicheSlugs.length ? creator.nicheSlugs.map(nicheLabel).join(" / ") : unknown },
    { label: copy("الحسابات المنشورة", "Published accounts"), value: String(creator.accounts.length) },
    { label: copy("الأسعار المعلنة", "Published rates"), value: String(creator.rates.length) },
    { label: copy("الأعمال المختارة", "Selected work"), value: String(creator.work.length) },
  ] : [
    { label: copy("بلد الشركة", "Company country"), value: country },
    { label: copy("موقع الشركة", "Company website"), value: brand!.website ?? unknown, ltr: !!brand!.website },
    { label: copy("نوع الشركة", "Organization type"), value: unknown },
    { label: copy("القطاع", "Sector"), value: unknown },
    { label: copy("لغات المحتوى", "Content languages"), value: unknown },
    { label: copy("أقسام الملف المنشورة", "Published portfolio sections"), value: String(profile.portfolio.sections.length) },
  ];

  return <section className={`${styles.page} ${creator ? "" : styles.brand}`}>
    <header className={styles.header}>
      <h1 className={styles.title}>{creator ? copy("ملف صانع المحتوى", "Creator profile") : copy("ملف الشركة", "Company profile")}</h1>
      <p className={styles.subtitle}>{copy("المعلومات العامة التي اختار صاحب الملف مشاركتها.", "Public information selected by the profile owner.")}</p>
    </header>
    <section className={styles.identity} aria-label={copy("معلومات الملف", "Profile identity")}>
      <div className={styles.avatar} aria-hidden="true">{Array.from(name.trim())[0] ?? "؟"}</div>
      <div className={styles.identityDetails}>
        <h2 dir="auto" className={styles.name}>{name}</h2>
        <p dir="ltr" className={styles.handle}>{creator ? `@${creator.handle}` : `infame.sa/brands/${brand!.slug}`}</p>
        {profile.portfolio.bio && <p dir="auto" className={styles.bio}>{profile.portfolio.bio}</p>}
      </div>
    </section>
    <dl className={styles.facts}>{facts.map(fact => <div key={fact.label} className={styles.fact}>
      <dt>{fact.label}</dt><dd dir={fact.ltr ? "ltr" : "auto"}>{fact.value}</dd>
    </div>)}</dl>
    <div className={styles.panels}>
      <section className={styles.panel} aria-labelledby="public-services-title">
        <h2 id="public-services-title" className={styles.panelTitle}>{creator ? copy("التخصصات والخدمات", "Niches and services") : copy("معلومات الشركة", "Company information")}</h2>
        {creator ? <>
          <div className={styles.chips}>{creator.nicheSlugs.length ? creator.nicheSlugs.map(slug => <span key={slug} className={styles.chip}>{nicheLabel(slug)}</span>) : <p className={styles.muted}>{copy("ما فيه تخصصات منشورة.", "No niches published.")}</p>}</div>
          <h3 className={styles.sectionHeading}>{copy("الأسعار المعلنة", "Published rates")}</h3>
          {creator.rates.length ? <ul className={styles.rates}>{creator.rates.map(rate => <li key={`${rate.platform}:${rate.format}:${rate.currencyCode}`} className={styles.rate}>
            <span><bdi dir="ltr">{rate.platform}</bdi> · {formats[rate.format]?.[isAr ? 0 : 1] ?? rate.format}</span>
            <bdi dir="ltr" className={styles.money}>{formatMoneyDecimal({ currencyCode: rate.currencyCode, amountMinor: rate.amountMinor })} {rate.currencyCode}</bdi>
          </li>)}</ul> : <p className={styles.muted}>{copy("ما فيه أسعار معلنة.", "No rates published.")}</p>}
          <h3 className={`${styles.sectionHeading} ${styles.accountsHeading}`}>{copy("الحسابات المعتمدة", "Accepted accounts")}</h3>
          {creator.accounts.length ? <ul className={styles.list}>{creator.accounts.map(account => <li key={`${account.platform}:${account.handle}`} className={styles.item}>
            <p dir="ltr" className={styles.itemHeading}>{account.platform} · @{account.handle}</p>
            <p className={styles.itemText}>{copy("ملكية الحساب معتمدة", "Account ownership accepted")}</p>
          </li>)}</ul> : <p className={styles.muted}>{copy("ما فيه حسابات ظاهرة للعموم.", "No accounts shared publicly.")}</p>}
        </> : <>
          <p className={styles.muted}>{copy("معلومات الشركة التي اختارت مشاركتها للعموم.", "Company information selected for public sharing.")}</p>
          {brand!.website && <a href={brand!.website} rel="noopener noreferrer" target="_blank" className={styles.website}>{copy("موقع الشركة", "Company website")}<span className={styles.srOnly}>{copy(" (يفتح في نافذة جديدة)", " (opens in a new window)")}</span></a>}
        </>}
      </section>
      <section className={styles.panel} aria-labelledby="public-portfolio-title">
        <h2 id="public-portfolio-title" className={styles.panelTitle}>{copy("الملف التعريفي", "Portfolio")}</h2>
        {profile.portfolio.sections.length ? <ul className={styles.list}>{profile.portfolio.sections.map((section, index) => <li key={index} className={styles.item}>
          <h3 dir="auto" className={styles.itemHeading}>{section.heading}</h3>
          <p dir="auto" className={styles.itemText}>{section.text}</p>
        </li>)}</ul> : <p className={styles.muted}>{copy("ما فيه أقسام إضافية منشورة.", "No additional sections published.")}</p>}
        {creator && <>
          <h3 className={`${styles.sectionHeading} ${styles.workHeading}`}>{copy("أعمال مختارة", "Selected work")}</h3>
          {creator.work.length ? <ul className={styles.list}>{creator.work.map((work, index) => <li key={index} className={styles.item}>
            <h4 dir="auto" className={styles.itemHeading}>{work.title}</h4>
            {work.description && <p dir="auto" className={styles.itemText}>{work.description}</p>}
          </li>)}</ul> : <p className={styles.muted}>{copy("ما فيه أعمال مختارة منشورة.", "No selected work published.")}</p>}
        </>}
      </section>
    </div>
  </section>;
}
