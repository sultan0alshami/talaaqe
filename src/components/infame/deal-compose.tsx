"use client";
import Link from "next/link";
import styles from "./deal-layout.module.css";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { DealComposeDTO } from "@/lib/deals/readiness";
import type { DealDTO } from "@/lib/deals/service";
import type { OfferDraftDTO } from "@/lib/deals/drafts";
import type { OfferTerms } from "@/lib/contracts/offers";
import { useDealCopy } from "./deal-copy";
import { DealEditor, type DraftTerms } from "./deal-editor";
import { DealTerms } from "./deal-terms";
import { useDealRequest } from "./deal-request";

export function DealCompose({
  initialContext,
  actorUserId,
}: {
  initialContext: DealComposeDTO;
  actorUserId: string;
}) {
  const { copy, errorCopy } = useDealCopy(),
    router = useRouter();
  const [context, setContext] = useState(initialContext),
    [editorKey, setEditorKey] = useState(0),
    [notice, setNotice] = useState<string | null>(null),
    [readBusy, setReadBusy] = useState(false);
  const [prepared, setPrepared] = useState<OfferTerms | null>(null),
    [reviewed, setReviewed] = useState(false),
    [compareRequired, setCompareRequired] = useState(false);
  const request = useDealRequest(
      actorUserId,
      `compose:${context.campaign.id}:${context.creator.id}`,
    ),
    readFlight = useRef(false);
  const locked = request.busy || !!request.pending || readBusy;
  const composeQuery = new URLSearchParams({
    campaignId: context.campaign.id,
    creatorId: context.creator.id,
    ...(context.matchRunId ? { matchRunId: context.matchRunId } : {}),
  });
  function receive(result: { draft?: OfferDraftDTO; deal?: DealDTO }) {
    if (result.draft) {
      setContext((previous) => ({ ...previous, draft: result.draft! }));
      setEditorKey((key) => key + 1);
      setPrepared(null);
      setReviewed(false);
      setNotice(
        copy(
          "انحفظت مسودة عرضك الخاصة. تقدر ترجع لها لاحقًا.",
          "Your private offer draft is saved. You can resume later.",
        ),
      );
    }
    if (result.deal)
      router.push(`/brand/deals/${encodeURIComponent(result.deal.id)}`);
  }
  async function save(patch: DraftTerms) {
    setNotice(null);
    await request.run<{ draft: OfferDraftDTO }>(
      "/api/deals/drafts",
      {
        operationKey: crypto.randomUUID(),
        expectedRevision: context.draft?.revision ?? 0,
        campaignId: context.campaign.id,
        creatorId: context.creator.id,
        patch,
      },
      receive,
    );
  }
  async function send() {
    if (
      !prepared ||
      !reviewed ||
      !context.readiness.canSend ||
      compareRequired ||
      !context.campaign.currentBriefVersion
    )
      return;
    setNotice(null);
    await request.run<{ deal: DealDTO }>(
      "/api/deals",
      {
        operationKey: crypto.randomUUID(),
        campaignId: context.campaign.id,
        creatorId: context.creator.id,
        expectedCampaignRevision: context.campaign.revision,
        expectedBriefVersion: context.campaign.currentBriefVersion,
        origin: context.origin,
        matchRunId: context.matchRunId,
        terms: prepared,
      },
      receive,
    );
  }
  async function reload() {
    if (readFlight.current || locked) return;
    readFlight.current = true;
    setReadBusy(true);
    request.setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/deals/compose?${composeQuery}`, {
          cache: "no-store",
        }),
        body = await response.json();
      if (!response.ok) {
        request.setError(body.error?.code ?? "INTERNAL_ERROR");
        return;
      }
      setContext(body.data);
      setPrepared(null);
      setReviewed(false);
      setCompareRequired(true);
      setNotice(
        copy(
          "تم تحميل الحملة والشروط الحالية. مدخلاتك باقية في المحرر؛ قارنها قبل الحفظ أو الإرسال.",
          "Current campaign and terms are loaded. Your editor entries are preserved; compare them before saving or sending.",
        ),
      );
    } catch {
      request.setError("NETWORK_READ");
    } finally {
      readFlight.current = false;
      setReadBusy(false);
    }
  }
  return (
    <div className={`${styles.page} ${styles.compose}`}>
      <header className={styles.header}>
        <Link
          href={`/brand/campaigns/${encodeURIComponent(context.campaign.id)}`}
          className={`${styles.back} inline-flex min-h-12 items-center underline underline-offset-4`}
        >
          {copy("ارجع للحملة", "Back to campaign")}
        </Link>
        <div className={styles.headerRow}>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold sm:text-4xl">
              {copy("جهّز عرض التعاون", "Prepare a collaboration offer")}
            </h1>
            <p className={`${styles.headerCopy} max-w-2xl text-muted-foreground`}>
              {copy(
                "اجمع الشروط بوضوح واحفظها على مهلك. ما يُرسل شيء للطرف الآخر إلا بعد مراجعتك وإرسالك الصريح.",
                "Prepare clear terms at your own pace and save them. Nothing goes to the other party until you explicitly review and send it.",
              )}
            </p>
          </div>
          <Button variant="outline" disabled={locked} onClick={reload}>
            {copy("حمّل الخيارات الحالية", "Load current options")}
          </Button>
        </div>
      </header>
      <Card className={styles.context}>
        <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">
              {copy("الحملة", "Campaign")}
            </p>
            <h2 className="mt-2 break-words text-xl font-semibold" dir="auto">
              {context.campaign.title ||
                copy("مسودة بدون عنوان", "Untitled draft")}
            </h2>
            <p className="mt-2 text-sm">
              {copy("نسخة الحملة", "Campaign revision")}{" "}
              {context.campaign.revision} ·{" "}
              {copy("نسخة الموجز", "Brief version")}{" "}
              {context.campaign.currentBriefVersion ??
                copy("غير معتمد", "Unapproved")}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {copy("الصانع", "Creator")}
            </p>
            <h2 className="mt-2 break-words text-xl font-semibold" dir="auto">
              {context.creator.displayName}
            </h2>
            <p className="mt-2 break-all" dir="ltr">
              @{context.creator.handle}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {context.creator.claimed
                ? copy(
                    "ملف مرتبط بصاحبه؛ الأهلية يعاد فحصها وقت الإرسال.",
                    "Claimed profile; eligibility is rechecked when sending.",
                  )
                : copy(
                    "ملف غير مُطالب به بعد؛ لا يمكن إرسال عرض تنفيذي.",
                    "Unclaimed profile; an executable offer cannot be sent.",
                  )}
            </p>
          </div>
          {context.requirements && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {copy("عملة الحملة", "Campaign currency")}:{" "}
              <bdi dir="ltr">{context.requirements.budget.currencyCode}</bdi> ·{" "}
              {copy("أوقات الحملة بتوقيت UTC", "Campaign times in UTC")}:{" "}
              <bdi dir="ltr" className="break-all">
                {context.requirements.period.startsAt} →{" "}
                {context.requirements.period.endsAt}
              </bdi>{" "}
              · <bdi dir="ltr">{context.requirements.period.timeZone}</bdi>
            </p>
          )}
        </CardContent>
      </Card>
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
            <Button
              variant="outline"
              disabled={request.busy}
              onClick={() => request.retry(receive)}
            >
              {copy("أعد نفس الطلب بأمان", "Retry the same request safely")}
            </Button>
          )}
        </div>
      )}
      {compareRequired && (
        <div className="space-y-4 rounded-2xl border border-border bg-muted p-5">
          <p>
            {copy(
              "قارن مدخلاتك بالحملة والشروط الحالية أعلاه. لن تُستبدل مدخلاتك تلقائيًا.",
              "Compare your entries with the current campaign and terms above. Your entries are never automatically replaced.",
            )}
          </p>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => setCompareRequired(false)}
          >
            {copy(
              "راجعت النسخة الحالية وأحتفظ بمدخلاتي",
              "I reviewed the current version and will keep my entries",
            )}
          </Button>
          {context.draft && (
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => {
                setEditorKey((key) => key + 1);
                setCompareRequired(false);
              }}
            >
              {copy(
                "استبدل المحرر بالمسودة المحفوظة",
                "Replace editor with saved draft",
              )}
            </Button>
          )}
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.main}>
          <DealEditor
            key={editorKey}
            initialTerms={context.draft?.terms ?? {}}
            templates={context.templates}
            mandatoryPolicyVersionIds={
              context.requirements?.mandatoryPolicyVersionIds ?? []
            }
            busy={locked || compareRequired}
            blockedReasons={context.readiness.blockedReasons}
            submitLabel={copy(
              "راجع العرض قبل الإرسال",
              "Review offer before sending",
            )}
            onSave={save}
            onSubmit={async (terms) => {
              setPrepared(terms);
              setReviewed(false);
            }}
            onDirty={() => {
              setPrepared(null);
              setReviewed(false);
            }}
          />
        </div>
        <aside className={styles.rail}>
          <Card>
            <CardHeader>
              <CardTitle><h2>{copy("راجع ثم أرسل", "Review, then send")}</h2></CardTitle>
              <CardDescription>
                {copy(
                  "المسودة خاصة بك. العرض المرسل يثبت نسخة ويظهر للطرف الآخر.",
                  "The draft is private to you. Sending creates a version visible to the other party.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {prepared ? (
                <DealTerms terms={prepared} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {copy(
                    "أكمل الشروط واختر مراجعة العرض لعرض النسخة التي سترسلها هنا.",
                    "Complete the terms and choose review to show the exact offer you will send here.",
                  )}
                </p>
              )}
              <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
                <Checkbox
                  checked={reviewed}
                  disabled={
                    locked ||
                    !prepared ||
                    !context.readiness.canSend ||
                    compareRequired
                  }
                  onCheckedChange={(value) => setReviewed(value === true)}
                />
                <span className="text-sm leading-7">
                  {copy(
                    "راجعت المخرجات والمبلغ والفترة والحقوق والشروط، وأريد إرسال هذا العرض للطرف الآخر.",
                    "I reviewed the deliverables, amount, period, rights and terms, and want to send this offer to the other party.",
                  )}
                </span>
              </label>
              <Button
                disabled={
                  locked ||
                  !prepared ||
                  !reviewed ||
                  !context.readiness.canSend ||
                  compareRequired
                }
                onClick={send}
              >
                {copy("أرسل العرض", "Send offer")}
              </Button>
              <p className="text-sm text-muted-foreground">
                {copy(
                  "قبول العرض لا يبدأ التنفيذ مباشرةً؛ بعد القبول يؤكد كل طرف الاتفاق المثبّت بشكل مستقل.",
                  "Acceptance does not immediately start execution; each party separately confirms the frozen agreement after acceptance.",
                )}
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
