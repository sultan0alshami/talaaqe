"use client";

// Retained Talaqee dashboard: compact sticky top bar, 232px sidebar and
// 28px/30px desktop content spacing. Infame supplies current routes/data.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, Moon, Sun } from "lucide-react";
import { BRAND, THEME_COOKIE, type Theme } from "@/lib/brand";
import { useI18n, type Dict } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type NavSpec = {
  key: string;
  href: string;
  badge?: string | number | null;
} & (
  | { labelKey: keyof Dict; label?: never }
  | { label: { ar: string; en: string }; labelKey?: never }
);
type DashboardRole = "client" | "provider" | "admin" | "brand" | "creator";

export function DashboardShell({
  role,
  sidebarTitle,
  nav,
  userInitial,
  userName,
  initialTheme = "light",
  children,
}: {
  role: DashboardRole;
  sidebarTitle: { ar: string; en: string };
  nav: NavSpec[];
  userInitial?: string;
  userName?: string;
  initialTheme?: Theme;
  children: ReactNode;
}) {
  const { t, isAr, toggleLang, pick } = useI18n();
  const pathname = usePathname(),
    router = useRouter();
  const [theme, setTheme] = useState(initialTheme),
    [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const copy = (ar: string, en: string) => (isAr ? ar : en);
  const home = `/${role}`;
  const roleLabel =
    role === "brand" || role === "client"
      ? copy("مساحة العلامة التجارية", "Brand workspace")
      : role === "creator" || role === "provider"
        ? copy("مساحة صانع المحتوى", "Creator workspace")
        : copy("إدارة المنصة", "Platform admin");
  const title = pick(sidebarTitle.ar, sidebarTitle.en);
  const initial = userInitial || userName?.trim().charAt(0) || title.charAt(0);
  const activeKey = nav
    .filter(
      (item) =>
        item.href === pathname ||
        (item.href !== home && pathname.startsWith(item.href + "/")),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.key;

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function changeTheme() {
    const value = theme === "light" ? "dark" : "light";
    setTheme(value);
    document.documentElement.classList.toggle("dark", value === "dark");
    document.documentElement.style.colorScheme = value;
    document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  }
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      router.push("/login");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  function navigation(mobile = false) {
    return (
      <nav aria-label={roleLabel} className="grid gap-[3px]">
        {nav.map((item) => {
          const active = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={mobile ? () => setMenuOpen(false) : undefined}
              className={`flex min-h-11 w-full items-center gap-[11px] rounded-[10px] px-3 py-2.5 text-start text-sm no-underline hover:bg-muted ${active ? "bg-accent font-bold text-foreground" : "font-medium text-muted-foreground"}`}
            >
              <span
                aria-hidden="true"
                className={`inline-block size-2 shrink-0 ${active ? "rounded-[2px] bg-foreground" : "rounded-full bg-border"}`}
              />
              <span className="min-w-0 flex-1 break-words">
                {item.label
                  ? pick(item.label.ar, item.label.en)
                  : String(t[item.labelKey])}
              </span>
              {item.badge != null && item.badge !== "" && item.badge !== 0 && (
                <bdi className="rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">
                  {item.badge}
                </bdi>
              )}
            </Link>
          );
        })}
      </nav>
    );
  }
  function sidebarFooter() {
    return (
      <div className="mt-auto rounded-[14px] border border-border bg-background p-3.5">
        <p className="mb-1 text-[13px] font-bold">
          {copy(
            "تعاون واضح، من البداية",
            "Clear collaboration, from the start",
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          <bdi>{BRAND.domain}</bdi>
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col text-[15px]">
      <a
        href="#infame-main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-5 focus:py-3 focus:text-primary-foreground"
      >
        {copy("انتقل للمحتوى", "Skip to content")}
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="flex items-center gap-2 px-3 py-2.5 lg:gap-[18px] lg:px-5">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label={copy(
                  "فتح قائمة مساحة العمل",
                  "Open workspace menu",
                )}
              >
                <Menu aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent
              className="start-0 top-0 flex h-dvh w-[288px] max-w-[calc(100%-2rem)] translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 rtl:translate-x-0 sm:max-w-[288px]"
              closeLabel={copy(
                "إغلاق قائمة مساحة العمل",
                "Close workspace menu",
              )}
            >
              <div className="border-b border-border px-6 pb-4 pt-16">
                <DialogTitle className="break-words text-base font-bold">
                  <bdi>{title}</bdi>
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {roleLabel}
                </DialogDescription>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-[18px]">
                {navigation(true)}
                {sidebarFooter()}
              </div>
            </DialogContent>
          </Dialog>
          <Link
            href="/"
            aria-label={copy("إنفيم، الموقع الرئيسي", "Infame, main website")}
            className="flex min-h-11 shrink-0 items-center gap-[9px] text-[17px] font-bold no-underline lg:min-h-[34px]"
          >
            <span
              aria-hidden="true"
              className="infame-brand-dot hidden sm:inline-block"
              style={{ width: 30, height: 29 }}
            />
            <span>{isAr ? BRAND.nameAr : BRAND.name}</span>
          </Link>
          <span className="hidden rounded-full bg-muted px-2.5 py-[3px] text-[11.5px] font-semibold text-muted-foreground lg:inline">
            {roleLabel}
          </span>
          <div className="ms-auto flex min-w-0 items-center gap-1 lg:gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:size-[34px]"
              onClick={changeTheme}
              aria-label={
                theme === "light"
                  ? copy("الوضع الداكن", "Dark mode")
                  : copy("الوضع الفاتح", "Light mode")
              }
            >
              {theme === "light" ? (
                <Moon aria-hidden="true" />
              ) : (
                <Sun aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="secondary"
              onClick={toggleLang}
              lang={isAr ? "en" : "ar"}
              className="h-11 min-w-11 rounded-full border border-border px-[13px] text-[12.5px] font-semibold lg:h-[34px]"
              aria-label={copy("التبديل إلى الإنجليزية", "Switch to Arabic")}
            >
              {isAr ? "EN" : "عربي"}
            </Button>
            <Link
              href="/"
              className="hidden min-h-11 items-center text-[13px] font-semibold text-muted-foreground no-underline hover:text-foreground lg:inline-flex lg:min-h-[34px]"
            >
              {copy("العودة للموقع", "Back to website")} ↗
            </Link>
            <Button
              variant="ghost"
              className="px-2 text-[13px] font-semibold text-muted-foreground lg:h-[34px] lg:px-0"
              onClick={logout}
              disabled={busy}
              aria-label={copy("تسجيل الخروج", "Sign out")}
            >
              <LogOut aria-hidden="true" className="sm:hidden rtl:rotate-180" />
              <span className="hidden sm:inline">{copy("تسجيل الخروج", "Log out")}</span>
            </Button>
            <div
              title={userName || title}
              className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background"
            >
              <bdi aria-hidden="true">{initial}</bdi>
              <span className="sr-only">
                <bdi>{userName || title}</bdi>
              </span>
            </div>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[232px] shrink-0 flex-col gap-[3px] border-e border-border bg-card px-3 py-[18px] lg:flex">
          <div className="break-words px-3 pb-2.5 text-[11.5px] font-bold text-muted-foreground">
            <bdi>{title}</bdi>
          </div>
          {navigation()}
          {sidebarFooter()}
        </aside>
        <main
          id="infame-main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-7 outline-none lg:px-[30px]"
        >
          {error && (
            <p role="alert" className="mb-4 text-destructive">
              {copy(
                "تعذر تسجيل الخروج. جرّب مرة ثانية.",
                "Sign out failed. Please try again.",
              )}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
