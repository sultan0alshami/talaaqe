"use client";

import type { PrivateAssetDTO } from "@/lib/evidence/service";
import { useRef, useState } from "react";
import { MAX_EVIDENCE_BYTES } from "@/lib/evidence/limits";
export type EvidenceAction = "OWNERSHIP_START" | "OWNERSHIP_SUBMIT" | "SCREENSHOT_SUBMIT" | "METRICS_APPROVE" | "CORRECTION_SUBMIT" | "CORRECTION_APPROVE" | "LICENCE_SUBMIT" | "BUSINESS_SUBMIT" | "OWNERSHIP_REVIEW" | "SCREENSHOT_REVIEW" | "LICENCE_REVIEW" | "BUSINESS_REVIEW";
export type EvidenceUpload = { asset: PrivateAssetDTO; replayed: boolean };
class EvidenceClientError extends Error {
  constructor(public code: string, public uncertain = false) { super(code); }
}
export function evidenceErrorCode(error: unknown): string {
  return error instanceof EvidenceClientError ? error.code : "NETWORK";
}
async function decode<T>(response: Response): Promise<T> {
  let body: { data?: T; error?: { code?: string } };
  try { body = await response.json(); } catch { throw new EvidenceClientError("NETWORK", true); }
  if (!response.ok) {
    const code = body?.error?.code;
    if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(code)) throw new EvidenceClientError("NETWORK", true);
    const definitive = ["CAPABILITY_UNAVAILABLE", "POLICY_UNAVAILABLE", "ASSET_BYTES_UNAVAILABLE", "UNSAFE_LOCAL_STORAGE"];
    throw new EvidenceClientError(code, response.status >= 500 && !definitive.includes(code));
  }
  if (body?.data === undefined) throw new EvidenceClientError("NETWORK", true);
  return body.data;
}
export async function evidenceRead<T>(path: string): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { cache: "no-store" }); } catch { throw new EvidenceClientError("NETWORK", true); }
  return decode<T>(response);
}
export function evidenceErrorMessage(code: string, isAr: boolean) {
  const messages: Record<string, [string, string]> = {
    NETWORK: ["تعذر معرفة نتيجة الطلب. مدخلاتك باقية؛ أعد نفس الطلب قبل إجراء جديد.", "The request result is uncertain. Your input remains; retry the same request before a new action."],
    REFRESH_REQUIRED: ["وصلت نتيجة الإجراء، لكن تعذر تحميل النسخة الحالية. حدّث البيانات قبل إجراء جديد.", "The action returned a result, but the current data could not be loaded. Refresh before a new action."],
    STALE_VERSION: ["تغيرت النسخة في مكان آخر. حدّث البيانات وقارنها بمدخلاتك قبل المحاولة.", "The version changed elsewhere. Refresh and compare with your input before trying again."],
    STALE_IDENTITY: ["تغير حساب التواصل أو نطاق الإثبات. حدّث البيانات وراجع الحساب المحدد.", "The social account or evidence scope changed. Refresh and review the selected account."],
    STALE_OWNER: ["تغير صاحب الملف. حدّث البيانات وراجع صلاحية الوصول.", "The profile owner changed. Refresh and review your access."],
    UNAUTHENTICATED: ["انتهت الجلسة. سجّل دخولك لاستكمال العمل.", "Your session ended. Sign in to continue."],
    FORBIDDEN: ["هذا الإجراء غير متاح لصلاحيتك الحالية.", "This action is unavailable for your current permissions."],
    CAPABILITY_UNAVAILABLE: ["تخزين الإثباتات غير متاح حاليًا. مدخلاتك باقية.", "Private evidence storage is currently unavailable. Your input remains."],
    POLICY_UNAVAILABLE: ["سياسة الترخيص المطلوبة غير متاحة للمراجعة الحالية. حدّث الخيارات.", "The required licence policy is unavailable for the current review. Refresh the options."],
    ACCOUNT_CONSENT_REQUIRED: ["أكد حسابك وإذن استخدام بياناته في إعداد الملف أولًا.", "Confirm your account and its data permission in profile setup first."],
    INVALID_ASSET_SIZE: ["اختر ملف إثبات ضمن الحد المعلن.", "Choose an evidence file within the stated limit."],
  };
  return messages[code]?.[isAr ? 0 : 1] ?? (isAr ? `تعذر الإجراء (${code}). مدخلاتك باقية؛ راجع الحقول والإثبات والنطاق.` : `The action failed (${code}). Your input remains; review the fields, evidence and scope.`);
}
type Request = { path: string; body: string | Uint8Array<ArrayBuffer>; headers: Record<string, string>; onSuccess?: (data: unknown) => void };
export function useEvidenceOperation(refreshData: () => Promise<void>) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false),
    [refreshRequired, setRefreshRequired] = useState(false), [notice, setNotice] = useState(false);
  const inFlight = useRef(false), captured = useRef<Request | null>(null), staleData = useRef(false);
  const completed = useRef<{ data: unknown; onSuccess?: (data: unknown) => void } | null>(null);
  function remember(request: Request | null) { captured.current = request; setPending(request !== null); }
  function needsRefresh(value: boolean) { staleData.current = value; setRefreshRequired(value); }
  async function execute(request: Request) {
    let committed = false;
    try {
      remember(request);
      let response: Response;
      try { response = await fetch(request.path, { method: "POST", cache: "no-store", headers: request.headers, body: request.body }); }
      catch { throw new EvidenceClientError("NETWORK", true); }
      const data = await decode(response);
      committed = true; remember(null); needsRefresh(true);
      completed.current = { data, onSuccess: request.onSuccess };
      await refreshData();
      const result = completed.current; completed.current = null;
      result?.onSuccess?.(result.data);
      needsRefresh(false); setNotice(true);
    } catch (caught) {
      if (committed) setError("REFRESH_REQUIRED");
      else {
        if (!(caught instanceof EvidenceClientError) || !caught.uncertain) remember(null);
        setError(evidenceErrorCode(caught));
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function start(prepare: () => Promise<Request>) {
    if (inFlight.current || captured.current || staleData.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(false);
    let request: Request;
    try { request = await prepare(); }
    catch (caught) { setError(evidenceErrorCode(caught)); inFlight.current = false; setBusy(false); return; }
    await execute(request);
  }
  return { busy, blocked: busy || pending || refreshRequired, error, pending, refreshRequired, notice,
    async command<T>(action: EvidenceAction, fields: Record<string, unknown>, resourceId?: string, onSuccess?: (data: T) => void) {
      await start(async () => ({ path: "/api/evidence/commands", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(resourceId ? { resourceId } : {}), command: { ...fields, operationKey: crypto.randomUUID() } }),
        onSuccess: onSuccess as ((data: unknown) => void) | undefined }));
    },
    async upload(file: File, purpose: string, onSuccess?: (data: EvidenceUpload) => void) {
      await start(async () => {
        if (!file.size || file.size > MAX_EVIDENCE_BYTES) throw new EvidenceClientError("INVALID_ASSET_SIZE");
        const body = new Uint8Array(await file.arrayBuffer());
        if (!body.byteLength || body.byteLength > MAX_EVIDENCE_BYTES) throw new EvidenceClientError("INVALID_ASSET_SIZE");
        return { path: "/api/evidence/assets", body: new Uint8Array(body), headers: { "content-type": file.type,
          "x-evidence-purpose": purpose, "x-operation-key": crypto.randomUUID() }, onSuccess: onSuccess as ((data: unknown) => void) | undefined };
      });
    },
    async retry() {
      if (inFlight.current || !captured.current) return;
      inFlight.current = true; setBusy(true); setError(null); setNotice(false);
      await execute(captured.current);
    },
    async refresh() {
      if (inFlight.current) return false;
      inFlight.current = true; setBusy(true); setError(null); setNotice(false);
      try {
        await refreshData();
        const result = completed.current; completed.current = null;
        result?.onSuccess?.(result.data);
        needsRefresh(false); if (result) setNotice(true); return true;
      }
      catch (caught) { setError(evidenceErrorCode(caught)); return false; }
      finally { inFlight.current = false; setBusy(false); }
    } };
}
