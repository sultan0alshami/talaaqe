import { describe, expect, it } from "vitest";
import {
  MatchingCampaignResponseSchema, MatchingCampaignSummarySchema, MatchingRunSchema, MatchingDecisionReceiptSchema,
  RunCommandSchema, DecisionCommandSchema, summarizeMatchingCampaign, matchesDecisionReceipt, matchesRunReceipt,
  type MatchingCampaignResponse, type MatchingRunDTO, type MatchingDecisionReceipt,
} from "@/lib/matching/contracts";
import { CampaignFieldsSchema, CampaignFieldObjectSchema, CampaignBriefContentSchema } from "@/lib/campaigns/contracts";
import { shortlist } from "@/lib/matching/strategy";
import type { CampaignInput, CreatorInput, Evidence, Fact, MatchingAccount } from "@/lib/matching/types";
import { campaignFields } from "../campaigns/fixtures";

// Root alone runs this independently authored pure contract suite. Samples are synthetic; the
// result rows come from the actual unchanged matcher, never a claimed native
// provider/legal/public-identity proof. No DB, server module or .test import.
const now = "2026-10-01T00:00:00.000Z";
const period = { startsAt: "2026-10-10T00:00:00.000Z", endsAt: "2026-10-20T00:00:00.000Z", timeZone: "Asia/Riyadh" };
const measuredWindow = { startsAt: "2026-09-01T00:00:00.000Z", endsAt: now, timeZone: "Asia/Riyadh" };
const sources = ["API", "SCREENSHOT_VERIFIED", "SELF_REPORTED", "PUBLIC_IMPORT"] as const;
function evidence(source: Evidence["source"] = "API"): Evidence {
  return { source, evidenceAt: now, reviewStatus: "APPROVED", visibility: "BRAND_ONLY", version: "synthetic-contract-evidence-v1" };
}
function fact<T>(value: T, source: Evidence["source"] = "API"): Fact<T> { return { value, evidence: evidence(source) }; }
function account(source: Evidence["source"] = "API"): MatchingAccount {
  return { id: "synthetic-account-a", platform: "INSTAGRAM", ownershipStatus: "VERIFIED", approved: true,
    visibility: "BRAND_ONLY", evidence: evidence(source), supportedFormats: ["REEL", "STORY"], followers: fact(10001, source),
    engagementPct: fact(3.2, source), engagementContext: { unit: "PERCENT", window: measuredWindow, definition: "engagements / followers" },
    averageViews: [], audience: { age: fact([{ key: "18-24", percent: 100 }], source), gender: fact([{ key: "FEMALE", percent: 100 }], source),
      countries: fact([{ key: "SA", percent: 100 }], source), cities: fact([{ key: "SA:riyadh", percent: 100 }], source) } };
}
function creator(source: Evidence["source"] = "API"): CreatorInput {
  return { id: "synthetic-creator-a", claimStatus: "CLAIMED", hidden: false, suspended: false, isTest: false, eligible: true,
    brandVisible: true, residenceCountryCode: "GB", contentLanguages: ["ar"], dialects: ["ar-Gulf"],
    availability: { status: "AVAILABLE", period, confirmedAt: now }, travelWilling: false, travelCountryCodes: [],
    nicheSlugs: fact(["beauty"], source), fameIndustries: null, accounts: [account(source)],
    rates: [{ creatorId: "synthetic-creator-a", platform: "INSTAGRAM", format: "REEL", amount: { amountMinor: "10000", currencyCode: "SAR" } }],
    minimumDeal: null, licences: [], policyOutcomes: [], safetyExclusions: [] };
}
function campaignInput(partialQuote = false): CampaignInput {
  return { id: "synthetic-campaign-a", briefVersion: 1, approved: true, budget: { amountMinor: "10000", currencyCode: "SAR" },
    desiredCreatorCount: 1, allocationOrdinal: 0, impressionsTarget: 1000, period,
    deliverables: partialQuote ? [{ platform: "INSTAGRAM", format: "REEL", count: 1 }, { platform: "INSTAGRAM", format: "STORY", count: 1 }]
      : [{ platform: "INSTAGRAM", format: "REEL", count: 1 }],
    targetAgeBuckets: ["18-24"], targetGenders: ["FEMALE"], targetCountryCodes: ["SA"], targetCityKeys: ["SA:riyadh"],
    contentLanguages: ["ar"], dialects: ["ar-Gulf"], nicheSlugs: ["beauty"], marketCountryCodes: ["SA"],
    physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, preferredTiers: [],
    dataVerificationRequired: false, preferredLicencePolicyIds: [], mandatoryPolicyVersionIds: [], noGoTopics: [] };
}
function run(source: Evidence["source"] = "API", partialQuote = false): MatchingRunDTO {
  const results = shortlist(campaignInput(partialQuote), [creator(source)], now);
  expect(results).toHaveLength(1); // Real pure-producer fixture precondition.
  return { runId: "synthetic-run-a", briefVersion: 1, strategyId: results[0]!.strategyId, createdAt: now,
    replayed: false, stale: false, readiness: "READY", allocationBasis: "FIRST_SLOT_COMPARISON", desiredCreatorCount: 1,
    results: results.map(result => ({ ...result, stale: false, creator: { displayName: "  اسم أصلي Original alias  ", handle: "synthetic_contract" },
      provenance: [evidence(source)], decision: null })) };
}
function fullCampaign(): MatchingCampaignResponse {
  const fields = CampaignFieldsSchema.parse(campaignFields);
  const content = CampaignBriefContentSchema.parse({ schemaVersion: 1, inputRevision: 1, approvedByUserId: "synthetic-brand-owner",
    requirements: { ...fields, campaignId: "synthetic-campaign-a", version: 1, brandCountryCode: "KW", mandatoryPolicyVersionIds: ["synthetic-policy-v1"] },
    policyReview: { reviewed: true, resolverVersion: "synthetic-contract-policy", reviewedAt: now,
      marketCountryCodes: ["KW"], mandatoryPolicyVersionIds: ["synthetic-policy-v1"] } });
  return { id: "synthetic-campaign-a", revision: 3, title: fields.title, status: "BRIEF_APPROVED", fields, fieldsRevision: 1,
    proposals: [{ id: "synthetic-proposal-a", patch: { summary: "Original proposed words" },
      originalText: { text: "  كلمات أصلية\nOriginal proposal  ", language: "ar" }, basedOnFieldsRevision: 1, createdAt: now, appliedAt: null }],
    clarificationCount: 1, missingFields: [], conversation: [{ role: "user", kind: "CLARIFICATION", text: "  نص أصلي\nOriginal conversation  ", language: "ar", field: "title", ts: Date.parse(now) }],
    currentBriefVersion: 1, updatedAt: now,
    briefs: [{ id: "synthetic-brief-a", campaignId: "synthetic-campaign-a", version: 1, inputRevision: 1,
      content, approvedAt: now, approvedByUserId: "synthetic-brand-owner", createdAt: now }] };
}
function receipt(): MatchingDecisionReceipt {
  return { creatorId: "synthetic-creator-a", decision: "SAVED", revision: 1, runId: "synthetic-run-a", updatedAt: now, replayed: false };
}

describe("matching wire contracts: current pure output and historical compatibility", () => {
  it("accepts full current campaign DTO, original words and an empty draft title while summarizing only the selected brief", () => {
    const campaign = fullCampaign(), parsed = MatchingCampaignResponseSchema.parse(campaign);
    expect(parsed).toEqual(campaign); expect(parsed.proposals[0]!.originalText.text).toBe("  كلمات أصلية\nOriginal proposal  ");
    expect(parsed.conversation[0]!.text).toBe("  نص أصلي\nOriginal conversation  ");
    const summary = summarizeMatchingCampaign(parsed);
    expect(MatchingCampaignSummarySchema.parse(summary)).toEqual({ id: campaign.id, title: campaign.title, revision: 3,
      currentBriefVersion: 1, status: "BRIEF_APPROVED", policyReviewed: true });
    const newer = structuredClone(campaign); newer.currentBriefVersion = 2;
    newer.briefs.push({ ...newer.briefs[0]!, id: "synthetic-brief-b", version: 2,
      content: { ...newer.briefs[0]!.content, requirements: { ...newer.briefs[0]!.content.requirements, version: 2, mandatoryPolicyVersionIds: [] }, policyReview: null } });
    expect(summarizeMatchingCampaign(MatchingCampaignResponseSchema.parse(newer)).policyReviewed).toBe(false);
    const draft: MatchingCampaignResponse = { ...campaign, title: "", status: "DRAFT", fields: {}, proposals: [], conversation: [],
      currentBriefVersion: null, briefs: [], missingFields: Object.keys(CampaignFieldObjectSchema.shape), clarificationCount: 0 };
    expect(MatchingCampaignResponseSchema.parse(draft)).toEqual(draft);
    expect(MatchingCampaignSummarySchema.parse(summarizeMatchingCampaign(draft))).toMatchObject({ title: "", policyReviewed: false, currentBriefVersion: null });
  });

  it("rejects an SSR-only six-field summary as API campaign data and rejects malformed or added private fields", () => {
    const campaign = fullCampaign(), summary = summarizeMatchingCampaign(campaign);
    for (const bad of [summary, null, {}, { data: campaign }, { ...campaign, briefs: null }, { ...campaign, revision: "3" },
      { ...campaign, ownerEmail: "synthetic-private@example.invalid" }, { ...summary, fields: campaign.fields }]) {
      expect(MatchingCampaignResponseSchema.safeParse(bad).success).toBe(false);
    }
    expect(MatchingCampaignSummarySchema.safeParse({ ...summary, fields: campaign.fields }).success).toBe(false);
    expect(MatchingCampaignResponseSchema.safeParse({ ...campaign, briefs: [{ ...campaign.briefs[0]!, content: { ...campaign.briefs[0]!.content, rawTranscript: "synthetic private canary" } }] }).success).toBe(false);
  });

  it("round-trips actual partial-quote matcher output, null unknowns, fractional estimates and duplicate aggregate evidence", () => {
    const result = run("API", true), row = result.results[0]!;
    expect(row.quote.coverage).toBe("PARTIAL"); expect(row.quote.total).toBeNull(); expect(row.subscores.budget).toBeNull();
    expect(row.quote.rows.some(item => item.amount === null)).toBe(true);
    expect(Number.isInteger(row.estimatedImpressions.rows[0]!.estimatedImpressions)).toBe(false);
    expect(row.audience.age!.evidence.map(item => item.version)).toEqual(["synthetic-contract-evidence-v1", "synthetic-contract-evidence-v1"]);
    const parsed = MatchingRunSchema.parse(result); expect(parsed).toEqual(result);
    expect(parsed.results[0]!.quote.subtotal).toEqual({ amountMinor: "10000", currencyCode: "SAR" });
    expect(parsed.results[0]!.quote.total).toBeNull(); expect(parsed.results[0]!.subscores.budget).toBeNull();
    expect(parsed.results[0]!.estimatedImpressions).toEqual(row.estimatedImpressions);
    expect(MatchingRunSchema.nullable().parse(null)).toBeNull();
  });

  it("keeps the central four evidence sources and historical four tiers without accepting discovery's MID tier", () => {
    for (const source of sources) {
      const result = run(source); expect(MatchingRunSchema.parse(result).results[0]!.provenance[0]!.source).toBe(source);
    }
    const result = run();
    for (const tier of ["NANO", "MICRO", "MACRO", "MEGA"] as const) {
      const value = structuredClone(result); value.results[0]!.tier = tier;
      expect(MatchingRunSchema.parse(value).results[0]!.tier).toBe(tier);
    }
    expect(MatchingRunSchema.safeParse({ ...result, results: [{ ...result.results[0]!, tier: "MID" }] }).success).toBe(false);
    expect(MatchingRunSchema.safeParse({ ...result, results: [{ ...result.results[0]!, provenance: [{ ...evidence(), source: "PUBLIC_UNVERIFIED" }] }] }).success).toBe(false);
  });

  it("accepts stale empty historical replay and campaign-wide OFFER_SENT decisions with older or nullable run references", () => {
    const historic = { ...run(), strategyId: "historical-strategy-before-current-v1", replayed: true, stale: true, results: [] };
    expect(MatchingRunSchema.parse(historic)).toEqual(historic);
    for (const runId of ["older-synthetic-run", null]) {
      const result = run(); result.results[0]!.decision = { creatorId: result.results[0]!.creatorId,
        decision: "OFFER_SENT", revision: 7, runId, updatedAt: now };
      expect(MatchingRunSchema.parse(result)).toEqual(result);
    }
    const unknownReadiness = { ...historic, readiness: "POLICY_OUTCOMES_UNAVAILABLE" };
    expect(MatchingRunSchema.parse(unknownReadiness)).toEqual(unknownReadiness);
  });

  it("rejects malformed run numbers, bounds, duplicate identities, currencies and added identity/proof metadata", () => {
    const result = run(), row = result.results[0]!;
    expect(row.reasons.length).toBeGreaterThan(0);
    const altered = (patch: Record<string, unknown>) => ({ ...result, results: [{ ...row, ...patch }] });
    for (const bad of [{}, { ...result, runId: "" }, { ...result, briefVersion: 0 }, { ...result, desiredCreatorCount: "1" },
      { ...result, allocationBasis: "RESERVED_SLOT" }, { ...result, results: Array.from({ length: 13 }, (_, i) => ({ ...row, creatorId: `synthetic-${i}` })) },
      { ...result, results: [row, row] }, altered({ score: NaN }), altered({ weightedFit: Infinity }), altered({ rawConfidence: -1 }),
      altered({ allocation: { amountMinor: 10000, currencyCode: "SAR" } }), altered({ allocation: { amountMinor: "0001", currencyCode: "SAR" } }),
      altered({ allocation: { amountMinor: "1", currencyCode: "ZZZ" } }), altered({ creator: { ...row.creator, ownerUserId: "synthetic-private-owner" } }),
      altered({ privateProofAssetId: "synthetic-private-proof" }),
      ...["ownerEmail", "privateProofAssetId", "rawTranscript"].map(field => altered({ reasons: [{ ...row.reasons[0]!,
        observed: { ...row.reasons[0]!.observed, [field]: "synthetic-private-metadata-canary" } }] }))]) expect(MatchingRunSchema.safeParse(bad).success).toBe(false);
  });

  it("preserves the exact old strict command key/id/revision contracts and validates the receipt-only replay flag", () => {
    const command = { operationKey: "legacy:key_1-2", expectedBriefVersion: 2147483648, expectedCampaignRevision: 2147483648 };
    expect(RunCommandSchema.parse(command)).toEqual(command); expect(RunCommandSchema.safeParse({ ...command, campaignId: "invented" }).success).toBe(false);
    for (const operationKey of ["a", "a".repeat(120)]) expect(RunCommandSchema.parse({ ...command, operationKey }).operationKey).toBe(operationKey);
    for (const operationKey of ["", "a".repeat(121), "contains space", "contains.dot"]) expect(RunCommandSchema.safeParse({ ...command, operationKey }).success).toBe(false);
    const decision = { operationKey: "legacy:key", expectedBriefVersion: 1, runId: "!".repeat(200), creatorId: "synthetic-creator-a",
      expectedDecisionRevision: 2147483648, decision: "NONE" };
    expect(DecisionCommandSchema.parse(decision)).toEqual(decision);
    expect(DecisionCommandSchema.safeParse({ ...decision, runId: "a".repeat(201) }).success).toBe(false);
    expect(DecisionCommandSchema.safeParse({ ...decision, creatorId: "invalid\nidentity" }).success).toBe(false);
    expect(DecisionCommandSchema.safeParse({ ...decision, decision: "OFFER_SENT" }).success).toBe(false);
    expect(DecisionCommandSchema.safeParse({ ...decision, expectedDecisionRevision: -1 }).success).toBe(false);
    expect(MatchingDecisionReceiptSchema.parse(receipt())).toEqual(receipt());
    expect(MatchingDecisionReceiptSchema.parse({ ...receipt(), replayed: true })).toMatchObject({ replayed: true });
    const { replayed: _replayed, ...nestedDecision } = receipt(); void _replayed;
    for (const bad of [nestedDecision, { ...receipt(), revision: 0 }, { ...receipt(), decision: "arbitrary" }, { ...receipt(), updatedAt: "invalid" },
      { ...receipt(), note: "synthetic private canary" }]) expect(MatchingDecisionReceiptSchema.safeParse(bad).success).toBe(false);
  });

  it("binds a decision receipt to creator/decision/run/revision+1 and accepts a matching RUN replay without invented fields or fresh cards", () => {
    const command = DecisionCommandSchema.parse({ operationKey: "legacy:key", expectedBriefVersion: 1, runId: "synthetic-run-a",
      creatorId: "synthetic-creator-a", expectedDecisionRevision: 0, decision: "SAVED" });
    expect(matchesDecisionReceipt(command, receipt())).toBe(true);
    expect(matchesDecisionReceipt(command, { ...receipt(), replayed: true })).toBe(true);
    for (const changed of [{ creatorId: "other-creator" }, { decision: "DISMISSED" }, { runId: "other-run" }, { runId: null }, { revision: 2 }]) {
      expect(matchesDecisionReceipt(command, { ...receipt(), ...changed })).toBe(false);
    }
    const runCommand = RunCommandSchema.parse({ operationKey: "legacy:run-key", expectedBriefVersion: 1, expectedCampaignRevision: 999 });
    const historical = { ...run(), stale: true, replayed: true, strategyId: "historical-other-strategy", results: [] };
    expect(matchesRunReceipt(runCommand, historical)).toBe(true);
    expect(matchesRunReceipt(runCommand, { ...historical, briefVersion: 2 })).toBe(false);
    // Native RUN DTO has neither campaignRevision nor operationKey/campaignId.
    // No validator may invent an output requirement to bind those absent fields.
    expect(Object.keys(historical)).not.toContain("campaignRevision"); expect(Object.keys(historical)).not.toContain("operationKey");
  });
});
