import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from "next/font/google";
import { cookies } from "next/headers";
import { I18nProvider } from "@/lib/i18n";
import { LANG_COOKIE, type Lang } from "@/lib/lang";
import { ToastProvider } from "@/components/ui/toast";
import { BRAND, THEME_COOKIE } from "@/lib/brand";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex-arabic",
});
const plexLatin = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-plex-latin" });

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: { default: `${BRAND.nameAr} | ${BRAND.name}`, template: `%s | ${BRAND.name}` },
  description: "إنفيم يجمع المؤثرين العرب والعلامات التجارية، من كل مكان. Arab creators and brands, from everywhere.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLang = cookieStore.get(LANG_COOKIE)?.value;
  const lang: Lang = cookieLang === "en" ? "en" : "ar";
  const theme = cookieStore.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return (
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={`${plexArabic.variable} ${plexLatin.variable}${theme === "dark" ? " dark" : ""}`}
      style={{ colorScheme: theme }}
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
