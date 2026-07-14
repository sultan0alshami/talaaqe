"use client";
// Public sticky blurred nav (shells spec §2.1). Anchor links (how/pricing/
// categories) live on the landing page; from other pages they navigate to
// /#id — landing sections set scroll-margin-top for the 70px sticky offset.
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

// Each nav choice is a bordered pill so it reads as a distinct selection;
// hover lifts it with a teal border, tint and soft shadow.
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
  border: `1px solid ${active ? "#C7D6EC" : "#E9EDF4"}`,
  background: active ? "#EEF3FB" : "#fff",
  color: active ? "#1B3568" : "#3D4C68",
  fontWeight: active ? 700 : 500,
});
const itemHover =
  "hover:border-[#14969E]! hover:bg-[#F2FBFB]! hover:text-[#0E7A81]! hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(20,150,158,0.14)]";

export function PublicNav() {
  const { t, toggleLang } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const anchor = (id: string) => {
    if (pathname !== "/") {
      router.push(`/#${id}`);
      return;
    }
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
  };

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link key={href} href={href} className={itemHover} style={itemStyle(active)}>
        {label}
      </Link>
    );
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,.92)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid #E4E9F1",
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <Image src="/assets/logo-mark.png" alt="Talaqi" width={36} height={35} style={{ objectFit: "contain" }} />
          <span style={{ fontWeight: 700, fontSize: 19, color: "#1B3568", lineHeight: 1.2 }}>{t.brand}</span>
        </Link>
        <div style={{ display: "flex", gap: 7, marginInlineStart: "auto", alignItems: "center" }}>
          {/* Product & audience first, then subscriptions, then company. */}
          <button onClick={() => anchor("tq-how")} className={itemHover} style={itemStyle(false)}>
            {t.navHow}
          </button>
          {navLink("/for-clients", t.navClients)}
          {navLink("/for-providers", t.navProviders)}
          <button onClick={() => anchor("tq-pricing")} className={itemHover} style={itemStyle(false)}>
            {t.navPricing}
          </button>
          {navLink("/about", t.navAbout)}
          {navLink("/contact", t.navContact)}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={toggleLang}
            className="hover:bg-[#E4E9F1]"
            style={{
              background: "#F0F3F8",
              border: "1px solid #E4E9F1",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "#1B3568",
              padding: "7px 14px",
              borderRadius: 999,
            }}
          >
            {t.langBtn}
          </button>
          <Link
            href="/login"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1B3568",
              padding: "8px 12px",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            {t.login}
          </Link>
          <Link
            href="/signup?role=client"
            className="hover:bg-[#24437F]!"
            style={{
              background: "#1B3568",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: 10,
              boxShadow: "0 4px 14px rgba(27,53,104,.25)",
              textDecoration: "none",
            }}
          >
            {t.startCta}
          </Link>
        </div>
      </div>
    </div>
  );
}
