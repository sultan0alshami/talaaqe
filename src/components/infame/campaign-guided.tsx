"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignDTO } from "@/lib/campaigns/service";
import styles from "./campaign-guided.module.css";

export function CampaignGuided({ conversation, clarificationCount, mode, text, language, disabled, hasCampaign, onModeChange, onTextChange, onLanguageChange, onRequest, onForm }: {
  conversation: CampaignDTO["conversation"];
  clarificationCount: number;
  mode: "chat" | "paragraph";
  text: string;
  language: string;
  disabled: boolean;
  hasCampaign: boolean;
  onModeChange: (mode: "chat" | "paragraph") => void;
  onTextChange: (text: string) => void;
  onLanguageChange: (language: string) => void;
  onRequest: () => void;
  onForm: () => void;
}) {
  const { isAr } = useI18n();
  const textId = useId(), languageId = useId();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  return <section className={styles.chat} aria-label={copy("اشرح الفكرة بطريقتك", "Explain the idea in your own words")}>
    <header className={styles.header}>
      <div className={styles.avatar} aria-hidden="true">إ</div>
      <div className={styles.identity}>
        <h2>{copy("اشرح الفكرة بطريقتك", "Explain the idea in your own words")}</h2>
        <p>{copy("المحادثة والفقرة تقترحان نفس حقول النموذج. لا يُطبّق اقتراح أو يُعتمد موجز بدون مراجعتك.", "Chat and paragraph input propose the same form fields. A proposal or brief needs your explicit review before it is applied or approved.")}</p>
      </div>
      <div className={styles.modes} aria-label={copy("طريقة الشرح", "Explanation method")}>
        <Button variant={mode === "chat" ? "secondary" : "ghost"} aria-pressed={mode === "chat"} onClick={() => onModeChange("chat")}>{copy("محادثة", "Conversation")}</Button>
        <Button variant={mode === "paragraph" ? "secondary" : "ghost"} aria-pressed={mode === "paragraph"} onClick={() => onModeChange("paragraph")}>{copy("فقرة كاملة", "Full paragraph")}</Button>
      </div>
    </header>
    <div className={styles.canvas} role="region" aria-label={copy("المحادثة المحفوظة", "Saved conversation")} tabIndex={conversation.length ? 0 : undefined}>
      <p className={styles.unavailable}>{copy("المساعد غير مهيأ حاليًا. النموذج متاح بالكامل؛ طلب المساعد يعرض حالة الخدمة الفعلية.", "The assistant is not configured currently. The complete form is available; assistant requests show the actual service status.")}</p>
      {conversation.length ? <ol aria-label={copy("المحادثة المحفوظة", "Saved conversation")} className={styles.messages}>
        {conversation.map((turn, index) => <li key={index} className={`${styles.message} ${turn.role === "user" ? styles.user : styles.assistant}`}>
          <p className={styles.role}>{turn.role === "user" ? copy("أنت", "You") : copy("المساعد", "Assistant")}</p>
          <p dir="auto" lang={turn.language ?? undefined} className={styles.bubble}>{turn.text}</p>
        </li>)}
      </ol> : <p className={styles.empty}>{copy("ما فيه رسائل محفوظة بعد.", "No saved messages yet.")}</p>}
      <p className={styles.questions}>{copy("أسئلة توضيحية محفوظة", "Saved clarification questions")}: {clarificationCount} / 5</p>
    </div>
    <div className={styles.composer}>
      <div className={styles.field}>
        <label htmlFor={textId}>{mode === "chat" ? copy("رسالتك", "Your message") : copy("وصف الحملة", "Campaign description")}</label>
        <Textarea id={textId} dir="auto" rows={6} maxLength={20000} className={styles.input} value={text} onChange={event => onTextChange(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={languageId}>{copy("لغة النص الأصلية (اختياري، رمز BCP47)", "Original text language (optional, BCP47 code)")}</label>
        <Input id={languageId} className={styles.input} dir="ltr" value={language} maxLength={100} onChange={event => onLanguageChange(event.target.value)} placeholder="ar / en" />
      </div>
      <div className={styles.actions}>
        <Button size="lg" disabled={disabled || !text.trim()} onClick={onRequest}>{copy("اطلب اقتراحًا للمراجعة", "Request a proposal to review")}</Button>
        <Button size="lg" variant="outline" onClick={onForm}>{copy("افتح نفس الحقول بالنموذج", "Open the same fields in the form")}</Button>
      </div>
      {!hasCampaign && <p className={styles.note}>{copy("طلب الاقتراح ينشئ مسودة خاصة للحملة. النص غير المعالج يبقى في هذا المحرر حتى تغادر الصفحة.", "Requesting a proposal creates a private campaign draft. Unprocessed text stays in this editor until you leave the page.")}</p>}
    </div>
  </section>;
}
