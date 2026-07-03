"use client";
// Public sticky blurred nav (shells spec §2.1). Anchor links (how/pricing/
// categories) live on the landing page; from other pages they navigate to
// /#id — landing sections set scroll-margin-top for the 70px sticky offset.
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

const ghost: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  padding: "8px 10px",
  borderRadius: 8,
  textDecoration: "none",
  display: "inline-block",
};

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
      <Link
        key={href}
        href={href}
        className="hover:bg-[#F0F3F8]"
        style={{ ...ghost, fontWeight: active ? 700 : 500, color: active ? "#1B3568" : "#3D4C68" }}
      >
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
        <div style={{ display: "flex", gap: 4, marginInlineStart: "auto", alignItems: "center" }}>
          {/* Product & audience first, then subscriptions, then company. */}
          <button onClick={() => anchor("tq-how")} className="hover:bg-[#F0F3F8]" style={{ ...ghost, fontWeight: 500, color: "#3D4C68" }}>
            {t.navHow}
          </button>
          {navLink("/for-clients", t.navClients)}
          {navLink("/for-providers", t.navProviders)}
          <button onClick={() => anchor("tq-pricing")} className="hover:bg-[#F0F3F8]" style={{ ...ghost, fontWeight: 500, color: "#3D4C68" }}>
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
          <Link href="/login" style={{ ...ghost, fontSize: 14, fontWeight: 600, color: "#1B3568", padding: "8px 12px" }}>
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
