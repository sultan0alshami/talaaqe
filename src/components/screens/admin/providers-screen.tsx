"use client";
// Admin providers table (provider-admin spec §5): verification chip by status,
// approve/reject pills on PENDING rows (POST /api/admin/providers/:id/...).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { fmtBudget } from "@/lib/format";

type ProviderRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  roleAr: string;
  roleEn: string;
  typeAr: string;
  typeEn: string;
  cityAr: string;
  cityEn: string;
  rating: number;
  priceMin: number | null;
  priceMax: number | null;
  verifiedStatus: "APPROVED" | "PENDING" | "REJECTED";
  avatarColor: string;
  avatarInitial: string;
};

const GRID = "2fr 1fr 1fr 1fr 1.2fr 1fr";

export function ProvidersScreen({ providers }: { providers: ProviderRow[] }) {
  const { t, pick } = useI18n();
  const router = useRouter();
  const [resolved, setResolved] = useState<Record<string, "APPROVED" | "REJECTED">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/providers/${id}/${action}`, { method: "POST" });
      if (res.ok) {
        setResolved((r) => ({ ...r, [id]: action === "approve" ? "APPROVED" : "REJECTED" }));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const chipFor = (status: ProviderRow["verifiedStatus"]) =>
    status === "APPROVED"
      ? { label: t.verified, bg: "#E9F6EF", fg: "#1F7A4D" }
      : status === "PENDING"
        ? { label: t.pendingTag, bg: "#FDF9F0", fg: "#8A6D33" }
        : { label: t.rejectedLbl, bg: "#FBEDEB", fg: "#B0433A" };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>{t.aProvidersTitle}</h1>
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
          <span>{t.thProvider}</span>
          <span>{t.thType}</span>
          <span>{t.thCity}</span>
          <span>{t.thRating}</span>
          <span>{t.thPrice}</span>
          <span>{t.thVerified}</span>
        </div>
        {providers.length === 0 && (
          <div style={{ padding: "22px 24px", fontSize: 13.5, color: "#93A1B8" }}>—</div>
        )}
        {providers.map((p) => {
          const status = p.id in resolved ? resolved[p.id] : p.verifiedStatus;
          const chip = chipFor(status);
          return (
            <div
              key={p.id}
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
                    borderRadius: 10,
                    background: p.avatarColor,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {p.avatarInitial}
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
                    {pick(p.nameAr, p.nameEn)}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "#93A1B8",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {pick(p.roleAr, p.roleEn)}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 13, color: "#4A5A76" }}>{pick(p.typeAr, p.typeEn)}</span>
              <span style={{ fontSize: 13, color: "#4A5A76" }}>{pick(p.cityAr, p.cityEn)}</span>
              <span style={{ fontSize: 13, color: "#4A5A76" }}>★ {p.rating}</span>
              <span style={{ fontSize: 13, color: "#4A5A76" }}>{fmtBudget(p.priceMin, p.priceMax)}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                  style={{
                    background: chip.bg,
                    color: chip.fg,
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "3px 11px",
                    borderRadius: 999,
                    whiteSpace: "nowrap",
                  }}
                >
                  {chip.label}
                </span>
                {status === "PENDING" && (
                  <>
                    <button
                      onClick={() => decide(p.id, "approve")}
                      disabled={busy === p.id}
                      className="hover:bg-[#D7EEDF]"
                      style={{
                        background: "#E9F6EF",
                        color: "#1F7A4D",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "6px 14px",
                        borderRadius: 999,
                        opacity: busy === p.id ? 0.6 : 1,
                      }}
                    >
                      {t.approve}
                    </button>
                    <button
                      onClick={() => decide(p.id, "reject")}
                      disabled={busy === p.id}
                      className="hover:bg-[#F6DEDA]"
                      style={{
                        background: "#FBEDEB",
                        color: "#B0433A",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "6px 14px",
                        borderRadius: 999,
                        opacity: busy === p.id ? 0.6 : 1,
                      }}
                    >
                      {t.reject}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
