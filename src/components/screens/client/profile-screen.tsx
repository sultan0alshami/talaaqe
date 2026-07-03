"use client";
// Client profile (client-screens.md §7, shells §5.1 fact cards).
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

// organizationType keys → localized labels (schema: individual|startup|sme|company|government)
const ORG_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  individual: { ar: "فرد", en: "Individual" },
  startup: { ar: "شركة ناشئة", en: "Startup" },
  sme: { ar: "شركة صغيرة", en: "Small company" },
  company: { ar: "شركة", en: "Company" },
  government: { ar: "جهة حكومية", en: "Government" },
};

const factCard: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 14,
  padding: "16px 18px",
};
const factLabel: React.CSSProperties = { fontSize: 12, color: "#93A1B8", marginBottom: 3 };
const factValue: React.CSSProperties = {
  fontSize: 14.5,
  fontWeight: 700,
  color: "#2C3A54",
  textAlign: "start",
};

export function ProfileScreen({
  nameAr,
  nameEn,
  companyName,
  email,
  phone,
  createdAt,
  organizationType,
  sector,
  location,
}: {
  nameAr: string;
  nameEn: string | null;
  companyName: string | null;
  email: string;
  phone: string | null;
  createdAt: string;
  organizationType: string | null;
  sector: string | null;
  location: string | null;
}) {
  const { t, isAr, pick } = useI18n();
  const { showToast } = useToast();

  const name = pick(nameAr, nameEn);
  const orgType = organizationType ? ORG_TYPE_LABELS[organizationType] : null;

  const facts: { label: string; v: string; ltr?: boolean }[] = [
    { label: t.cpOrgType, v: orgType ? (isAr ? orgType.ar : orgType.en) : "—" },
    { label: t.cpSector, v: sector ?? "—" },
    { label: t.cpLocation, v: location ?? "—" },
    { label: t.ciEmail, v: email, ltr: true },
    { label: t.sfPhone, v: phone ?? "—", ltr: !!phone },
    { label: t.memberSince, v: fmtDate(createdAt) },
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{t.cpTitle}</h1>
        <p style={{ color: "#7684A0", margin: 0, fontSize: 14.5 }}>{t.cpSub}</p>
      </div>

      {/* Identity card */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E4E9F1",
          borderRadius: 18,
          padding: 26,
          marginBottom: 18,
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: "#1B3568",
            color: "#fff",
            fontSize: 30,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {name.trim().charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{name}</div>
          <div style={{ fontSize: 14, color: "#7684A0" }}>
            {companyName ? `${companyName} · ` : ""}
            {t.memberSince} {fmtDate(createdAt)}
          </div>
        </div>
        <button
          onClick={() => showToast(t.demoOnly)}
          className="hover:border-[#1B3568]!"
          style={{
            background: "#fff",
            color: "#1B3568",
            border: "1.5px solid #D5DDE9",
            cursor: "pointer",
            fontSize: 13.5,
            fontWeight: 600,
            padding: "11px 20px",
            borderRadius: 10,
          }}
        >
          ✎ {t.cpEdit}
        </button>
      </div>

      {/* Facts grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 18,
        }}
      >
        {facts.map((f, i) => (
          <div key={i} style={factCard}>
            <div style={factLabel}>{f.label}</div>
            <div dir={f.ltr ? "ltr" : undefined} style={factValue}>
              {f.v}
            </div>
          </div>
        ))}
      </div>

      {/* Contact person card */}
      <div style={factCard}>
        <div style={factLabel}>{t.cpContactT}</div>
        <div style={factValue}>{name}</div>
      </div>
    </div>
  );
}
