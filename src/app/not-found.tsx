"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { InfameBrandPattern } from "@/components/infame/brand-pattern";

export default function NotFound() {
  const { isAr } = useI18n();
  return <main id="infame-main" className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-center justify-center gap-5 px-6 py-12 text-center">
    <InfameBrandPattern compact />
    <h1 className="text-2xl font-bold">{isAr ? "هذه الصفحة غير متاحة" : "This page is unavailable"}</h1>
    <p className="text-muted-foreground">{isAr ? "يمكنك الرجوع إلى الموقع الرئيسي والمتابعة من هناك." : "Return to the main website to continue."}</p>
    <Button asChild><Link href="/">{isAr ? "الموقع الرئيسي" : "Main website"}</Link></Button>
  </main>;
}
