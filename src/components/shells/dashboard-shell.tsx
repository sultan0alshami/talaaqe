"use client";
// Dashboard app shell (shells spec §1): sticky top bar + 232px sidebar.
// The prototype's demo role switcher is replaced by real auth (README §2);
// a logout button takes its place.
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n, type Dict } from "@/lib/i18n";

export type NavSpec = {
  key: string;
  labelKey: keyof Dict;
  href: string;
  badge?: string | number | null;
};

const AVATAR = {
  client: { bg: "#1B3568", init: "أ" },
  provider: { bg: "#14969E", init: "ع" },
  admin: { bg: "#14213A", init: "م" },
} as const;

export function DashboardShell({
  role,
  sidebarTitle,
  nav,
  userInitial,
  children,
}: {
  role: "client" | "provider" | "admin";
  sidebarTitle: { ar: string; en: string };
  nav: NavSpec[];
  userInitial?: string;
  children: React.ReactNode;
}) {
  const { t, toggleLang, pick } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/");
    router.refresh();
  };

  const isActive = (item: NavSpec) =>
    item.href === pathname ||
    (item.href !== `/${role}` && pathname.startsWith(item.href + "/")) ||
    // Project detail pages highlight "My projects".
    (item.key === "projects" && pathname.startsWith(`/${role}/projects`));

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E4E9F1", position: "sticky", top: 0, zIndex: 40 }}>
        <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
            <Image src="/assets/logo-mark.png" alt="Talaqi" width={30} height={29} style={{ objectFit: "contain" }} />
            <span style={{ fontWeight: 700, fontSize: 17, color: "#1B3568" }}>{t.brand}</span>
          </Link>
          <span
            style={{
              background: "#F7F0E3",
              color: "#8A6D33",
              fontSize: 11.5,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 999,
            }}
          >
            {t.demoMode}
          </span>
          <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={toggleLang}
              className="hover:bg-[#E4E9F1]"
              style={{
                background: "#F0F3F8",
                border: "1px solid #E4E9F1",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#1B3568",
                padding: "6px 13px",
                borderRadius: 999,
              }}
            >
              {t.langBtn}
            </button>
            <Link
              href="/"
              className="hover:text-[#1B3568]!"
              style={{ fontSize: 13, fontWeight: 600, color: "#7684A0", textDecoration: "none" }}
            >
              {t.backToSite} ↗
            </Link>
            <button
              onClick={logout}
              className="hover:text-[#B0433A]!"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#7684A0",
              }}
            >
              {t.langBtn === "EN" ? "تسجيل الخروج" : "Log out"}
            </button>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: AVATAR[role].bg,
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {userInitial || AVATAR[role].init}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div
          style={{
            width: 232,
            flexShrink: 0,
            background: "#fff",
            borderInlineEnd: "1px solid #E4E9F1",
            padding: "18px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: "#93A1B8",
              letterSpacing: ".06em",
              padding: "0 12px 10px",
            }}
          >
            {pick(sidebarTitle.ar, sidebarTitle.en)}
          </div>
          {nav.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.key}
                href={item.href}
                className="hover:bg-[#F0F3F8]"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  fontSize: 14,
                  padding: "10px 12px",
                  borderRadius: 10,
                  textAlign: "start",
                  width: "100%",
                  border: "none",
                  textDecoration: "none",
                  background: active ? "#EEF3FB" : "transparent",
                  color: active ? "#1B3568" : "#4A5A76",
                  fontWeight: active ? 700 : 500,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    flexShrink: 0,
                    background: active ? "#14969E" : "#C9D3E2",
                    borderRadius: active ? 2 : "50%",
                    display: "inline-block",
                  }}
                />
                <span style={{ flex: 1 }}>{String(t[item.labelKey])}</span>
                {item.badge ? (
                  <span
                    style={{
                      background: "#14969E",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "1px 8px",
                      borderRadius: 999,
                    }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
          <div
            style={{
              marginTop: "auto",
              background: "#F2F7F9",
              border: "1px solid #DCEBEE",
              borderRadius: 14,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0E7A81", marginBottom: 4 }}>{t.tagline}</div>
            <div style={{ fontSize: 12, color: "#7684A0" }}>Talaqi AI v0.9</div>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, minWidth: 0, padding: "28px 30px", overflowX: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}
