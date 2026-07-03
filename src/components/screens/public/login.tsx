"use client";
// Public Login page (public-screens spec §7, prototype lines 455–493).
// Real auth via POST /api/auth/login; demo quick-access uses the seeded accounts.
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

const DEST: Record<string, string> = { CLIENT: "/client", PROVIDER: "/provider", ADMIN: "/admin" };

const DEMO_ACCOUNTS = {
  client: "ahmed@oudalkhaleej.sa",
  provider: "abdullah.dev@gmail.com",
  admin: "ops@talaqi.sa",
} as const;

type DemoRole = keyof typeof DEMO_ACCOUNTS;

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
  padding: "12px 14px",
  fontSize: 14,
  outline: "none",
  background: "#FBFCFE",
};

export function LoginScreen({ next }: { next?: string }) {
  const { t, isAr } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<DemoRole | null>(null);

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password: loginPassword }),
    });
    if (!res.ok) throw new Error("login failed");
    const data = await res.json();
    const dest = DEST[data.user?.role as string] ?? "/client";
    // Same-origin only: "//evil.com" and "/\evil.com" pass startsWith("/")
    // but resolve off-site (open redirect).
    const safeNext =
      next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : null;
    router.push(safeNext ?? dest);
  };

  const submit = async () => {
    if (busy || demoBusy) return;
    setError(false);
    setBusy(true);
    try {
      await doLogin(email.trim(), password);
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  const demoLogin = async (role: DemoRole) => {
    if (busy || demoBusy) return;
    setError(false);
    setDemoBusy(role);
    try {
      await doLogin(DEMO_ACCOUNTS[role], "talaqi123");
    } catch {
      setError(true);
      setDemoBusy(null);
    }
  };

  const anyBusy = busy || demoBusy !== null;

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
          width: 430,
          maxWidth: "100%",
          boxShadow: "0 20px 60px rgba(20,40,80,.08)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <Image src="/assets/logo-mark.png" alt="Talaqi" width={52} height={51} style={{ objectFit: "contain", marginBottom: 12, display: "inline-block" }} />
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t.loginTitle}</div>
          <div style={{ fontSize: 14, color: "#7684A0" }}>{t.loginSub}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>{t.lfEmail}</div>
          <input
            dir="ltr"
            placeholder="you@company.sa"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="focus:border-[#14969E]!"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={labelStyle}>{t.lfPassword}</div>
          <input
            type="password"
            dir="ltr"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="focus:border-[#14969E]!"
            style={inputStyle}
          />
        </div>
        {error && (
          <div style={{ fontSize: 12.5, color: "#B0433A", marginBottom: 8 }}>
            {isAr ? "بيانات الدخول غير صحيحة" : "Invalid credentials"}
          </div>
        )}
        <div style={{ textAlign: "end", marginBottom: 18 }}>
          <span style={{ fontSize: 12.5, color: "#14969E", cursor: "pointer", fontWeight: 600 }}>{t.forgotPass}</span>
        </div>
        <button
          onClick={submit}
          disabled={anyBusy}
          className="hover:bg-[#24437F]!"
          style={{
            width: "100%",
            background: "#1B3568",
            color: "#fff",
            border: "none",
            cursor: anyBusy ? "default" : "pointer",
            fontSize: 15,
            fontWeight: 700,
            padding: 13,
            borderRadius: 11,
            marginBottom: 20,
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "…" : t.loginBtn}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, height: 1, background: "#EEF1F6" }} />
          <span style={{ fontSize: 12, color: "#93A1B8", whiteSpace: "nowrap" }}>{t.loginDemo}</span>
          <div style={{ flex: 1, height: 1, background: "#EEF1F6" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
          <button
            onClick={() => demoLogin("client")}
            disabled={anyBusy}
            className="hover:bg-[#E4E9F1]!"
            style={{
              background: "#F0F3F8",
              color: "#1B3568",
              border: "none",
              cursor: anyBusy ? "default" : "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "10px 6px",
              borderRadius: 9,
              opacity: demoBusy === "client" ? 0.6 : 1,
            }}
          >
            {demoBusy === "client" ? "…" : t.demoClient}
          </button>
          <button
            onClick={() => demoLogin("provider")}
            disabled={anyBusy}
            className="hover:bg-[#D5EEEF]!"
            style={{
              background: "#E8F5F6",
              color: "#0E7A81",
              border: "none",
              cursor: anyBusy ? "default" : "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "10px 6px",
              borderRadius: 9,
              opacity: demoBusy === "provider" ? 0.6 : 1,
            }}
          >
            {demoBusy === "provider" ? "…" : t.demoProvider}
          </button>
          <button
            onClick={() => demoLogin("admin")}
            disabled={anyBusy}
            className="hover:bg-[#F0E5CC]!"
            style={{
              background: "#F7F0E3",
              color: "#8A6D33",
              border: "none",
              cursor: anyBusy ? "default" : "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "10px 6px",
              borderRadius: 9,
              opacity: demoBusy === "admin" ? 0.6 : 1,
            }}
          >
            {demoBusy === "admin" ? "…" : t.demoAdmin}
          </button>
        </div>

        <div style={{ textAlign: "center", fontSize: 13, color: "#7684A0" }}>
          {t.noAccount}{" "}
          <span
            onClick={() => router.push("/signup?role=client")}
            style={{ color: "#14969E", fontWeight: 700, cursor: "pointer" }}
          >
            {t.createOne}
          </span>
        </div>
      </div>
    </div>
  );
}
