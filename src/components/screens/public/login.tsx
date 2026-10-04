"use client";
// Public Login page (public-screens spec §7, prototype lines 455–493).
// Real auth via POST /api/auth/login.
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

const DEST: Record<string, string> = { BRAND: "/client", CREATOR: "/provider", ADMIN: "/admin" };

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--muted-foreground)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1.5px solid var(--border)",
  borderRadius: 10,
  padding: "12px 14px",
  fontSize: 14,
  outline: "none",
  background: "var(--background)",
};

export function LoginScreen({ next }: { next?: string }) {
  const { t, isAr } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (busy) return;
    setError(false);
    setBusy(true);
    try {
      await doLogin(email.trim(), password);
    } catch {
      setError(true);
      setBusy(false);
    }
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
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 22,
          padding: 40,
          width: 430,
          maxWidth: "100%",
          boxShadow: "0 20px 60px rgba(20,40,80,.08)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <Image src="/assets/logo-mark.png" alt="Talaqi" width={52} height={51} priority style={{ width: 52, height: 51, objectFit: "contain", marginBottom: 12, display: "inline-block" }} />
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t.loginTitle}</div>
          <div style={{ fontSize: 14, color: "var(--muted-foreground)" }}>{t.loginSub}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>{t.lfEmail}</div>
          <input
            dir="ltr"
            placeholder="you@company.sa"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="focus:border-[var(--foreground)]!"
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
            className="focus:border-[var(--foreground)]!"
            style={inputStyle}
          />
        </div>
        {error && (
          <div style={{ fontSize: 12.5, color: "#B0433A", marginBottom: 8 }}>
            {isAr ? "بيانات الدخول مو صحيحة" : "Invalid credentials"}
          </div>
        )}
        <div style={{ textAlign: "end", marginBottom: 18 }}>
          <span style={{ fontSize: 12.5, color: "var(--foreground)", cursor: "pointer", fontWeight: 600 }}>{t.forgotPass}</span>
        </div>
        <button
          onClick={submit}
          disabled={busy}
          className="hover:bg-[var(--foreground)]!"
          style={{
            width: "100%",
            background: "var(--foreground)",
            color: "var(--card)",
            border: "none",
            cursor: busy ? "default" : "pointer",
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

        <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>
          {t.noAccount}{" "}
          <span
            onClick={() => router.push("/signup?role=client")}
            style={{ color: "var(--foreground)", fontWeight: 700, cursor: "pointer" }}
          >
            {t.createOne}
          </span>
        </div>
      </div>
    </div>
  );
}
