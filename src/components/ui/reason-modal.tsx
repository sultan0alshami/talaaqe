"use client";
// Reusable "give a reason" modal — used when a provider declines an
// opportunity or a proposal request (a reason is required).
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

export function ReasonModal({
  open,
  title,
  sub,
  placeholder,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  sub?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const { dir } = useI18n();
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      const id = setTimeout(() => ref.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;
  const valid = reason.trim().length >= 3;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        background: "rgba(15,25,45,.55)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        dir={dir}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 20,
          padding: "28px 30px",
          width: 460,
          maxWidth: "100%",
          boxShadow: "0 30px 80px rgba(0,0,0,.3)",
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "#14213A", margin: "0 0 6px" }}>{title}</h3>
        {sub && <p style={{ fontSize: 13.5, color: "#7684A0", margin: "0 0 16px" }}>{sub}</p>}
        <textarea
          ref={ref}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
          rows={4}
          maxLength={500}
          style={{
            width: "100%",
            border: "1.5px solid #E4E9F1",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            outline: "none",
            background: "#FBFCFE",
            resize: "vertical",
            color: "#2C3A54",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#14969E")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#E4E9F1")}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            className="hover:bg-[#E4E9F1]"
            style={{
              background: "#F0F3F8",
              color: "#4A5A76",
              border: "none",
              cursor: busy ? "default" : "pointer",
              fontSize: 13.5,
              fontWeight: 600,
              padding: "11px 20px",
              borderRadius: 10,
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => valid && onConfirm(reason.trim())}
            disabled={!valid || busy}
            className="hover:bg-[#9A3A32]"
            style={{
              background: valid && !busy ? "#B0433A" : "#E4B7B2",
              color: "#fff",
              border: "none",
              cursor: valid && !busy ? "pointer" : "default",
              fontSize: 13.5,
              fontWeight: 700,
              padding: "11px 22px",
              borderRadius: 10,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
