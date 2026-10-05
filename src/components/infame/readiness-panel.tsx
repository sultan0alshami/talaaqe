"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import {
  PublicationReadinessQuerySchema, PublicationReadinessSchema,
  type PublicationReadiness, type PublicationReadinessQuery,
} from "@/lib/readiness/contracts";
import styles from "./readiness-panel.module.css";

type Role = "CREATOR" | "BRAND";
type CapturedRead = { key: string; role: Role; query: PublicationReadinessQuery; url: string };
type Assessment = { key: string; data: PublicationReadiness; fresh: boolean };
type ReadFailure = { key: string; code: string };
type ActiveRead = {
  key: string; generation: number; controller: AbortController; timedOut: boolean;
  timer: ReturnType<typeof setTimeout> | null; focusAfter: boolean;
};
class PublicationReadFailure extends Error {
  constructor(public readonly code: string) { super(code); }
}
function captureRead(key: string): CapturedRead | null {
  const value = JSON.parse(key) as { role: unknown; query: unknown };
  if (value.role !== "CREATOR" && value.role !== "BRAND") return null;
  const parsed = PublicationReadinessQuerySchema.safeParse(value.query);
  if (!parsed.success) return null;
  const params = new URLSearchParams();
  if (parsed.data.portfolioVersion !== undefined) params.set("portfolioVersion", String(parsed.data.portfolioVersion));
  if (parsed.data.visibleAccountIds !== undefined) params.set("visibleAccountIds", JSON.stringify(parsed.data.visibleAccountIds));
  return { key, role: value.role, query: parsed.data, url: "/api/readiness/publication" + (params.size ? "?" + params.toString() : "") };
}
function validAssessment(data: PublicationReadiness, captured: CapturedRead) {
  return data.role === captured.role && (data.status !== "READY_FOR_REVIEW"
    || data.draftId !== null && data.draftRevision !== null && data.portfolioVersion !== null
      && (captured.query.portfolioVersion === undefined || data.portfolioVersion === captured.query.portfolioVersion));
}
function disposeRead(state: {
  mounted: { current: boolean }; active: { current: ActiveRead | null }; key: { current: string | null };
  generation: { current: number }; mutex: { current: boolean };
}) {
  state.mounted.current = false; state.key.current = null;
  const request = state.active.current;
  if (request?.timer !== null && request?.timer !== undefined) clearTimeout(request.timer);
  request?.controller.abort(); state.active.current = null;
  state.generation.current++; state.mutex.current = false;
}
const blockerLabels: Record<NonNullable<PublicationReadiness["blockerCode"]>, [string, string]> = {
  DRAFT_REQUIRED: ["ابدأ إعداد ملفك", "Start your profile setup"],
  PUBLICATION_CONSENT_REQUIRED: ["راجع تأكيد النشر", "Review publication confirmation"],
  EMAIL_VERIFICATION_REQUIRED: ["تأكيد البريد الإلكتروني مطلوب", "Email verification is required"],
  PRIMARY_OWNERSHIP_REQUIRED: ["إثبات ملكية الحساب الأساسي مطلوب", "Primary account ownership proof is required"],
  PROFILE_ESSENTIALS_REQUIRED: ["أكمل معلومات الملف الأساسية", "Complete the profile essentials"],
  ACCOUNT_MAPPING_CHANGED: ["راجع الحسابات المرتبطة بملفك", "Review your profile account mapping"],
  REPRESENTATION_REQUIRED: ["إثبات تمثيل الشركة مطلوب", "Company representation proof is required"],
  PORTFOLIO_APPROVAL_REQUIRED: ["راجع نسخة الملف الحالية واعتمدها", "Review and approve the current portfolio"],
  ACCOUNT_PUBLICATION_NOT_ALLOWED: ["راجع الحسابات المختارة للظهور", "Review the accounts selected for publication"],
};
const remedyLabels: Record<PublicationReadiness["remedies"][number]["kind"], [string, string]> = {
  ONBOARDING: ["إكمال إعداد الملف", "Continue profile setup"],
  EMAIL: ["تأكيد البريد من الرئيسية", "Verify email from Overview"],
  OWNERSHIP: ["مراجعة إثبات الحساب الأساسي", "Review primary account evidence"],
  REPRESENTATION: ["مراجعة إثبات تمثيل الشركة", "Review company representation evidence"],
  ESSENTIALS: ["إكمال الأساسيات", "Complete essentials"],
  MAPPING: ["مراجعة الحسابات", "Review account mapping"],
  PORTFOLIO: ["مراجعة الملف التعريفي", "Review portfolio"],
  ACCOUNT_SELECTION: ["مراجعة الحسابات المختارة", "Review selected accounts"],
};

export function PublicationReadinessPanel({
  role, portfolioVersion, visibleAccountIds, onGoToStep, refreshKey,
}: {
  role: Role; portfolioVersion?: number; visibleAccountIds?: string[];
  onGoToStep?: (step: number) => void; refreshKey?: number;
}) {
  const { lang, isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const headingId = "publication-readiness-" + useId();
  const captureKey = JSON.stringify({ role, query: {
    ...(portfolioVersion === undefined ? {} : { portfolioVersion }),
    ...(visibleAccountIds === undefined ? {} : { visibleAccountIds }),
  }, refreshKey: refreshKey ?? null });
  const captured = useMemo(() => captureRead(captureKey), [captureKey]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [failure, setFailure] = useState<ReadFailure | null>(null);
  const [retry, setRetry] = useState<CapturedRead | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ key: string; generation: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false), mutex = useRef(false), generation = useRef(0);
  const active = useRef<ActiveRead | null>(null), currentKey = useRef<string | null>(null);

  const load = useCallback(async (read: CapturedRead, focusAfter = false) => {
    if (!mounted.current || mutex.current || currentKey.current !== read.key) return;
    mutex.current = true; setLoadingKey(read.key); setFailure(null); setRetry(read);
    setAssessment(previous => previous?.key === read.key ? { ...previous, fresh: false } : null);
    const request: ActiveRead = { key: read.key, generation: ++generation.current, controller: new AbortController(), timedOut: false, timer: null, focusAfter };
    active.current = request;
    const owned = () => mounted.current && active.current === request && generation.current === request.generation && currentKey.current === read.key;
    request.timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, 30_000);
    try {
      const response = await fetch(read.url, { cache: "no-store", signal: request.controller.signal });
      if (!owned()) return;
      // A same-request denial wins over cancellation and clears the private
      // assessment and its time before any denial body is parsed.
      if ([401, 403, 404].includes(response.status)) {
        setAssessment(null); setRetry(null);
        setFailure({ key: read.key, code: response.status === 401 ? "UNAUTHENTICATED" : response.status === 403 ? "FORBIDDEN" : "NOT_FOUND" });
        return;
      }
      if (request.controller.signal.aborted) throw new PublicationReadFailure("CANCELLED");
      if (!response.ok) throw new PublicationReadFailure(response.status === 503 ? "RETRY_REQUIRED" : response.status === 422 ? "VALIDATION" : "REQUEST_FAILED");
      let body: unknown;
      try { body = await response.json(); } catch { throw new PublicationReadFailure("INVALID_RESPONSE"); }
      if (!owned()) return;
      if (request.controller.signal.aborted) throw new PublicationReadFailure("CANCELLED");
      const parsed = PublicationReadinessSchema.safeParse(body && typeof body === "object" && !Array.isArray(body) && "data" in body ? body.data : null);
      if (!parsed.success || !validAssessment(parsed.data, read)) throw new PublicationReadFailure("INVALID_RESPONSE");
      setAssessment({ key: read.key, data: parsed.data, fresh: true }); setRetry(null); setFailure(null);
    } catch (error) {
      if (owned()) setFailure({ key: read.key, code: request.timedOut ? "TIMEOUT" : request.controller.signal.aborted ? "CANCELLED"
        : error instanceof PublicationReadFailure ? error.code : "NETWORK" });
    } finally {
      if (request.timer !== null) clearTimeout(request.timer);
      if (owned()) {
        active.current = null; mutex.current = false; setLoadingKey(null);
        if (request.focusAfter) setFocusRequest({ key: read.key, generation: request.generation });
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true; currentKey.current = captureKey;
    const cleanupState = { mounted, active, key: currentKey, generation, mutex };
    let disposed = false;
    // Fetch after commit. A new selection invalidates the preceding request;
    // the displayed assessment is already hidden by its mismatched capture key.
    queueMicrotask(() => { if (!disposed && captured) void load(captured); });
    return () => { disposed = true; disposeRead(cleanupState); };
  }, [captureKey, captured, load]);
  useEffect(() => {
    if (focusRequest && currentKey.current === focusRequest.key) heading.current?.focus();
  }, [focusRequest]);

  const current = assessment?.key === captureKey ? assessment : null;
  const busy = loadingKey === captureKey;
  const error = captured === null ? "VALIDATION" : failure?.key === captureKey ? failure.code : null;
  const retryRead = retry?.key === captureKey ? retry : null;
  const denied = error !== null && ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(error);
  const home = role === "CREATOR" ? "/creator" : "/brand", onboarding = home + "/onboarding";
  const date = (value: string) => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const errorText = error === "UNAUTHENTICATED"
    ? copy("انتهت الجلسة. سجّل الدخول مجددًا لطلب تقييم النشر.", "Your session ended. Sign in again to assess publication.")
    : denied ? copy("لا يتوفر تقييم نشر مسموح لهذا الحساب الآن. ارجع إلى مساحتك لإكمال الإعداد.", "No authorized publication assessment is available for this account now. Return to your workspace to continue setup.")
    : error === "VALIDATION" ? copy("تعذر تقييم نسخة الملف أو اختيار الحسابات الحالي. راجع الاختيار في إعداد الملف.", "The current portfolio version or account selection could not be assessed. Review the selection in profile setup.")
    : error === "TIMEOUT" ? copy("استغرق التقييم وقتًا طويلًا. يمكنك إعادة نفس القراءة؛ أي نتيجة سابقة ليست تقييمًا حاليًا.", "The assessment timed out. You can retry the same read; an earlier result is not a current assessment.")
    : error === "CANCELLED" ? copy("أُلغي الانتظار. يمكنك إعادة نفس التقييم؛ أي نتيجة سابقة تبقى تاريخية.", "Waiting was cancelled. You can retry the same assessment; an earlier result remains historical.")
    : copy("تعذر تأكيد تقييم حالي. احتفظنا بالنتيجة السابقة إن وُجدت، مع تمييزها كتاريخية.", "A current assessment could not be confirmed. Any previous result is retained and marked historical.");

  return <section className={styles.region} aria-labelledby={headingId} dir={isAr ? "rtl" : "ltr"}>
    <Card className={styles.panel + " ring-0"} aria-busy={busy}>
      <header className={styles.header}>
        <div><h2 id={headingId} className={styles.title} ref={heading} tabIndex={-1}>{copy("مراجعة متطلبات النشر", "Publication readiness")}</h2>
          <p className={styles.intro}>{copy("تقييم خاص لمتطلبات نشر ملفك. لا ينشر هذا التقييم ملفك؛ الموافقة الصريحة تأتي في خطوة النشر.", "A private assessment of your profile's publication requirements. This assessment does not publish your profile; explicit consent comes at the publication step.")}</p></div>
        <Button variant="outline" disabled={busy || captured === null} onClick={() => captured && void load(captured, true)}>{copy("تقييم المتطلبات الحالية", "Assess current requirements")}</Button>
      </header>
      <p role="status" aria-live="polite" aria-atomic="true" className={styles.status}>{busy
        ? copy("جارٍ تقييم متطلبات النشر الحالية…", "Assessing current publication requirements…")
        : current?.fresh ? copy("اكتمل تقييم المتطلبات الحالية.", "The current requirements assessment is complete.") : ""}</p>
      {busy && <Button variant="outline" onClick={() => {
        const request = active.current; if (request) { request.focusAfter = true; request.controller.abort(); }
      }}>{copy("إلغاء الانتظار", "Cancel waiting")}</Button>}
      {error && <div role="alert" className={styles.error}><p>{errorText}</p>
        <div className={styles.actions}>
          {retryRead && !denied && <Button variant="outline" disabled={busy} onClick={() => void load(retryRead, true)}>{copy("إعادة التقييم نفسه", "Retry the same assessment")}</Button>}
          {denied && <Button asChild variant="outline"><Link href={error === "UNAUTHENTICATED" ? "/login" : home} prefetch={false}>{error === "UNAUTHENTICATED" ? copy("تسجيل الدخول", "Sign in") : copy("العودة لمساحتي", "Return to my workspace")}</Link></Button>}
        </div>
      </div>}
      {!current && !busy && !error && <p className={styles.note}>{copy("لم يكتمل تقييم المتطلبات لهذا الاختيار بعد.", "Requirements for this selection have not been assessed yet.")}</p>}
      {current && !denied && <div className={current.fresh ? styles.assessment : styles.historical}>
        {!current.fresh ? <>
          <h3>{copy("نتيجة سابقة — تحتاج تقييمًا جديدًا", "Previous result — a fresh assessment is needed")}</h3>
          <p>{current.data.blockerCode ? copy("العائق في التقييم السابق:", "The earlier blocker was:") + " " + blockerLabels[current.data.blockerCode][isAr ? 0 : 1]
            : copy("لم يجد التقييم السابق عائقًا. هذه نتيجة تاريخية ولا تؤكد استيفاء المتطلبات الآن.", "The earlier assessment found no blocker. This is historical and does not confirm the requirements are satisfied now.")}</p>
        </> : current.data.status === "READY_FOR_REVIEW" ? <>
          <h3>{copy("المتطلبات جاهزة لمراجعتك", "Ready for your review")}</h3>
          <p>{copy("اجتاز الاختيار الحالي متطلبات النشر وقت التقييم. راجع نسخة الملف والحسابات، ثم اختر الموافقة على النشر بنفسك؛ لم يُنشر شيء بهذا التقييم.", "The current selection passed publication prerequisites at the assessment time. Review the portfolio and accounts, then explicitly choose publication consent yourself; this assessment published nothing.")}</p>
          <div className={styles.actions}>{onGoToStep ? <Button variant="outline" disabled={busy} onClick={() => onGoToStep(4)}>{copy("مراجعة الملف والمشاركة", "Review portfolio and sharing")}</Button>
            : <Button asChild variant="outline"><Link href={onboarding} prefetch={false}>{copy("مراجعة الملف والمشاركة", "Review portfolio and sharing")}</Link></Button>}</div>
        </> : <>
          <h3>{blockerLabels[current.data.blockerCode!][isAr ? 0 : 1]}</h3>
          <p>{copy("هذا أول متطلب غير مستوفٍ في التقييم الحالي. أكمل الخطوة المناسبة ثم أعد التقييم.", "This is the first unmet prerequisite in the current assessment. Complete the relevant step, then assess again.")}</p>
          <div className={styles.actions}>{current.data.remedies.map((remedy, index) => {
            const label = remedyLabels[remedy.kind][isAr ? 0 : 1];
            return onGoToStep && remedy.onboardingStep !== null
              ? <Button key={index} variant="outline" disabled={busy} onClick={() => onGoToStep(remedy.onboardingStep!)}>{label}</Button>
              : <Button key={index} asChild variant="outline"><Link href={remedy.href} prefetch={false}>{label}</Link></Button>;
          })}</div>
        </>}
        <p className={styles.timestamp}>{current.fresh ? copy("وقت التقييم:", "Assessed at:") : copy("وقت النتيجة السابقة:", "Previous result time:")} <time dateTime={current.data.asOf}>{date(current.data.asOf)}</time> <bdi dir="ltr">UTC</bdi></p>
      </div>}
      <p className={styles.note}>{copy("النشر، وإتاحة الملف للعامة، وأهلية عروض التعاون لها فحوص منفصلة. هذا التقييم ليس توثيقًا عامًا للحساب.", "Publication, current public visibility and collaboration-offer eligibility have separate checks. This assessment is not a general account verification.")}</p>
    </Card>
  </section>;
}
