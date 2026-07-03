"use client";
// Navy public footer (shells spec §2.2).
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export function PublicFooter() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  const anchor = (id: string) => {
    if (pathname !== "/") {
      router.push(`/#${id}`);
      return;
    }
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
  };

  const linkStyle: React.CSSProperties = { fontSize: 13.5, color: "#C4CFE2", cursor: "pointer", textDecoration: "none" };
  const headStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#8A9AB8", marginBottom: 4 };

  return (
    <div style={{ background: "#14213A", color: "#fff" }}>
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "52px 24px 36px",
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr",
          gap: 40,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ background: "#fff", borderRadius: 10, padding: 5, display: "inline-flex" }}>
              <Image src="/assets/logo-mark.png" alt="Talaqi" width={28} height={27} style={{ objectFit: "contain", display: "block" }} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 18 }}>{t.brand}</span>
          </div>
          <p style={{ fontSize: 13.5, color: "#8A9AB8", maxWidth: 340, margin: 0 }}>{t.positioning}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={headStyle}>{t.footerLinks1}</div>
          <span style={linkStyle} onClick={() => anchor("tq-how")}>
            {t.navHow}
          </span>
          <span style={linkStyle} onClick={() => anchor("tq-cats")}>
            {t.navCats}
          </span>
          <span style={linkStyle} onClick={() => anchor("tq-pricing")}>
            {t.navPricing}
          </span>
          <Link href="/for-clients" style={linkStyle}>
            {t.navClients}
          </Link>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={headStyle}>{t.footerLinks2}</div>
          <Link href="/about" style={linkStyle}>
            {t.footerAbout}
          </Link>
          <Link href="/for-providers" style={linkStyle}>
            {t.navProviders}
          </Link>
          <Link href="/contact" style={linkStyle}>
            {t.footerContact}
          </Link>
          <span style={linkStyle}>{t.footerTerms}</span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            fontSize: 12.5,
            color: "#6B7C9E",
          }}
        >
          <span>{t.footerRights}</span>
          <span>{t.footerMade}</span>
        </div>
      </div>
    </div>
  );
}
