"use client";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoneyDecimal } from "@/lib/contracts/money";
import type { publicCreator, publicBrand } from "@/lib/onboarding/profiles";
type Creator = NonNullable<Awaited<ReturnType<typeof publicCreator>>>;
type Brand = NonNullable<Awaited<ReturnType<typeof publicBrand>>>;
export function PublicPortfolio({ creator, brand }: { creator?: Creator; brand?: Brand }) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const profile = creator ?? brand!;
  return <section className="mx-auto max-w-5xl space-y-8 px-4 py-12 sm:py-20">
    <div className="space-y-4"><p dir="ltr" className="text-sm text-muted-foreground">{creator ? `@${creator.handle}` : `infame.sa/brands/${brand!.slug}`}</p><h1 className="text-4xl font-semibold">{creator?.displayName ?? brand!.name}</h1><p className="whitespace-pre-wrap text-lg">{profile.portfolio.bio}</p>{profile.countryCode && <p className="text-muted-foreground">{new Intl.DisplayNames([isAr ? "ar" : "en"], { type: "region" }).of(profile.countryCode)}</p>}</div>
    {profile.portfolio.sections.map((section, index) => <Card key={index}><CardHeader><CardTitle><h2>{section.heading}</h2></CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-base">{section.text}</p></CardContent></Card>)}
    {creator && <><Card><CardHeader><CardTitle><h2>{copy("الحسابات المعتمدة", "Accepted accounts")}</h2></CardTitle></CardHeader><CardContent className="flex flex-wrap gap-4">{creator.accounts.map((account) => <div key={`${account.platform}:${account.handle}`} className="rounded-lg border p-4"><p dir="ltr">{account.platform} · @{account.handle}</p><p className="mt-2 text-sm text-muted-foreground">{copy("ملكية الحساب معتمدة", "Account ownership accepted")}</p></div>)}</CardContent></Card>{creator.rates.length > 0 && <Card><CardHeader><CardTitle><h2>{copy("الأسعار المعلنة", "Published rates")}</h2></CardTitle></CardHeader><CardContent className="space-y-4">{creator.rates.map((rate) => <div key={`${rate.platform}:${rate.format}:${rate.currencyCode}`} className="flex flex-wrap justify-between gap-3"><span dir="ltr">{rate.platform} · {rate.format}</span><span dir="ltr">{formatMoneyDecimal(rate)} {rate.currencyCode}</span></div>)}</CardContent></Card>}{creator.work.length > 0 && <Card><CardHeader><CardTitle><h2>{copy("أعمال مختارة", "Selected work")}</h2></CardTitle></CardHeader><CardContent className="space-y-5">{creator.work.map((work, index) => <div key={index}><h3 className="text-lg font-semibold">{work.title}</h3>{work.description && <p className="mt-2 whitespace-pre-wrap text-base">{work.description}</p>}</div>)}</CardContent></Card>}</>}
    {brand?.website && <a href={brand.website} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-12 items-center underline">{copy("موقع الشركة", "Company website")}</a>}
  </section>;
}
