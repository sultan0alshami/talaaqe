"use client";
// Admin users table (provider-admin spec §7): role/status chips + a small
// suspend/activate ghost action per row (PATCH /api/admin/users/:id).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n, type Dict } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";

type UserRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  email: string;
  role: "CLIENT" | "PROVIDER" | "ADMIN";
  active: boolean;
  joined: string;
};

// Role chip + avatar color map (behaviors §6.8).
const ROLE_CHIP: Record<UserRow["role"], { labelKey: keyof Dict; bg: string; fg: string; avatar: string }> = {
  CLIENT: { labelKey: "roleClient", bg: "#EEF3FB", fg: "#1B3568", avatar: "#1B3568" },
  PROVIDER: { labelKey: "roleProvider", bg: "#E8F5F6", fg: "#0E7A81", avatar: "#14969E" },
  ADMIN: { labelKey: "roleAdminL", bg: "#F7F0E3", fg: "#8A6D33", avatar: "#14213A" },
};

const GRID = "2.2fr 1fr 1fr 1fr auto";

export function UsersScreen({ users, selfId }: { users: UserRow[]; selfId: string }) {
  const { t, isAr, pick } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const toggleActive = async (u: UserRow) => {
    setBusy(u.id);
    try {
      await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !u.active }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>{t.usersTitle}</h1>
      <div style={{ background: "#fff", border: "1px solid #E4E9F1", borderRadius: 18, overflow: "hidden" }}>
        <div
          style={{
            padding: "13px 24px",
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 12,
            background: "#FAFBFD",
            borderBottom: "1px solid #EEF1F6",
            fontSize: 12.5,
            fontWeight: 700,
            color: "#7684A0",
          }}
        >
          <span>{t.thUser}</span>
          <span>{t.thRole}</span>
          <span>{t.thJoined}</span>
          <span>{t.thStatus}</span>
          <span style={{ width: 64 }} />
        </div>
        {users.length === 0 && (
          <div style={{ padding: "22px 24px", fontSize: 13.5, color: "#93A1B8" }}>—</div>
        )}
        {users.map((u) => {
          const chip = ROLE_CHIP[u.role];
          return (
            <div
              key={u.id}
              className="hover:bg-[#FAFBFD]"
              style={{
                padding: "13px 24px",
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 12,
                alignItems: "center",
                borderBottom: "1px solid #F3F5F9",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: chip.avatar,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {pick(u.nameAr, u.nameEn).charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {pick(u.nameAr, u.nameEn)}
                  </div>
                  <div
                    dir="ltr"
                    style={{
                      fontSize: 11.5,
                      color: "#93A1B8",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textAlign: "start",
                    }}
                  >
                    {u.email}
                  </div>
                </div>
              </div>
              <span
                style={{
                  background: chip.bg,
                  color: chip.fg,
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: "3px 12px",
                  borderRadius: 999,
                  justifySelf: "start",
                }}
              >
                {String(t[chip.labelKey])}
              </span>
              <span style={{ fontSize: 13, color: "#4A5A76" }}>{fmtDate(u.joined)}</span>
              <span
                style={{
                  background: u.active ? "#E9F6EF" : "#FBEDEB",
                  color: u.active ? "#1F7A4D" : "#B0433A",
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: "3px 12px",
                  borderRadius: 999,
                  justifySelf: "start",
                }}
              >
                {u.active ? t.activeL : t.suspendedL}
              </span>
              {u.id !== selfId ? (
                <button
                  onClick={() => toggleActive(u)}
                  disabled={busy === u.id}
                  className="hover:bg-[#F0F3F8]"
                  style={{
                    background: "none",
                    border: "1px solid #E4E9F1",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    color: u.active ? "#B0433A" : "#1F7A4D",
                    padding: "5px 13px",
                    borderRadius: 999,
                    whiteSpace: "nowrap",
                    opacity: busy === u.id ? 0.6 : 1,
                  }}
                >
                  {u.active ? (isAr ? "إيقاف" : "Suspend") : isAr ? "تفعيل" : "Activate"}
                </button>
              ) : (
                <span style={{ width: 64 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
