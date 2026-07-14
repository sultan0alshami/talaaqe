"use client";
// Toast: dark navy pill, bottom-center, auto-dismisses after 2.6s; a new
// toast resets the timer (prototype behavior, behaviors.md §3).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

type ToastContextValue = { showToast: (msg: string) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isAr } = useI18n();

  const showToast = useCallback((msg: string) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            insetInlineStart: "50%",
            transform: `translateX(${isAr ? "50%" : "-50%"})`,
            background: "#14213A",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            padding: "13px 26px",
            borderRadius: 12,
            boxShadow: "0 14px 40px rgba(0,0,0,.3)",
            zIndex: 120,
            animation: "tq-rise .3s ease both",
          }}
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
