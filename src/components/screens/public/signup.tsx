"use client";
// Public Sign-up page (public-screens spec §8, behaviors §7.2, prototype lines 495–566).
// Role cards preselect from ?role=; provider adds a specialty select fed by
// GET /api/categories. Submits to POST /api/auth/signup then redirects by role.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

type Category = { id: string; nameAr: string; nameEn: string; count: number };
type SignupRole = "client" | "provider";

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#4A5A76",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1.5px solid #E4E9F1",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  outline: "none",
  background: "#FBFCFE",
};

export function SignupScreen({ initialRole }: { initialRole?: string }) {
  const { t, isAr, lang, pick } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();

  const [role, setRole] = useState<SignupRole>(initialRole === "provider" ? "provider" : "client");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [city, setCity] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<"duplicate" | "generic" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (!alive || !Array.isArray(data?.categories)) return;
        setCategories(data.categories);
        setCategoryId((prev) => prev || data.categories[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const isClient = role === "client";

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          name: name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
          company: company.trim() || undefined,
          city: isClient ? city.trim() || undefined : undefined,
          categoryId: isClient ? undefined : categoryId || undefined,
          language: lang,
        }),
      });
      if (!res.ok) {
        setError(res.status === 409 ? "duplicate" : "generic");
        setBusy(false);
        return;
      }
      showToast(t.signupToast);
      router.push(isClient ? "/client" : "/provider");
    } catch {
      setError("generic");
      setBusy(false);
    }
  };

  const roleCard = (target: SignupRole): React.CSSProperties => {
    const selected = role === target;
    return {
      textAlign: "start",
      background: selected ? (target === "client" ? "#EEF3FB" : "#E8F5F6") : "#fff",
      border: `2px solid ${selected ? (target === "client" ? "#1B3568" : "#0E7A81") : "#E4E9F1"}`,
      borderRadius: 14,
      padding: 16,
      cursor: "pointer",
    };
  };

  return (
    <div
      style={{
        minHeight: "calc(100vh - 220px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 24px",
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid #E4E9F1",
          borderRadius: 22,
          padding: 40,
          width: 560,
          maxWidth: "100%",
          boxShadow: "0 20px 60px rgba(20,40,80,.08)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t.signupTitle}</div>
          <div style={{ fontSize: 14, color: "#7684A0" }}>{t.signupSub}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
          <button onClick={() => setRole("client")} style={roleCard("client")}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1B3568", marginBottom: 3 }}>{t.suClientT}</div>
            <div style={{ fontSize: 12.5, color: "#7684A0" }}>{t.suClientD}</div>
          </button>
          <button onClick={() => setRole("provider")} style={roleCard("provider")}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0E7A81", marginBottom: 3 }}>{t.suProviderT}</div>
            <div style={{ fontSize: 12.5, color: "#7684A0" }}>{t.suProviderD}</div>
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <div style={labelStyle}>{t.sfName}</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="focus:border-[#14969E]!" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>{t.sfPhone}</div>
            <input
              dir="ltr"
              placeholder="+966 5X XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="focus:border-[#14969E]!"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={labelStyle}>{t.sfEmail}</div>
            <input dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="focus:border-[#14969E]!" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>{t.sfPassword}</div>
            <input
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="focus:border-[#14969E]!"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={labelStyle}>{t.sfCompany}</div>
            <input value={company} onChange={(e) => setCompany(e.target.value)} className="focus:border-[#14969E]!" style={inputStyle} />
          </div>
          {isClient ? (
            <div>
              <div style={labelStyle}>{t.sfCity}</div>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="focus:border-[#14969E]!" style={inputStyle} />
            </div>
          ) : (
            <div>
              <div style={labelStyle}>{t.sfCat}</div>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="focus:border-[#14969E]!"
                style={{ ...inputStyle, padding: "11px 10px", color: "#2C3A54" }}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pick(c.nameAr, c.nameEn)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 12.5, color: "#B0433A", marginBottom: 10 }}>
            {error === "duplicate"
              ? isAr
                ? "هذا البريد الإلكتروني مسجّل مسبقًا"
                : "This email is already registered"
              : isAr
                ? "تعذر إنشاء الحساب — تحقق من البيانات وحاول مجددًا"
                : "Could not create the account — check your details and try again"}
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="hover:opacity-[.93]"
          style={{
            width: "100%",
            background: isClient ? "#1B3568" : "#0E7A81",
            color: "#fff",
            border: "none",
            cursor: busy ? "default" : "pointer",
            fontSize: 15,
            fontWeight: 700,
            padding: 13,
            borderRadius: 11,
            marginBottom: 12,
            opacity: busy ? 0.7 : undefined,
          }}
        >
          {busy ? "…" : t.signupBtn}
        </button>
        <div style={{ fontSize: 11.5, color: "#93A1B8", textAlign: "center", marginBottom: 14 }}>{t.termsNote}</div>
        <div style={{ textAlign: "center", fontSize: 13, color: "#7684A0" }}>
          {t.haveAccount}{" "}
          <span onClick={() => router.push("/login")} style={{ color: "#14969E", fontWeight: 700, cursor: "pointer" }}>
            {t.signInLink}
          </span>
        </div>
      </div>
    </div>
  );
}
