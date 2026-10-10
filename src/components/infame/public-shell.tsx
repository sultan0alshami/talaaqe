"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpLeft, ArrowUpRight, Menu, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND, THEME_COOKIE, type Theme } from "@/lib/brand";
import { INFAME_COPY } from "@/lib/infame-copy";
import { useI18n } from "@/lib/i18n";
import { InfameBrandPattern } from "./brand-pattern";
import { PwaInstall } from "./pwa-install";

export function PublicShell({ children, initialTheme = "light" }: { children: React.ReactNode; initialTheme?: Theme }) {
  const { lang, isAr, toggleLang } = useI18n();
  const copy = INFAME_COPY[lang];
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const links = [
    { href: "/for-brands", label: copy.nav.brands },
    { href: "/for-creators", label: copy.nav.creators },
    { href: "/about", label: copy.nav.about },
    { href: "/pricing", label: copy.nav.pricing },
  ];
  const Arrow = isAr ? ArrowUpLeft : ArrowUpRight;
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  const navLinks = links.map(({ href, label }) => (
    <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="infame-nav-link">{label}</Link>
  ));
  return (
    <div className="infame-public">
      <a className="infame-skip" href="#infame-main">{copy.nav.skip}</a>
      <header className="infame-header">
        <div className="infame-container infame-header-inner">
          <Link href="/" className="infame-wordmark" aria-label={`${BRAND.nameAr} / ${BRAND.name}`}><span className="infame-brand-dot" aria-hidden="true" /><span>{isAr ? BRAND.nameAr : BRAND.name}</span></Link>
          <nav className="infame-desktop-nav" aria-label={copy.nav.navigation}>{navLinks}</nav>
          <div className="infame-header-actions">
            <Button type="button" variant="ghost" size="icon" onClick={toggleTheme} aria-label={theme === "dark" ? copy.nav.light : copy.nav.dark}>{theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>
            <Button type="button" variant="ghost" onClick={toggleLang} aria-label={copy.nav.language} lang={isAr ? "en" : "ar"} className="infame-language">{isAr ? "EN" : "عربي"}</Button>
            <Button asChild variant="ghost" className="infame-desktop-auth"><Link href="/login">{copy.nav.login}</Link></Button>
            <Button asChild className="infame-desktop-auth"><Link href="/signup">{copy.nav.join}<Arrow aria-hidden="true" /></Link></Button>
            <details className="infame-mobile-menu" onKeyDown={(event) => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}>
              <summary aria-label={copy.nav.menu}><Menu size={21} aria-hidden="true" /><span className="sr-only">{copy.nav.menu}</span></summary>
              <nav aria-label={`${copy.nav.menu} · ${copy.nav.navigation}`} onClick={(event) => { if ((event.target as Element).closest("a")) event.currentTarget.closest("details")?.removeAttribute("open"); }}>
                {navLinks}<Link href="/login" className="infame-nav-link">{copy.nav.login}</Link><Button asChild><Link href="/signup">{copy.nav.join}</Link></Button>
              </nav>
            </details>
          </div>
        </div>
      </header>
      <main id="infame-main" tabIndex={-1} className="infame-main">{children}</main>
      <footer className="infame-footer">
        <div className="infame-container infame-footer-grid">
          <div><InfameBrandPattern compact /><Link href="/" className="infame-wordmark"><span className="infame-brand-dot" aria-hidden="true" />{isAr ? BRAND.nameAr : BRAND.name}</Link><p>{copy.footer.description}</p><p className="infame-footer-location">{copy.footer.location}</p></div>
          <nav aria-label={isAr ? "روابط التذييل" : "Footer links"}>{navLinks}<Link href="/contact" className="infame-nav-link">{copy.footer.contact}</Link><PwaInstall /></nav>
        </div>
        <div className="infame-container infame-footer-bottom"><span>{copy.footer.copyright}</span><span dir="ltr">{BRAND.domain}</span></div>
      </footer>
    </div>
  );
}
