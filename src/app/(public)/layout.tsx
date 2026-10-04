import { cookies } from "next/headers";
import { PublicShell } from "@/components/infame/public-shell";
import { THEME_COOKIE } from "@/lib/brand";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const initialTheme = (await cookies()).get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";
  return <PublicShell initialTheme={initialTheme}>{children}</PublicShell>;
}
