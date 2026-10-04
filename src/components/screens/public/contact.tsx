"use client";
// Public Contact page (public-screens spec §6, prototype lines 400–453).
// Contact has no backend in the MVP — submit shows a toast and clears the form.
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

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
  padding: "11px 14px",
  fontSize: 14,
  outline: "none",
  background: "var(--background)",
};

export function ContactScreen() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const send = () => {
    showToast(t.contactSentToast);
    setName("");
    setEmail("");
    setSubject("");
    setMessage("");
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "76px 24px 96px" }}>
      <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
        <h1 style={{ fontSize: 38, fontWeight: 700, margin: "0 0 14px", color: "var(--foreground)" }}>{t.contactTitle}</h1>
        <p style={{ fontSize: 16, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.9 }}>{t.contactLead}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 22, alignItems: "start" }}>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, padding: 32 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <div style={labelStyle}>{t.cfName}</div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="focus:border-[var(--foreground)]!" style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>{t.cfEmail}</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="focus:border-[var(--foreground)]!" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={labelStyle}>{t.cfSubject}</div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="focus:border-[var(--foreground)]!" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 22 }}>
            <div style={labelStyle}>{t.cfMessage}</div>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="focus:border-[var(--foreground)]!"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
          <button
            onClick={send}
            className="hover:bg-[var(--foreground)]!"
            style={{
              background: "var(--foreground)",
              color: "var(--card)",
              border: "none",
              cursor: "pointer",
              fontSize: 14.5,
              fontWeight: 700,
              padding: "13px 28px",
              borderRadius: 11,
            }}
          >
            {t.cfSend}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 4 }}>{t.ciEmail}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }} dir="ltr">
              hello@talaqi.sa
            </div>
          </div>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 4 }}>{t.ciLocation}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t.ciLocationV}</div>
          </div>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 4 }}>{t.ciHours}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t.ciHoursV}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
