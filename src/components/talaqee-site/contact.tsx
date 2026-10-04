"use client";
// Public Contact page (public-screens spec §6, prototype lines 400–453).
// Retain the original form geometry. Unavailable delivery never claims success.
import { useState } from "react";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--classic-body)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1.5px solid var(--classic-field-border)",
  borderRadius: 10,
  padding: "11px 14px",
  fontSize: 14,
  outline: "none",
  background: "var(--classic-page)",
};

export function ContactScreen() {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const send = () => {
    setUnavailable(true);
  };

  return (
    <div className={styles.information} style={{ maxWidth: 1080, margin: "0 auto", padding: "76px 24px 96px" }}>
      <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 44px" }}>
        <h1 style={{ fontSize: 38, fontWeight: 700, margin: "0 0 14px", color: "var(--classic-deep)" }}>{t.contactTitle}</h1>
        <p style={{ fontSize: 16, color: "var(--classic-body)", margin: 0, lineHeight: 1.9 }}>{t.contactLead}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 22, alignItems: "start" }}>
        <form onSubmit={(event) => { event.preventDefault(); send(); }} style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 20, padding: 32 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label htmlFor="classic-contact-name" style={{ ...labelStyle, display: "block" }}>{t.cfName}</label>
              <input id="classic-contact-name" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className="focus:border-[var(--classic-accent-ink)]!" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="classic-contact-email" style={{ ...labelStyle, display: "block" }}>{t.cfEmail}</label>
              <input id="classic-contact-email" type="email" dir="ltr" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="focus:border-[var(--classic-accent-ink)]!" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="classic-contact-subject" style={{ ...labelStyle, display: "block" }}>{t.cfSubject}</label>
            <input id="classic-contact-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className="focus:border-[var(--classic-accent-ink)]!" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label htmlFor="classic-contact-message" style={{ ...labelStyle, display: "block" }}>{t.cfMessage}</label>
            <textarea
              rows={5}
              id="classic-contact-message" maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="focus:border-[var(--classic-accent-ink)]!"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
          <button
            type="submit"
            className="hover:opacity-90"
            style={{
              background: "var(--classic-ink)",
              color: "var(--classic-inverse)",
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
          {unavailable && <p role="status" className={styles.contactStatus}>{t.contactUnavailable}</p>}
        </form>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 12.5, color: "var(--classic-muted)", marginBottom: 4 }}>{t.ciEmail}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--classic-ink)" }}>
              {t.ciEmailValue}
            </div>
          </div>
          <div style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 12.5, color: "var(--classic-muted)", marginBottom: 4 }}>{t.ciLocation}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t.ciLocationV}</div>
          </div>
          <div style={{ background: "var(--classic-card)", border: "1px solid var(--classic-border)", borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 12.5, color: "var(--classic-muted)", marginBottom: 4 }}>{t.ciHours}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t.ciHoursV}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
