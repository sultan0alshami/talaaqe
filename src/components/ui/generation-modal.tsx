"use client";
// Brief-generation modal (shells spec §4). Three phases:
//   1) running    — spinner + 4 progressive steps (850ms each, ~4.25s).
//   2) finalizing — steps done but the (slow, live-AI) API call is still
//                   running; a hint keeps the user informed instead of a
//                   silent spinner.
//   3) done       — steps done AND apiDone: success checkmark + a short
//                   countdown before redirecting to the brief page (with a
//                   "view now" button to skip the wait).
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

const COUNTDOWN_FROM = 3;

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
  const { t, dir, isAr } = useI18n();
  const [genStep, setGenStep] = useState(0);
  const [stepsComplete, setStepsComplete] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  const doneFired = useRef(false);
  // Keep onDone in a ref so the countdown timer isn't reset when the parent
  // passes a fresh inline callback on re-render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finished = active && stepsComplete && apiDone;

  // Step animation.
  useEffect(() => {
    if (!active) {
      setGenStep(0);
      setStepsComplete(false);
      setCountdown(COUNTDOWN_FROM);
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

  // Countdown → redirect once everything is finished.
  useEffect(() => {
    if (!finished) {
      setCountdown(COUNTDOWN_FROM);
      return;
    }
    if (countdown <= 0) {
      if (!doneFired.current) {
        doneFired.current = true;
        onDoneRef.current?.();
      }
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [finished, countdown]);

  const skip = () => {
    if (!doneFired.current) {
      doneFired.current = true;
      onDoneRef.current?.();
    }
  };

  if (!active) return null;
  const steps = [t.genStep1, t.genStep2, t.genStep3, t.genStep4];
  const finalizing = stepsComplete && !apiDone;

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
        padding: 20,
      }}
    >
      <div
        dir={dir}
        style={{
          background: "#fff",
          borderRadius: 22,
          padding: "36px 44px",
          width: 460,
          maxWidth: "100%",
          boxShadow: "0 30px 80px rgba(0,0,0,.3)",
        }}
      >
        {/* Header: spinner while working, green check when done */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
          {finished ? (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#E9F6EF",
                color: "#1F7A4D",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 700,
                flexShrink: 0,
                animation: "tq-rise .3s ease both",
              }}
            >
              ✓
            </div>
          ) : (
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
          )}
          <div style={{ fontSize: 17, fontWeight: 700, color: "#14213A" }}>
            {finished ? t.genDone : t.generating}
          </div>
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((label, i) => {
            const done = finished || genStep > i;
            const isActive = !finished && genStep === i;
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

        {/* Finalizing hint (steps done, API still running) */}
        {finalizing && (
          <div style={{ marginTop: 20, fontSize: 13, color: "#7684A0", display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ width: 7, height: 7, borderRadius: "50%", background: "#14969E", display: "inline-block", animation: "tq-blink 1.2s infinite" }}
            />
            {t.genFinalizing}
          </div>
        )}

        {/* Done: success sub + countdown + view-now button */}
        {finished && (
          <div
            style={{
              marginTop: 22,
              paddingTop: 20,
              borderTop: "1px solid #EEF1F6",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              animation: "tq-rise .3s ease both",
            }}
          >
            <div style={{ fontSize: 13.5, color: "#4A5A76" }}>{t.genDoneSub}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ fontSize: 13.5, color: "#7684A0", display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    minWidth: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "#EEF3FB",
                    color: "#1B3568",
                    fontWeight: 700,
                    fontSize: 13,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 6px",
                  }}
                >
                  {Math.max(countdown, 1)}
                </span>
                {isAr
                  ? `بنحوّلك لصفحة الملخص خلال ${Math.max(countdown, 1)} ثوانٍ…`
                  : `Taking you to your brief in ${Math.max(countdown, 1)}…`}
              </div>
              <button
                onClick={skip}
                className="hover:bg-[#24437F]"
                style={{
                  background: "#1B3568",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13.5,
                  fontWeight: 700,
                  padding: "10px 20px",
                  borderRadius: 10,
                }}
              >
                {t.genViewNow}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
