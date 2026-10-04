import { cookies } from "next/headers";
import { requirePageSession } from "@/lib/auth";
import { THEME_COOKIE } from "@/lib/brand";
import { AppShell } from "@/components/infame/app-shell";
export default async function BrandLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageSession("BRAND");
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return <AppShell name={actor.name} role="BRAND" initialTheme={theme}>{children}</AppShell>;
}
