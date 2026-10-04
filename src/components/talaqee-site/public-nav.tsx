"use client";
// Public sticky blurred nav (shells spec §2.1). Anchor links (how/pricing/
// categories) live on the landing page; from other pages they navigate to
// /classic#id — landing sections reserve the sticky header offset.
import { InfameMark } from "./mark";
import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

// Each nav choice is a bordered pill so it reads as a distinct selection;
// hover lifts it with an ink border, tint and soft shadow.
const itemBase: React.CSSProperties = {
  cursor: "pointer",
  fontSize: 14,
  padding: "8px 16px",
  borderRadius: 999,
  textDecoration: "none",
  display: "inline-block",
  transition: "border-color .15s ease, background .15s ease, color .15s ease, transform .15s ease, box-shadow .15s ease",
};
const itemStyle = (active: boolean): React.CSSProperties => ({
  ...itemBase,
  border: `1px solid ${active ? "var(--classic-border)" : "var(--classic-border)"}`,
  background: active ? "var(--classic-tint)" : "var(--classic-card)",
  color: active ? "var(--classic-ink)" : "var(--classic-body)",
  fontWeight: active ? 700 : 500,
});
const itemHover =
  "hover:border-[var(--classic-accent-ink)]! hover:bg-[var(--classic-tint)]! hover:text-[var(--classic-accent-ink)]! hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(18,18,20,0.14)]";

export function PublicNav() {
  const { t, toggleLang } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const anchor = (id: string) => {
    if (pathname !== "/classic") {
      router.push(`/classic#${id}`);
      return;
    }
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link key={href} href={href} aria-current={active ? "page" : undefined} className={itemHover} style={itemStyle(active)}>
        {label}
      </Link>
    );
  };

  const choices = <>
    <button type="button" onClick={() => anchor("tq-how")} className={itemHover} style={itemStyle(false)}>{t.navHow}</button>
    {navLink("/classic/for-brands", t.navClients)}
    {navLink("/classic/for-creators", t.navProviders)}
    <button type="button" onClick={() => anchor("tq-pricing")} className={itemHover} style={itemStyle(false)}>{t.navPricing}</button>
    {navLink("/classic/about", t.navAbout)}
    {navLink("/classic/contact", t.navContact)}
  </>;
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,.92)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--classic-border)",
      }}
    >
      <div className={styles.headerInner}
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <Link href="/classic" aria-label={t.brand} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <InfameMark />
          <span style={{ fontWeight: 700, fontSize: 19, color: "var(--classic-ink)", lineHeight: 1.2 }}>{t.brand}</span>
        </Link>
        <nav className={styles.desktopNav} aria-label={t.navLabel} style={{ display: "flex", gap: 7, marginInlineStart: "auto", alignItems: "center" }}>{choices}</nav>
        <div className={styles.headerActions} style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={toggleLang}
            type="button" aria-label={t.langBtn === "EN" ? "Switch to English" : "التبديل إلى العربية"} lang={t.langBtn === "EN" ? "en" : "ar"}
            className="hover:bg-[var(--classic-border)]"
            style={{
              background: "var(--classic-tint)",
              border: "1px solid var(--classic-border)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--classic-ink)",
              padding: "7px 14px",
              borderRadius: 999,
            }}
          >
            {t.langBtn}
          </button>
          <Link
            href="/classic/login"
            className={styles.desktopAuth}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--classic-ink)",
              padding: "8px 12px",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            {t.login}
          </Link>
          <Link
            href="/classic/signup?role=brand"
            className={`${styles.desktopAuth} hover:opacity-90`}
            style={{
              background: "var(--classic-ink)",
              color: "var(--classic-inverse)",
              fontSize: 14,
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: 10,
              boxShadow: "0 4px 14px rgba(18,18,20,.25)",
              textDecoration: "none",
            }}
          >
            {t.startCta}
          </Link>
          <details className={styles.mobileMenu} onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
            }}>
            <summary aria-label={t.menuLabel}><Menu size={20} aria-hidden="true" /></summary>
            <nav aria-label={`${t.menuLabel} · ${t.navLabel}`} onClick={(event) => {
              const activated = (event.target as Element).closest("a,button");
              if (activated) {
                const details = event.currentTarget.closest("details");
                details?.removeAttribute("open");
                if (activated.tagName === "BUTTON") details?.querySelector("summary")?.focus();
              }
            }}>{choices}{navLink("/classic/login", t.login)}{navLink("/classic/signup?role=brand", t.startCta)}{navLink("/classic/signup?role=creator", t.joinCta)}</nav>
          </details>
        </div>
      </div>
    </header>
  );
}
