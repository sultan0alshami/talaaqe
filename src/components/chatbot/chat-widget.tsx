"use client";
// Floating visitor assistant. A launcher button opens a chat panel that
// talks to /api/assistant (Haiku, server-side, same Anthropic key). Public,
// visitor-facing — mounted on the marketing site.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatWidget() {
  const { t, lang, dir, isAr } = useI18n();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || typing) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
    setTyping(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, messages: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.reply) throw new Error("assistant failed");
      setMessages((m) => [...m, { role: "assistant", content: data.reply as string }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: t.botError }]);
    } finally {
      setTyping(false);
    }
  };

  const END = 24;
  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={t.botOpen}
          title={t.botOpen}
          className="hover:brightness-110"
          style={{
            position: "fixed",
            bottom: END,
            insetInlineEnd: END,
            zIndex: 90,
            width: 60,
            height: 60,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: "linear-gradient(135deg, #1B3568, #14969E)",
            boxShadow: "0 12px 30px rgba(20,150,158,.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChatIcon />
          <span
            style={{
              position: "absolute",
              top: 4,
              insetInlineEnd: 4,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#7FE3E9",
              border: "2px solid #fff",
            }}
          />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          dir={dir}
          style={{
            position: "fixed",
            bottom: END,
            insetInlineEnd: END,
            zIndex: 90,
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            height: 560,
            maxHeight: "calc(100vh - 48px)",
            background: "#fff",
            borderRadius: 20,
            boxShadow: "0 24px 70px rgba(20,40,80,.28)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: "1px solid #E4E9F1",
            animation: "tq-rise .25s ease both",
          }}
        >
          {/* Header */}
          <div
            style={{
              background: "linear-gradient(135deg, #1B3568, #14969E)",
              color: "#fff",
              padding: "16px 18px",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "rgba(255,255,255,.16)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <ChatIcon size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700 }}>{t.botTitle}</div>
              <div style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "#7FE3E9", display: "inline-block" }}
                />
                {t.botSub}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="hover:bg-white/20"
              style={{
                background: "rgba(255,255,255,.12)",
                border: "none",
                cursor: "pointer",
                color: "#fff",
                width: 30,
                height: 30,
                borderRadius: 8,
                fontSize: 18,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "18px 16px",
              background: "#FBFCFE",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Bubble role="assistant" text={t.botGreeting} />
            {messages.length === 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                {t.botStarters.map((s: string) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="hover:bg-[#E8F5F6]"
                    style={{
                      background: "#fff",
                      border: "1.5px solid #C6E7E9",
                      color: "#0E7A81",
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: "8px 14px",
                      borderRadius: 999,
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.content} />
            ))}
            {typing && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E4E9F1",
                    borderRadius: "4px 16px 16px 16px",
                    padding: "12px 16px",
                    display: "flex",
                    gap: 5,
                  }}
                >
                  {[0, 0.2, 0.4].map((d) => (
                    <span
                      key={d}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#14969E",
                        display: "inline-block",
                        animation: `tq-blink 1.2s ${d}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{ borderTop: "1px solid #EEF1F6", padding: 12, display: "flex", gap: 8, background: "#fff" }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send(draft);
              }}
              placeholder={t.botPlaceholder}
              dir={dir}
              style={{
                flex: 1,
                border: "1.5px solid #E4E9F1",
                borderRadius: 10,
                padding: "11px 14px",
                fontSize: 14,
                outline: "none",
                background: "#FBFCFE",
                color: "#2C3A54",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#14969E")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#E4E9F1")}
            />
            <button
              onClick={() => void send(draft)}
              disabled={!draft.trim() || typing}
              className="hover:bg-[#24437F]!"
              style={{
                background: draft.trim() && !typing ? "#1B3568" : "#B7C2D6",
                color: "#fff",
                border: "none",
                cursor: draft.trim() && !typing ? "pointer" : "default",
                fontSize: 13.5,
                fontWeight: 700,
                padding: "0 18px",
                borderRadius: 10,
                flexShrink: 0,
              }}
            >
              {isAr ? "إرسال" : "Send"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "82%",
          padding: "11px 15px",
          fontSize: 14,
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          background: isUser ? "#1B3568" : "#fff",
          color: isUser ? "#fff" : "#2C3A54",
          border: isUser ? "none" : "1px solid #E4E9F1",
          borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
          boxShadow: "0 2px 8px rgba(20,40,80,.05)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ChatIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H10l-4.2 3.4A.6.6 0 0 1 4.8 18l.2-3H6.5"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="1.15" fill="#fff" />
      <circle cx="12.5" cy="9" r="1.15" fill="#fff" />
      <circle cx="16" cy="9" r="1.15" fill="#fff" />
    </svg>
  );
}
