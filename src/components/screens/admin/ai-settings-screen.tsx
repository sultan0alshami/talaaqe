"use client";
// Admin → Settings: AI provider control. The admin switches the active
// provider (Claude, Gemini, OpenAI, DeepSeek, NVIDIA NIM, Grok, Groq,
// Mistral, OpenRouter…), saves API keys (stored encrypted server-side) and
// overrides the chat/brief models. Data comes from the server page
// (getAdminAiStatus); mutations PUT /api/admin/ai then router.refresh().
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import type { AdminAiProviderStatus, AdminAiStatus, AiProviderId } from "@/lib/ai-providers";

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #E4E9F1",
  borderRadius: 18,
  padding: 24,
  marginBottom: 18,
};
const inputStyle: React.CSSProperties = {
  border: "1px solid #E4E9F1",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 600,
  color: "#2C3A54",
  background: "#fff",
  outline: "none",
};
const chip = (bg: string, color: string): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 700,
  background: bg,
  color,
  borderRadius: 999,
  padding: "3px 10px",
  whiteSpace: "nowrap",
});
const smallBtn = (bg: string, color: string): React.CSSProperties => ({
  background: bg,
  color,
  border: "none",
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 700,
  padding: "8px 16px",
  borderRadius: 10,
});

type TestResult = { ok: boolean; msg: string };

export function AiSettingsScreen({ data }: { data: AdminAiStatus }) {
  const { isAr, pick } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();

  const [openId, setOpenId] = useState<AiProviderId | null>(null);
  const [form, setForm] = useState({ key: "", chat: "", brief: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Partial<Record<AiProviderId, TestResult>>>({});

  const activeDef = data.active ? data.providers.find((p) => p.id === data.active!.id) : null;

  const put = async (body: Record<string, unknown>, busyKey: string) => {
    setBusy(busyKey);
    try {
      const res = await fetch("/api/admin/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        showToast(err?.error ?? (isAr ? "فشل الحفظ" : "Save failed"));
        return false;
      }
      showToast(isAr ? "تم الحفظ" : "Saved");
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const selectMode = (mode: "auto" | AiProviderId) => put({ mode }, `select:${mode}`);

  const toggleOpen = (p: AdminAiProviderStatus) => {
    if (openId === p.id) {
      setOpenId(null);
      return;
    }
    setOpenId(p.id);
    setForm({ key: "", chat: p.chatModel ?? "", brief: p.briefModel ?? "" });
  };

  const saveConfig = async (p: AdminAiProviderStatus) => {
    const done = await put(
      {
        provider: p.id,
        chatModel: form.chat.trim() || null,
        briefModel: form.brief.trim() || null,
        ...(form.key.trim() ? { apiKey: form.key.trim() } : {}),
      },
      `save:${p.id}`
    );
    if (done) setForm((f) => ({ ...f, key: "" }));
  };

  const removeKey = (p: AdminAiProviderStatus) => put({ provider: p.id, apiKey: null }, `save:${p.id}`);

  const testProvider = async (p: AdminAiProviderStatus) => {
    setBusy(`test:${p.id}`);
    setTests((t) => ({ ...t, [p.id]: undefined }));
    try {
      const res = await fetch("/api/admin/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p.id }),
      });
      const out = (await res.json().catch(() => null)) as
        | { ok: boolean; model?: string; latencyMs?: number; error?: string }
        | null;
      setTests((t) => ({
        ...t,
        [p.id]: out?.ok
          ? { ok: true, msg: `${out.model} — ${out.latencyMs}ms` }
          : { ok: false, msg: out?.error ?? "error" },
      }));
    } finally {
      setBusy(null);
    }
  };

  const radio = (checked: boolean) => (
    <span
      aria-hidden
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: checked ? "5px solid #0E7A81" : "2px solid #C4CEDC",
        background: "#fff",
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );

  const rowBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 2px",
    borderTop: "1px solid #EEF1F6",
  };

  return (
    <div style={card}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
        {isAr ? "مزوّد الذكاء الاصطناعي" : "AI Provider"}
      </h3>
      <p style={{ fontSize: 13, color: "#7684A0", margin: "0 0 14px" }}>
        {isAr
          ? "اختر المزوّد الذي يشغّل المحادثة وتوليد الموجز وترشيح المزوّدين. المفاتيح تُحفظ مشفّرة في قاعدة البيانات، ومفاتيح ملف البيئة تبقى خيارًا احتياطيًا."
          : "Choose which provider powers the chat, brief generation and provider matching. Keys are stored encrypted in the database; environment keys remain as a fallback."}
      </p>

      {/* Current status */}
      <div
        style={{
          background: data.active ? "#E8F5F6" : "#FDF4E3",
          color: data.active ? "#0E7A81" : "#A96A12",
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {data.active && activeDef ? (
          <>
            {isAr ? "يعمل الآن: " : "Active now: "}
            {pick(activeDef.nameAr, activeDef.nameEn)}
            <span dir="ltr" style={{ fontWeight: 700 }}>
              {" "}
              — {data.active.chatModel}
              {data.active.briefModel !== data.active.chatModel ? ` / ${data.active.briefModel}` : ""}
            </span>
            {data.active.keySource === "env" && (
              <span style={{ opacity: 0.75 }}> {isAr ? "(مفتاح البيئة)" : "(env key)"}</span>
            )}
          </>
        ) : isAr ? (
          "لا يوجد مزوّد مهيأ — المنصة تعمل بالوضع التجريبي المكتوب."
        ) : (
          "No provider configured — the platform runs in scripted demo mode."
        )}
      </div>

      {/* Auto mode */}
      <div style={{ ...rowBase, borderTop: "none", cursor: "pointer" }} onClick={() => selectMode("auto")}>
        {radio(data.mode === "auto")}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#2C3A54" }}>
            {isAr ? "تلقائي" : "Automatic"}
          </div>
          <div style={{ fontSize: 12, color: "#93A1B8" }}>
            {isAr ? "أول مزوّد يتوفر له مفتاح حسب ترتيب القائمة" : "First provider with a key, in list order"}
          </div>
        </div>
      </div>

      {/* Provider rows */}
      {data.providers.map((p) => {
        const isActive = data.active?.id === p.id;
        const selected = data.mode === p.id;
        const open = openId === p.id;
        const test = tests[p.id];
        return (
          <div key={p.id}>
            <div style={rowBase}>
              <span style={{ cursor: "pointer", display: "inline-flex" }} onClick={() => selectMode(p.id)}>
                {radio(selected)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "#2C3A54",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {pick(p.nameAr, p.nameEn)}
                  {isActive && <span style={chip("#E8F5F6", "#0E7A81")}>{isAr ? "النشط" : "active"}</span>}
                  {p.envKey && <span style={chip("#EEF3FB", "#1B3568")}>{isAr ? "مفتاح بيئة" : "env key"}</span>}
                  {p.savedKey && (
                    <span dir="ltr" style={chip("#EEF3FB", "#1B3568")}>
                      {p.savedKey}
                    </span>
                  )}
                  {!p.configured && (
                    <span style={chip("#F0F3F8", "#93A1B8")}>{isAr ? "غير مهيأ" : "not configured"}</span>
                  )}
                </div>
                <div dir="ltr" style={{ fontSize: 12, color: "#93A1B8", textAlign: "start" }}>
                  {p.chatModel ?? p.defaultChatModel}
                  {(p.briefModel ?? p.defaultBriefModel) !== (p.chatModel ?? p.defaultChatModel) &&
                    ` / ${p.briefModel ?? p.defaultBriefModel}`}
                </div>
              </div>
              <button
                onClick={() => toggleOpen(p)}
                className="hover:bg-[#E4E9F1]"
                style={smallBtn("#F0F3F8", "#1B3568")}
              >
                {open ? (isAr ? "إغلاق" : "Close") : isAr ? "تهيئة" : "Configure"}
              </button>
            </div>

            {selected && !p.configured && (
              <div
                style={{
                  background: "#FDF4E3",
                  color: "#A96A12",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  margin: "0 0 10px",
                }}
              >
                {isAr
                  ? "هذا المزوّد بلا مفتاح — الذكاء الاصطناعي متوقف حاليًا ويعمل الوضع التجريبي."
                  : "This provider has no key — AI is currently off and scripted mode is used."}
              </div>
            )}

            {open && (
              <div
                style={{
                  background: "#FBFCFE",
                  border: "1px solid #E4E9F1",
                  borderRadius: 12,
                  padding: 14,
                  margin: "2px 0 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    dir="ltr"
                    type="password"
                    autoComplete="off"
                    value={form.key}
                    onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                    placeholder={
                      p.savedKey
                        ? `${p.savedKey} — ${isAr ? "أدخل مفتاحًا جديدًا للاستبدال" : "enter a new key to replace"}`
                        : isAr
                          ? "أدخل مفتاح API"
                          : "Enter API key"
                    }
                    style={{ ...inputStyle, flex: 1, minWidth: 220 }}
                  />
                  {p.savedKey && (
                    <button
                      onClick={() => removeKey(p)}
                      disabled={busy === `save:${p.id}`}
                      className="hover:bg-[#F6DEDA]"
                      style={smallBtn("#FBEDEB", "#B0433A")}
                    >
                      {isAr ? "حذف المفتاح" : "Remove key"}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ flex: 1, minWidth: 200, fontSize: 12, color: "#7684A0", fontWeight: 600 }}>
                    {isAr ? "نموذج المحادثة" : "Chat model"}
                    <input
                      dir="ltr"
                      value={form.chat}
                      onChange={(e) => setForm((f) => ({ ...f, chat: e.target.value }))}
                      placeholder={p.defaultChatModel}
                      style={{ ...inputStyle, width: "100%", marginTop: 4 }}
                    />
                  </label>
                  <label style={{ flex: 1, minWidth: 200, fontSize: 12, color: "#7684A0", fontWeight: 600 }}>
                    {isAr ? "نموذج الموجز" : "Brief model"}
                    <input
                      dir="ltr"
                      value={form.brief}
                      onChange={(e) => setForm((f) => ({ ...f, brief: e.target.value }))}
                      placeholder={p.defaultBriefModel}
                      style={{ ...inputStyle, width: "100%", marginTop: 4 }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    onClick={() => saveConfig(p)}
                    disabled={busy === `save:${p.id}`}
                    className="hover:bg-[#24437F]"
                    style={{ ...smallBtn("#1B3568", "#fff"), opacity: busy === `save:${p.id}` ? 0.6 : 1 }}
                  >
                    {isAr ? "حفظ" : "Save"}
                  </button>
                  <button
                    onClick={() => testProvider(p)}
                    disabled={busy === `test:${p.id}` || !p.configured}
                    className="hover:bg-[#14969E]"
                    style={{
                      ...smallBtn("#0E7A81", "#fff"),
                      opacity: busy === `test:${p.id}` || !p.configured ? 0.6 : 1,
                    }}
                  >
                    {busy === `test:${p.id}`
                      ? isAr
                        ? "جارٍ الاختبار…"
                        : "Testing…"
                      : isAr
                        ? "اختبار الاتصال"
                        : "Test connection"}
                  </button>
                  <a
                    href={p.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12.5, fontWeight: 700, color: "#0E7A81", textDecoration: "none" }}
                  >
                    {isAr ? "الحصول على مفتاح ↗" : "Get a key ↗"}
                  </a>
                  {test && (
                    <span
                      dir="ltr"
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: test.ok ? "#0E7A81" : "#B0433A",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {test.ok ? `✓ ${test.msg}` : `✕ ${test.msg}`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
