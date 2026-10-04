import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { CampaignRequirementsSchema, parseBriefContent } from "@/lib/campaigns/contracts";
import { applyCampaignMutation, approveCampaignBrief, createCampaign, generateCampaignBrief, getCampaign, getApprovedRequirements } from "@/lib/campaigns/service";
import { campaignFields as fields } from "./fixtures";

const users: string[] = [];
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: "Synthetic campaign", email: `${id}@example.invalid`, passwordHash: "not-a-login", role, isTest: true } });
  users.push(id);
  if (role === "BRAND") await prisma.brand.create({ data: { userId: id, slug: `brand-${id}`, name: "شركة أصلية", countryCode: "KW", timeZone: "Asia/Kuwait" } });
  return id;
}
afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { OR: users.map((id) => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.deal.deleteMany({ where: { brand: { userId: { in: users } } } });
  await prisma.campaign.deleteMany({ where: { brand: { userId: { in: users } } } });
  await prisma.creator.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});
async function created(owner: string, initial: Record<string, unknown> = fields) {
  return (await createCampaign(owner, { operationKey: randomUUID(), fields: initial })).campaign;
}
async function generated(owner: string) {
  const campaign = await created(owner);
  return generateCampaignBrief(owner, campaign.id, { operationKey: randomUUID(), expectedRevision: campaign.revision });
}

describe("brand-owned durable campaign requirements and immutable approval", () => {
  it("creates once across separate connections, resumes original text and requires current active BRAND ownership", async () => {
    const owner = await actor(), second = new PrismaClient(), input = { operationKey: randomUUID(), fields: { title: "عنوان أصلي" } };
    try {
      const results = await Promise.all([createCampaign(owner, input), createCampaign(owner, input, second)]);
      expect(results[0].campaign.id).toBe(results[1].campaign.id);
      expect(results.map((item) => item.replayed).sort()).toEqual([false, true]);
      const campaign = await getCampaign(owner, results[0].campaign.id);
      expect(campaign.fields.title).toBe("عنوان أصلي");
      expect(campaign.fields.budget).toBeUndefined();
      expect(campaign.fields.marketCountryCodes).toBeUndefined();
      expect(campaign.fields.desiredCreatorCount).toBe(1);
      await expect(createCampaign(owner, { ...input, fields: { title: "Changed same key" } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      await expect(getCampaign(await actor(), campaign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(createCampaign(await actor("CREATOR"), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.user.update({ where: { id: owner }, data: { active: false } });
      await expect(getCampaign(owner, campaign.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await second.$disconnect(); }
  });

  it("validates full schema, exact money and country/time/format without guessing policy assertions", async () => {
    const owner = await actor(), campaign = await created(owner);
    const draft = await generateCampaignBrief(owner, campaign.id, { operationKey: randomUUID(), expectedRevision: campaign.revision });
    expect(draft.brief.content.requirements.budget).toEqual(fields.budget);
    expect(draft.brief.content.requirements.brandCountryCode).toBe("KW");
    expect(draft.brief.content.requirements.mandatoryPolicyVersionIds).toEqual([]);
    expect(draft.brief.content.policyReview).toBeNull();
    expect(draft.brief.approvedAt).toBeNull();
    expect(() => parseBriefContent({ ...draft.brief.content, requirements: { ...draft.brief.content.requirements, mandatoryPolicyVersionIds: ["forged-mandatory"] } })).toThrow();
    expect(() => parseBriefContent({ ...draft.brief.content, policyReview: { reviewed: true, resolverVersion: "synthetic-v1", reviewedAt: new Date().toISOString(), marketCountryCodes: ["JP"], mandatoryPolicyVersionIds: [] } })).toThrow();
    for (const patch of [
      { budget: { amountMinor: 1000, currencyCode: "KWD" } }, { budget: { amountMinor: "001", currencyCode: "KWD" } },
      { marketCountryCodes: ["ZZ"] }, { period: { ...fields.period, timeZone: "not/a_zone" } },
      { period: { ...fields.period, startsAt: fields.period.endsAt } }, { deliverables: [{ platform: "TIKTOK", format: "REEL", count: 1 }] },
      { desiredCreatorCount: 13 }, { mandatoryPolicyVersionIds: ["model-invented"] }, { policyReview: { reviewed: true } },
    ]) await expect(applyCampaignMutation(owner, campaign.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: draft.campaign.revision, payload: { patch } })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
    const partial = await created(owner, { title: "Missing explicit fields" });
    await expect(generateCampaignBrief(owner, partial.id, { operationKey: randomUUID(), expectedRevision: partial.revision })).rejects.toMatchObject({ code: "MISSING_REQUIREMENTS" });
  });

  it("chat/paragraph proposals use form fields, remain proposed until explicit application, and cannot approve", async () => {
    const owner = await actor(), form = await created(owner, {}), chat = await created(owner, {});
    const formSaved = await applyCampaignMutation(owner, form.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: form.revision, payload: { patch: fields } });
    const proposed = await applyCampaignMutation(owner, chat.id, { action: "PROPOSE_FIELDS", operationKey: randomUUID(), expectedRevision: chat.revision,
      payload: { type: "PROPOSE_FIELDS", patch: fields, originalText: { text: "فقرة أصلية", language: "ar" } } }, prisma, { channel: "CHAT_TOOL" });
    expect(proposed.campaign.fields.budget).toBeUndefined();
    const applied = await applyCampaignMutation(owner, chat.id, { action: "APPLY_PROPOSAL", operationKey: randomUUID(), expectedRevision: proposed.campaign.revision, payload: { proposalId: proposed.proposalId } });
    expect(applied.campaign.fields).toEqual(formSaved.campaign.fields);
    await expect(applyCampaignMutation(owner, chat.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: applied.campaign.revision, payload: { patch: { title: "Tool cannot commit" } } }, prisma, { channel: "CHAT_TOOL" })).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED" });
    const brief = await generateCampaignBrief(owner, chat.id, { operationKey: randomUUID(), expectedRevision: applied.campaign.revision });
    await expect(approveCampaignBrief(owner, chat.id, { operationKey: randomUUID(), expectedRevision: brief.campaign.revision, briefId: brief.brief.id, expectedBriefVersion: brief.brief.version }, prisma, { channel: "CHAT_TOOL" })).rejects.toMatchObject({ code: "EXPLICIT_CONFIRMATION_REQUIRED" });
  });

  it("records exactly one focused clarification per turn, caps five and excludes server greetings", async () => {
    const owner = await actor(), campaign = await created(owner, {});
    let current = (await applyCampaignMutation(owner, campaign.id, { action: "GREETING", operationKey: randomUUID(), expectedRevision: campaign.revision, payload: { text: { text: "مرحباً", language: "ar" } } }, prisma, { channel: "SERVER" })).campaign;
    expect(current.clarificationCount).toBe(0);
    for (const field of ["title", "productService", "goal", "marketCountryCodes", "budget"]) {
      current = (await applyCampaignMutation(owner, campaign.id, { action: "ASK_CLARIFICATION", operationKey: randomUUID(), expectedRevision: current.revision, payload: { field, text: { text: "سؤال واحد؟", language: "ar" } } }, prisma, { channel: "CHAT_TOOL" })).campaign;
    }
    expect(current.clarificationCount).toBe(5);
    await expect(applyCampaignMutation(owner, campaign.id, { action: "ASK_CLARIFICATION", operationKey: randomUUID(), expectedRevision: current.revision, payload: { field: "period", text: { text: "السادس؟", language: "ar" } } }, prisma, { channel: "CHAT_TOOL" })).rejects.toMatchObject({ code: "QUESTION_LIMIT" });
    await expect(applyCampaignMutation(owner, campaign.id, { action: "ASK_CLARIFICATION", operationKey: randomUUID(), expectedRevision: current.revision, payload: { fields: ["period", "tone"], text: { text: "سؤالان؟", language: "ar" } } }, prisma, { channel: "CHAT_TOOL" })).rejects.toMatchObject({ code: "INVALID_COMMAND" });
  });

  it("preserves immutable approved history and deal-independent content when material changes create a new version", async () => {
    const owner = await actor(), draft = await generated(owner);
    const approval = { operationKey: randomUUID(), expectedRevision: draft.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version };
    const approved = await approveCampaignBrief(owner, draft.campaign.id, approval);
    expect((await approveCampaignBrief(owner, draft.campaign.id, approval)).replayed).toBe(true);
    const before = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: draft.brief.id } });
    const creatorUser = await actor("CREATOR");
    const creator = await prisma.creator.create({ data: { userId: creatorUser, handle: `fixture_${creatorUser.slice(0, 8)}`, displayName: "Synthetic creator" } });
    const brand = await prisma.brand.findUniqueOrThrow({ where: { userId: owner } });
    const deal = await prisma.deal.create({ data: { campaignId: draft.campaign.id, creatorId: creator.id, brandId: brand.id, briefVersion: 1, status: "ACCEPTED", acceptedOfferVersion: 1, agreementVersion: 1 } });
    await prisma.dealOffer.create({ data: { dealId: deal.id, version: 1, proposerUserId: owner, recipientUserId: creatorUser, status: "ACCEPTED", terms: { fixture: true, amount: fields.budget } } });
    const agreement = await prisma.agreementSnapshot.create({ data: { dealId: deal.id, version: 1, offerVersion: 1, briefVersion: 1, content: { fixture: true, requirements: approved.brief.content.requirements } } });
    const edit = await applyCampaignMutation(owner, draft.campaign.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: approved.campaign.revision, payload: { patch: { desiredCreatorCount: 2, title: "نسخة ثانية" } } });
    expect(edit.campaign.currentBriefVersion).toBeNull();
    expect(edit.campaign.briefs.map((brief) => brief.version)).toEqual([1, 2]);
    expect(await prisma.campaignBrief.findUniqueOrThrow({ where: { id: draft.brief.id } })).toEqual(before);
    expect(await prisma.agreementSnapshot.findUniqueOrThrow({ where: { id: agreement.id } })).toEqual(agreement);
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toEqual(deal);
    await expect(getApprovedRequirements(owner, draft.campaign.id)).rejects.toMatchObject({ code: "BRIEF_NOT_APPROVED" });
    expect(CampaignRequirementsSchema.parse(edit.campaign.briefs[1].content.requirements).title).toBe("نسخة ثانية");
  });

  it("has one winner for concurrent revisions and creates one approval event for concurrent exact replay", async () => {
    const owner = await actor(), draft = await generated(owner), second = new PrismaClient();
    try {
      const approval = { operationKey: randomUUID(), expectedRevision: draft.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version };
      const approvals = await Promise.all([approveCampaignBrief(owner, draft.campaign.id, approval), approveCampaignBrief(owner, draft.campaign.id, approval, second)]);
      expect(approvals.map((item) => item.replayed).sort()).toEqual([false, true]);
      const current = approvals[0].campaign;
      const results = await Promise.allSettled([
        applyCampaignMutation(owner, current.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: current.revision, payload: { patch: { title: "One" } } }),
        applyCampaignMutation(owner, current.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: current.revision, payload: { patch: { title: "Two" } } }, second),
      ]);
      expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect((results.find((item) => item.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "STALE_VERSION" });
      expect(await prisma.outboxEvent.count({ where: { type: "brief.approved", payload: { path: ["aggregateId"], equals: current.id } } })).toBe(1);
    } finally { await second.$disconnect(); }
  });

  it("refuses nonowner/stale approval and does not auto-approve a mutation racing approval", async () => {
    const owner = await actor(), draft = await generated(owner), second = new PrismaClient();
    const approval = { operationKey: randomUUID(), expectedRevision: draft.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version };
    await expect(approveCampaignBrief(await actor(), draft.campaign.id, approval)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(approveCampaignBrief(owner, draft.campaign.id, { ...approval, expectedBriefVersion: 99 })).rejects.toMatchObject({ code: "STALE_BRIEF" });
    try {
      const results = await Promise.allSettled([approveCampaignBrief(owner, draft.campaign.id, approval), applyCampaignMutation(owner, draft.campaign.id, { action: "UPDATE_FIELDS", operationKey: randomUUID(), expectedRevision: draft.campaign.revision, payload: { patch: { budget: { amountMinor: "500000", currencyCode: "KWD" } } } }, second)]);
      expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      const current = await getCampaign(owner, draft.campaign.id);
      if (current.fields.budget?.amountMinor === "500000") expect(current.currentBriefVersion).toBeNull();
      else expect((await getApprovedRequirements(owner, current.id)).budget).toEqual(fields.budget);
    } finally { await second.$disconnect(); }
  });

  it("linearizes current-role revocation with approval across separate connections", async () => {
    const owner = await actor(), draft = await generated(owner), second = new PrismaClient();
    try {
      const [approval] = await Promise.allSettled([
        approveCampaignBrief(owner, draft.campaign.id, { operationKey: randomUUID(), expectedRevision: draft.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version }),
        second.user.update({ where: { id: owner }, data: { role: "CREATOR" } }),
      ]);
      const persisted = await prisma.campaignBrief.findUniqueOrThrow({ where: { id: draft.brief.id } });
      if (approval.status === "fulfilled") expect(persisted.approvedByUserId).toBe(owner);
      else { expect(approval.reason).toMatchObject({ code: "FORBIDDEN" }); expect(persisted.approvedAt).toBeNull(); }
      await expect(getCampaign(owner, draft.campaign.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await second.$disconnect(); }
  });

  it("reapproval with a new key preserves shortlisted lifecycle and does not enqueue another approval event", async () => {
    const owner = await actor(), draft = await generated(owner);
    const approved = await approveCampaignBrief(owner, draft.campaign.id, { operationKey: randomUUID(), expectedRevision: draft.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version });
    await prisma.campaign.update({ where: { id: draft.campaign.id }, data: { status: "SHORTLISTED" } });
    const repeat = await approveCampaignBrief(owner, draft.campaign.id, { operationKey: randomUUID(), expectedRevision: approved.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version });
    expect(repeat.campaign.status).toBe("SHORTLISTED");
    expect(await prisma.outboxEvent.count({ where: { type: "brief.approved", payload: { path: ["aggregateId"], equals: draft.campaign.id } } })).toBe(1);
  });

  it("generates a new unapproved snapshot when explicit brand country changed without mutating the old brief", async () => {
    const owner = await actor(), draft = await generated(owner);
    const approved = await approveCampaignBrief(owner, draft.campaign.id, { operationKey: randomUUID(), expectedRevision: draft.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version });
    await prisma.brand.update({ where: { userId: owner }, data: { countryCode: "JP" } });
    await expect(approveCampaignBrief(owner, draft.campaign.id, { operationKey: randomUUID(), expectedRevision: approved.campaign.revision, briefId: draft.brief.id, expectedBriefVersion: draft.brief.version })).rejects.toMatchObject({ code: "STALE_BRIEF" });
    const refreshed = await generateCampaignBrief(owner, draft.campaign.id, { operationKey: randomUUID(), expectedRevision: approved.campaign.revision });
    expect(refreshed.brief.version).toBe(2);
    expect(refreshed.brief.content.requirements.brandCountryCode).toBe("JP");
    expect(refreshed.brief.approvedAt).toBeNull();
    expect(refreshed.campaign.currentBriefVersion).toBeNull();
    expect((await prisma.campaignBrief.findUniqueOrThrow({ where: { id: draft.brief.id } })).content).toEqual(approved.brief.content);
  });
});
