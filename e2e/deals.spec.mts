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
import { authenticate, openSession, resolveSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { cleanup, fixture, user } from "../tests/deals/fixtures";
import { nativeDealActor } from "../tests/deals/native-actors";
import { AgreementContentSchema } from "../src/lib/deals/contracts";

const state = taskState(),
  origin = "http://localhost:3100";
const policies: string[] = [],
  assets: string[] = [],
  contactUsers: string[] = [];
type HydrationEvent = { kind: "console"; messageType: string } | { kind: "pageerror" };
const hydrationEvents = new WeakMap<import("@playwright/test").BrowserContext, HydrationEvent[]>();
function currentHydrationEvents(context: import("@playwright/test").BrowserContext) {
  const events = hydrationEvents.get(context);
  if (!events) throw new Error("The journey hydration collector was not initialized");
  return events;
}
function collectHydrationEvents(context: import("@playwright/test").BrowserContext, events: HydrationEvent[]) {
  const observed = new WeakSet<import("@playwright/test").Page>();
  const observe = (page: import("@playwright/test").Page) => {
    if (observed.has(page)) return;
    observed.add(page);
    // React reports mismatches through several console types. Keep only safe
    // categories, never raw console text, private inputs or session metadata.
    page.on("console", message => {
      if (/hydration|hydrated|did not match|didn't match|does not match|expected server html to contain|expected not to contain.*server html/i.test(message.text())) {
        events.push({ kind: "console", messageType: message.type() });
      }
    });
    page.on("pageerror", () => events.push({ kind: "pageerror" }));
  };
  context.pages().forEach(observe);
  context.on("page", observe);
}
test.beforeEach(({ context }) => {
  const events: HydrationEvent[] = [];
  hydrationEvents.set(context, events);
  collectHydrationEvents(context, events);
});
test.afterEach(({ context }) => {
  expect(currentHydrationEvents(context), "Hydration console mismatches and uncaught page errors").toEqual([]);
  hydrationEvents.delete(context);
});
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
  const brandSession = await nativeDealActor(f.brandUserId, "e2e");
  const creatorSession = await nativeDealActor(f.target.userId, "e2e");
  return {
    ...f,
    options: { ...f.options, serverAuth: brandSession.actor },
    creatorOptions: { ...f.options, serverAuth: creatorSession.actor },
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

function hydrationLatch<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  // A route can fail before its corresponding gate is awaited. Keep that failure
  // available to the caller without an unhandled detached rejection.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

async function holdDealClient(
  page: import("@playwright/test").Page,
  component: "deal-compose" | "deal-screen",
) {
  const marker = `[project]/src/components/infame/${component}.tsx [app-client] (ecmascript)`;
  const arrived = hydrationLatch<void>(), delivered = hydrationLatch<void>(), released = hydrationLatch<void>();
  const active = new Set<Promise<void>>();
  let held = false, terminalFailure: { error: unknown } | undefined;
  const scripts = (url: URL) => url.origin === origin && url.pathname.startsWith("/_next/static/chunks/") && url.pathname.endsWith(".js");
  const handler = (route: import("@playwright/test").Route) => {
    const work = (async () => {
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      const relevant = (await actual.body()).includes(Buffer.from(marker));
      if (relevant) {
        held = true;
        arrived.resolve();
        await released.promise;
      }
      // Preserve every actual byte/header/status; only delivery scheduling varies.
      await route.fulfill({ response: actual });
      if (relevant) delivered.resolve();
    })();
    active.add(work);
    void work.then(() => active.delete(work), error => {
      active.delete(work);
      terminalFailure = { error };
      arrived.reject(error);
      delivered.reject(error);
    });
    return work;
  };
  await page.route(scripts, handler);
  return {
    async waitForHeld() {
      // A bounded assertion observes the actual route latch; it is not a timing
      // delay, hydration guess or second user action.
      await expect.poll(() => held || !!terminalFailure, { timeout: 10000,
        message: "The actual required deal client module response must be held" }).toBe(true);
      if (terminalFailure) throw terminalFailure.error;
      await arrived.promise;
    },
    async release() { released.resolve(); await delivered.promise; },
    async close() {
      released.resolve();
      try {
        // Removing a route can continue its pending request. Finish every actual
        // delivery first so its handler remains the sole owner of fulfillment.
        while (active.size) await Promise.allSettled([...active]);
        if (terminalFailure) throw terminalFailure.error;
        if (held) await delivered.promise;
      } finally {
        await page.unroute(scripts, handler);
      }
    },
  };
}

async function watchJournalRestoration(
  page: import("@playwright/test").Page,
  input: import("@playwright/test").Locator,
  retryName: string,
) {
  await input.evaluate((element, name) => {
    const id = element.id;
    let earlyEnabled = false, journalSeen = false;
    const observe = () => {
      journalSeen ||= [...document.querySelectorAll("button")].some(button =>
        button.textContent?.trim() === name && button.getClientRects().length > 0);
      const current = document.getElementById(id);
      if (!journalSeen && current && !current.matches(":disabled") && !current.closest('[aria-disabled="true"]')) earlyEnabled = true;
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "hidden", "style", "class"] });
    const state = window as typeof window & {
      __infameJournalHydrationWitness?: { read: () => boolean; stop: () => void };
    };
    state.__infameJournalHydrationWitness = { read: () => earlyEnabled, stop: () => observer.disconnect() };
    observe();
  }, retryName);
  return {
    async sawEarlyEnabled() {
      return page.evaluate(() => (window as typeof window & {
        __infameJournalHydrationWitness?: { read: () => boolean };
      }).__infameJournalHydrationWitness?.read() ?? true);
    },
    async close() {
      await page.evaluate(() => {
        const state = window as typeof window & {
          __infameJournalHydrationWitness?: { stop: () => void };
        };
        state.__infameJournalHydrationWitness?.stop();
        delete state.__infameJournalHydrationWitness;
      });
    },
  };
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
  const hydration = await holdDealClient(page, "deal-compose");
  const firstCurrency = page.getByLabel(label("عملة العرض", "Offer currency"), { exact: true });
  const firstNote = page.getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true });
  try {
    await page.goto(`/brand/deals/new?campaignId=${f.campaign.id}&creatorId=${f.target.id}`, { waitUntil: "commit" });
    await hydration.waitForHeld();
    await expect(firstCurrency).toBeVisible();
    await expect(firstCurrency).toBeDisabled();
    await expect(firstNote).toBeDisabled();
    await hydration.release();
    await expect(firstCurrency).toBeEnabled();
    await expect(firstNote).toBeEnabled();
  } finally { await hydration.close(); }
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
  const resumeHydration = await holdDealClient(page, "deal-compose");
  try {
    await page.reload({ waitUntil: "commit" });
    await resumeHydration.waitForHeld();
    await expect(firstNote).toBeVisible();
    await expect(firstNote).toBeDisabled();
    await resumeHydration.release();
    await expect(firstNote).toBeEnabled();
    // Existing exact saved-note/currency assertions follow without being replaced.
  } finally { await resumeHydration.close(); }
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
  const hydration = await holdDealClient(page, "deal-compose");
  const currencyControl = page.getByLabel(label("عملة العرض", "Offer currency"), { exact: true });
  const amountControl = page.getByLabel(label("المبلغ", "Amount"), { exact: true });
  const addControl = page.getByRole("button", { name: label("أضف مخرجًا", "Add deliverable"), exact: true });
  try {
    await page.goto(`/brand/deals/new?${query}`, { waitUntil: "commit" });
    await hydration.waitForHeld();
    await expect(amountControl).toBeVisible();
    // Consequential RED: the current SSR form exposes enabled inputs without a
    // handler. API readiness is genuinely true from the existing assertion at419.
    await expect(currencyControl).toBeDisabled();
    await expect(amountControl).toBeDisabled();
    await expect(addControl).toBeDisabled();
    await hydration.release();
    await expect(currencyControl).toBeEnabled();
    await expect(amountControl).toBeEnabled();
    await expect(addControl).toBeEnabled();
  } finally { await hydration.close(); }
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
  await expect(amountControl).toHaveValue("5.000");
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
  // Native offer, acceptance and both confirmations above establish genuine
  // actual-party history before this page-boundary witness. This fixture stays
  // unbound; synthetic reviewed registry rows do not prove live legal readiness.
  const frozenBefore = AgreementContentSchema.parse(frozen.content);
  expect(frozenBefore.partiesSnapshot).toMatchObject({
    brandUserId: f.brandUserId,
    creatorUserId: f.target.userId,
    brandId: f.brandId,
    creatorId: f.target.id,
  });
  const historyBeforeResponse = await page.request.get(`/api/deals/${deal.id}`);
  expect(historyBeforeResponse.status()).toBe(200);
  expect(historyBeforeResponse.headers()["cache-control"]).toBe("private, no-store");
  const historyBefore = (await historyBeforeResponse.json()).data;
  expect(historyBefore).toMatchObject({
    id: deal.id,
    campaignId: f.campaign.id,
    creatorId: f.target.id,
    status: "AGREED",
    agreement: { id: frozen.id, version: frozen.version, ...frozenBefore },
  });
  const historyComposeURL = `/api/deals/compose?${query}&dealId=${deal.id}&view=CURRENT_EXECUTION`;
  const composeBeforeResponse = await page.request.get(historyComposeURL);
  expect(composeBeforeResponse.status()).toBe(200);
  expect(composeBeforeResponse.headers()["cache-control"]).toBe("private, no-store");
  const composeBefore = (await composeBeforeResponse.json()).data;
  expect(composeBefore).toMatchObject({
    campaign: { id: f.campaign.id },
    creator: {
      id: f.target.id,
      displayName: frozenBefore.partiesSnapshot.creatorName,
      handle: frozenBefore.partiesSnapshot.creatorHandle,
    },
    requirements: { campaignId: f.campaign.id, version: frozen.briefVersion },
  });
  // dealId belongs to existing-deal history, not fresh composition. In
  // particular, one genuine ID must not let the new page mount a fresh form.
  for (const invalidQuery of [
    `${query}&dealId=${deal.id}`,
    `${query}&dealId=${deal.id}&dealId=${deal.id}`,
    `${query}&unexpectedHistoryField=${deal.id}`,
  ]) {
    const invalid = await page.goto(`/brand/deals/new?${invalidQuery}`);
    expect(invalid?.status()).toBe(404);
    await expect(page.getByLabel(label("عملة العرض", "Offer currency"), { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: label("راجع العرض قبل الإرسال", "Review offer before sending"), exact: true })).toHaveCount(0);
  }
  const retainedPage = await page.goto(`/brand/deals/${deal.id}`);
  expect(retainedPage?.status()).toBe(200);
  const frozenTerms = page.getByRole("region", {
    name: `${label("نص الشروط كما تمت مراجعته", "Terms exactly as reviewed")} · ${frozenBefore.language === "ar" ? "العربية" : "English"}`,
    exact: true,
  });
  await expect(frozenTerms.getByText(frozenBefore.content, { exact: true })).toBeVisible();
  const historyAfterResponse = await page.request.get(`/api/deals/${deal.id}`);
  expect(historyAfterResponse.status()).toBe(200);
  expect((await historyAfterResponse.json()).data).toEqual(historyBefore);
  const composeAfterResponse = await page.request.get(historyComposeURL);
  expect(composeAfterResponse.status()).toBe(200);
  expect((await composeAfterResponse.json()).data).toEqual(composeBefore);
  expect(AgreementContentSchema.parse((await db.agreementSnapshot.findUniqueOrThrow({ where: { id: frozen.id } })).content)).toEqual(frozenBefore);
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
  const messageControl = page.getByLabel(label("رسالتك", "Your message"), { exact: true });
  const nativeHistory = page.locator("details").last();
  const nativeSummary = nativeHistory.locator("summary").first();
  const initialHydration = await holdDealClient(page, "deal-screen");
  try {
    await page.goto(`/brand/deals/${deal.id}`, { waitUntil: "commit" });
    await initialHydration.waitForHeld();
    await nativeSummary.scrollIntoViewIfNeeded();
    await expect(nativeSummary).toBeVisible();
    await expect(nativeHistory).not.toHaveAttribute("open", "");
    const heldBox = await nativeSummary.boundingBox();
    expect(heldBox).not.toBeNull();
    if (!heldBox) throw new Error("The observed native summary has no mouse target");
    // A real mouse action bypasses Locator's enabled wait and witnesses the
    // browser-native disclosure behavior while the required module is held.
    await page.mouse.click(heldBox.x + heldBox.width / 2, heldBox.y + heldBox.height / 2);
    await expect(nativeHistory).not.toHaveAttribute("open", "");
    await expect(messageControl).toBeVisible();
    await expect(messageControl).toBeDisabled();
    await initialHydration.release();
    await expect(messageControl).toBeEnabled();
    await nativeSummary.scrollIntoViewIfNeeded();
    const readyBox = await nativeSummary.boundingBox();
    expect(readyBox).not.toBeNull();
    if (!readyBox) throw new Error("The ready native summary has no mouse target");
    await page.mouse.click(readyBox.x + readyBox.width / 2, readyBox.y + readyBox.height / 2);
    await expect(nativeHistory).toHaveAttribute("open", "");
    // Restore the closed state for the original later Space-key witness.
    await nativeSummary.click();
    await expect(nativeHistory).not.toHaveAttribute("open", "");
  } finally { await initialHydration.close(); }
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
  const restoredRetry = page.getByRole("button", { name: label("أعد نفس الطلب بأمان", "Retry the same request safely"), exact: true });
  const restoreHydration = await holdDealClient(page, "deal-screen");
  let journalObserver: Awaited<ReturnType<typeof watchJournalRestoration>> | undefined;
  try {
    await page.reload({ waitUntil: "commit" });
    await restoreHydration.waitForHeld();
    await expect(messageControl).toBeVisible();
    // SSR cannot know the existing browser request journal. Inputs must remain
    // disabled until its actual storage snapshot has been restored.
    await expect(messageControl).toBeDisabled();
    journalObserver = await watchJournalRestoration(page, messageControl,
      label("أعد نفس الطلب بأمان", "Retry the same request safely"));
    await restoreHydration.release();
    await expect(restoredRetry).toBeVisible();
    await expect(restoredRetry).toBeEnabled();
    // A genuinely pending request keeps new input locked even AFTER hydration.
    await expect(messageControl).toBeDisabled();
    // Observe across release->restored Retry, not merely its two endpoints. Any
    // actionable empty-journal DOM commit is a failure, even if later relocked.
    expect(await journalObserver.sawEarlyEnabled()).toBe(false);
  } finally {
    try { await restoreHydration.close(); }
    finally { await journalObserver?.close(); }
  }
  await expect(
    page.getByRole("button", {
      name: label("أعد نفس الطلب بأمان", "Retry the same request safely"),
      exact: true,
    }),
  ).toBeVisible();
  const replayResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/deals/${deal.id}/commands` && response.request().method() === "POST");
  await page
    .getByRole("button", {
      name: label("أعد نفس الطلب بأمان", "Retry the same request safely"),
      exact: true,
    })
    .click();
  const replay = await replayResponse;
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data.replayed).toBe(true);
  await expect(messageControl).toBeEnabled();
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
    const hydration = await holdDealClient(tab, "deal-screen");
    const propose = tab.getByRole("button", { name: label("اقترح شروطًا معدّلة", "Propose revised terms"), exact: true });
    const amountControl = tab.getByLabel(label("المبلغ", "Amount"), { exact: true });
    const noteControl = tab.getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true });
    try {
      await tab.goto(`/brand/deals/${deal.id}`, { waitUntil: "commit" });
      await hydration.waitForHeld();
      await expect(propose).toBeVisible();
      await expect(propose).toBeDisabled();
      await hydration.release();
      await expect(propose).toBeEnabled();
      await propose.click(); // First actual click only; no retry.
      await expect(amountControl).toBeVisible();
      await expect(amountControl).toBeEnabled();
      await amountControl.fill(amount);
      await noteControl.fill(note);
      await expect(amountControl).toHaveValue(amount);
      await expect(noteControl).toHaveValue(note);
    } finally { await hydration.close(); }
  };
  const send = async (tab: import("@playwright/test").Page) => {
    const response = tab.waitForResponse(r => r.url().endsWith(`/api/deals/${deal.id}/commands`) && r.request().method() === "POST");
    await tab.getByRole("button", { name: label("أرسل الشروط المعدّلة", "Send revised terms"), exact: true }).click();
    return response;
  };
  await open(page, "4.999", "عرض معدل أصلي من التبويب الأول");
  await open(other, "4.998", "مدخل أصلي محفوظ في التبويب القديم");
  expect((await send(page)).status()).toBe(200);
  const firstCounterResponse = await page.request.get(`/api/deals/${deal.id}`);
  expect(firstCounterResponse.status()).toBe(200);
  const firstCounter = (await firstCounterResponse.json()).data;
  expect(firstCounter.currentOffer.terms.amount).toEqual({ amountMinor: "4999", currencyCode: "KWD" });
  expect(firstCounter.currentOffer.terms.note).toEqual({ text: "عرض معدل أصلي من التبويب الأول", language: "ar" });
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
  collectHydrationEvents(creatorContext, currentHydrationEvents(context));
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
  const cancel = page.getByRole("button", { name: label("ألغِ الصفقة بسبب واضح", "Cancel with a clear reason"), exact: true });
  const confirm = page.getByRole("button", { name: label("أكّد إلغاء الصفقة", "Confirm cancellation"), exact: true });
  const hydration = await holdDealClient(page, "deal-screen");
  try {
    await page.goto(`/brand/deals/${deal.id}`, { waitUntil: "commit" });
    await hydration.waitForHeld();
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeDisabled();
    await hydration.release();
    await expect(cancel).toBeEnabled();
    await cancel.click(); // First actual click only; no retry.
    await expect(confirm).toBeVisible();
  } finally { await hydration.close(); }
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
  const propose = page.getByRole("button", { name: label("اقترح شروطًا معدّلة", "Propose revised terms"), exact: true });
  const submit = page.getByRole("button", { name: label("أرسل الشروط المعدّلة", "Send revised terms"), exact: true });
  const note = page.getByLabel(label("ملاحظة العرض", "Offer note"), { exact: true });
  const hydration = await holdDealClient(page, "deal-screen");
  try {
    await page.goto(`/brand/deals/${deal.id}`, { waitUntil: "commit" });
    await hydration.waitForHeld();
    await expect(propose).toBeVisible();
    await expect(propose).toBeDisabled();
    await hydration.release();
    // Editing remains available after client readiness even though real policy
    // readiness is blocked. Submission eligibility is a separate existing gate.
    await expect(propose).toBeEnabled();
    await propose.click();
    await expect(note).toBeVisible();
    await expect(note).toBeEnabled();
  } finally { await hydration.close(); }
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
  // Restore the same synthetic reviewed policy so protected CURRENT data is
  // genuinely available before exercising an authoritative denial boundary.
  await db.policyVersion.update({ where: { id: f.marketId }, data: { status: "VERIFIED" } });
  const load = page.getByRole("button", { name: label("حمّل الحالة الحالية", "Load current state"), exact: true });
  const actualCurrent = page.waitForResponse(response => new URL(response.url()).pathname === "/api/deals/compose"
    && response.request().method() === "GET" && response.status() === 200);
  await load.click();
  const currentResponse = await actualCurrent;
  expect((await currentResponse.json()).data).toMatchObject({ kind: "CURRENT", readiness: { canSend: true } });
  await expect(load).toBeEnabled();
  await expect(note).toHaveValue("مدخل أصلي محفوظ أثناء مراجعة السياسة");
  const save = page.getByRole("button", { name: label("احفظ مسودة العرض الخاصة", "Save private offer draft"), exact: true });
  const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/deals/drafts"
    && response.request().method() === "POST");
  await save.click();
  expect((await savedResponse).status()).toBe(200);
  await expect(save).toBeEnabled();

  const cookie = (await context.cookies(origin)).find(cookie => cookie.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  if (!cookie) throw new Error("The actual signed browser session cookie is absent");
  const capturedSession = await resolveSession(cookie.value);
  expect(capturedSession).not.toBeNull();
  if (!capturedSession) throw new Error("The actual browser session did not resolve before revocation");
  let actualHistory200 = false, actualComposeDenied = false;
  const dealPath = `/api/deals/${deal.id}`;
  const historyRoute = (url: URL) => url.origin === origin && url.pathname === dealPath;
  const composeRoute = (url: URL) => url.origin === origin && url.pathname === "/api/deals/compose"
    && url.searchParams.get("dealId") === deal.id && url.searchParams.get("view") === "CURRENT_EXECUTION";
  const afterHistory = async (route: import("@playwright/test").Route) => {
    const actual = await route.fetch();
    expect(route.request().method()).toBe("GET");
    expect(actual.status()).toBe(200);
    actualHistory200 = true;
    // Revoke the actual captured native session only AFTER genuine history GET
    // succeeds and BEFORE its unchanged response lets the caller request compose.
    await db.authSession.update({ where: { id: capturedSession.sessionId }, data: { revokedAt: new Date() } });
    expect(await resolveSession(cookie.value)).toBeNull();
    await route.fulfill({ response: actual });
  };
  const deniedCompose = async (route: import("@playwright/test").Route) => {
    expect(actualHistory200).toBe(true);
    const actual = await route.fetch();
    expect(route.request().method()).toBe("GET");
    expect(actual.status()).toBe(401);
    actualComposeDenied = true;
    // Disclosed negative delivery: retain the real native401 status/headers,
    // but make its denial body malformed to require status-before-JSON handling.
    // This is not a manufactured authentication/readiness response.
    await route.fulfill({ response: actual, body: "{synthetic_native_auth_denial_malformed" });
  };
  await page.route(historyRoute, afterHistory);
  await page.route(composeRoute, deniedCompose);
  try {
    const denial = page.waitForResponse(response => composeRoute(new URL(response.url())) && response.status() === 401);
    await load.click();
    expect((await denial).status()).toBe(401);
    await expect(load).toBeEnabled(); // Current asynchronous reload has settled.
    expect(actualHistory200).toBe(true); expect(actualComposeDenied).toBe(true);
    await expect(page.getByText(label(
      "تم تحميل الحالة الحالية. مدخلاتك ما تغيرت؛ راجع النسخ قبل إجراء جديد.",
      "The current state is loaded. Your entries are unchanged; review versions before another action.",
    ), { exact: true })).toHaveCount(0);
    // Authoritative denial removes/locks protected CURRENT controls even when
    // the response body cannot parse. No stale private draft/template may act.
    for (const control of [note, save,
      page.getByLabel(label("نسخة الشروط", "Terms version"), { exact: true }), submit]) {
      if (await control.count()) {
        expect(await control.isVisible() && await control.isEnabled()).toBe(false);
      }
    }
  } finally {
    await page.unroute(historyRoute, afterHistory);
    await page.unroute(composeRoute, deniedCompose);
  }

  // Reauthentication is an explicit test user action after denial has been
  // proved, never automatic domain/API renewal or a denial bypass.
  await signIn(context, f.brandEmail, f.password);
  const recoveredCurrent = page.waitForResponse(response => composeRoute(new URL(response.url())) && response.status() === 200);
  await load.click();
  const recovered = await recoveredCurrent;
  expect((await recovered.json()).data).toMatchObject({ kind: "CURRENT", readiness: { canSend: true } });
  await expect(load).toBeEnabled();
  // Re-open after an authoritative CURRENT result if denial closed the editor.
  if (!await note.count() || !await note.isVisible()) await propose.click();
  await expect(note).toBeVisible();
  await expect(note).toHaveValue("مدخل أصلي محفوظ أثناء مراجعة السياسة");
  await expect(save).toBeEnabled();
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
        actor === f.brandUserId ? f.options : f.creatorOptions,
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
  const paymentCheck = page.getByLabel(label(
    "أصرح بأنني دفعت المقابل للطرف الآخر، وأفهم أن إنفيم لا يتحقق من هذا الدفع.",
    "I declare that I paid the other party and understand that Infame does not verify this payment.",
  ), { exact: true });
  const paymentHydration = await holdDealClient(page, "deal-screen");
  try {
    await page.reload({ waitUntil: "commit" });
    await paymentHydration.waitForHeld();
    await expect(paymentCheck).toBeVisible();
    await expect(paymentCheck).toBeDisabled();
    await paymentHydration.release();
    await expect(paymentCheck).toBeEnabled();
  } finally { await paymentHydration.close(); }
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
  // A real pre-transfer MESSAGE makes the retained-word witness nonempty.
  const oldHistoryText = "رسالة أصلية محفوظة قبل نقل الملكية";
  const messageInput = page.getByLabel(label("رسالتك", "Your message"), { exact: true });
  const sentBeforeTransfer = page.waitForResponse(response => new URL(response.url()).pathname === `/api/deals/${deal.id}/commands`
    && response.request().method() === "POST");
  await messageInput.fill(oldHistoryText);
  await page.getByRole("button", { name: label("أرسل الرسالة", "Send message"), exact: true }).click();
  expect((await sentBeforeTransfer).status()).toBe(200);
  await expect(page.locator("p").filter({ hasText: new RegExp(`^${oldHistoryText}$`) })).toBeVisible();
  const baselineResponse = await page.request.get(`/api/deals/${deal.id}`);
  expect(baselineResponse.status()).toBe(200);
  const baselineHistory = (await baselineResponse.json()).data;
  expect(baselineHistory.status).toBe("COMPLETED");
  expect(baselineHistory.agreement.contentHash).toBe(frozen.contentHash);
  const originalCreatorCookies = await context.cookies(origin);
  await signIn(context, f.brandEmail, f.password);
  const originalBrandCookies = await context.cookies(origin);
  // Cookies above are genuine existing native sessions captured BEFORE transfer.
  // No session is renewed to bypass the later suspension or an auth denial.
  const replacementBrandId = await user("BRAND"), replacementCreatorId = await user("CREATOR");
  const replacementBrand = await nativeDealActor(replacementBrandId, "e2e");
  const replacementCreator = await nativeDealActor(replacementCreatorId, "e2e");
  const privateCanary = `SYNTHETIC_TRANSFERRED_PRIVATE_${randomUUID()}`;
  const currentCampaign = await db.campaign.findUniqueOrThrow({ where: { id: f.campaign.id }, select: { input: true } });
  const currentInput = currentCampaign.input as Record<string, import("@prisma/client").Prisma.JsonValue>;
  await db.campaign.update({ where: { id: f.campaign.id }, data: { title: privateCanary,
    input: { ...currentInput, fields: { ...(currentInput.fields as Record<string, import("@prisma/client").Prisma.JsonValue>), title: privateCanary } } } });
  await db.brand.update({ where: { id: f.brandId }, data: { userId: replacementBrandId, name: privateCanary,
    description: privateCanary, state: "PRIVATE", profileFacts: { privateHistoryProbe: privateCanary } } });
  await db.creator.update({ where: { id: f.target.id }, data: { userId: replacementCreatorId, displayName: privateCanary,
    state: "PRIVATE", brandVisible: false, availability: { status: "UNKNOWN", privateHistoryProbe: privateCanary } } });
  let expectedMessages = baselineHistory.messages;

  for (const original of [
    { role: "BRAND" as const, cookies: originalBrandCookies, path: "brand", userId: f.brandUserId },
    { role: "CREATOR" as const, cookies: originalCreatorCookies, path: "creator", userId: f.target.userId },
  ]) {
    await context.addCookies(original.cookies);
    const retainedResponse = await page.request.get(`/api/deals/${deal.id}`);
    expect(retainedResponse.status()).toBe(200);
    const retained = (await retainedResponse.json()).data;
    expect(retained).toMatchObject({ id: deal.id, status: "COMPLETED", approvedBrief: baselineHistory.approvedBrief,
      agreement: baselineHistory.agreement });
    expect(retained.messages).toEqual(expectedMessages);
    expect(JSON.stringify(retained).includes(privateCanary)).toBe(false);
    const listResponse = await page.request.get("/api/deals");
    expect(listResponse.status()).toBe(200);
    const listed = (await listResponse.json()).data;
    expect(listed.deals.find((row: { id: string }) => row.id === deal.id)).toMatchObject({ approvedBrief: baselineHistory.approvedBrief,
      agreement: baselineHistory.agreement });
    expect(listed.deals.find((row: { id: string }) => row.id === deal.id).messages).toEqual(expectedMessages);
    expect(JSON.stringify(listed).includes(privateCanary)).toBe(false);
    const historyURL = `/api/deals/compose?campaignId=${f.campaign.id}&creatorId=${f.target.id}&dealId=${deal.id}`;
    const historyResponse = await page.request.get(historyURL);
    expect(historyResponse.status()).toBe(200);
    const pinned = (await historyResponse.json()).data;
    expect(pinned).toMatchObject({ kind: "HISTORY_ONLY", approvedBrief: baselineHistory.approvedBrief,
      campaign: { title: baselineHistory.approvedBrief.content.requirements.title },
      parties: { brand: { userId: f.brandUserId, name: frozen.partiesSnapshot.brandName },
        creator: { userId: f.target.userId, name: frozen.partiesSnapshot.creatorName, handle: frozen.partiesSnapshot.creatorHandle } },
      readiness: { canSend: false, blockedReasons: ["HISTORY_ONLY"] } });
    expect(JSON.stringify(pinned).includes(privateCanary)).toBe(false);
    const unavailable = await page.request.get(`${historyURL}&view=CURRENT_EXECUTION`);
    expect(unavailable.status()).toBe(409);
    const unavailableBody = await unavailable.json();
    expect(unavailableBody.error.code).toBe("CURRENT_EXECUTION_UNAVAILABLE");
    expect(JSON.stringify(unavailableBody).includes(privateCanary)).toBe(false);

    // Observe an actual Next client navigation/preload response, not a guessed
    // RSC header or fabricated stream. Hard list navigation resets router cache.
    const detailPath = `/${original.path}/deals/${deal.id}`;
    const rsc = page.waitForResponse(response => new URL(response.url()).pathname === detailPath
      && (response.headers()["content-type"] ?? "").includes("text/x-component"));
    const listPageResponse = await page.goto(`/${original.path}/deals`);
    expect(listPageResponse?.status()).toBe(200);
    expect((await listPageResponse!.text()).includes(privateCanary)).toBe(false);
    await page.locator(`a[href="${detailPath}"]`).first().click();
    const rscResponse = await rsc;
    expect(rscResponse.status()).toBe(200);
    expect((await rscResponse.text()).includes(privateCanary)).toBe(false);
    await expect(page.getByText(frozen.content, { exact: true })).toBeVisible();
    await page.locator("summary").filter({ hasText: label("متطلبات الموجز المعتمدة", "Approved brief requirements") }).first().click();
    await expect(page.getByText(baselineHistory.approvedBrief.content.requirements.title, { exact: true }).first()).toBeVisible();
    await expect(page.locator("p").filter({ hasText: new RegExp(`^${oldHistoryText}$`) })).toBeVisible();
    expect((await page.locator("body").innerText()).includes(privateCanary)).toBe(false);
    const ssr = await page.request.get(detailPath);
    expect(ssr.status()).toBe(200);
    expect((await ssr.text()).includes(privateCanary)).toBe(false);
    for (const name of [label("اقترح شروطًا معدّلة", "Propose revised terms"), label("أكّد هذا الاتفاق", "Confirm this agreement")]) {
      const control = page.getByRole("button", { name, exact: true });
      if (await control.count()) expect(await control.isVisible() && await control.isEnabled()).toBe(false);
    }
    const newHistoryText = original.role === "BRAND" ? "رسالة أصلية من الشركة بعد نقل الملكية" : "رسالة أصلية من المنشئ بعد نقل الملكية";
    const sentAfterTransfer = page.waitForResponse(response => new URL(response.url()).pathname === `/api/deals/${deal.id}/commands`
      && response.request().method() === "POST");
    await messageInput.fill(newHistoryText);
    await page.getByRole("button", { name: label("أرسل الرسالة", "Send message"), exact: true }).click();
    const sent = await sentAfterTransfer;
    expect(sent.status()).toBe(200);
    const actual = (await sent.json()).data.deal;
    expect(actual.messages).toEqual(expect.arrayContaining(expectedMessages));
    expect(actual.messages).toHaveLength(expectedMessages.length + 1);
    expect(actual.messages.some((row: { senderUserId: string; text: { text: string } }) => row.senderUserId === original.userId && row.text.text === newHistoryText)).toBe(true);
    expect(actual.messages.some((row: { text: { text: string } }) => row.text.text === oldHistoryText)).toBe(true);
    expect(actual.agreement).toEqual(baselineHistory.agreement);
    expect(actual.approvedBrief).toEqual(baselineHistory.approvedBrief);
    expect(JSON.stringify(actual).includes(privateCanary)).toBe(false);
    expectedMessages = actual.messages;
  }

  for (const replacement of [replacementBrand, replacementCreator]) {
    const deniedContext = await context.browser()!.newContext({ baseURL: origin });
    collectHydrationEvents(deniedContext, currentHydrationEvents(context));
    try {
      await deniedContext.addCookies([{ name: SESSION_COOKIE, value: replacement.token, url: origin, httpOnly: true, sameSite: "Lax" }]);
      const deniedPage = await deniedContext.newPage();
      const foreignHistory = await deniedPage.request.get(`/api/deals/${deal.id}`);
      expect(foreignHistory.status()).toBe(404);
      const foreignHistoryBody = await foreignHistory.text();
      expect(foreignHistoryBody.includes(frozen.content)).toBe(false);
      expect(foreignHistoryBody.includes(oldHistoryText)).toBe(false);
      const foreignList = await deniedPage.request.get("/api/deals");
      expect(foreignList.status()).toBe(200);
      expect((await foreignList.json()).data.deals.some((row: { id: string }) => row.id === deal.id)).toBe(false);
    } finally { await deniedContext.close(); }
  }
  // Restore the original Creator's SAME captured cookie for the untouched final
  // suspension/API401/login assertions. No reactivation or session mint occurs.
  await context.addCookies(originalCreatorCookies);
  await page.goto(`/creator/deals/${deal.id}`);
  await expect(page.getByText(frozen.content, { exact: true })).toBeVisible();
  expect(await db.deal.count({ where: { campaignId: f.campaign.id } })).toBe(1);
  expect(await db.agreementSnapshot.count({ where: { dealId: deal.id } })).toBe(1);
  await db.user.update({
    where: { id: f.target.userId },
    data: { active: false },
  });
  expect((await page.request.get(`/api/deals/${deal.id}`)).status()).toBe(401);
  await page.goto(`/creator/deals/${deal.id}`);
  await expect(page).toHaveURL(/\/login/);
});
