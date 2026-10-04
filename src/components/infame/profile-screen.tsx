"use client";

import type { ReactNode } from "react";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { countryLabel } from "@/lib/contracts/country-labels";
import { CURATED_CITIES } from "@/lib/contracts/vocabulary";
import { NICHE_BY_SLUG } from "@/lib/contracts/taxonomy";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import type { OwnerProfileDTO } from "@/lib/onboarding/profiles";
import styles from "./profile-screen.module.css";

type ProfileRole = "CREATOR" | "BRAND";
type Copy = (ar: string, en: string) => string;
const formats: Record<string, [string, string]> = {
  STORY: ["ستوري", "Story"], POST: ["منشور", "Post"], REEL: ["ريل", "Reel"],
  LIVE: ["بث مباشر", "Live"], CAMPAIGN: ["باقة حملة", "Campaign package"],
  VIDEO: ["فيديو", "Video"], SHORT: ["فيديو قصير", "Short"],
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function savedState(value: string, copy: Copy) {
  return value === "PUBLISHED" ? copy("محفوظ كمنشور", "Saved as published")
    : value === "HIDDEN" ? copy("مخفي", "Hidden")
      : copy("محفوظ بشكل خاص", "Saved privately");
}

// Talaqee's owner profile presentation, with canonical Infame owner data.
export function ProfileScreen({
  role, owner, loadError = false,
}: { role: ProfileRole; owner: OwnerProfileDTO | null; loadError?: boolean }) {
  const { isAr } = useI18n();
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const copy: Copy = (ar, en) => isAr ? ar : en;
  const creator = role === "CREATOR";
  const editPath = `/${role.toLowerCase()}/onboarding`;
  const title = creator ? copy("ملفي", "My profile") : copy("ملف الشركة", "Company profile");
  const pageClass = `${styles.page} ${creator ? "" : styles.brand}`;

  if (!owner || loadError) {
    return <section className={pageClass}>
      <header className={styles.header}><h1 className={styles.title}>{title}</h1></header>
      <div className={`${styles.panel} ${styles.empty} ${loadError ? styles.error : ""}`}>
        <h2>{loadError ? copy("تعذر تحميل ملفك", "Your profile could not be loaded") : copy("ابدأ ملفك", "Start your profile")}</h2>
        <p className={styles.muted} role={loadError ? "alert" : undefined}>
          {loadError ? copy("ما نقدر نعرض بياناتك الآن. حاول مرة ثانية.", "We cannot display your information right now. Try again.") : copy("أضف معلوماتك واحفظها بشكل خاص، وبعدها تقدر ترجع لها من هنا.", "Add your information and save it privately, then return to it here.")}
        </p>
        <div>{loadError ? <Button variant="outline" disabled={retrying} onClick={() => startRetry(() => router.refresh())}><RefreshCw aria-hidden="true" className={retrying ? "animate-spin motion-reduce:animate-none" : ""} />{retrying ? copy("جارٍ التحميل…", "Loading…") : copy("حاول مرة ثانية", "Try again")}</Button> : <Button asChild><Link href={editPath}>{copy("إكمال الملف", "Complete profile")}</Link></Button>}</div>
      </div>
    </section>;
  }

  const { profile, portfolio } = owner;
  const profileFacts = object(profile.facts);
  const city = object(profile.city);
  const curatedCity = CURATED_CITIES.find((item) => item.key === city.key);
  const cityName = text(city.label) ?? (curatedCity ? isAr ? curatedCity.ar : curatedCity.en : null);
  const unknown = copy("غير محدد", "Not set");
  const languages = creator ? profile.languages : Array.isArray(profileFacts.languages)
    ? profileFacts.languages.filter((language): language is string => typeof language === "string") : [];
  const availability = object(profile.availability);
  const availabilityLabel = availability.status === "AVAILABLE"
    ? copy("متاح خلال الفترة المحفوظة", "Available during the saved period")
    : availability.status === "UNAVAILABLE" ? copy("غير متاح", "Unavailable") : unknown;
  const contactName = text(profileFacts.contactName);
  const representativeRole = text(profileFacts.representativeRole);
  const facts: { label: string; value: ReactNode; ltr?: boolean; note?: ReactNode }[] = [
    { label: copy("بلد الإقامة / الشركة", "Residence / company country"), value: profile.countryCode ? countryLabel(profile.countryCode, isAr ? "ar" : "en") : unknown },
    { label: copy("المدينة", "City"), value: cityName ?? unknown },
    { label: copy("لغات المحتوى", "Content languages"), value: languages.length ? languages.join(" / ") : unknown, ltr: languages.length > 0 },
    { label: copy("المنطقة الزمنية", "Timezone"), value: profile.timeZone ?? unknown, ltr: !!profile.timeZone },
    ...(creator ? [
      { label: copy("الحد الأدنى المعلن للتعاون", "Declared collaboration minimum"), value: profile.minimumMinor !== null && profile.currency ? <bdi dir="ltr">{formatMoneyDecimal({ amountMinor: profile.minimumMinor, currencyCode: profile.currency })} {profile.currency}</bdi> : unknown },
      { label: copy("التفرّغ المعلن", "Declared availability"), value: availabilityLabel, note: availability.status === "AVAILABLE" && text(availability.startsAt) && text(availability.endsAt) ? <span dir="ltr">{text(availability.startsAt)} — {text(availability.endsAt)} UTC</span> : undefined },
    ] : [
      { label: copy("موقع الشركة", "Company website"), value: profile.website ?? (profileFacts.noWebsite === true ? copy("بدون موقع حاليًا", "No website currently") : unknown), ltr: !!profile.website },
      { label: copy("العملة المفضّلة", "Preferred currency"), value: text(profileFacts.preferredCurrency) ?? unknown, ltr: !!text(profileFacts.preferredCurrency) },
    ]),
  ];

  return <section className={pageClass}>
    <header className={styles.header}>
      <div><h1 className={styles.title}>{title}</h1><p className={styles.subtitle}>{copy("معلوماتك المحفوظة وخدماتك وملفك، في مكان واحد.", "Your saved information, services and portfolio in one place.")}</p></div>
      <div className={styles.savedState}><p className={styles.muted}>{copy("حالة الحفظ", "Saved state")}</p><p className={styles.stateValue}>{savedState(profile.state, copy)}</p></div>
    </header>

    <section className={styles.identity} aria-label={copy("معلومات الملف", "Profile identity")}>
      <div className={styles.avatar} aria-hidden="true">{Array.from(profile.displayName.trim())[0] ?? "؟"}</div>
      <div className={styles.identityDetails}>
        <h2 className={styles.name} dir="auto">{profile.displayName}</h2>
        <p className={styles.handle} dir="ltr">{creator ? `@${profile.handle}` : profile.handle}</p>
        {profile.bio && <p className={styles.bio} dir="auto">{profile.bio}</p>}
      </div>
      <Button asChild variant="outline"><Link href={editPath}><Pencil aria-hidden="true" />{copy("تعديل الملف", "Edit profile")}</Link></Button>
    </section>

    <dl className={styles.facts}>{facts.map((fact) => <div key={fact.label} className={styles.fact}><dt>{fact.label}</dt><dd dir={fact.ltr ? "ltr" : "auto"}>{fact.value}{fact.note && <div className={styles.factNote}>{fact.note}</div>}</dd></div>)}</dl>

    <div className={styles.panels}>
      <section className={styles.panel} aria-labelledby="profile-services-title">
        <div className={styles.panelHeader}><h2 id="profile-services-title" className={styles.panelTitle}>{creator ? copy("التخصصات والخدمات", "Niches and services") : copy("معلومات الشركة", "Company information")}</h2><Link className={styles.editLink} href={editPath}>{copy("تعديل", "Edit")}</Link></div>
        {creator ? <>
          <div className={styles.chips}>{profile.nicheSlugs.length ? profile.nicheSlugs.map((slug) => <span key={slug} className={styles.chip}>{NICHE_BY_SLUG[slug]?.[isAr ? "labelAr" : "labelEn"] ?? slug}</span>) : <p className={styles.muted}>{copy("ما أضفت تخصصات حتى الآن.", "No niches added yet.")}</p>}</div>
          <h3 className={styles.sectionHeading}>{copy("الأسعار المحفوظة", "Saved rates")}</h3>
          {owner.rates.length ? <ul className={styles.list}>{owner.rates.map((rate) => <li key={`${rate.platform}:${rate.format}:${rate.currencyCode}`} className={styles.rate}><span><bdi dir="ltr">{rate.platform}</bdi> · {formats[rate.format]?.[isAr ? 0 : 1] ?? rate.format}</span><bdi dir="ltr" className={styles.money}>{formatMoneyDecimal(rate)} {rate.currencyCode}</bdi></li>)}</ul> : <p className={styles.muted}>{copy("ما أضفت أسعارًا حتى الآن. تقدر تكمل ملفك بدونها.", "No rates added yet. You can continue your profile without them.")}</p>}
        </> : <>
          <h3 className={styles.sectionHeading}>{copy("ممثل الشركة (خاص)", "Company representative (private)")}</h3>
          <p dir="auto" className={styles.itemHeading}>{contactName ?? unknown}</p>
          <p dir="auto" className={styles.muted}>{representativeRole ?? unknown}</p>
          <p className={`${styles.muted} mt-3`}>{copy("هذه معلوماتك المحفوظة، وليست تأكيدًا لصلاحية التمثيل.", "These are your saved details; they do not confirm representation authority.")}</p>
        </>}
      </section>

      <section className={styles.panel} aria-labelledby="profile-portfolio-title">
        <div className={styles.panelHeader}><h2 id="profile-portfolio-title" className={styles.panelTitle}>{copy("الملف التعريفي", "Portfolio")}</h2><Link className={styles.editLink} href={editPath}>{copy("مراجعة وتعديل", "Review and edit")}</Link></div>
        {portfolio ? <>
          <p className={styles.portfolioStatus}>{copy("نسخة محفوظة", "Saved version")} <bdi>{portfolio.version}</bdi> · {portfolio.approvedAt ? copy("راجعتها بنفسك", "Reviewed by you") : copy("بانتظار مراجعتك", "Awaiting your review")}</p>
          {portfolio.content.bio && <p dir="auto" className={styles.portfolioBio}>{portfolio.content.bio}</p>}
          {portfolio.content.sections.length ? <ul className={styles.list}>{portfolio.content.sections.map((section, index) => <li key={index} className={styles.item}><h3 dir="auto" className={styles.itemHeading}>{section.heading}</h3><p dir="auto" className={styles.itemText}>{section.text}</p></li>)}</ul> : <p className={styles.muted}>{copy("ما أضفت أقسامًا إضافية لهذه النسخة.", "No additional sections in this version.")}</p>}
        </> : <p className={styles.muted}>{copy("ما عندك ملف تعريفي محفوظ حتى الآن. جهّز مسودته وراجعها من إعداد ملفك.", "No saved portfolio yet. Prepare and review a draft in profile setup.")}</p>}
      </section>
    </div>

    {creator && <section className={`${styles.panel} ${styles.accounts}`} aria-labelledby="profile-accounts-title">
      <div className={styles.panelHeader}><h2 id="profile-accounts-title" className={styles.panelTitle}>{copy("الحسابات المحفوظة", "Saved accounts")}</h2><Link className={styles.editLink} href={editPath}>{copy("مراجعة الحسابات", "Review accounts")}</Link></div>
      {owner.accounts.length ? <ul className={styles.list}>{owner.accounts.map((account) => <li key={account.id} className={styles.item}><p dir="ltr" className={styles.itemHeading}>{account.platform} · @{account.handle}</p>{account.id === profile.primaryAccountId && <p className={styles.muted}>{copy("الحساب الأساسي المختار", "Selected primary account")}</p>}</li>)}</ul> : <p className={styles.muted}>{copy("ما أضفت حسابات حتى الآن.", "No accounts added yet.")}</p>}
      <p className={`${styles.muted} mt-3`}>{copy("اختيار الحساب وإثبات ملكيته خطوتان منفصلتان. راجع الإثبات والمشاركة من إعداد ملفك.", "Selecting an account and proving ownership are separate steps. Review proof and sharing in profile setup.")}</p>
    </section>}
  </section>;
}
