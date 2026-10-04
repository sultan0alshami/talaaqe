"use client";
import { useI18n } from "@/lib/i18n";

export function useDealCopy() {
  const { isAr } = useI18n();
  const copy = (ar: string, en: string) => (isAr ? ar : en);
  const status = (value: string) =>
    (
      ({
        OFFERED: ["عرض مرسل", "Offer sent"],
        COUNTERED: ["عرض معدّل", "Counteroffer"],
        ACCEPTED: [
          "مقبول — بانتظار التأكيد",
          "Accepted — awaiting confirmations",
        ],
        AGREED: ["مؤكد من الطرفين", "Confirmed by both parties"],
        DELIVERED: ["تم الإبلاغ عن التسليم", "Delivery reported"],
        COMPLETED: ["مكتمل", "Completed"],
        DECLINED: ["مرفوض", "Declined"],
        CANCELLED: ["ملغي", "Cancelled"],
        PENDING: ["بانتظار الرد", "Pending response"],
        SUPERSEDED: ["استبدل بنسخة أحدث", "Superseded"],
      }) as Record<string, string[]>
    )[value]?.[isAr ? 0 : 1] ?? value;
  const errorCopy = (code: string) => {
    const entries: Record<string, [string, string]> = {
      NETWORK: [
        "تعذر تأكيد نتيجة الطلب. أعد نفس الطلب بأمان قبل أي تعديل جديد.",
        "The result could not be confirmed. Retry the same request safely before making another change.",
      ],
      NETWORK_READ: [
        "تعذر تحميل الحالة الحالية. تقدر تعيد المحاولة مع بقاء مدخلاتك.",
        "The current state could not be loaded. Retry while keeping your entries.",
      ],
      STALE_VERSION: [
        "تغيرت النسخة. حمّل الحالة الحالية وقارنها بمدخلاتك قبل الإرسال.",
        "The version changed. Load the current state and compare it with your entries before sending.",
      ],
      STALE_OFFER: [
        "هذا العرض استبدل بنسخة أحدث. حمّل الحالة الحالية ثم راجع العرض الجديد.",
        "A newer version replaced this offer. Load the current state and review the new offer.",
      ],
      STALE_BRIEF: [
        "تغير موجز الحملة. راجع النسخة المعتمدة الحالية قبل تقديم عرض جديد.",
        "The campaign brief changed. Review the current approved version before submitting another offer.",
      ],
      STALE_PARTICIPANTS: [
        "تغيرت ملكية أحد الملفات. التاريخ محفوظ للطرفين الأصليين، والإجراءات التجارية متوقفة.",
        "A profile's ownership changed. History remains with the original parties; commercial actions are blocked.",
      ],
      POLICY_UNAVAILABLE: [
        "الشروط أو سياسات السوق المراجعة غير متاحة أو لم تعد صالحة. احفظ مسودتك واستكملها عند توفر المراجعة.",
        "Reviewed terms or market policies are unavailable or no longer current. Save your draft and resume when the review is available.",
      ],
      REVIEWED_TERMS_UNAVAILABLE: [
        "ما فيه نسخة شروط مراجعة مناسبة للطرفين وأسواق الحملة حاليًا. تقدر تحفظ مسودتك الخاصة.",
        "No reviewed terms currently cover these parties and campaign markets. You can save your private draft.",
      ],
      CREATOR_UNCLAIMED: [
        "ملف الصانع غير مرتبط بصاحبه حتى الآن. تقدر تحفظ مسودة، لكن العرض التنفيذي يحتاج مطالبة موثقة بالملف.",
        "The creator profile is unclaimed. You can save a draft; an executable offer requires a verified profile claim.",
      ],
      COMMERCIAL_CONTEXT_UNAVAILABLE: [
        "ملف الصانع أو صلاحياته الحالية لا تتيح إجراءً تجاريًا الآن. تاريخ الصفقة محفوظ للطرفين الأصليين.",
        "The creator's current profile or permissions do not currently allow a commercial action. Deal history remains with the original parties.",
      ],
      POLICY_REVIEW_REQUIRED: [
        "أسواق الحملة تحتاج مراجعة موثقة للسياسات قبل المتابعة.",
        "The campaign markets need a documented policy review before proceeding.",
      ],
      POLICY_AMBIGUOUS: [
        "توجد نسخ سياسات حالية متعارضة لهذه الأسواق. يلزم حسم النسخة المراجعة قبل إرسال عرض؛ مسودتك قابلة للحفظ.",
        "Current policy versions conflict for these markets. The reviewed version must be resolved before sending; your draft can still be saved.",
      ],
      POLICY_ELIGIBILITY_REQUIRED: [
        "لم تكتمل أهلية التراخيص والسياسات المطلوبة لهذا الصانع.",
        "This creator's required licence and policy eligibility is incomplete.",
      ],
      POLICY_VERSION_MISMATCH: [
        "نسخ السياسات المختارة لا تطابق الموجز المعتمد. حمّل الخيارات الحالية.",
        "The selected policy versions do not match the approved brief. Load the current options.",
      ],
      BRAND_CONTACT_VERIFICATION_REQUIRED: [
        "يلزم تأكيد بيانات الاتصال المطلوبة للشركة قبل إرسال عرض. مسودتك قابلة للحفظ.",
        "The brand's required contact verification must be completed before sending. Your draft can still be saved.",
      ],
      CREATOR_NOT_EXECUTABLE: [
        "يلزم إكمال ملكية الحساب ومراجعة البيانات والنشر والموافقات المطلوبة للصانع قبل إرسال عرض.",
        "The creator must complete required account ownership, data review, publication and permissions before an offer can be sent.",
      ],
      CREATOR_NOT_ELIGIBLE: [
        "الصانع غير مؤهل حاليًا لمتطلبات الحملة. المسودة لا تؤكد الأهلية.",
        "The creator is not currently eligible for the campaign. Saving a draft does not establish eligibility.",
      ],
      AVAILABILITY_REQUIRED: [
        "فترة توفر الصانع لا تغطي فترة العرض حاليًا.",
        "The creator's confirmed availability does not currently cover the offer period.",
      ],
      REVIEWED_LANGUAGE_UNAVAILABLE: [
        "نسخة مراجعة من الشروط بهذه اللغة غير متاحة. لا يُترجم الاتفاق تلقائيًا.",
        "Reviewed terms in this language are unavailable. The agreement is never automatically translated.",
      ],
      BRIEF_NOT_APPROVED: [
        "اعتمد موجز الحملة أولًا. تقدر تحفظ مسودة العرض أثناء ذلك.",
        "Approve the campaign brief first. You can save the offer draft meanwhile.",
      ],
      CAMPAIGN_SLOTS_FULL: [
        "اكتمل عدد الصنّاع المخصص لهذه الحملة.",
        "All creator slots for this campaign are committed.",
      ],
      BUDGET_EXCEEDED: [
        "المبلغ يتجاوز الميزانية المتاحة أو حصة هذا العرض.",
        "The amount exceeds the available campaign budget or this offer's allocation.",
      ],
      ACTIVE_DEAL_EXISTS: [
        "يوجد عرض قائم بين هذين الطرفين لهذه الحملة. افتح الصفقات لمتابعته.",
        "These parties already have an active deal for this campaign. Open deals to continue it.",
      ],
      RECIPIENT_ONLY: [
        "القبول والرفض متاحان للطرف المستلم للعرض الحالي فقط.",
        "Only the current offer's recipient may accept or decline it.",
      ],
      ROLE_ONLY: [
        "هذا الإجراء متاح للطرف الآخر فقط.",
        "Only the other party may perform this action.",
      ],
      INVALID_STATE: [
        "هذا الإجراء غير متاح في الحالة الحالية. حمّل أحدث نسخة.",
        "This action is unavailable in the current state. Load the latest version.",
      ],
      INVALID_COMMAND: [
        "راجع الحقول المطلوبة والعملات والتواريخ ونسخ العرض.",
        "Check required fields, currencies, dates and offer versions.",
      ],
      INVALID_TERMS: [
        "راجع شروط العرض؛ العملة والفترة يجب أن تتوافقا مع الحملة.",
        "Review the offer terms; currency and dates must match the campaign.",
      ],
      UNSUPPORTED_DELIVERABLE: [
        "أحد المخرجات لا يطابق منصة أو صيغة الحملة المطلوبة.",
        "A deliverable does not match the campaign's required platform or format.",
      ],
      VALIDATION: [
        "راجع الحقول المدخلة وأكمل القيم المطلوبة.",
        "Check your entries and complete the required values.",
      ],
      ALREADY_RATED: [
        "سبق أن أرسلت تقييمك لهذه الصفقة.",
        "You already submitted a rating for this deal.",
      ],
      UNAUTHENTICATED: [
        "انتهت الجلسة. سجّل دخولك لاستكمال الصفقة.",
        "Your session ended. Sign in to continue the deal.",
      ],
      FORBIDDEN: [
        "هذا الإجراء غير متاح لحسابك حاليًا.",
        "This action is unavailable to your account.",
      ],
      NOT_FOUND: [
        "هذا السجل غير متاح لهذا الحساب.",
        "This record is unavailable to this account.",
      ],
      PAYLOAD_TOO_LARGE: [
        "النص أطول من الحد المتاح. اختصره مع الحفاظ على الشروط المهمة.",
        "The text exceeds the allowed size. Shorten it while keeping the important terms.",
      ],
      IDEMPOTENCY_CONFLICT: [
        "مفتاح الطلب مرتبط بمدخلات أخرى. حمّل الحالة الحالية قبل المتابعة.",
        "This request key is associated with different entries. Load the current state before proceeding.",
      ],
      INTERNAL_ERROR: [
        "تعذر إكمال الطلب. تحقق من الحالة الحالية قبل المحاولة من جديد.",
        "The request could not be completed. Check the current state before trying again.",
      ],
    };
    return (
      entries[code]?.[isAr ? 0 : 1] ??
      copy(
        "تعذر إكمال الإجراء. حمّل الحالة الحالية وراجع الأهلية والشروط.",
        "The action could not be completed. Load the current state and review eligibility and terms.",
      )
    );
  };
  return { isAr, copy, status, errorCopy };
}
