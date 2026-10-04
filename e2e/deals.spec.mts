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
  const f = await fixture(),
    password = `Synthetic deal ${randomUUID()}`,
    current = new Date();
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
      ownershipReviewedAt: current,
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
  f.options.now = current;
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
