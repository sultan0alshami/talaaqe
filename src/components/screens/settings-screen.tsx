"use client";
// Shared Settings screen for all three roles (behaviors §7.1, shells §1.4).
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: 24,
  marginBottom: 18,
};
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: "0 0 4px" };
const cardSub: React.CSSProperties = { fontSize: 13, color: "#7684A0", margin: "0 0 16px" };

export function SettingsScreen() {
  const { t, isAr, setLang } = useI18n();
  const { showToast } = useToast();
  const [notif, setNotif] = useState<boolean[]>([true, true, false]);

  const segActive: React.CSSProperties = {
    background: "#fff",
    color: "#1B3568",
    boxShadow: "0 2px 6px rgba(20,40,80,.12)",
  };
  const segInactive: React.CSSProperties = { background: "transparent", color: "#7684A0", boxShadow: "none" };
  const segBtn: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    padding: "7px 22px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
  };
  const actionBtn: React.CSSProperties = {
    background: "#F0F3F8",
    color: "#1B3568",
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
        <div style={{ display: "inline-flex", background: "#F0F3F8", borderRadius: 999, padding: 4, gap: 2 }}>
          <button style={{ ...segBtn, ...(isAr ? segActive : segInactive) }} onClick={() => setLang("ar")}>
            العربية
          </button>
          <button style={{ ...segBtn, ...(!isAr ? segActive : segInactive) }} onClick={() => setLang("en")}>
            English
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div style={card}>
        <h3 style={{ ...cardTitle, marginBottom: 14 }}>{t.setNotifT}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {t.notifs.map((label: string, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 14, color: "#2C3A54" }}>{label}</span>
              <button
                onClick={() => {
                  setNotif((n) => n.map((v, j) => (j === i ? !v : v)));
                  showToast(t.settingsSaved);
                }}
                aria-pressed={notif[i]}
                style={{
                  width: 44,
                  height: 25,
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  position: "relative",
                  transition: "background .2s",
                  background: notif[i] ? "#14969E" : "#D5DDE9",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    insetInlineStart: notif[i] ? 22 : 3,
                    width: 19,
                    height: 19,
                    borderRadius: "50%",
                    background: "#fff",
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
          <button className="hover:bg-[#E4E9F1]" style={actionBtn} onClick={() => showToast(t.demoOnly)}>
            {t.changePass}
          </button>
          <button className="hover:bg-[#E4E9F1]" style={actionBtn} onClick={() => showToast(t.demoOnly)}>
            {t.exportData}
          </button>
          <button
            className="hover:bg-[#F6DEDA]"
            style={{ ...actionBtn, background: "#FBEDEB", color: "#B0433A" }}
            onClick={() => showToast(t.demoOnly)}
          >
            {t.deleteAcc}
          </button>
        </div>
      </div>
    </div>
  );
}
