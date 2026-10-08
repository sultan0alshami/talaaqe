"use client";
import Link from "next/link";
import styles from "./deal-layout.module.css";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DealCommandSchema } from "@/lib/deals/contracts";
import type { DealDTO } from "@/lib/deals/service";
import type { DealComposeDTO } from "@/lib/deals/readiness";
import type { CampaignRequirementsDTO } from "@/lib/campaigns/contracts";
import type { OfferDraftDTO } from "@/lib/deals/drafts";
import type { OriginalText } from "@/lib/contracts/vocabulary";
import { countryLabel } from "@/lib/contracts/country-labels";
import { useDealCopy } from "./deal-copy";
import {
  DealEditor,
  type DraftTerms,
  type ReviewedTermsOption,
} from "./deal-editor";
import { DealTerms } from "./deal-terms";
import { DealBrief } from "./deal-brief";
import { useDealRequest } from "./deal-request";
import { useDealHydrationReady } from "./deal-hydration";

export type DealReadiness = {
  requirements?: CampaignRequirementsDTO | null;
  templates: ReviewedTermsOption[];
  mandatoryPolicyVersionIds: string[];
  blockedReasons: string[];
};
const emptyText = (): OriginalText => ({ text: "", language: null });
function TextEntry({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: OriginalText;
  onChange: (value: OriginalText) => void;
  rows?: number;
}) {
  const id = useId(),
    { copy } = useDealCopy();
  return (
    <div className="space-y-4">
      <label htmlFor={id} className="grid gap-2 text-sm font-medium">
        {label}
        <Textarea
          aria-label={label}
          id={id}
          rows={rows}
          maxLength={20000}
          value={value.text}
          dir="auto"
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
      </label>
      <label
        htmlFor={`${id}-language`}
        className="grid gap-2 text-sm font-medium"
      >
        {copy("لغة النص (اختيارية، BCP47)", "Text language (optional, BCP47)")}
        <Input
          aria-label={copy(
            "لغة النص (اختيارية، BCP47)",
            "Text language (optional, BCP47)",
          )}
          id={`${id}-language`}
          value={value.language ?? ""}
          dir="ltr"
          maxLength={100}
          onChange={(event) =>
            onChange({ ...value, language: event.target.value || null })
          }
        />
        <span className="text-xs font-normal text-muted-foreground">
          {copy(
            "النص يبقى بلغته الأصلية. تحديد اللغة لا يترجمه.",
            "The text keeps its original language. Declaring a language does not translate it.",
          )}
        </span>
      </label>
    </div>
  );
}
function Check({
  children,
  checked,
  onChange,
  disabled,
}: {
  children: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span className="text-sm leading-7">{children}</span>
    </label>
  );
}
function original(value: unknown): OriginalText | null {
  const schema = z.object({
    text: z.string(),
    language: z.string().nullable(),
  });
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function DealScreen({
  initialDeal,
  actorUserId,
  role,
  initialDraft = null,
  readiness = {
    templates: [],
    mandatoryPolicyVersionIds: [],
    blockedReasons: ["POLICY_UNAVAILABLE"],
  },
}: {
  initialDeal: DealDTO;
  actorUserId: string;
  role: "BRAND" | "CREATOR";
  initialDraft?: Pick<OfferDraftDTO, "id" | "revision" | "terms"> | null;
  readiness?: DealReadiness;
}) {
  const { isAr, copy, status, errorCopy } = useDealCopy(),
    prefix = useId();
  const [deal, setDeal] = useState(initialDeal),
    [draft, setDraft] = useState(initialDraft),
    [notice, setNotice] = useState<string | null>(null);
  const [commercial, setCommercial] = useState(readiness);
  const [readBusy, setReadBusy] = useState(false),
    [authorizationDenied, setAuthorizationDenied] = useState(false),
    [counterOpen, setCounterOpen] = useState(false),
    [counterBase, setCounterBase] = useState({
      version: initialDeal.version,
      offerId: initialDeal.currentOffer.id,
      offerVersion: initialDeal.currentOffer.version,
    });
  const [editorKey, setEditorKey] = useState(0),
    [compareRequired, setCompareRequired] = useState(false);
  const [acceptRead, setAcceptRead] = useState(false),
    [agreementRead, setAgreementRead] = useState(false),
    [completeRead, setCompleteRead] = useState(false),
    [paymentRead, setPaymentRead] = useState(false),
    [ratingRead, setRatingRead] = useState(false);
  const [agreementLanguage, setAgreementLanguage] = useState<"" | "ar" | "en">(
      "",
    ),
    [reason, setReason] = useState<OriginalText>(emptyText),
    [cancelOpen, setCancelOpen] = useState(false);
  const [message, setMessage] = useState<OriginalText>(emptyText),
    [delivery, setDelivery] = useState<OriginalText>(emptyText),
    [deliveryLinks, setDeliveryLinks] = useState("");
  const [stars, setStars] = useState(0),
    [ratingComment, setRatingComment] = useState<OriginalText>(emptyText);
  const request = useDealRequest(actorUserId, `deal:${deal.id}`),
    readFlight = useRef(false);
  const hydrated = useDealHydrationReady();
  const readLocked = !hydrated || request.busy || !!request.pending || readBusy;
  const locked = readLocked || authorizationDenied;
  const recipient = deal.currentOffer.recipientUserId === actorUserId,
    negotiating = ["OFFERED", "COUNTERED"].includes(deal.status);
  const ownConfirmation = deal.confirmations.some(
    (row) =>
      row.userId === actorUserId && row.version === deal.agreement?.version,
  );
  const ownRating = deal.ratings.find(
      (row) => row.authorUserId === actorUserId,
    ),
    moneyStage = ["AGREED", "DELIVERED", "COMPLETED"].includes(deal.status);
  const myPaymentReported =
    role === "BRAND"
      ? deal.brandPaymentReportedAt
      : deal.creatorReceiptReportedAt;
  const currentTemplate = commercial.templates.find(
    (template) =>
      template.id === deal.currentOffer.terms.governingTermsVersionId,
  );
  const path = `/api/deals/${encodeURIComponent(deal.id)}`;
  const participant = (id: string) =>
    id === actorUserId
      ? copy("أنت", "You")
      : copy("الطرف الآخر", "The other party");
  const timestamp = (value: string) => (
    <time
      dateTime={value}
      dir="ltr"
      className="break-all text-xs text-muted-foreground"
    >
      {value}
    </time>
  );
  function receive(result: {
    deal?: DealDTO;
    draft?: OfferDraftDTO;
    replayed?: boolean;
  }) {
    if (result.deal) {
      setDeal(result.deal);
      setAcceptRead(false);
      setAgreementRead(false);
      setCompleteRead(false);
      setPaymentRead(false);
      setRatingRead(false);
      setNotice(
        copy(
          "تم تسجيل الإجراء. هذه هي الحالة الحالية.",
          "The action was recorded. This is the current state.",
        ),
      );
    }
    if (result.draft) {
      setDraft(result.draft);
      setEditorKey((key) => key + 1);
      setNotice(
        copy(
          "انحفظت مسودة عرضك الخاصة. تقدر ترجع لها لاحقًا.",
          "Your private offer draft is saved. You can resume later.",
        ),
      );
    }
  }
  async function command(
    action: string,
    extra: Record<string, unknown> = {},
    version = deal.version,
  ) {
    const body = {
      action,
      operationKey: crypto.randomUUID(),
      expectedVersion: version,
      ...extra,
    };
    if (!DealCommandSchema.safeParse(body).success) {
      request.setError("VALIDATION");
      return;
    }
    setNotice(null);
    await request.run<{ deal: DealDTO; replayed: boolean }>(
      `${path}/commands`,
      body,
      (result) => {
        receive(result);
        if (action === "MESSAGE") setMessage(emptyText());
        if (action === "COUNTER") setCounterOpen(false);
      },
    );
  }
  async function reload() {
    if (readFlight.current || request.busy || request.pending) return;
    readFlight.current = true;
    setReadBusy(true);
    request.setError(null);
    setNotice(null);
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        denyAuthorization(response.status);
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        request.setError(body.error?.code ?? "INTERNAL_ERROR");
        return;
      }
      setDeal(body.data);
      setAcceptRead(false);
      setAgreementRead(false);
      setCompleteRead(false);
      setPaymentRead(false);
      setRatingRead(false);
      if (counterOpen && body.data.version !== counterBase.version)
        setCompareRequired(true);
      const query = new URLSearchParams({
        campaignId: deal.campaignId,
        creatorId: deal.creatorId,
        dealId: deal.id,
        view: "CURRENT_EXECUTION",
      });
      const contextResponse = await fetch(`/api/deals/compose?${query}`, {
          cache: "no-store",
        });
      if (contextResponse.status === 401 || contextResponse.status === 403) {
        denyAuthorization(contextResponse.status);
        return;
      }
      const contextBody = await contextResponse.json();
      if (contextResponse.ok) {
        const context: DealComposeDTO = contextBody.data;
        if (context.kind === "CURRENT") {
          setAuthorizationDenied(false);
          setCommercial({
            requirements: context.requirements,
            templates: context.templates,
            mandatoryPolicyVersionIds:
              context.requirements?.mandatoryPolicyVersionIds ?? [],
            blockedReasons: context.readiness.blockedReasons,
          });
          setDraft(context.draft);
        } else {
          setCommercial({ requirements: context.approvedBrief.content.requirements, templates: [],
            mandatoryPolicyVersionIds: [], blockedReasons: context.readiness.blockedReasons });
          setDraft(null);
        }
      } else
        setCommercial({
          requirements: null,
          templates: [],
          mandatoryPolicyVersionIds: [],
          blockedReasons: [
            contextBody.error?.code === "NOT_FOUND"
              ? "COMMERCIAL_CONTEXT_UNAVAILABLE"
              : (contextBody.error?.code ?? "POLICY_UNAVAILABLE"),
          ],
        });
      setNotice(
        copy(
          "تم تحميل الحالة الحالية. مدخلاتك ما تغيرت؛ راجع النسخ قبل إجراء جديد.",
          "The current state is loaded. Your entries are unchanged; review versions before another action.",
        ),
      );
    } catch {
      request.setError("NETWORK_READ");
    } finally {
      readFlight.current = false;
      setReadBusy(false);
    }
  }
  function denyAuthorization(status: number) {
    const code = status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN";
    setAuthorizationDenied(true);
    setDraft(null);
    setCommercial({ requirements: null, templates: [], mandatoryPolicyVersionIds: [], blockedReasons: [code] });
    setNotice(null);
    request.setError(code);
  }
  async function saveDraft(patch: DraftTerms) {
    await request.run<{ draft: OfferDraftDTO }>(
      "/api/deals/drafts",
      {
        campaignId: deal.campaignId,
        creatorId: deal.creatorId,
        expectedRevision: draft?.revision ?? 0,
        operationKey: crypto.randomUUID(),
        patch,
      },
      receive,
    );
  }
  const eventNames: Record<string, [string, string]> = {
    "deal.offered": ["إرسال عرض", "Offer sent"],
    "deal.countered": ["تقديم شروط معدّلة", "Counteroffer submitted"],
    "deal.accepted": [
      "قبول العرض وتثبيت الاتفاق",
      "Offer accepted; agreement frozen",
    ],
    "deal.declined": ["رفض العرض", "Offer declined"],
    "agreement.confirmed": ["تأكيد الاتفاق", "Agreement confirmed"],
    "deal.agreed": ["اكتمال تأكيد الطرفين", "Both parties confirmed"],
    "deal.delivered": ["إبلاغ عن تسليم", "Delivery reported"],
    "deal.completed": ["اكتمال الصفقة", "Deal completed"],
    "deal.cancelled": ["إلغاء الصفقة", "Deal cancelled"],
    "payment.paid_declared": [
      "إبلاغ الشركة عن الدفع",
      "Brand reported payment",
    ],
    "payment.received_declared": [
      "إبلاغ الصانع عن الاستلام",
      "Creator reported receipt",
    ],
    "rating.submitted": ["إرسال تقييم مختوم", "Sealed rating submitted"],
    "ratings.revealed": ["كشف التقييمات", "Ratings revealed"],
    "deal.message_posted": ["رسالة جديدة", "Message posted"],
  };
  const deliveryEvent = [...deal.events]
      .reverse()
      .find((event) => event.type === "deal.delivered"),
    evidence = record(record(deliveryEvent?.payload).evidence),
    evidenceText = original(evidence.text);
  return (
    <div className={styles.page} aria-busy={!hydrated}>
      <header className={styles.header}>
        <Link
          href={`/${role.toLowerCase()}/deals`}
          className={`${styles.back} inline-flex min-h-12 items-center underline underline-offset-4`}
        >
          {copy("كل الصفقات", "All deals")}
        </Link>
        <div className={styles.headerRow}>
          <div className="min-w-0 space-y-3">
            <p className={styles.status}>
              {status(deal.status)}
            </p>
            <h1 className="text-2xl font-bold">
              {copy("تفاصيل الصفقة", "Deal details")}
            </h1>
            <p className="break-all text-xs text-muted-foreground" dir="ltr">
              {deal.id}
            </p>
            <p className="text-sm">
              {copy("نسخة الصفقة", "Deal version")} {deal.version} ·{" "}
              {copy("نسخة الموجز", "Brief version")} {deal.briefVersion}
            </p>
          </div>
          <Button variant="outline" onClick={reload} disabled={readLocked}>
            {readBusy
              ? copy("جاري التحميل…", "Loading…")
              : copy("حمّل الحالة الحالية", "Load current state")}
          </Button>
        </div>
      </header>
      {notice && (
        <p
          role="status"
          className="rounded-2xl border border-border bg-muted p-4"
        >
          {notice}
        </p>
      )}
      {request.error && (
        <div
          role="alert"
          className="space-y-3 rounded-2xl border border-destructive p-5"
        >
          <p className="text-destructive">{errorCopy(request.error)}</p>
          {request.pending && (
            <>
              <p className="text-sm">
                {copy(
                  "الطلب محفوظ في جلسة هذا المتصفح لإعادة نفس الإجراء حتى بعد إعادة التحميل. لا تُرسل إجراءً مختلفًا قبل تأكيد نتيجته.",
                  "This browser session retains the request so the same action can be retried after reload. Confirm its result before submitting another action.",
                )}
              </p>
              <Button
                variant="outline"
                disabled={!hydrated || request.busy}
                onClick={() =>
                  request.retry<{ deal?: DealDTO; draft?: OfferDraftDTO }>(
                    (result) => {
                      receive(result);
                      if (request.pending?.body.action === "MESSAGE")
                        setMessage(emptyText());
                    },
                  )
                }
              >
                {copy("أعد نفس الطلب بأمان", "Retry the same request safely")}
              </Button>
            </>
          )}
        </div>
      )}
      <DealProgress deal={deal} />
      <div className={styles.body}>
        <div className={styles.main}>
          <Card>
            <CardHeader>
              <CardTitle><h2>
                {copy("العرض الحالي", "Current offer")} ·{" "}
                {deal.currentOffer.version}
              </h2></CardTitle>
              <CardDescription>
                {copy("مقدم العرض", "Proposer")}:{" "}
                {participant(deal.currentOffer.proposerUserId)} ·{" "}
                {copy("المستلم", "Recipient")}:{" "}
                {participant(deal.currentOffer.recipientUserId)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <DealTerms terms={deal.currentOffer.terms} />
              {currentTemplate && (
                <details inert={!hydrated} className="rounded-xl border border-border p-4">
                  <summary className="min-h-12 cursor-pointer py-3 font-medium">
                    {copy(
                      "اقرأ الشروط المراجعة لهذا العرض",
                      "Read this offer's reviewed terms",
                    )}
                  </summary>
                  <div className="space-y-6 py-4">
                    {(["ar", "en"] as const)
                      .filter((language) => currentTemplate.translations[language])
                      .map((language) => (
                        <p
                          key={language}
                          className="whitespace-pre-wrap break-words"
                          lang={language}
                          dir={language === "ar" ? "rtl" : "ltr"}
                        >
                          {currentTemplate.translations[language]}
                        </p>
                      ))}
                  </div>
                </details>
              )}
              {timestamp(deal.currentOffer.createdAt)}
              {negotiating && (
                <p className="rounded-xl bg-muted p-4 text-sm">
                  {recipient
                    ? copy(
                        "أنت مستلم العرض الحالي. تقدر تقبله، ترفضه بسبب واضح، أو تقدم شروطًا معدّلة.",
                        "You are the current recipient. Accept it, decline with a clear reason, or propose revised terms.",
                      )
                    : copy(
                        "أنت مقدم العرض الحالي. الرد عند الطرف الآخر، وتقدر تقدم نسخة معدّلة تحفظ النسخة السابقة في التاريخ.",
                        "You proposed the current offer. The other party can respond; you may submit revised terms while preserving the previous version in history.",
                      )}
                </p>
              )}
            </CardContent>
          </Card>
          <Card><CardContent>
            <DealBrief requirements={deal.approvedBrief.content.requirements} campaignId={deal.campaignId} briefVersion={deal.briefVersion} />
          </CardContent></Card>
          {negotiating && (
            <Card>
              <CardHeader>
                <CardTitle><h2>
                  {copy("راجع العرض ورد عليه", "Review and respond")}
                </h2></CardTitle>
                <CardDescription>
                  {copy(
                    "القبول يثبت اتفاقًا بالنسخة المختارة، ثم يؤكد كل طرف الاتفاق بشكل مستقل.",
                    "Acceptance freezes an agreement in the selected language. Each party then confirms it separately.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {recipient && (
                  <fieldset disabled={locked} className="space-y-4">
                    <label
                      htmlFor={`${prefix}-agreement-language`}
                      className="grid gap-2 text-sm font-medium"
                    >
                      {copy("لغة الاتفاق المراجعة", "Reviewed agreement language")}
                      <select
                        aria-label={copy(
                          "لغة الاتفاق المراجعة",
                          "Reviewed agreement language",
                        )}
                        id={`${prefix}-agreement-language`}
                        value={agreementLanguage}
                        onChange={(event) => {
                          setAgreementLanguage(
                            event.target.value as "" | "ar" | "en",
                          );
                          setAcceptRead(false);
                        }}
                        className="min-h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
                      >
                        <option value="">
                          {copy(
                            "اختر اللغة صراحةً",
                            "Explicitly choose a language",
                          )}
                        </option>
                        <option
                          value="ar"
                          disabled={!currentTemplate?.translations.ar}
                        >
                          العربية
                        </option>
                        <option
                          value="en"
                          disabled={!currentTemplate?.translations.en}
                        >
                          English
                        </option>
                      </select>
                      <span className="text-xs font-normal text-muted-foreground">
                        {copy(
                          "لا يتم ترجمة الشروط تلقائيًا؛ يلزم توفر نص مراجع باللغة التي تختارها.",
                          "Terms are never automatically translated; reviewed text must exist in the chosen language.",
                        )}
                      </span>
                    </label>
                    <Check checked={acceptRead} onChange={setAcceptRead}>
                      {copy(
                        `راجعت المخرجات والمبلغ والحقوق والشروط في العرض ${deal.currentOffer.version}، وأريد قبول هذه النسخة.`,
                        `I reviewed the deliverables, amount, rights and terms in offer ${deal.currentOffer.version}, and want to accept this version.`,
                      )}
                    </Check>
                    <Button
                      disabled={
                        !acceptRead ||
                        !agreementLanguage ||
                        !currentTemplate?.translations[agreementLanguage] ||
                        commercial.blockedReasons.length > 0
                      }
                      onClick={() =>
                        command("ACCEPT", {
                          offerId: deal.currentOffer.id,
                          expectedOfferVersion: deal.currentOffer.version,
                          language: agreementLanguage,
                        })
                      }
                    >
                      {copy(
                        "اقبل العرض وثبّت الاتفاق",
                        "Accept offer and freeze agreement",
                      )}
                    </Button>
                  </fieldset>
                )}
                {commercial.blockedReasons.length > 0 && (
                  <div
                    className="space-y-2 rounded-xl bg-muted p-4 text-sm"
                    role="status"
                  >
                    {commercial.blockedReasons.map((code) => (
                      <p key={code}>{errorCopy(code)}</p>
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    setCounterOpen((open) => !open);
                    setCounterBase({
                      version: deal.version,
                      offerId: deal.currentOffer.id,
                      offerVersion: deal.currentOffer.version,
                    });
                    setCompareRequired(false);
                  }}
                >
                  {counterOpen
                    ? copy("أخفِ محرر الشروط", "Hide terms editor")
                    : copy("اقترح شروطًا معدّلة", "Propose revised terms")}
                </Button>
                {recipient && (
                  <details inert={!hydrated} className="rounded-xl border border-border p-4">
                    <summary className="min-h-12 cursor-pointer py-3 font-medium">
                      {copy("ارفض العرض بسبب واضح", "Decline with a clear reason")}
                    </summary>
                    <fieldset disabled={locked} className="space-y-4 py-4">
                      <TextEntry
                        label={copy("سبب الرفض", "Decline reason")}
                        value={reason}
                        onChange={setReason}
                      />
                      <Button
                        variant="outline"
                        disabled={!reason.text.trim()}
                        onClick={() =>
                          command("DECLINE", {
                            offerId: deal.currentOffer.id,
                            expectedOfferVersion: deal.currentOffer.version,
                            reason,
                          })
                        }
                      >
                        {copy("ارفض هذا العرض", "Decline this offer")}
                      </Button>
                    </fieldset>
                  </details>
                )}
              </CardContent>
            </Card>
          )}
          {counterOpen && negotiating && (
            <section className="space-y-6" aria-labelledby={`${prefix}-counter`}>
              <h2 id={`${prefix}-counter`} className="text-2xl font-semibold">
                {copy("شروطك المعدّلة", "Your revised terms")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {copy(
                  "إرسال الشروط المعدّلة ينشئ نسخة جديدة للطرف الآخر؛ لا يعدّل تاريخ العروض السابقة.",
                  "Sending revised terms creates a new version for the other party; previous offers remain unchanged.",
                )}
              </p>
              {compareRequired && (
                <div className="space-y-4 rounded-2xl border border-border bg-muted p-5">
                  <p>
                    {copy(
                      "مدخلاتك محفوظة في المحرر. قارنها بالعرض الحالي أعلاه قبل الإرسال بناءً على النسخة الحالية.",
                      "Your editor entries are preserved. Compare them with the current offer above before submitting against the current version.",
                    )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCounterBase({
                        version: deal.version,
                        offerId: deal.currentOffer.id,
                        offerVersion: deal.currentOffer.version,
                      });
                      setCompareRequired(false);
                    }}
                  >
                    {copy(
                      "راجعت النسخة الحالية وأحتفظ بمدخلاتي",
                      "I reviewed the current version and will keep my entries",
                    )}
                  </Button>
                </div>
              )}
              <DealEditor
                key={editorKey}
                initialTerms={draft?.terms ?? deal.currentOffer.terms}
                templates={commercial.templates}
                mandatoryPolicyVersionIds={commercial.mandatoryPolicyVersionIds}
                busy={locked}
                blockedReasons={[
                  ...commercial.blockedReasons,
                  ...(compareRequired ? ["STALE_VERSION"] : []),
                ]}
                submitLabel={copy("أرسل الشروط المعدّلة", "Send revised terms")}
                onSave={saveDraft}
                onSubmit={(terms) =>
                  command(
                    "COUNTER",
                    {
                      offerId: counterBase.offerId,
                      expectedOfferVersion: counterBase.offerVersion,
                      terms,
                    },
                    counterBase.version,
                  )
                }
              />
            </section>
          )}
          {deal.agreement && (
            <Card>
              <CardHeader>
                <CardTitle><h2>
                  {copy("الاتفاق المثبّت", "Frozen agreement")} ·{" "}
                  {deal.agreement.version}
                </h2></CardTitle>
                <CardDescription>
                  {copy(
                    "هذه هي النسخة التي نتجت عن قبول العرض. نصها وهويات الطرفين والشروط ثابتة. التأكيد هنا سجل داخل التطبيق.",
                    "This is the version frozen when the offer was accepted. Its text, parties and terms remain unchanged. Confirmation is an in-app record.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-7">
                <div className="grid gap-4 rounded-xl bg-muted p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {copy("الشركة", "Brand")}
                    </p>
                    <p dir="auto">{deal.agreement.partiesSnapshot.brandName}</p>
                    <p className="text-sm">
                      {countryLabel(
                        deal.agreement.brandCountryCode,
                        isAr ? "ar" : "en",
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {copy("الصانع", "Creator")}
                    </p>
                    <p dir="auto">{deal.agreement.partiesSnapshot.creatorName}</p>
                    <p>
                      <bdi dir="ltr">
                        @{deal.agreement.partiesSnapshot.creatorHandle}
                      </bdi>{" "}
                      ·{" "}
                      {countryLabel(
                        deal.agreement.creatorCountryCode,
                        isAr ? "ar" : "en",
                      )}
                    </p>
                  </div>
                  <p className="text-sm sm:col-span-2">
                    {copy("أسواق الحملة", "Campaign markets")}:{" "}
                    {deal.agreement.campaignMarketCountryCodes
                      .map((code) => countryLabel(code, isAr ? "ar" : "en"))
                      .join(" · ")}
                  </p>
                </div>
                <DealTerms terms={deal.agreement.terms} />
                <section aria-labelledby={`${prefix}-agreement-text`}>
                  <h3
                    id={`${prefix}-agreement-text`}
                    className="mb-4 font-semibold"
                  >
                    {copy("نص الشروط كما تمت مراجعته", "Terms exactly as reviewed")}{" "}
                    · {deal.agreement.language === "ar" ? "العربية" : "English"}
                  </h3>
                  <div
                    className="whitespace-pre-wrap break-words rounded-2xl border border-border p-5"
                    dir={deal.agreement.language === "ar" ? "rtl" : "ltr"}
                    lang={deal.agreement.language}
                  >
                    {deal.agreement.content}
                  </div>
                </section>
                <details inert={!hydrated} className="rounded-xl border border-border p-4">
                  <summary className="min-h-12 cursor-pointer py-3 font-medium">
                    {copy(
                      "مرجع النسخة وتفاصيل السياسات",
                      "Version reference and policy details",
                    )}
                  </summary>
                  <div className="min-w-0 space-y-4 py-4 text-sm">
                    <p>{copy("بصمة الاتفاق", "Agreement hash")}</p>
                    <p dir="ltr" className="break-all">
                      {deal.agreement.contentHash}
                    </p>
                    <p>
                      {copy("العرض المقبول", "Accepted offer")}:{" "}
                      <bdi dir="ltr" className="break-all">
                        {deal.agreement.acceptedOfferId}
                      </bdi>
                    </p>
                    <p>
                      {copy("مرجع السياسة", "Policy reference")}:{" "}
                      <bdi dir="ltr" className="break-all">
                        {deal.agreement.policyVersion}
                      </bdi>
                    </p>
                    <pre
                      className="max-w-full whitespace-pre-wrap break-all rounded-xl bg-muted p-3 text-xs"
                      dir="ltr"
                    >
                      {JSON.stringify(
                        {
                          marketPolicyVersions: deal.agreement.marketPolicyVersions,
                          reviewedLicenceSnapshots:
                            deal.agreement.reviewedLicenceSnapshots,
                        },
                        null,
                        2,
                      )}
                    </pre>
                    {timestamp(deal.agreement.acceptedAt)}
                  </div>
                </details>
                <ul className="space-y-3">
                  {deal.confirmations
                    .filter((row) => row.version === deal.agreement?.version)
                    .map((row) => (
                      <li
                        key={row.userId}
                        className="rounded-xl bg-muted p-4 text-sm"
                      >
                        {participant(row.userId)} ·{" "}
                        {copy("أكد الاتفاق", "Confirmed agreement")} {row.version}
                        <span className="mt-2 block">
                          {timestamp(row.confirmedAt)}
                        </span>
                      </li>
                    ))}
                </ul>
                {deal.status === "ACCEPTED" && !ownConfirmation && (
                  <fieldset disabled={locked} className="space-y-4">
                    <Check checked={agreementRead} onChange={setAgreementRead}>
                      {copy(
                        `قرأت الاتفاق المثبّت ${deal.agreement.version} كاملًا مع الشروط والحقوق وهويات الطرفين. أؤكد هذه النسخة بشكل مستقل.`,
                        `I read frozen agreement ${deal.agreement.version} in full, including terms, rights and party identities. I independently confirm this exact version.`,
                      )}
                    </Check>
                    <Button
                      disabled={
                        !agreementRead ||
                        !commercial.templates.some(
                          (template) =>
                            template.id ===
                              deal.agreement!.governingTermsVersionId &&
                            template.translations[deal.agreement!.language],
                        ) ||
                        commercial.blockedReasons.length > 0
                      }
                      onClick={() =>
                        command("CONFIRM", {
                          agreementId: deal.agreement!.id,
                          expectedAgreementVersion: deal.agreement!.version,
                        })
                      }
                    >
                      {copy("أكّد هذا الاتفاق", "Confirm this agreement")}
                    </Button>
                    {commercial.blockedReasons.map((code) => (
                      <p key={code} className="text-sm text-muted-foreground">
                        {errorCopy(code)}
                      </p>
                    ))}
                  </fieldset>
                )}
                {deal.status === "ACCEPTED" && ownConfirmation && (
                  <p role="status" className="rounded-xl bg-muted p-4">
                    {copy(
                      "تم تأكيدك. التنفيذ يبدأ بعد تأكيد الطرف الآخر أيضًا.",
                      "Your confirmation is recorded. Execution begins after the other party also confirms.",
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {(deal.deliveredAt ||
            (role === "CREATOR" && deal.status === "AGREED") ||
            (role === "BRAND" && deal.status === "DELIVERED")) && (
            <Card>
              <CardHeader>
                <CardTitle><h2>
                  {copy("التسليم والاكتمال", "Delivery and completion")}
                </h2></CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {evidenceText && (
                  <div className="space-y-3 rounded-xl bg-muted p-4">
                    <p className="text-sm font-medium">
                      {copy(
                        "إثبات التسليم الذي أرسله الصانع",
                        "Delivery evidence submitted by the creator",
                      )}
                    </p>
                    <p
                      className="whitespace-pre-wrap break-words"
                      dir="auto"
                      lang={evidenceText.language ?? undefined}
                    >
                      {evidenceText.text}
                    </p>
                    {Array.isArray(evidence.links) &&
                      evidence.links
                        .filter(
                          (link): link is string =>
                            typeof link === "string" && /^https:\/\//.test(link),
                        )
                        .map((link) => (
                          <a
                            key={link}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            dir="ltr"
                            className="block min-h-12 break-all py-3 underline underline-offset-4"
                          >
                            {link}
                          </a>
                        ))}
                    {deal.deliveredAt && timestamp(deal.deliveredAt)}
                  </div>
                )}
                {role === "CREATOR" && deal.status === "AGREED" && (
                  <fieldset disabled={locked} className="space-y-4">
                    <TextEntry
                      label={copy(
                        "تفاصيل إثبات التسليم",
                        "Delivery evidence details",
                      )}
                      value={delivery}
                      onChange={setDelivery}
                    />
                    <label className="grid gap-2 text-sm font-medium">
                      {copy(
                        "روابط الإثبات — رابط HTTPS لكل سطر (اختياري)",
                        "Evidence links — one HTTPS link per line (optional)",
                      )}
                      <Textarea
                        rows={3}
                        value={deliveryLinks}
                        dir="ltr"
                        onChange={(event) => setDeliveryLinks(event.target.value)}
                      />
                    </label>
                    <Button
                      disabled={!delivery.text.trim()}
                      onClick={() =>
                        command("DELIVER", {
                          evidence: {
                            text: delivery,
                            links: deliveryLinks
                              .split(/\r?\n/)
                              .map((value) => value.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                    >
                      {copy(
                        "أبلغ عن التسليم مع الإثبات",
                        "Report delivery with evidence",
                      )}
                    </Button>
                  </fieldset>
                )}
                {role === "BRAND" && deal.status === "DELIVERED" && (
                  <fieldset disabled={locked} className="space-y-4">
                    <Check checked={completeRead} onChange={setCompleteRead}>
                      {copy(
                        "راجعت التسليم وأريد تسجيل اكتمال الصفقة.",
                        "I reviewed the delivery and want to record completion.",
                      )}
                    </Check>
                    <Button
                      disabled={!completeRead}
                      onClick={() => command("COMPLETE")}
                    >
                      {copy("سجّل اكتمال الصفقة", "Record completion")}
                    </Button>
                  </fieldset>
                )}
                {deal.completedAt && (
                  <p>
                    {copy("سُجل الاكتمال", "Completion recorded")} ·{" "}
                    {timestamp(deal.completedAt)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {moneyStage && (
            <Card>
              <CardHeader>
                <CardTitle><h2>
                  {copy(
                    "إبلاغ الدفع والاستلام",
                    "Payment and receipt declarations",
                  )}
                </h2></CardTitle>
                <CardDescription>
                  {copy(
                    "هذه تصريحات من الطرفين. إنفيم لا يحصّل الأموال ولا يؤكد انتقالها أو يوفر ضمانًا ماليًا.",
                    "These are party declarations. Infame does not collect funds, verify transfers or provide escrow.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-muted p-4">
                    <h3 className="font-medium">
                      {copy("إبلاغ الشركة عن الدفع", "Brand's payment declaration")}
                    </h3>
                    <p className="mt-2 text-sm">
                      {deal.brandPaymentReportedAt
                        ? copy(
                            "أبلغت الشركة عن الدفع — تصريح ذاتي",
                            "The brand reported payment — self-reported",
                          )
                        : copy(
                            "لم تسجل الشركة إبلاغًا بعد",
                            "No brand declaration yet",
                          )}
                    </p>
                    {deal.brandPaymentReportedAt &&
                      timestamp(deal.brandPaymentReportedAt)}
                  </div>
                  <div className="rounded-xl bg-muted p-4">
                    <h3 className="font-medium">
                      {copy(
                        "إبلاغ الصانع عن الاستلام",
                        "Creator's receipt declaration",
                      )}
                    </h3>
                    <p className="mt-2 text-sm">
                      {deal.creatorReceiptReportedAt
                        ? copy(
                            "أبلغ الصانع عن الاستلام — تصريح ذاتي",
                            "The creator reported receipt — self-reported",
                          )
                        : copy(
                            "لم يسجل الصانع إبلاغًا بعد",
                            "No creator declaration yet",
                          )}
                    </p>
                    {deal.creatorReceiptReportedAt &&
                      timestamp(deal.creatorReceiptReportedAt)}
                  </div>
                </div>
                {!myPaymentReported && (
                  <fieldset disabled={locked} className="space-y-4">
                    <Check checked={paymentRead} onChange={setPaymentRead}>
                      {role === "BRAND"
                        ? copy(
                            "أصرح بأنني دفعت المقابل للطرف الآخر، وأفهم أن إنفيم لا يتحقق من هذا الدفع.",
                            "I declare that I paid the other party and understand that Infame does not verify this payment.",
                          )
                        : copy(
                            "أصرح بأنني استلمت المقابل، وأفهم أن إنفيم لا يتحقق من هذا الاستلام.",
                            "I declare that I received payment and understand that Infame does not verify this receipt.",
                          )}
                    </Check>
                    <Button
                      variant="outline"
                      disabled={!paymentRead}
                      onClick={() =>
                        command(
                          role === "BRAND" ? "DECLARE_PAID" : "DECLARE_RECEIVED",
                        )
                      }
                    >
                      {role === "BRAND"
                        ? copy("أبلغ بأنني دفعت", "Declare that I paid")
                        : copy("أبلغ بأنني استلمت", "Declare that I received")}
                    </Button>
                  </fieldset>
                )}
              </CardContent>
            </Card>
          )}
          {deal.status === "COMPLETED" && (
            <Card>
              <CardHeader>
                <CardTitle><h2>
                  {copy("تقييم التعاون", "Collaboration feedback")}
                </h2></CardTitle>
                <CardDescription>
                  {copy(
                    "التقييم مختوم حتى يرسل الطرفان تقييميهما، أو تمر ٧ أيام كاملة من أول تقييم. لا يظهر لك تقييم الطرف الآخر قبل ذلك.",
                    "Feedback is sealed until both parties submit, or seven full days pass after the first rating. The other party's rating remains hidden until then.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {deal.ratingsRevealAt && !deal.ratingsRevealed && (
                  <p className="text-sm">
                    {copy(
                      "وقت الكشف إن لم يقيّم الطرفان قبل ذلك (UTC)",
                      "Reveal time if both parties do not rate earlier (UTC)",
                    )}
                    : {timestamp(deal.ratingsRevealAt)}
                  </p>
                )}
                {deal.ratings.map((rating) => (
                  <article
                    key={rating.id}
                    className="space-y-3 rounded-xl border border-border p-4"
                  >
                    <p className="font-semibold">
                      {participant(rating.authorUserId)} ·{" "}
                      <bdi dir="ltr">{rating.stars} / 5</bdi> ·{" "}
                      {deal.ratingsRevealed
                        ? copy("مكشوف", "Revealed")
                        : copy("تقييمك المختوم", "Your sealed rating")}
                    </p>
                    {rating.comment && (
                      <p
                        className="whitespace-pre-wrap break-words"
                        dir="auto"
                        lang={rating.comment.language ?? undefined}
                      >
                        {rating.comment.text}
                      </p>
                    )}
                    {timestamp(rating.submittedAt)}
                  </article>
                ))}
                {!ownRating && (
                  <fieldset disabled={locked} className="space-y-4">
                    <label
                      htmlFor={`${prefix}-stars`}
                      className="grid gap-2 text-sm font-medium"
                    >
                      {copy("تقييمك من ١ إلى ٥", "Your rating from 1 to 5")}
                      <select
                        aria-label={copy(
                          "تقييمك من ١ إلى ٥",
                          "Your rating from 1 to 5",
                        )}
                        id={`${prefix}-stars`}
                        value={stars}
                        onChange={(event) => setStars(Number(event.target.value))}
                        className="min-h-12 rounded-xl border border-input bg-background px-3 text-base"
                      >
                        <option value={0}>
                          {copy("اختر تقييمك", "Choose your rating")}
                        </option>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={value}>
                            {value} / 5
                          </option>
                        ))}
                      </select>
                    </label>
                    <TextEntry
                      label={copy("تعليقك (اختياري)", "Your comment (optional)")}
                      value={ratingComment}
                      onChange={setRatingComment}
                    />
                    <Check checked={ratingRead} onChange={setRatingRead}>
                      {copy(
                        "هذا تقييمي النهائي لهذه الصفقة، وأفهم سياسة الكشف.",
                        "This is my final rating for this deal, and I understand the reveal policy.",
                      )}
                    </Check>
                    <Button
                      disabled={!stars || !ratingRead}
                      onClick={() =>
                        command("RATE", {
                          stars,
                          comment: ratingComment.text ? ratingComment : null,
                        })
                      }
                    >
                      {copy("أرسل تقييمك المختوم", "Submit your sealed rating")}
                    </Button>
                  </fieldset>
                )}
                {ownRating && !deal.ratingsRevealed && (
                  <p role="status" className="rounded-xl bg-muted p-4">
                    {copy(
                      "انحفظ تقييمك. تقييم الطرف الآخر مختوم حاليًا.",
                      "Your rating is saved. The other party's rating is currently sealed.",
                    )}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {["OFFERED", "COUNTERED", "ACCEPTED", "AGREED"].includes(deal.status) && (
            <section className="space-y-4">
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => setCancelOpen((open) => !open)}
              >
                {cancelOpen
                  ? copy("أخفِ الإلغاء", "Hide cancellation")
                  : copy("ألغِ الصفقة بسبب واضح", "Cancel with a clear reason")}
              </Button>
              {cancelOpen && (
                <fieldset
                  disabled={locked}
                  className="space-y-4 rounded-2xl border border-border p-5"
                >
                  <p className="text-sm text-muted-foreground">
                    {copy(
                      "يُحفظ سبب الإلغاء في تاريخ الصفقة. الالتزامات المقبولة سابقًا تظل مسجلة.",
                      "The cancellation reason remains in the deal history. Previously accepted obligations remain recorded.",
                    )}
                  </p>
                  <TextEntry
                    label={copy("سبب الإلغاء", "Cancellation reason")}
                    value={reason}
                    onChange={setReason}
                  />
                  <Button
                    variant="destructive"
                    disabled={!reason.text.trim()}
                    onClick={() => command("CANCEL", { reason })}
                  >
                    {copy("أكّد إلغاء الصفقة", "Confirm cancellation")}
                  </Button>
                </fieldset>
              )}
            </section>
          )}
        </div>
        <aside className={styles.rail}>
          <Card>
            <CardHeader>
              <CardTitle><h2>{copy("رسائل الصفقة", "Deal messages")}</h2></CardTitle>
              <CardDescription>
                {copy(
                  "للطرفين الأصليين فقط. الرسائل تبقى بلغتها الأصلية حتى بعد انتهاء الصفقة.",
                  "For the original parties only. Messages keep their original language, including after the deal ends.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {deal.messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {copy("ما فيه رسائل بعد", "No messages yet")}
                </p>
              )}
              <ol className="space-y-4">
                {deal.messages.map((row) => (
                  <li
                    key={row.id}
                    className="space-y-3 rounded-xl border border-border p-4"
                  >
                    <p className="text-sm font-medium">
                      {participant(row.senderUserId)}
                    </p>
                    <p
                      className="whitespace-pre-wrap break-words"
                      dir="auto"
                      lang={row.text.language ?? undefined}
                    >
                      {row.text.text}
                    </p>
                    {timestamp(row.createdAt)}
                  </li>
                ))}
              </ol>
              <fieldset disabled={locked} className="space-y-4">
                <TextEntry
                  label={copy("رسالتك", "Your message")}
                  value={message}
                  onChange={setMessage}
                />
                <Button
                  disabled={!message.text.trim()}
                  onClick={() => command("MESSAGE", { text: message })}
                >
                  {copy("أرسل الرسالة", "Send message")}
                </Button>
              </fieldset>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle><h2>
                {copy("تاريخ العروض والإجراءات", "Offer and action history")}
              </h2></CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {deal.offers.map((offer) => (
                  <details
                    inert={!hydrated}
                    key={offer.id}
                    className="rounded-xl border border-border p-4"
                  >
                    <summary className="min-h-12 cursor-pointer py-3 font-medium">
                      {copy("العرض", "Offer")} {offer.version} ·{" "}
                      {offer.status === "ACCEPTED" ? copy("مقبول", "Accepted") : status(offer.status)} · {participant(offer.proposerUserId)}
                    </summary>
                    <div className="space-y-5 py-4">
                      <p className="text-sm">
                        {copy("المستلم", "Recipient")}:{" "}
                        {participant(offer.recipientUserId)}
                      </p>
                      <DealTerms terms={offer.terms} />
                      {timestamp(offer.createdAt)}
                    </div>
                  </details>
                ))}
              </div>
              <ol className="space-y-3">
                {deal.events.map((event) => {
                  const payload = record(event.payload),
                    eventReason = original(payload.reason);
                  return (
                    <li
                      key={event.id}
                      className="space-y-2 border-s-2 border-border ps-4"
                    >
                      <p className="text-sm">
                        {eventNames[event.type]?.[isAr ? 0 : 1] ??
                          copy("إجراء مسجل", "Recorded action")}{" "}
                        · {participant(event.actorUserId)}{" "}
                      </p>
                      {eventReason && (
                        <p
                          className="whitespace-pre-wrap break-words text-sm"
                          dir="auto"
                          lang={eventReason.language ?? undefined}
                        >
                          {eventReason.text}
                        </p>
                      )}
                      {timestamp(event.occurredAt)}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function DealProgress({ deal }: { deal: DealDTO }) {
  const { copy, status } = useDealCopy(),
    titleId = useId();
  const hasEvent = (type: string) =>
    deal.events.some((event) => event.type === type);
  const bothConfirmed =
    new Set(
      deal.confirmations
        .filter((row) => row.version === deal.agreement?.version)
        .map((row) => row.userId),
    ).size === 2;
  const stages = [
    {
      label: copy("العرض", "Offer"),
      recorded: deal.offers.length > 0 || hasEvent("deal.offered"),
    },
    {
      label: copy("قبول العرض", "Offer acceptance"),
      recorded:
        !!deal.agreement || hasEvent("deal.accepted") ||
        ["ACCEPTED", "AGREED", "DELIVERED", "COMPLETED"].includes(deal.status),
    },
    {
      label: copy("تأكيد الطرفين", "Both confirmations"),
      recorded:
        bothConfirmed || hasEvent("deal.agreed") ||
        ["AGREED", "DELIVERED", "COMPLETED"].includes(deal.status),
    },
    {
      label: copy("التسليم", "Delivery"),
      recorded:
        !!deal.deliveredAt || hasEvent("deal.delivered") ||
        ["DELIVERED", "COMPLETED"].includes(deal.status),
    },
    {
      label: copy("الاكتمال", "Completion"),
      recorded:
        !!deal.completedAt || hasEvent("deal.completed") ||
        deal.status === "COMPLETED",
    },
  ];
  const stopped = ["CANCELLED", "DECLINED"].includes(deal.status);
  const current = stopped ? -1 : stages.reduce(
    (last, stage, index) => stage.recorded ? index : last, -1,
  );
  return (
    <section className={styles.progress} aria-labelledby={titleId}>
      <h2 id={titleId}>
        {copy("مراحل الصفقة المحفوظة", "Recorded deal stages")}
      </h2>
      <ol className={styles.steps}>
        {stages.map((stage, index) => (
          <li
            key={index}
            className={`${styles.step} ${stage.recorded ? styles.recorded : ""} ${index === current ? styles.current : ""}`}
            aria-current={index === current ? "step" : undefined}
          >
            <span className={styles.stepLabel}>
              <span className={styles.circle} aria-hidden="true">
                {stage.recorded ? "✓" : index + 1}
              </span>
              <span className={styles.stepText}>
                {stage.label}
                <span className="sr-only">
                  {" · "}{stage.recorded
                    ? copy("مسجلة", "Recorded")
                    : copy("لم تصل إليها الصفقة", "Not reached")}
                </span>
              </span>
            </span>
            {index < stages.length - 1 && (
              <span
                aria-hidden="true"
                className={`${styles.connector} ${stage.recorded && stages[index + 1].recorded ? styles.recordedConnector : ""}`}
              />
            )}
          </li>
        ))}
      </ol>
      {stopped && (
        <p className={styles.stopped}>
          {status(deal.status)} · {copy(
            "الصفقة متوقفة. المراحل المعلمة فقط مسجلة في تاريخها.",
            "The deal has stopped. Only marked stages are recorded in its history.",
          )}
        </p>
      )}
    </section>
  );
}
