"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { ExternalCollaborationResultSchema } from "@/lib/external-collaborations/schemas";
export function ExternalCollaborationUpload({ id, revision, disabled, onSaved, onPending, onDenied }: {
  id: string; revision: number; disabled: boolean; onSaved: () => Promise<void>; onPending: (value: boolean) => void; onDenied: () => void;
}) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const [file, setFile] = useState<File | null>(null), [label, setLabel] = useState(""), [busy, setBusy] = useState(false);
  const [error, setError] = useState(false), [retry, setRetry] = useState(false), [progress, setProgress] = useState<number | null>(null);
  const pending = useRef<{ metadata: string; file: File } | null>(null), xhr = useRef<XMLHttpRequest | null>(null), locked = useRef(false);
  useEffect(() => () => { if (xhr.current) { xhr.current.onload = null; xhr.current.onerror = null; xhr.current.onabort = null; xhr.current.abort(); } }, []);
  async function upload() {
    if (locked.current || (!pending.current && (!file || !label.trim()))) return;
    locked.current = true; setBusy(true); setError(false); onPending(true);
    try {
      if (!pending.current) {
        if (!file || file.size === 0 || file.size > 10485760 || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type)) throw new Error("FILE");
        const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(value => value.toString(16).padStart(2, "0")).join("");
        pending.current = { file, metadata: JSON.stringify({ action: "ATTACH_FILE", operationKey: crypto.randomUUID(), collaborationId: id,
          expectedRevision: revision, payload: { label: { text: label, language: null }, file: { checksum, contentType: file.type, size: file.size } } }) };
      }
      const form = new FormData(); form.set("command", new Blob([pending.current.metadata], { type: "application/json" }), "command.json"); form.set("file", pending.current.file);
      const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        const request = new XMLHttpRequest(); xhr.current = request;
        request.open("POST", "/api/external-collaborations/" + encodeURIComponent(id) + "/attachments"); request.timeout = 30000;
        request.upload.onprogress = event => setProgress(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : null);
        request.onload = () => resolve({ status: request.status, text: request.responseText });
        request.onerror = request.onabort = request.ontimeout = () => reject(new Error("NETWORK"));
        request.send(form);
      });
      if (response.status === 401 || response.status === 403) onDenied();
      if (response.status !== 200) {
        if (response.status < 500 && response.status !== 408) pending.current = null;
        throw new Error("UPLOAD");
      }
      ExternalCollaborationResultSchema.parse(JSON.parse(response.text).data);
      pending.current = null; setRetry(false); setFile(null); setLabel(""); onPending(false);
      await onSaved();
    } catch { setError(true); setRetry(pending.current !== null); onPending(pending.current !== null); }
    finally { locked.current = false; xhr.current = null; setBusy(false); setProgress(null); }
  }
  return <div className="space-y-3 border-t pt-4">
    <label className="block space-y-2 text-sm"><span>{copy("عنوان الملف", "File label")}</span><Input maxLength={200} value={label} disabled={disabled || busy || retry} onChange={event => setLabel(event.target.value)} /></label>
    <Input aria-label={copy("اختر ملفاً", "Choose file")} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={disabled || busy || retry} onChange={event => { setFile(event.target.files?.[0] ?? null); if (!label) setLabel((event.target.files?.[0]?.name ?? "").slice(0, 200)); }} />
    <p className="text-xs text-muted-foreground">PNG · JPEG · WebP · PDF — {copy("حتى 10 ميغابايت", "Up to 10 MB")}</p>
    {busy ? <p role="status" className="text-sm">{progress === null ? copy("جارٍ تجهيز الملف…", "Preparing file…") : progress < 100 ? `${progress}%` : copy("جارٍ تأكيد الحفظ…", "Confirming save…")}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{retry ? copy("تعذر تأكيد النتيجة. أعد نفس الملف بأمان.", "Could not confirm the result. Retry the same file safely.") : copy("تعذر رفع الملف. راجع نوعه وحجمه وحدّث الحالة عند الحاجة.", "Could not upload. Check the file type and size, and refresh if needed.")}</p> : null}
    <div className="flex gap-2"><Button disabled={busy || (disabled && !retry) || (!retry && (!file || !label.trim()))} onClick={() => void upload()}>{retry ? copy("إعادة نفس الملف", "Retry same file") : copy("رفع الملف", "Upload file")}</Button>{busy ? <Button variant="outline" onClick={() => xhr.current?.abort()}>{copy("إلغاء الرفع", "Cancel upload")}</Button> : null}</div>
  </div>;
}
