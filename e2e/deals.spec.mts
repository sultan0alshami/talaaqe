import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { test, expect } from "@playwright/test";
import {
  taskState,
  assertLocalTarget,
  workspace,
} from "../scripts/task-state.mjs";
import { prisma as db } from "../src/lib/prisma";
import { createDealOffer, applyDealCommand } from "../src/lib/deals/service";
import {
  applyCampaignMutation,
  generateCampaignBrief,
  approveCampaignBrief,
} from "../src/lib/campaigns/service";
import { resolveCampaignPolicyReview } from "../src/lib/policies";
import { authenticate, openSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { cleanup, fixture } from "../tests/deals/fixtures";

const state = taskState(),
  origin = "http://localhost:3100";
const policies: string[] = [],
  assets: string[] = [],
  contactUsers: string[] = [];
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e"))
  throw new Error(
    "Deal browser journeys require the exact isolated E2E target",
  );
test.beforeAll(async () => {
  const marker = await db.$queryRaw<
    Array<{ id: string; kind: string; db: string; host: string }>
  >`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (
    marker.length !== 1 ||
    marker[0].id !== state.id ||
    marker[0].kind !== "e2e" ||
    marker[0].db !== state.targets.e2e ||
    marker[0].host !== "127.0.0.1"
  )
    throw new Error("Incorrect deal E2E database identity");
});
test.afterEach(async () => {
  await db.verificationFallback.deleteMany({
    where: { userId: { in: contactUsers.splice(0) } },
  });
  await db.policyVersion.deleteMany({
    where: { id: { in: policies.splice(0) } },
  });
  await db.privateAsset.deleteMany({ where: { id: { in: assets.splice(0) } } });
  await cleanup();
});
test.afterAll(async () => {
  await db.$disconnect();
});
async function ownedFixture(language: "ar" | "en" = "ar") {
  const current = new Date(),
    f = await fixture(2, "10001", { now: current, target: "e2e" }),
    password = `Synthetic deal ${randomUUID()}`;
  // Eligibility's isTest=false rows exist only in this guarded disposable E2E
  // database and are unmistakably named synthetic. Domain-only test review is
  // used to seed histories; production routes always use actual registry checks.
  await db.user.updateMany({
    where: {
      id: { in: [f.brandUserId, f.target.userId, f.target.reviewerId] },
    },
    data: { emailVerifiedAt: current },
  });
  await db.user.updateMany({
    where: { id: { in: [f.brandUserId, f.target.userId] } },
    data: { passwordHash: await bcrypt.hash(password, 12), language },
  });
  await db.socialAccount.update({
    where: { id: f.target.accountId },
    data: {
      factsApprovedAt: current,
      intendedConfirmedAt: current,
      consentAt: current,
    },
  });
  // Evidence is immutable. A fresh observation is a new record, never an edit
  // to the domain fixture's separately timestamped observation.
  await db.metricsSnapshot.create({
    data: {
      accountId: f.target.accountId,
      mappingRevision: 1,
      source: "PUBLIC_IMPORT",
      providerObservationId: `synthetic-browser-${randomUUID()}`,
      observedAt: current,
      reviewStatus: "VERIFIED",
      approvedAt: current,
      approvedBy: f.target.reviewerId,
      followers: BigInt(1000),
    },
  });
  await db.creator.update({
    where: { id: f.target.id },
    data: {
      publishedAt: current,
      publicConsentAt: current,
      availability: {
        status: "AVAILABLE",
        startsAt: "2026-11-01T00:00:00.000Z",
        endsAt: "2026-12-01T00:00:00.000Z",
        confirmedAt: current.toISOString(),
      },
    },
  });
  await db.portfolioVersion.create({
    data: {
      creatorId: f.target.id,
      version: 1,
      inputRevision: 1,
      approvedAt: current,
      content: {
        title: "ملف اصطناعي معتمد للاختبار",
        bio: "ملف متصفح اصطناعي في قاعدة اختبار معزولة فقط",
        sections: [],
        method: "APPROVED_FACT_TEMPLATE",
      },
    },
  });
  // `current` is the observation instant captured before asynchronous setup.
  // Campaign approval keeps its actual server timestamp; deal commands must
  // evaluate after that approval and the remaining fixture writes complete.
  f.options.now = new Date();
  const brand = await db.user.findUniqueOrThrow({
      where: { id: f.brandUserId },
    }),
    creator = await db.user.findUniqueOrThrow({
      where: { id: f.target.userId },
    });
  return {
    ...f,
    password,
    brandEmail: brand.email,
    creatorEmail: creator.email,
  };
}
async function reviewedFixture(language: "ar" | "en") {
  const f = await ownedFixture(language),
    reviewedAt = new Date(),
    createdAt = new Date(reviewedAt.getTime() - 60000),
    admin = f.target.reviewerId;
  async function evidence(purpose: string, ownerUserId = admin) {
    const row = await db.privateAsset.create({
      data: {
        ownerUserId,
        purpose,
        storageKey: `synthetic-deal-browser/${randomUUID()}`,
        contentType: "text/plain",
        size: 1,
        checksum: "d".repeat(64),
        createdAt,
      },
    });
    assets.push(row.id);
    return row.id;
  }
  async function policy(kind: string, content: object) {
    const id = `synthetic-deal-browser-${randomUUID()}`;
    policies.push(id);
    await db.policyVersion.create({
      data: {
        id,
        kind,
        countryCodes: ["KW"],
        status: "VERIFIED",
        reviewedBy: admin,
        reviewedAt,
        createdAt,
        evidenceAssetId: await evidence("LEGAL_POLICY_REVIEW"),
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        content: JSON.parse(JSON.stringify(content)),
      },
    });
    return id;
  }
  const basis = {
    reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW",
    reviewReference:
      "Synthetic isolated browser fixture only; no live legal/contact review",
  };
  const marketId = await policy("MARKET", {
    schemaVersion: 1,
    kind: "MARKET",
    marketCountryCode: "KW",
    brandCountryCodes: ["KW"],
    creatorCountryCodes: ["KW"],
    licenceRequired: false,
    licencePolicyId: null,
    ...basis,
  });
  const termsId = await policy("GOVERNING_TERMS", {
    schemaVersion: 1,
    kind: "GOVERNING_TERMS",
    brandCountryCodes: ["KW"],
    creatorCountryCodes: ["KW"],
    marketCountryCodes: ["KW"],
    translations: {
      ar: "نص شروط اصطناعي مراجع للاختبار المعزول فقط",
      en: "Synthetic reviewed test terms for the isolated browser database only",
    },
    ...basis,
  });
  const fallbackId = await policy("PHONE_FALLBACK", {
    schemaVersion: 1,
    kind: "PHONE_FALLBACK",
    countryCode: "KW",
    marketCountryCodes: ["KW"],
    method: "DOCUMENTED_ADMIN_REVIEW",
    description: "Synthetic contact-review fixture; no provider verification",
    ...basis,
  });
  contactUsers.push(f.brandUserId);
  await db.verificationFallback.create({
    data: {
      userId: f.brandUserId,
      countryCode: "KW",
      policyVersion: fallbackId,
      status: "VERIFIED",
      reviewedBy: admin,
      reviewedAt,
      evidenceAssetId: await evidence("CONTACT_VERIFICATION", f.brandUserId),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    },
  });
  const changed = await applyCampaignMutation(f.brandUserId, f.campaign.id, {
    action: "UPDATE_FIELDS",
    operationKey: randomUUID(),
    expectedRevision: f.campaign.revision,
    payload: { patch: { title: "حملة اصطناعية بمراجعة سياسات اختبار" } },
  });
  const generated = await generateCampaignBrief(f.brandUserId, f.campaign.id, {
    operationKey: randomUUID(),
    expectedRevision: changed.campaign.revision,
  });
  const approved = await approveCampaignBrief(
    f.brandUserId,
    f.campaign.id,
    {
      operationKey: randomUUID(),
      expectedRevision: generated.campaign.revision,
      briefId: generated.brief.id,
      expectedBriefVersion: generated.brief.version,
    },
    db,
    { channel: "FORM", policyReviewResolver: resolveCampaignPolicyReview },
  );
  return { ...f, campaign: approved.campaign, marketId, termsId };
}
async function screenshot(page: import("@playwright/test").Page, name: string) {
  const directory = path.join(workspace, ".infame", "artifacts");
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage: true,
  });
}
async function actualReviewedOffer(
  page: import("@playwright/test").Page,
  f: Awaited<ReturnType<typeof reviewedFixture>>,
) {
  const response = await page.request.get(
    `/api/deals/compose?campaignId=${f.campaign.id}&creatorId=${f.target.id}`,
  );
  expect(response.status()).toBe(200);
  const current = (await response.json()).data;
  expect(current.readiness).toEqual({ canSend: true, blockedReasons: [] });
  const created = await page.request.post("/api/deals", {
    headers: { Origin: origin },
    data: {
      ...f.input,
      operationKey: randomUUID(),
      expectedCampaignRevision: current.campaign.revision,
      expectedBriefVersion: current.requirements.version,
      terms: {
        ...f.terms,
        governingTermsVersionId: f.termsId,
        licencePolicyVersionIds: current.requirements.mandatoryPolicyVersionIds,
      },
    },
  });
  expect(created.status()).toBe(200);
  return (await created.json()).data.deal;
}
async function signIn(
  context: import("@playwright/test").BrowserContext,
  email: string,
  password: string,
) {
  // Login transport/throttling has its own account tests. Deal journeys use the
  // real password check and signed, DB-backed issuer in isolated fixture setup;
  // every page/API then resolves current authorization normally.
  const user = await authenticate(email, password);
  expect(user).not.toBeNull();
  const token = await openSession(
    user!.id,
    user!.sessionVersion,
    user!.passwordHash,
  );
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "infame_lang",
      value: user!.language,
      url: origin,
      sameSite: "Lax",
    },
  ]);
}

test("resumable private offer composition stays usable while sending is blocked", async ({
  page,
  context,
}, info) => {
  const english = info.project.name === "english-desktop",
    label = (ar: string, en: string) => (english ? en : ar),
    f = await ownedFixture(english ? "en" : "ar");
  if (english)
    await context.addCookies([
      { name: "infame_lang", value: "en", domain: "localhost", path: "/" },
    ]);
  await signIn(context, f.brandEmail, f.password);
  await page.goto(
    `/brand/deals/new?campaignId=${f.campaign.id}&creatorId=${f.target.id}`,
  );
  await expect(
    page.getByRole("heading", {
      name: label("جهّز عرض التعاون", "Prepare a collaboration offer"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: label("أرسل العرض", "Send offer"),
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByLabel(label("عملة العرض", "Offer currency"), { exact: true })
    .selectOption("KWD");
  await page
    .getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true })
    .fill("مسودة عربية أصلية للعرض");
  await page
    .getByRole("button", {
      name: label("احفظ مسودة العرض الخاصة", "Save private offer draft"),
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      label(
        "انحفظت مسودة عرضك الخاصة. تقدر ترجع لها لاحقًا.",
        "Your private offer draft is saved. You can resume later.",
      ),
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true }),
  ).toHaveValue("مسودة عربية أصلية للعرض");
  await expect(
    page.getByLabel(label("عملة العرض", "Offer currency"), { exact: true }),
  ).toHaveValue("KWD");
  expect(await db.deal.count({ where: { campaignId: f.campaign.id } })).toBe(0);
  const languageToggle = page.getByRole("button", {
    name: english ? "Switch to Arabic" : "التبديل إلى الإنجليزية",
    exact: true,
  });
  await expect(languageToggle).toBeVisible();
  await languageToggle.click();
  await expect(page.locator("html")).toHaveAttribute("lang", english ? "ar" : "en");
  await expect(page.locator("html")).toHaveAttribute("dir", english ? "rtl" : "ltr");
  await expect(
    page.getByLabel(english ? "ملاحظة العرض" : "Offer note", { exact: true }),
  ).toHaveValue("مسودة عربية أصلية للعرض");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, `${info.project.name}-offer-private-blocked`);
});

test("current approved proof, portfolio, contact and reviewed policies enable the actual offer and two confirmations", async ({
  page,
  context,
}, info) => {
  const english = info.project.name === "english-desktop",
    label = (ar: string, en: string) => (english ? en : ar),
    f = await reviewedFixture(english ? "en" : "ar");
  if (english)
    await context.addCookies([
      { name: "infame_lang", value: "en", domain: "localhost", path: "/" },
    ]);
  const login = (email: string) => signIn(context, email, f.password);
  await login(f.brandEmail);
  const query = `campaignId=${f.campaign.id}&creatorId=${f.target.id}`;
  const readiness = (
    await (await page.request.get(`/api/deals/compose?${query}`)).json()
  ).data;
  expect(readiness.readiness).toEqual({ canSend: true, blockedReasons: [] });
  await page.goto(`/brand/deals/new?${query}`);
  await page
    .getByLabel(label("عملة العرض", "Offer currency"), { exact: true })
    .selectOption("KWD");
  await page
    .getByLabel(label("المبلغ", "Amount"), { exact: true })
    .fill("5.000");
  await page
    .getByRole("button", {
      name: label("أضف مخرجًا", "Add deliverable"),
      exact: true,
    })
    .click();
  await page.getByLabel(label("العدد", "Count"), { exact: true }).fill("2");
  await page
    .getByLabel(label("البداية (UTC)", "Starts at (UTC)"), { exact: true })
    .fill(f.terms.period.startsAt.slice(0, 16));
  await page
    .getByLabel(label("النهاية (UTC)", "Ends at (UTC)"), { exact: true })
    .fill(f.terms.period.endsAt.slice(0, 16));
  await page
    .getByLabel(label("المنطقة الزمنية (IANA)", "Timezone (IANA)"), {
      exact: true,
    })
    .fill("Asia/Kuwait");
  await page
    .getByLabel(label("حقوق الاستخدام", "Usage rights"), { exact: true })
    .fill("حقوق أصلية لهذه الحملة الاصطناعية فقط");
  await page
    .getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true })
    .fill("ملاحظة أصلية للعرض التنفيذي الاصطناعي");
  await page
    .getByLabel(label("نسخة الشروط", "Terms version"), { exact: true })
    .selectOption(f.termsId);
  await page
    .getByLabel(
      label(
        "أدرج نسخ سياسات السوق المراجعة المطلوبة في العرض",
        "Include the required reviewed market policy versions in this offer",
      ),
      { exact: false },
    )
    .check();
  await page
    .getByRole("button", {
      name: label("راجع العرض قبل الإرسال", "Review offer before sending"),
      exact: true,
    })
    .click();
  await page
    .getByLabel(
      label(
        "راجعت المخرجات والمبلغ والفترة والحقوق والشروط، وأريد إرسال هذا العرض للطرف الآخر.",
        "I reviewed the deliverables, amount, period, rights and terms, and want to send this offer to the other party.",
      ),
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", {
      name: label("أرسل العرض", "Send offer"),
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/brand\/deals\/[^/?]+$/);
  const deal = await db.deal.findFirstOrThrow({
    where: { campaignId: f.campaign.id },
  });
  expect(await db.deal.count({ where: { campaignId: f.campaign.id } })).toBe(1);
  await login(f.creatorEmail);
  await page.goto(`/creator/deals/${deal.id}`);
  await page
    .getByLabel(label("لغة الاتفاق المراجعة", "Reviewed agreement language"), {
      exact: true,
    })
    .selectOption("ar");
  await page
    .getByLabel(
      label(
        "راجعت المخرجات والمبلغ والحقوق والشروط في العرض 1، وأريد قبول هذه النسخة.",
        "I reviewed the deliverables, amount, rights and terms in offer 1, and want to accept this version.",
      ),
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", {
      name: label(
        "اقبل العرض وثبّت الاتفاق",
        "Accept offer and freeze agreement",
      ),
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("region", {
        name: new RegExp(
          label("^نص الشروط كما تمت مراجعته", "^Terms exactly as reviewed"),
        ),
      })
      .getByText("نص شروط اصطناعي مراجع للاختبار المعزول فقط", { exact: true }),
  ).toBeVisible();
  expect(
    await db.agreementConfirmation.count({ where: { dealId: deal.id } }),
  ).toBe(0);
  const confirmation = label(
    "قرأت الاتفاق المثبّت 1 كاملًا مع الشروط والحقوق وهويات الطرفين. أؤكد هذه النسخة بشكل مستقل.",
    "I read frozen agreement 1 in full, including terms, rights and party identities. I independently confirm this exact version.",
  );
  await page.getByLabel(confirmation, { exact: true }).check();
  await page
    .getByRole("button", {
      name: label("أكّد هذا الاتفاق", "Confirm this agreement"),
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      label(
        "تم تأكيدك. التنفيذ يبدأ بعد تأكيد الطرف الآخر أيضًا.",
        "Your confirmation is recorded. Execution begins after the other party also confirms.",
      ),
      { exact: true },
    ),
  ).toBeVisible();
  await login(f.brandEmail);
  await page.goto(`/brand/deals/${deal.id}`);
  await page.getByLabel(confirmation, { exact: true }).check();
  await page
    .getByRole("button", {
      name: label("أكّد هذا الاتفاق", "Confirm this agreement"),
      exact: true,
    })
    .click();
  await expect(
    page
      .getByText(label("مؤكد من الطرفين", "Confirmed by both parties"), {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  expect(
    await db.agreementConfirmation.count({ where: { dealId: deal.id } }),
  ).toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, `${info.project.name}-deal-actual-two-confirmations`);
  // Exercise execution through the real controls and commands, not service
  // transitions. The prerequisite policies above remain synthetic fixtures.
  const frozen = await db.agreementSnapshot.findFirstOrThrow({ where: { dealId: deal.id } });
  await login(f.creatorEmail);
  await page.goto(`/creator/deals/${deal.id}`);
  await page.getByLabel(label("تفاصيل إثبات التسليم", "Delivery evidence details"), { exact: true }).fill("تفاصيل تسليم أصلية من الصانع <script>test</script>");
  await page.getByLabel(label("روابط الإثبات — رابط HTTPS لكل سطر (اختياري)", "Evidence links — one HTTPS link per line (optional)"), { exact: true }).fill("https://example.invalid/synthetic-delivery");
  const deliveredResponse = page.waitForResponse(response => response.url().endsWith(`/api/deals/${deal.id}/commands`) && response.request().method() === "POST");
  await page.getByRole("button", { name: label("أبلغ عن التسليم مع الإثبات", "Report delivery with evidence"), exact: true }).click();
  const deliveryResult = await deliveredResponse;
  expect(deliveryResult.status()).toBe(200);
  expect((await deliveryResult.json()).data.deal.status).toBe("DELIVERED");
  await expect(page.getByText("تفاصيل تسليم أصلية من الصانع <script>test</script>", { exact: true })).toBeVisible();
  expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe("DELIVERED");
  await login(f.brandEmail);
  await page.goto(`/brand/deals/${deal.id}`);
  await expect(page.getByText("تفاصيل تسليم أصلية من الصانع <script>test</script>", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.invalid/synthetic-delivery", exact: true })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("button", { name: label("سجّل اكتمال الصفقة", "Record completion"), exact: true })).toBeDisabled();
  await page.getByLabel(label("راجعت التسليم وأريد تسجيل اكتمال الصفقة.", "I reviewed the delivery and want to record completion."), { exact: true }).check();
  await page.getByRole("button", { name: label("سجّل اكتمال الصفقة", "Record completion"), exact: true }).click();
  await expect(page.getByRole("heading", { name: label("تقييم التعاون", "Collaboration feedback"), exact: true })).toBeVisible();
  expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe("COMPLETED");
  await page.getByLabel(label("أصرح بأنني دفعت المقابل للطرف الآخر، وأفهم أن إنفيم لا يتحقق من هذا الدفع.", "I declare that I paid the other party and understand that Infame does not verify this payment."), { exact: true }).check();
  await page.getByRole("button", { name: label("أبلغ بأنني دفعت", "Declare that I paid"), exact: true }).click();
  await expect(page.getByText(label("أبلغت الشركة عن الدفع — تصريح ذاتي", "The brand reported payment — self-reported"), { exact: true })).toBeVisible();
  await page.getByLabel(label("تقييمك من ١ إلى ٥", "Your rating from 1 to 5"), { exact: true }).selectOption("3");
  await page.getByLabel(label("تعليقك (اختياري)", "Your comment (optional)"), { exact: true }).fill("تقييم الشركة الأصلي المختوم");
  await page.getByLabel(label("هذا تقييمي النهائي لهذه الصفقة، وأفهم سياسة الكشف.", "This is my final rating for this deal, and I understand the reveal policy."), { exact: true }).check();
  await page.getByRole("button", { name: label("أرسل تقييمك المختوم", "Submit your sealed rating"), exact: true }).click();
  await expect(page.locator("p").filter({ hasText: /^تقييم الشركة الأصلي المختوم$/ })).toBeVisible();
  await login(f.creatorEmail);
  await page.goto(`/creator/deals/${deal.id}`);
  await expect(page.getByText("تقييم الشركة الأصلي المختوم", { exact: true })).toHaveCount(0);
  expect(JSON.stringify(await (await page.request.get(`/api/deals/${deal.id}`)).json())).not.toContain("تقييم الشركة الأصلي المختوم");
  await page.getByLabel(label("أصرح بأنني استلمت المقابل، وأفهم أن إنفيم لا يتحقق من هذا الاستلام.", "I declare that I received payment and understand that Infame does not verify this receipt."), { exact: true }).check();
  await page.getByRole("button", { name: label("أبلغ بأنني استلمت", "Declare that I received"), exact: true }).click();
  await expect(page.getByText(label("أبلغ الصانع عن الاستلام — تصريح ذاتي", "The creator reported receipt — self-reported"), { exact: true })).toBeVisible();
  await page.getByLabel(label("تقييمك من ١ إلى ٥", "Your rating from 1 to 5"), { exact: true }).selectOption("5");
  await page.getByLabel(label("تعليقك (اختياري)", "Your comment (optional)"), { exact: true }).fill("تقييم الصانع الأصلي");
  await page.getByLabel(label("هذا تقييمي النهائي لهذه الصفقة، وأفهم سياسة الكشف.", "This is my final rating for this deal, and I understand the reveal policy."), { exact: true }).check();
  await page.getByRole("button", { name: label("أرسل تقييمك المختوم", "Submit your sealed rating"), exact: true }).click();
  await expect(page.getByText("تقييم الشركة الأصلي المختوم", { exact: true })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: /^تقييم الصانع الأصلي$/ })).toBeVisible();
  const final = (await (await page.request.get(`/api/deals/${deal.id}`)).json()).data;
  expect(final.ratingsRevealed).toBe(true);
  expect(final.ratings).toHaveLength(2);
  expect(final.brandPaymentReportedAt).toBeTruthy();
  expect(final.creatorReceiptReportedAt).toBeTruthy();
  expect(final.agreement.contentHash).toBe((frozen.content as { contentHash: string }).contentHash);
  // A later material campaign edit must not substitute this deal's approved
  // historical requirements or rewrite the frozen agreement.
  const currentCampaign = await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
  await applyCampaignMutation(f.brandUserId, f.campaign.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: currentCampaign.revision, payload: { patch: { summary: "ملخص لاحق لا يخص النسخة المثبتة" } } });
  await page.reload();
  await page.getByText(label("متطلبات الموجز المعتمدة", "Approved brief requirements"), { exact: true }).click();
  await expect(page.locator("[data-brief-field]")).toHaveCount(30);
  await expect(page.locator('[data-brief-field="title"] dd')).toBeVisible();
  await expect(page.locator('[data-brief-field="budget"] dd')).toBeVisible();
  await expect(page.locator('[data-brief-field="period"] dd')).toBeVisible();
  await expect(page.locator('[data-brief-field="title"] dd')).toHaveText("حملة اصطناعية بمراجعة سياسات اختبار");
  await expect(page.locator('[data-brief-field="budget"] dd')).toHaveText("10.001 KWD");
  await expect(page.locator('[data-brief-field="period"] dd')).toContainText("Asia/Kuwait");
  await expect(page.locator('[data-brief-field="summary"] dd')).not.toContainText("ملخص لاحق لا يخص النسخة المثبتة");
  const progress = page.getByRole("region", { name: label("مراحل الصفقة المحفوظة", "Recorded deal stages"), exact: true });
  await expect(progress.locator("li[aria-current=step]")).toContainText(label("الاكتمال", "Completion"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await screenshot(page, `${info.project.name}-deal-original-completed-brief`);
  await page.getByText(label("متطلبات الموجز المعتمدة", "Approved brief requirements"), { exact: true }).click();
  await page.screenshot({ path: path.join(workspace, ".infame", "artifacts", `${info.project.name}-deal-original-completed-preview.png`) });
});

test("offer parties, response-loss replay after reload and original text remain correct", async ({
  page,
  context,
}, info) => {
  const english = info.project.name === "english-desktop",
    label = (ar: string, en: string) => (english ? en : ar),
    f = await ownedFixture(english ? "en" : "ar");
  if (english)
    await context.addCookies([
      { name: "infame_lang", value: "en", domain: "localhost", path: "/" },
    ]);
  const deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
  await signIn(context, f.brandEmail, f.password);
  await page.goto(`/brand/deals/${deal.id}`);
  await expect(
    page.getByRole("heading", {
      name: label("تفاصيل الصفقة", "Deal details"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: label(
        "اقبل العرض وثبّت الاتفاق",
        "Accept offer and freeze agreement",
      ),
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: label("اقترح شروطًا معدّلة", "Propose revised terms"),
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel(label("رسالتك", "Your message"), { exact: true })
    .fill("رسالة أصلية بعد فقد الاستجابة");
  await page.route(`**/api/deals/${deal.id}/commands`, async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", {
      name: label("أرسل الرسالة", "Send message"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: label("أعد نفس الطلب بأمان", "Retry the same request safely"),
      exact: true,
    }),
  ).toBeVisible();
  expect(await db.dealMessage.count({ where: { dealId: deal.id } })).toBe(1);
  await page.unroute(`**/api/deals/${deal.id}/commands`);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: label("أعد نفس الطلب بأمان", "Retry the same request safely"),
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: label("أعد نفس الطلب بأمان", "Retry the same request safely"),
      exact: true,
    })
    .click();
  await expect(
    page.getByText("رسالة أصلية بعد فقد الاستجابة", { exact: true }),
  ).toBeVisible();
  expect(await db.dealMessage.count({ where: { dealId: deal.id } })).toBe(1);
  await page
    .getByText(label("العرض 1", "Offer 1"), { exact: false })
    .last()
    .focus();
  await page.keyboard.press("Space");
  await expect(page.locator("details").last()).toHaveAttribute("open", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, `${info.project.name}-deal-offer-replay`);
  await signIn(context, f.creatorEmail, f.password);
  await page.goto(`/creator/deals/${deal.id}`);
  await expect(
    page.getByRole("button", {
      name: label(
        "اقبل العرض وثبّت الاتفاق",
        "Accept offer and freeze agreement",
      ),
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByText("رسالة أصلية بعد فقد الاستجابة", { exact: true }),
  ).toBeVisible();
});

test("two-tab counters preserve stale inputs, enforce the recipient and retain declined history", async ({ page, context, browser }, info) => {
  const english = info.project.name === "english-desktop",
    label = (ar: string, en: string) => english ? en : ar,
    f = await reviewedFixture(english ? "en" : "ar");
  await signIn(context, f.brandEmail, f.password);
  const deal = await actualReviewedOffer(page, f);
  const other = await context.newPage();
  const open = async (tab: import("@playwright/test").Page, amount: string, note: string) => {
    await tab.goto(`/brand/deals/${deal.id}`);
    await tab.getByRole("button", { name: label("اقترح شروطًا معدّلة", "Propose revised terms"), exact: true }).click();
    await tab.getByLabel(label("المبلغ", "Amount"), { exact: true }).fill(amount);
    await tab.getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true }).fill(note);
  };
  const send = async (tab: import("@playwright/test").Page) => {
    const response = tab.waitForResponse(r => r.url().endsWith(`/api/deals/${deal.id}/commands`) && r.request().method() === "POST");
    await tab.getByRole("button", { name: label("أرسل الشروط المعدّلة", "Send revised terms"), exact: true }).click();
    return response;
  };
  await open(page, "4.999", "عرض معدل أصلي من التبويب الأول");
  await open(other, "4.998", "مدخل أصلي محفوظ في التبويب القديم");
  expect((await send(page)).status()).toBe(200);
  expect((await send(other)).status()).toBe(409);
  const note = other.getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true });
  await expect(note).toHaveValue("مدخل أصلي محفوظ في التبويب القديم");
  expect(await db.dealOffer.count({ where: { dealId: deal.id } })).toBe(2);
  await other.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
  const compare = other.getByRole("button", { name: label("راجعت النسخة الحالية وأحتفظ بمدخلاتي", "I reviewed the current version and will keep my entries"), exact: true });
  await expect(compare).toBeVisible();
  await expect(other.getByRole("button", { name: label("أرسل الشروط المعدّلة", "Send revised terms"), exact: true })).toBeDisabled();
  await expect(note).toHaveValue("مدخل أصلي محفوظ في التبويب القديم");
  await expect(other.getByLabel(label("المبلغ", "Amount"), { exact: true })).toHaveValue("4.998");
  await compare.click();
  expect((await send(other)).status()).toBe(200);
  const actual = (await (await other.request.get(`/api/deals/${deal.id}`)).json()).data;
  expect(actual.offers).toHaveLength(3);
  expect(actual.currentOffer.terms.amount).toEqual({ amountMinor: "4998", currencyCode: "KWD" });
  expect(actual.currentOffer.terms.note).toEqual({ text: "مدخل أصلي محفوظ في التبويب القديم", language: "ar" });
  expect(actual.currentOffer.recipientUserId).toBe(f.target.userId);
  expect(actual.offers.filter((offer: { status: string }) => offer.status === "PENDING")).toHaveLength(1);
  const ownAccept = await other.request.post(`/api/deals/${deal.id}/commands`, { headers: { Origin: origin }, data: { action: "ACCEPT", operationKey: randomUUID(), expectedVersion: actual.version, offerId: actual.currentOffer.id, expectedOfferVersion: actual.currentOffer.version, language: "ar" } });
  expect(ownAccept.status()).toBe(403);
  expect((await ownAccept.json()).error.code).toBe("RECIPIENT_ONLY");
  expect(await db.agreementSnapshot.count({ where: { dealId: deal.id } })).toBe(0);
  await screenshot(other, `${info.project.name}-deal-original-counter-history`);
  const creatorContext = await browser.newContext({ baseURL: origin, viewport: english ? { width: 1440, height: 1000 } : { width: 360, height: 800 } });
  try {
    await signIn(creatorContext, f.creatorEmail, f.password);
    const creatorPage = await creatorContext.newPage();
    await creatorPage.goto(`/creator/deals/${deal.id}`);
    await creatorPage.getByText(label("ارفض العرض بسبب واضح", "Decline with a clear reason"), { exact: true }).click();
    await expect(creatorPage.getByRole("button", { name: label("ارفض هذا العرض", "Decline this offer"), exact: true })).toBeDisabled();
    await creatorPage.getByLabel(label("سبب الرفض", "Decline reason"), { exact: true }).fill("سبب رفض أصلي محفوظ");
    const declineResponse = creatorPage.waitForResponse(r => r.url().endsWith(`/api/deals/${deal.id}/commands`) && r.request().method() === "POST");
    await creatorPage.getByRole("button", { name: label("ارفض هذا العرض", "Decline this offer"), exact: true }).click();
    const declined = await declineResponse;
    expect(declined.status()).toBe(200);
    expect((await declined.json()).data.deal.status).toBe("DECLINED");
    await expect(creatorPage.locator("p").filter({ hasText: /^سبب رفض أصلي محفوظ$/ })).toBeVisible();
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe("DECLINED");
    await expect(creatorPage.getByRole("button", { name: label("اقترح شروطًا معدّلة", "Propose revised terms"), exact: true })).toHaveCount(0);
    const progress = creatorPage.getByRole("region", { name: label("مراحل الصفقة المحفوظة", "Recorded deal stages"), exact: true });
    await expect(progress.locator("[aria-current=step]")).toHaveCount(0);
    await expect(progress.getByText(label("قبول العرض · لم تصل إليها الصفقة", "Offer acceptance · Not reached"), { exact: false })).toBeVisible();
    await creatorPage.getByLabel(label("رسالتك", "Your message"), { exact: true }).fill("رسالة أصلية بعد الرفض");
    await creatorPage.getByRole("button", { name: label("أرسل الرسالة", "Send message"), exact: true }).click();
    await expect(creatorPage.locator("p").filter({ hasText: /^رسالة أصلية بعد الرفض$/ })).toBeVisible();
    expect(await db.dealOffer.count({ where: { dealId: deal.id } })).toBe(3);
    expect(await creatorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await creatorPage.evaluate(() => scrollTo(0, 0));
    await screenshot(creatorPage, `${info.project.name}-deal-original-declined`);
  } finally { await creatorContext.close(); await other.close(); }
});

test("reasoned cancellation stops progress and preserves original party messaging", async ({ page, context }, info) => {
  const english = info.project.name === "english-desktop",
    label = (ar: string, en: string) => english ? en : ar,
    f = await reviewedFixture(english ? "en" : "ar");
  await signIn(context, f.brandEmail, f.password);
  const deal = await actualReviewedOffer(page, f);
  await page.goto(`/brand/deals/${deal.id}`);
  await page.getByRole("button", { name: label("ألغِ الصفقة بسبب واضح", "Cancel with a clear reason"), exact: true }).click();
  const confirm = page.getByRole("button", { name: label("أكّد إلغاء الصفقة", "Confirm cancellation"), exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(label("سبب الإلغاء", "Cancellation reason"), { exact: true }).fill("سبب إلغاء أصلي محفوظ");
  const cancelledResponse = page.waitForResponse(r => r.url().endsWith(`/api/deals/${deal.id}/commands`) && r.request().method() === "POST");
  await confirm.click();
  const response = await cancelledResponse;
  expect(response.status()).toBe(200);
  expect((await response.json()).data.deal.status).toBe("CANCELLED");
  await expect(page.locator("p").filter({ hasText: /^سبب إلغاء أصلي محفوظ$/ })).toBeVisible();
  const progress = page.getByRole("region", { name: label("مراحل الصفقة المحفوظة", "Recorded deal stages"), exact: true });
  await expect(progress.locator("[aria-current=step]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: label("اقترح شروطًا معدّلة", "Propose revised terms"), exact: true })).toHaveCount(0);
  await signIn(context, f.creatorEmail, f.password);
  await page.goto(`/creator/deals/${deal.id}`);
  await expect(page.locator("p").filter({ hasText: /^سبب إلغاء أصلي محفوظ$/ })).toBeVisible();
  await page.getByLabel(label("رسالتك", "Your message"), { exact: true }).fill("رسالة أصلية بعد الإلغاء");
  await page.getByRole("button", { name: label("أرسل الرسالة", "Send message"), exact: true }).click();
  await expect(page.locator("p").filter({ hasText: /^رسالة أصلية بعد الإلغاء$/ })).toBeVisible();
  expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe("CANCELLED");
  expect(await db.agreementSnapshot.count({ where: { dealId: deal.id } })).toBe(0);
  expect(await db.dealOffer.count({ where: { dealId: deal.id } })).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("counter readiness follows actual policy restoration and withdrawal after reload", async ({
  page,
  context,
}, info) => {
  const english = info.project.name === "english-desktop",
    label = (ar: string, en: string) => (english ? en : ar),
    f = await reviewedFixture(english ? "en" : "ar");
  await signIn(context, f.brandEmail, f.password);
  const deal = await actualReviewedOffer(page, f);
  await db.policyVersion.update({ where: { id: f.marketId }, data: { status: "REVOKED" } });
  await page.goto(`/brand/deals/${deal.id}`);
  await page.getByRole("button", { name: label("اقترح شروطًا معدّلة", "Propose revised terms"), exact: true }).click();
  const submit = page.getByRole("button", { name: label("أرسل الشروط المعدّلة", "Send revised terms"), exact: true });
  const note = page.getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true });
  await note.fill("مدخل أصلي محفوظ أثناء مراجعة السياسة");
  await expect(submit).toBeDisabled();
  // Explicit synthetic control fixture restoration in the guarded E2E database.
  // The page still obtains readiness from the real authenticated compose API.
  await db.policyVersion.update({ where: { id: f.marketId }, data: { status: "VERIFIED" } });
  await page.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
  await expect(note).toHaveValue("مدخل أصلي محفوظ أثناء مراجعة السياسة");
  await expect(submit).toBeEnabled();
  await db.policyVersion.update({ where: { id: f.marketId }, data: { status: "REVOKED" } });
  const withdrawnRead = page.waitForResponse(response => response.url().includes("/api/deals/compose?") && response.status() === 200);
  await page.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true }).click();
  const withdrawnContext = (await (await withdrawnRead).json()).data;
  expect(withdrawnContext.readiness.canSend).toBe(false);
  expect(withdrawnContext.readiness.blockedReasons).toContain("POLICY_REVIEW_REQUIRED");
  await expect(page.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true })).toBeEnabled();
  await expect(submit).toBeDisabled();
  await expect(note).toHaveValue("مدخل أصلي محفوظ أثناء مراجعة السياسة");
  expect(await db.dealOffer.count({ where: { dealId: deal.id } })).toBe(1);
});

test("immutable agreement, separate confirmation, reported payment and sealed ratings are readable", async ({
  page,
  context,
}, info) => {
  const english = info.project.name === "english-desktop",
    label = (ar: string, en: string) => (english ? en : ar),
    f = await ownedFixture(english ? "en" : "ar");
  if (english)
    await context.addCookies([
      { name: "infame_lang", value: "en", domain: "localhost", path: "/" },
    ]);
  let deal = (await createDealOffer(f.brandUserId, f.input, f.options)).deal;
  const send = async (actor: string, action: string, extra: object = {}) => {
    deal = (
      await applyDealCommand(
        actor,
        deal.id,
        {
          action,
          expectedVersion: deal.version,
          operationKey: randomUUID(),
          ...extra,
        },
        f.options,
      )
    ).deal;
  };
  await send(f.target.userId, "ACCEPT", {
    offerId: deal.currentOffer.id,
    expectedOfferVersion: deal.currentOffer.version,
  });
  const frozen = deal.agreement!;
  await signIn(context, f.brandEmail, f.password);
  await page.goto(`/brand/deals/${deal.id}`);
  await expect(page.getByText(frozen.content, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: label("أكّد هذا الاتفاق", "Confirm this agreement"),
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    await db.agreementConfirmation.count({ where: { dealId: deal.id } }),
  ).toBe(0);
  const agreement = {
    agreementId: frozen.id,
    expectedAgreementVersion: frozen.version,
  };
  await send(f.brandUserId, "CONFIRM", agreement);
  await send(f.target.userId, "CONFIRM", agreement);
  await send(f.target.userId, "DELIVER", {
    evidence: {
      text: { text: "إثبات تسليم اصطناعي", language: "ar" },
      links: [],
    },
  });
  await send(f.brandUserId, "COMPLETE");
  await page.reload();
  await page
    .getByLabel(
      label(
        "أصرح بأنني دفعت المقابل للطرف الآخر، وأفهم أن إنفيم لا يتحقق من هذا الدفع.",
        "I declare that I paid the other party and understand that Infame does not verify this payment.",
      ),
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", {
      name: label("أبلغ بأنني دفعت", "Declare that I paid"),
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      label(
        "أبلغت الشركة عن الدفع — تصريح ذاتي",
        "The brand reported payment — self-reported",
      ),
      { exact: true },
    ),
  ).toBeVisible();
  const unchanged = await db.agreementSnapshot.findUniqueOrThrow({
    where: { id: frozen.id },
  });
  expect((unchanged.content as { contentHash: string }).contentHash).toBe(
    frozen.contentHash,
  );
  await page
    .getByLabel(label("تقييمك من ١ إلى ٥", "Your rating from 1 to 5"), {
      exact: true,
    })
    .selectOption("2");
  await page
    .getByLabel(label("تعليقك (اختياري)", "Your comment (optional)"), {
      exact: true,
    })
    .fill("تعليق مختوم خاص للمتصفح");
  await page
    .getByLabel(
      label(
        "هذا تقييمي النهائي لهذه الصفقة، وأفهم سياسة الكشف.",
        "This is my final rating for this deal, and I understand the reveal policy.",
      ),
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", {
      name: label("أرسل تقييمك المختوم", "Submit your sealed rating"),
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      label(
        "انحفظ تقييمك. تقييم الطرف الآخر مختوم حاليًا.",
        "Your rating is saved. The other party's rating is currently sealed.",
      ),
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await screenshot(page, `${info.project.name}-deal-agreement-feedback`);
  await signIn(context, f.creatorEmail, f.password);
  await page.goto(`/creator/deals/${deal.id}`);
  await expect(
    page.getByText("تعليق مختوم خاص للمتصفح", { exact: true }),
  ).toHaveCount(0);
  expect(
    JSON.stringify(
      await (await page.request.get(`/api/deals/${deal.id}`)).json(),
    ),
  ).not.toContain("تعليق مختوم خاص للمتصفح");
  await expect(page.getByText(frozen.content, { exact: true })).toBeVisible();
  await db.user.update({
    where: { id: f.target.userId },
    data: { active: false },
  });
  expect((await page.request.get(`/api/deals/${deal.id}`)).status()).toBe(401);
  await page.goto(`/creator/deals/${deal.id}`);
  await expect(page).toHaveURL(/\/login/);
});
