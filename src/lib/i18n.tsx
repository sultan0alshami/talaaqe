"use client";
// Instant AR↔EN switching (README §11): Arabic default + RTL, no reload.
// The server layout reads the `talaqi_lang` cookie for first paint; this
// provider owns it afterwards and flips <html lang/dir> live.
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { I18N } from "./talaqi-data";

export type Lang = "ar" | "en";
export type Dict = typeof I18N.ar;

export const LANG_COOKIE = "talaqi_lang";

type I18nContextValue = {
  lang: Lang;
  isAr: boolean;
  dir: "rtl" | "ltr";
  dirOpp: "rtl" | "ltr";
  arrowChar: "←" | "→";
  t: Dict;
  /** Pick the localized member of a bilingual pair. */
  pick: (ar: string | null | undefined, en: string | null | undefined) => string;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function applyToDocument(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function I18nProvider({
  initialLang,
  children,
}: {
  initialLang: Lang;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    applyToDocument(next);
    // Persist per user when authenticated; fire-and-forget.
    fetch("/api/me/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: next }),
    }).catch(() => {});
  }, []);

  const toggleLang = useCallback(() => setLang(lang === "ar" ? "en" : "ar"), [lang, setLang]);

  const value = useMemo<I18nContextValue>(() => {
    const isAr = lang === "ar";
    return {
      lang,
      isAr,
      dir: isAr ? "rtl" : "ltr",
      dirOpp: isAr ? "ltr" : "rtl",
      arrowChar: isAr ? "←" : "→",
      t: (isAr ? I18N.ar : I18N.en) as Dict,
      pick: (ar, en) => (isAr ? ar ?? en ?? "" : en ?? ar ?? ""),
      setLang,
      toggleLang,
    };
  }, [lang, setLang, toggleLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
