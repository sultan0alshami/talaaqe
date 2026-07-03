import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { cookies } from "next/headers";
import { I18nProvider, LANG_COOKIE, type Lang } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex-arabic",
});

export const metadata: Metadata = {
  title: "تلاقي | Talaqi — AI Procurement & Execution Platform",
  description:
    "تلاقي منصة ذكية للشراء والتنفيذ تحوّل احتياجك إلى مشروع واضح قابل للتنفيذ، ثم ترشّح لك أنسب مقدم خدمة. Talaqi is the intelligent operating system for professional services.",
  icons: { icon: "/assets/logo-mark.png" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = cookieLang === "en" ? "en" : "ar";
  return (
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={plexArabic.variable}
      suppressHydrationWarning
    >
      <body>
        <I18nProvider initialLang={lang}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
