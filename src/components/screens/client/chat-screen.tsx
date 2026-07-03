"use client";
// AI chat assistant screen (client-screens spec §2, behaviors §4).
// Scripted/live modes share the same REST endpoints; messages persist as
// {ar,en} pairs and render the language they were written in.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { GenerationModal } from "@/components/ui/generation-modal";
import type { ChatChip, ChatMessage } from "@/lib/domain";

const LIVE_FALLBACK = {
  ar: "تعذر الاتصال بالذكاء الحي حاليًا — يمكنك متابعة المحادثة التجريبية.",
  en: "Live AI is unavailable right now — you can continue with the demo conversation.",
};

const chipStyle: React.CSSProperties = {
  background: "#fff",
  border: "1.5px solid #C6E7E9",
  color: "#0E7A81",
  cursor: "pointer",
  fontSize: 13.5,
  fontWeight: 600,
  padding: "10px 18px",
  borderRadius: 999,
};

function TypingDots() {
  return (
    <div style={{ display: "flex" }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #E4E9F1",
          borderRadius: 16,
          padding: "14px 20px",
          display: "flex",
          gap: 5,
        }}
      >
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#14969E",
              animation: `tq-blink 1.2s ${delay}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Bubble({ msg, text }: { msg: ChatMessage; text: string }) {
  const ai = msg.role === "assistant";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: ai ? "flex-start" : "flex-end",
        animation: "tq-rise .3s ease both",
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          background: ai ? "#fff" : "#1B3568",
          color: ai ? "#2C3A54" : "#fff",
          border: ai ? "1px solid #E4E9F1" : "none",
          // Physical corner radii preserved as-is (prototype §2.2.2 / shells §5.13).
          borderRadius: ai ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
          padding: "13px 18px",
          fontSize: 14.5,
          lineHeight: 1.8,
          boxShadow: "0 2px 8px rgba(20,40,80,.05)",
          whiteSpace: "pre-wrap",
        }}
      >
        {text}
      </div>
    </div>
  );
}

export function ChatScreen({
  aiEnabled,
  initialProjectId,
  initialMessages,
  initialQuestionsAsked: _initialQuestionsAsked,
  initialReady,
  hasBrief,
}: {
  aiEnabled: boolean;
  initialProjectId: string | null;
  initialMessages: ChatMessage[];
  initialQuestionsAsked: number;
  initialReady: boolean;
  hasBrief: boolean;
}) {
  const { t, isAr, lang } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [ready, setReady] = useState(initialReady);
  const [liveMode, setLiveMode] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [briefDone, setBriefDone] = useState(false);
  const sendingRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom 60ms after each append (behaviors §4.2).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const id = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 60);
    return () => clearTimeout(id);
  }, [messages, typing]);

  const started = !!projectId || messages.some((m) => m.role === "user");
  const showStarters = !started && !liveMode && !typing;
  const last = messages[messages.length - 1];
  const quickChips: ChatChip[] =
    !liveMode && !typing && !ready && last?.role === "assistant" && last.chips ? last.chips : [];
  const showGenerate = ready && !hasBrief && !typing;

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || typing || generating || sendingRef.current) return;
      sendingRef.current = true;
      const isFirst = !projectId;
      const mode = liveMode ? "live" : "scripted";
      setMessages((prev) => [...prev, { role: "user", ar: text, en: text, ts: Date.now() }]);
      setTyping(true);
      // Typing indicator stays ≥1000ms (1100ms for the very first reply);
      // the API call runs concurrently — reveal at max(apiDone, delay).
      const minDelay = new Promise<void>((res) => setTimeout(res, isFirst ? 1100 : 1000));
      try {
        const req = fetch(isFirst ? "/api/projects" : `/api/projects/${projectId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isFirst ? { description: text, mode, lang } : { message: text, mode, lang }
          ),
        });
        const [res] = await Promise.all([req, minDelay]);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "chat failed");
        setTyping(false);
        setMessages(data.messages as ChatMessage[]);
        setReady(!!data.ready);
        if (isFirst && data.projectId) {
          setProjectId(data.projectId as string);
          window.history.replaceState(null, "", `/client/chat?project=${data.projectId}`);
        }
      } catch {
        setTyping(false);
        // The failed message was never persisted: drop the optimistic bubble
        // (the next successful send replaces messages with the server copy,
        // which doesn't contain it), restore it to the draft for retry, and
        // surface the fallback notice as a toast instead of a phantom bubble.
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          return lastMsg?.role === "user" && lastMsg.ar === text ? prev.slice(0, -1) : prev;
        });
        setDraft(text);
        showToast(isAr ? LIVE_FALLBACK.ar : LIVE_FALLBACK.en);
      } finally {
        sendingRef.current = false;
      }
    },
    [typing, generating, projectId, liveMode, lang, isAr, showToast]
  );

  const sendDraft = () => {
    const text = draft;
    setDraft("");
    void send(text);
  };

  const setLive = () => {
    if (!aiEnabled) {
      showToast(t.demoOnly);
      return;
    }
    setLiveMode(true);
  };

  const generate = () => {
    if (!projectId || generating) return;
    setGenerating(true);
    setBriefDone(false);
    fetch(`/api/projects/${projectId}/brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("brief failed");
        setBriefDone(true);
      })
      .catch(() => {
        setGenerating(false);
        showToast(
          isAr
            ? "تعذر توليد الملخص التنفيذي حاليًا — حاول مرة أخرى."
            : "Couldn't generate the brief right now — please try again."
        );
      });
  };

  const msgText = (m: ChatMessage) => (isAr ? m.ar : m.en);

  return (
    <div
      style={{
        maxWidth: 780,
        margin: "0 auto",
        height: "calc(100vh - 130px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header card */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E4E9F1",
          borderRadius: "18px 18px 0 0",
          padding: "16px 22px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 13,
            background: "linear-gradient(135deg, #1B3568, #14969E)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 17,
          }}
        >
          ت
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700 }}>{t.chatTitle}</div>
          <div
            style={{
              fontSize: 12.5,
              color: "#7684A0",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#2FA36B",
                display: "inline-block",
              }}
            />
            {t.chatSub} — {t.chatOnline}
          </div>
        </div>
        <div style={{ display: "flex", background: "#F0F3F8", borderRadius: 999, padding: 3, gap: 2 }}>
          <button
            onClick={() => setLiveMode(false)}
            style={{
              background: !liveMode ? "#fff" : "transparent",
              color: !liveMode ? "#1B3568" : "#7684A0",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 999,
            }}
          >
            {t.chatScripted}
          </button>
          <button
            onClick={setLive}
            style={{
              background: liveMode ? "#fff" : "transparent",
              color: liveMode ? "#0E7A81" : "#7684A0",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 999,
            }}
          >
            ⚡ {t.chatLive}
          </button>
        </div>
      </div>

      {/* Chat canvas */}
      <div
        ref={boxRef}
        style={{
          flex: 1,
          background: "#FBFCFE",
          borderInline: "1px solid #E4E9F1",
          padding: "24px 22px",
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {liveMode && (
          <div
            style={{
              alignSelf: "center",
              background: "#E8F5F6",
              color: "#0E7A81",
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 16px",
              borderRadius: 999,
            }}
          >
            ⚡ {t.liveNote}
          </div>
        )}

        {/* Fresh chat opens with the hello message rendered locally (the
            server persists its own copy on project creation). */}
        {messages.length === 0 && (
          <Bubble msg={{ role: "assistant", ar: "", en: "", ts: 0 }} text={t.chatHello} />
        )}

        {messages.map((m, i) => (
          <Bubble key={m.ts + ":" + i} msg={m} text={msgText(m)} />
        ))}

        {typing && <TypingDots />}

        {showStarters && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {[t.chatStarter1, t.chatStarter2, t.chatStarter3].map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="hover:bg-[#E8F5F6] hover:border-[#14969E]"
                style={{ ...chipStyle, alignSelf: "flex-start" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {quickChips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {quickChips.map((c, i) => (
              <button
                key={i}
                onClick={() => void send(isAr ? c.ar : c.en)}
                className="hover:bg-[#E8F5F6] hover:border-[#14969E]"
                style={chipStyle}
              >
                {isAr ? c.ar : c.en}
              </button>
            ))}
          </div>
        )}

        {showGenerate && (
          <div style={{ alignSelf: "center", marginTop: 8 }}>
            <button
              onClick={generate}
              disabled={generating}
              className="hover:-translate-y-px"
              style={{
                background: "linear-gradient(120deg, #1B3568, #14969E)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 700,
                padding: "14px 32px",
                borderRadius: 12,
                boxShadow: "0 10px 26px rgba(20,150,158,.3)",
              }}
            >
              ✦ {t.generateBrief}
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E4E9F1",
          borderTop: "none",
          borderRadius: "0 0 18px 18px",
          padding: "14px 16px",
          display: "flex",
          gap: 10,
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendDraft();
          }}
          placeholder={t.chatPlaceholder}
          className="focus:border-[#14969E]!"
          style={{
            flex: 1,
            border: "1.5px solid #E4E9F1",
            borderRadius: 11,
            padding: "12px 16px",
            fontSize: 14.5,
            outline: "none",
            background: "#FBFCFE",
          }}
        />
        <button
          onClick={sendDraft}
          disabled={typing}
          className="hover:bg-[#24437F]"
          style={{
            background: "#1B3568",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 700,
            padding: "12px 24px",
            borderRadius: 11,
          }}
        >
          {t.chatSend}
        </button>
      </div>

      <GenerationModal
        active={generating}
        apiDone={briefDone}
        onDone={() => router.push(`/client/brief?project=${projectId}`)}
      />
    </div>
  );
}
