"use client";
// Legacy caller adapter. Completion follows the API; no invented timed progress.
import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
export function GenerationModal({ active, apiDone = false, onDone }: { active: boolean; apiDone?: boolean; onDone?: () => void }) {
  const { t, dir } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (active) dialog.current?.showModal();
    else dialog.current?.close();
  }, [active]);
  return <dialog ref={dialog} dir={dir} aria-labelledby="generation-status" onCancel={e => e.preventDefault()} className="rounded-xl border p-8 backdrop:bg-black/50">
    <h2 id="generation-status">{apiDone ? t.genDone : t.generating}</h2>
    <p role="status" aria-live="polite">{apiDone ? t.genDoneSub : t.genFinalizing}</p>
    {apiDone && <button type="button" onClick={onDone}>{t.pdViewBrief}</button>}
  </dialog>;
}
