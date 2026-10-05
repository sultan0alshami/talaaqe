"use client";
// Shared Settings screen for all three roles (behaviors §7.1, shells §1.4).
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 24,
  marginBottom: 18,
};
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: "0 0 4px" };
const cardSub: React.CSSProperties = { fontSize: 13, color: "var(--muted-foreground)", margin: "0 0 16px" };

export function SettingsScreen({ organizationSettings = false }: { organizationSettings?: boolean }) {
  const { t, isAr, setLang } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;

  const segActive: React.CSSProperties = {
    background: "var(--card)",
    color: "var(--foreground)",
    boxShadow: "0 2px 6px rgba(20,40,80,.12)",
  };
  const segInactive: React.CSSProperties = { background: "transparent", color: "var(--muted-foreground)", boxShadow: "none" };
  const segBtn: React.CSSProperties = {
    minHeight: 44,
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 22px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
  };
  const actionBtn: React.CSSProperties = {
    background: "var(--muted)",
    color: "var(--foreground)",
    border: "none",
    cursor: "pointer",
    padding: "11px 20px",
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 13.5,
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>{t.cNavSettings}</h1>

      {/* Language */}
      <div style={card}>
        <h3 style={cardTitle}>{t.setLangT}</h3>
        <p style={cardSub}>{t.setLangD}</p>
        <div style={{ display: "inline-flex", background: "var(--muted)", borderRadius: 999, padding: 4, gap: 2 }}>
          <button aria-pressed={isAr} style={{ ...segBtn, ...(isAr ? segActive : segInactive) }} onClick={() => setLang("ar")}>
            العربية
          </button>
          <button aria-pressed={!isAr} style={{ ...segBtn, ...(!isAr ? segActive : segInactive) }} onClick={() => setLang("en")}>
            English
          </button>
        </div>
      </div>

      {/* Notifications */}
      {organizationSettings && <div style={card}>
        <h3 style={cardTitle}>{copy("المؤسسات والفريق", "Organizations and team")}</h3>
        <p style={cardSub}>{copy("إدارة عضوية المؤسسة والوصول المفوّض للعملاء.", "Manage organization memberships and delegated client access.")}</p>
        <Link href="/brand/organizations" style={{ ...actionBtn, display: "inline-flex", textDecoration: "none", minHeight: 44, alignItems: "center" }}>
          {copy("عرض المؤسسات", "View organizations")}
        </Link>
        <Link href="/brand/settings/agency-access" style={{ ...actionBtn, display: "inline-flex", textDecoration: "none", minHeight: 44, alignItems: "center", marginInlineStart: 12 }}>
          {copy("وصول الوكالات ومراجع حسابك", "Agency access and your account references")}
        </Link>
      </div>}
      <div style={card}>
        <h3 style={{ ...cardTitle, marginBottom: 14 }}>{t.setNotifT}</h3>
        <p style={cardSub}>{copy("إعدادات إرسال الإشعارات غير متاحة حاليًا.", "Notification delivery settings are currently unavailable.")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {t.notifs.map((label: string, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 14, color: "var(--foreground)" }}>{label}</span>
              <button
                disabled
                aria-label={label}
                aria-pressed={false}
                style={{
                  width: 44,
                  height: 25,
                  borderRadius: 999,
                  border: "none",
                  cursor: "not-allowed",
                  position: "relative",
                  transition: "background .2s",
                  background: "var(--border)",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    insetInlineStart: 3,
                    width: 19,
                    height: 19,
                    borderRadius: "50%",
                    background: "var(--card)",
                    boxShadow: "0 1px 4px rgba(0,0,0,.25)",
                    transition: "inset-inline-start .2s",
                  }}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Account */}
      <div style={card}>
        <h3 style={{ ...cardTitle, marginBottom: 14 }}>{t.setAccountT}</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="hover:bg-[var(--border)]" style={{ ...actionBtn, textDecoration: "none" }} href="/forgot-password">
            {t.changePass}
          </Link>
          <button disabled style={{ ...actionBtn, cursor: "not-allowed", opacity: .6 }}>
            {t.exportData}
          </button>
          <button
            disabled
            style={{ ...actionBtn, background: "var(--infame-danger-bg)", color: "var(--destructive)", cursor: "not-allowed", opacity: .6 }}
          >
            {t.deleteAcc}
          </button>
        </div>
        <p style={{ ...cardSub, margin: "12px 0 0" }}>{copy("تصدير البيانات وحذف الحساب غير متاحين من هذه الشاشة حاليًا.", "Data export and account deletion are currently unavailable from this screen.")}</p>
      </div>
    </div>
  );
}
