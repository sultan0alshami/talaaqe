"use client";
// Brief-generation modal (shells spec §4): spinner + 4 progressive steps,
// 850ms per tick (~4.25s total). `onDone` fires once the step sequence has
// finished AND `apiDone` is true — so the real brief API call gates exit.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

export function GenerationModal({
  active,
  apiDone = true,
  onDone,
}: {
  active: boolean;
  /** Set true when the brief API call has resolved. */
  apiDone?: boolean;
  onDone?: () => void;
}) {
  const { t, dir } = useI18n();
  const [genStep, setGenStep] = useState(0);
  const [stepsComplete, setStepsComplete] = useState(false);
  const doneFired = useRef(false);

  useEffect(() => {
    if (!active) {
      setGenStep(0);
      setStepsComplete(false);
      doneFired.current = false;
      return;
    }
    let i = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (i <= 4) {
        setGenStep(i);
        i += 1;
        timer = setTimeout(tick, 850);
      } else {
        setStepsComplete(true);
      }
    };
    timer = setTimeout(tick, 850);
    return () => clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (active && stepsComplete && apiDone && !doneFired.current) {
      doneFired.current = true;
      onDone?.();
    }
  }, [active, stepsComplete, apiDone, onDone]);

  if (!active) return null;
  const steps = [t.genStep1, t.genStep2, t.genStep3, t.genStep4];
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(15,25,45,.55)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        dir={dir}
        style={{
          background: "#fff",
          borderRadius: 22,
          padding: "40px 48px",
          width: 440,
          maxWidth: "90vw",
          boxShadow: "0 30px 80px rgba(0,0,0,.3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 26 }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: "3px solid #E4E9F1",
              borderTopColor: "#14969E",
              borderRadius: "50%",
              animation: "tq-spin 1s linear infinite",
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: 17, fontWeight: 700, color: "#14213A" }}>{t.generating}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((label, i) => {
            const done = genStep > i;
            const isActive = genStep === i;
            return (
              <div
                key={i}
                style={{ display: "flex", gap: 12, alignItems: "center", opacity: done || isActive ? 1 : 0.45 }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    fontSize: 12,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background: done ? "#E9F6EF" : isActive ? "#E8F5F6" : "#F0F3F8",
                    color: done ? "#1F7A4D" : isActive ? "#0E7A81" : "#93A1B8",
                  }}
                >
                  {done ? "✓" : i + 1}
                </div>
                <div style={{ fontSize: 14, color: "#2C3A54", fontWeight: 500 }}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
