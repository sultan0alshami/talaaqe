// Preparation only. Root adopts/runs exactly these two pure groups after review.
// Every identity, source pin and confirmation below is synthetic declaration data.
// Passing a pure schema proves no native authority, entailment or provider call.
import { expect, it, vi } from "vitest";
import type { z } from "zod";
import { CampaignFieldsSchema, CampaignFieldObjectSchema, type CampaignFields } from "@/lib/campaigns/contracts";
import { AgentBindingSchema, AgentSnapshotSchema, CampaignAgentFieldKeys,
  type AgentBinding, type AgentSnapshot } from "@/lib/campaign-agent/contracts";
import { OriginalTextSchema, type OriginalText } from "@/lib/contracts/vocabulary";
import { ClientAuthoritySchema } from "@/lib/organizations/contracts";
import { COMMERCIAL_POLICY_VERSION } from "@/lib/commercial/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";

type Schema = Pick<z.ZodType, "parse" | "safeParse">;
type OutputContracts = {
  PlanningScopeFingerprintSchema: Schema; planningScopeFingerprintHash(input: unknown): string;
  PlanningReplyWireSchema: Schema; PlanningBriefWireSchema: Schema; PlanningStrategyWireSchema: Schema;
  PlanningIdeasPackWireSchema: Schema; PlanningRefinementWireSchema: Schema; PlanningProviderWireSchema: Schema;
  PlanningBriefContentSchema: Schema;
  planningRefinementForTargetsSchema(targets: unknown, fingerprint: unknown): Schema;
  planningBriefContentForFingerprintSchema(fingerprint: unknown): Schema;
  planningProviderWireForFingerprintSchema(fingerprint: unknown): Schema;
};
// A string argument avoids a TypeScript dependency on the deliberately absent
// product module, while Vitest still resolves the actual reviewed alias at runtime.
const outputModule = "@/lib/planning/output-contracts";
const load = () => vi.importActual<OutputContracts>(outputModule);
const clone = <T,>(input: T): T => structuredClone(input);
const h = (input: unknown) => canonicalHash({ domain: "synthetic-planning-output-pin", input });
const text = (value: string, language: OriginalText["language"] = "ar"): OriginalText =>
  OriginalTextSchema.parse({ text: value, language });
const keys = CampaignAgentFieldKeys;
const rawFields = {
  originalLanguage: null, title: "  فكرة أصلية\nOriginal title  ", productService: "منتج أصلي", goal: "AWARENESS", summary: "وصف أصلي واحد",
  marketCountryCodes: ["KW"], targetAgeBuckets: ["18-24"], targetGenders: ["FEMALE"], targetCountryCodes: ["KW"], targetCityKeys: [],
  contentLanguages: ["ar"], dialects: ["ar-Gulf"], nicheSlugs: ["beauty"], deliverables: [{ platform: "INSTAGRAM", format: "STORY", count: 2 }],
  budget: { amountMinor: "9223372036854775807", currencyCode: "KWD" }, desiredCreatorCount: 3, impressionsTarget: null,
  period: { startsAt: "2026-11-01T10:00:00.000Z", endsAt: "2026-11-10T10:00:00.000Z", timeZone: "Asia/Kuwait" },
  physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, tone: "ودي", noGoTopics: [], preferredTiers: [],
  dataVerificationRequired: false, preferredLicencePolicyIds: [], usageRights: "للحملة فقط", kpis: [{ name: "الزيارات", target: "زيادة الزيارات" }],
  assumptions: [], openQuestions: [],
};
const fields = CampaignFieldsSchema.parse(rawFields);
const fieldHash = (field: string, value: unknown) => canonicalHash({ domain: "infame-campaign-field-value-v1", field, value });
const fieldsHash = (value: CampaignFields) => canonicalHash({ domain: "infame-campaign-fields-v1", fields: value });
const refs = () => [{ id: "source~00", sourceHash: h("source zero") }, { id: "source~01", sourceHash: h("source one") }];
function binding(): AgentBinding {
  return AgentBindingSchema.parse({ scope: { kind: "OWN_BRAND", brandId: "brand~original" },
    workspaceId: "workspace~original", campaignId: "campaign~original" });
}
function snapshot(): AgentSnapshot {
  return AgentSnapshotSchema.parse({ campaignRevision: 7, fieldsRevision: 7, planningRevision: 5,
    selection: { id: "selection~original", revision: 3, kind: "NONE", versionId: null, contentHash: null },
    fieldsHash: fieldsHash(fields) });
}
function fingerprint(kind = "REPLY") {
  return { schemaVersion: 1, binding: binding(), brandId: "brand~original", organizationId: null as string | null,
    clientId: null as string | null, actor: { userId: "user~original", role: "BRAND", sessionVersion: 2 },
    brandOwner: { userId: "user~original", sessionVersion: 2 }, authority: null as null | {
      view: ReturnType<typeof ClientAuthoritySchema.parse>; plan: ReturnType<typeof ClientAuthoritySchema.parse> },
    pool: { id: "pool~original", scope: "OWN_BRAND", brandId: "brand~original" as string | null, organizationId: null as string | null },
    enrollment: { id: "enrollment~original", revision: 1, subscriberUserId: "user~original" },
    seat: { id: "seat~original", userId: "user~original", revision: 1, membershipId: null as string | null },
    cycle: { id: "cycle~original", startsAt: "2026-10-11T00:00:00.000Z", endsAt: "2026-11-11T00:00:00.000Z",
      planId: "STARTER", policyVersion: COMMERCIAL_POLICY_VERSION, priceVersion: "synthetic-price-v1" },
    sessionId: "planning-session~original", operation: { id: "operation~original", kind, ordinal: 1,
      selectedArtifacts: kind === "COMBINED_REFINEMENT" ? targets() : [] as ReturnType<typeof targets> },
    agent: { id: "agent~original", revision: 4, stateHash: h("manual agent state") }, snapshot: snapshot(),
    context: null as null | { contextId: string; versionId: string; version: number; versionInputRevision: number;
      contentHash: string; submissionId: string }, sources: refs(),
    confirmation: kind === "BRIEF" || kind === "COMBINED_REFINEMENT" ? { batchId: "batch~original", batchHash: h("batch"), reviewedSnapshot: snapshot(),
      fields: keys.map(field => ({ field, id: "confirmation~" + field, valueHash: fieldHash(field, fields[field]),
        confirmationHash: h({ field, synthetic: "not an actual confirmation" }) })) } : null };
}
function clientFingerprint(kind = "REPLY") {
  const value = fingerprint(kind);
  value.organizationId = "organization~original"; value.clientId = "client~original";
  value.pool.scope = "CLIENT"; value.pool.brandId = null; value.pool.organizationId = value.organizationId;
  value.binding.scope = { kind: "CLIENT", clientId: value.clientId };
  value.brandOwner.userId = "client-brand-owner~original";
  value.enrollment.subscriberUserId = "organization-subscriber~original";
  value.seat.membershipId = "membership~original";
  const authority = { organizationId: value.organizationId, clientId: value.clientId, brandId: value.brandId,
    membershipId: value.seat.membershipId, grantId: "grant~original", organizationRevision: 3, membershipRevision: 5,
    clientRevision: 7, grantRevision: 11 };
  value.authority = { view: ClientAuthoritySchema.parse({ ...authority, capability: "view" }),
    plan: ClientAuthoritySchema.parse({ ...authority, capability: "plan" }) };
  return value;
}
const recommendation = () => ({ kind: "UNVERIFIED_RECOMMENDATION", title: text("اقتراح للمراجعة"),
  body: text("هذه توصية، وليست حقيقة مؤكدة."), relatedFields: ["tone", "goal"] });
const brief = () => ({ kind: "BRIEF", narrative: { overview: text("  مسودة مساعدة\nExact provider narrative  ", null),
  requirementsExplanation: text("شرح المتطلبات للمراجعة", "ar-SA"), hypotheses: [text("فرضية تحتاج إلى مراجعة")], openQuestions: [] } });
const strategy = () => ({ kind: "STRATEGY", summary: text("اقتراح استراتيجية"), audienceApproach: text("الجمهور المقترح"),
  channelApproach: text("القنوات المقترحة"), measurementApproach: text("نهج قياس مقترح"), recommendations: [recommendation()],
  hypotheses: [], openQuestions: [text("ما القياس المتاح؟", null)] });
const ideas = () => ({ kind: "IDEAS_PACK", ideas: [1, 2].map(ordinal => ({ ordinal, title: text("فكرة " + ordinal),
  concept: text("مفهوم مقترح"), executionNotes: text("للمراجعة قبل التنفيذ"), relatedFields: ["deliverables"] })),
  hypotheses: [], openQuestions: [] });
const reply = () => ({ kind: "REPLY", reply: text("  رد مساعد\nOriginal provider words  ", null),
  proposals: keys.map(field => ({ kind: "SOURCE_PROPOSAL", field, value: fields[field],
    source: { kind: "CUSTOMER_TEXT", references: refs() } })), recommendations: [recommendation()], openQuestions: [] });
const targets = () => ["BRIEF", "STRATEGY", "IDEAS_PACK"].map(kind => ({ id: "artifact~" + kind, kind, contentHash: h("artifact " + kind) }));
function refinement() {
  const bodies = [brief(), strategy(), ideas()];
  return { kind: "COMBINED_REFINEMENT", changes: targets().map((base, index) => ({ base, revised: bodies[index]! })) };
}
function content(value = fingerprint("BRIEF")) {
  return { ...brief(), customerFields: clone(fields), fieldsHash: fieldsHash(fields),
    confirmationBatchId: value.confirmation!.batchId, confirmationBatchHash: value.confirmation!.batchHash,
    binding: clone(value.binding), snapshot: clone(value.snapshot), sources: clone(value.sources) };
}
function reject(schema: Schema, cases: unknown[], label: string) {
  for (const [index, value] of cases.entries()) {
    expect(() => schema.safeParse(value), label + " safeParse " + index).not.toThrow();
    expect(schema.safeParse(value).success, label + " rejection " + index).toBe(false);
  }
}

it("keeps all thirty field proposals centrally typed and provider text separate from customer authority, approval and accounting", async () => {
  const c = await load();
  expect(keys).toHaveLength(30);
  const wires: Array<[Schema, ReturnType<typeof reply> | ReturnType<typeof brief> | ReturnType<typeof strategy> | ReturnType<typeof ideas> | ReturnType<typeof refinement>]> = [
    [c.PlanningReplyWireSchema, reply()], [c.PlanningBriefWireSchema, brief()], [c.PlanningStrategyWireSchema, strategy()],
    [c.PlanningIdeasPackWireSchema, ideas()], [c.PlanningRefinementWireSchema, refinement()],
  ];
  for (const [schema, wire] of wires) {
    expect(schema.parse(wire)).toEqual(wire); expect(c.PlanningProviderWireSchema.parse(wire)).toEqual(wire);
    for (const extra of [{ actor: { userId: "invented" } }, { confirmation: true }, { approvedByUserId: "invented" },
      { verified: true }, { complete: true }, { success: true }, { price: "9900" }, { pricingHash: h("invented") },
      { scope: binding().scope }, { modelId: "invented" }, { createdAt: "2026-10-11T00:00:00.000Z" }]) {
      reject(schema, [{ ...wire, ...extra }], "server-owned extension");
      reject(c.PlanningProviderWireSchema, [{ ...wire, ...extra }], "union server-owned extension");
    }
  }
  const all = reply();
  const parsed = c.PlanningReplyWireSchema.parse(all) as ReturnType<typeof reply>;
  expect(parsed.reply).toEqual(text("  رد مساعد\nOriginal provider words  ", null));
  expect(parsed.proposals.map(proposal => proposal.field)).toEqual(keys);
  for (const proposal of parsed.proposals) expect(proposal.value).toEqual(CampaignFieldObjectSchema.shape[proposal.field].parse(fields[proposal.field]));
  for (const references of [[refs()[0]!], [...refs(), { id: "source~02", sourceHash: h("two") }, { id: "source~03", sourceHash: h("three") }]]) {
    expect(c.PlanningReplyWireSchema.safeParse({ ...all, proposals: [{ ...all.proposals[0], source: { kind: "CUSTOMER_TEXT", references } }] }).success).toBe(true);
  }
  const duplicateDeliverables = [{ platform: "INSTAGRAM", format: "STORY", count: 1 },
    { platform: "TIKTOK", format: "VIDEO", count: 2 }, { platform: "INSTAGRAM", format: "STORY", count: 3 }];
  const merged = c.PlanningReplyWireSchema.parse({ ...all, proposals: [{ kind: "SOURCE_PROPOSAL", field: "deliverables",
    value: duplicateDeliverables, source: { kind: "CUSTOMER_TEXT", references: refs() } }] }) as ReturnType<typeof reply>;
  expect(merged.proposals[0]!.value).toEqual(CampaignFieldObjectSchema.shape.deliverables.parse(duplicateDeliverables));
  const proposal = all.proposals[0]!;
  reject(c.PlanningReplyWireSchema, [
    { ...all, proposals: [proposal, proposal] }, { ...all, proposals: [{ ...proposal, field: "invented" }] },
    ...keys.map(field => ({ ...all, proposals: [{ kind: "SOURCE_PROPOSAL", field,
      value: field === "originalLanguage" || field === "impressionsTarget" ? {} : null, source: proposal.source }] })),
    ...[{ field: "title", value: false }, { field: "goal", value: "INVENTED" }, { field: "desiredCreatorCount", value: 13 },
      { field: "budget", value: { amountMinor: 9900, currencyCode: "SAR" } }, { field: "impressionsTarget", value: Number.MAX_SAFE_INTEGER + 1 },
      { field: "period", value: { ...fields.period, endsAt: fields.period.startsAt } }].map(wrong => ({ ...all, proposals: [{ ...proposal, ...wrong }] })),
    ...[[], Array.from({ length: 5 }, (_, index) => ({ id: "source~" + String(index).padStart(2, "0"), sourceHash: h(index) })),
      [refs()[0], refs()[0]], refs().reverse()].map(references => ({ ...all,
      proposals: [{ ...proposal, source: { kind: "CUSTOMER_TEXT", references } }] })),
    { ...all, proposals: [{ ...proposal, source: { kind: "PROVIDER", references: refs() } }] },
    { ...all, proposals: [{ ...proposal, valueHash: h("model assertion") }] },
    { ...all, proposals: [{ ...proposal, source: { ...proposal.source, confirmed: true } }] },
    { ...all, proposals: [{ ...proposal, source: { kind: "CUSTOMER_TEXT", references: [{ ...refs()[0], verified: true }] } }] },
    { ...all, recommendations: [{ ...recommendation(), kind: "SOURCE_PROPOSAL" }] },
    { ...all, recommendations: [{ ...recommendation(), verified: true }] },
    { ...all, recommendations: [{ ...recommendation(), relatedFields: ["tone", "tone"] }] },
    { ...all, reply: { ...all.reply, language: undefined } }, { ...all, reply: text("x", null), openQuestions: Array(31).fill(text("question")) },
    { ...all, reply: { text: "  \n\t ", language: null } }, { ...all, reply: { text: "bad\u0000text", language: null } },
    { ...all, reply: { text: "x", language: "not_a_language" } }, { ...all, reply: { text: "x", language: null, author: "customer" } },
  ], "typed proposal or authorship");
  reject(c.PlanningBriefWireSchema, [{ ...brief(), customerFields: fields }, { ...brief(), fieldsHash: fieldsHash(fields) },
    { ...brief(), narrative: { ...brief().narrative, approved: true } }], "provider BRIEF cannot replace confirmed fields");
  reject(c.PlanningStrategyWireSchema, [{ ...strategy(), recommendations: [] }], "strategy needs labelled recommendations");
  reject(c.PlanningIdeasPackWireSchema, [{ ...ideas(), ideas: [] }, { ...ideas(), ideas: [ideas().ideas[1]] },
    { ...ideas(), ideas: [ideas().ideas[0], ideas().ideas[0]] }, { ...ideas(), ideas: [{ ...ideas().ideas[0], creatorBooked: true }] }], "idea inclusion and ordinal");
  const oversize = { kind: "REPLY", reply: text("ع".repeat(20000)), proposals: [], recommendations: [], openQuestions: Array(30).fill(text("ع".repeat(500))) };
  expect(new TextEncoder().encode(JSON.stringify(oversize)).byteLength).toBeGreaterThan(65536);
  reject(c.PlanningReplyWireSchema, [oversize, undefined, Number.NaN, Number.POSITIVE_INFINITY,
    { ...all, proposals: [{ ...proposal, value: BigInt(1) }] }, JSON.parse('{"kind":"REPLY","__proto__":{}}')], "bounded plain JSON");
  let getterReads = 0;
  const accessorReply = clone(all);
  Object.defineProperty(accessorReply, "reply", { enumerable: true, get: () => { getterReads++; return all.reply; } });
  const accessorQuestions: OriginalText[] = [];
  Object.defineProperty(accessorQuestions, "0", { enumerable: true, get: () => { getterReads++; return text("valid-looking question"); } });
  const accessorSource = clone(all);
  Object.defineProperty(accessorSource.proposals[0]!.source.references[0]!, "sourceHash",
    { enumerable: true, get: () => { getterReads++; return refs()[0]!.sourceHash; } });
  const sparseQuestions = new Array<OriginalText>(1);
  const extraQuestions = Object.assign([text("valid question")], { extra: "JSON serialization would silently drop this property" });
  reject(c.PlanningReplyWireSchema, [accessorReply, { ...all, openQuestions: accessorQuestions }, accessorSource,
    { ...all, openQuestions: sparseQuestions }, { ...all, openQuestions: extraQuestions }], "unsafe JSON descriptors and arrays");
  expect(getterReads).toBe(0);
  let subclassForEachCalls = 0, subclassToJsonCalls = 0;
  class ExtendedQuestions extends Array<OriginalText> {
    override forEach(callback: (value: OriginalText, index: number, array: OriginalText[]) => void, thisArg?: unknown): void {
      subclassForEachCalls++; super.forEach(callback, thisArg);
    }
    toJSON() { subclassToJsonCalls++; return Array.from(this); }
  }
  const subclassQuestions = new ExtendedQuestions(text("valid-looking subclass question"));
  let customForEachCalls = 0, customToJsonCalls = 0;
  const customQuestions = [text("valid-looking custom-prototype question")];
  const customPrototype = {
    forEach() { customForEachCalls++; },
    toJSON() { customToJsonCalls++; return [text("valid-looking serialized question")]; },
  };
  Object.setPrototypeOf(customPrototype, Array.prototype);
  Object.setPrototypeOf(customQuestions, customPrototype);
  reject(c.PlanningReplyWireSchema, [{ ...all, openQuestions: subclassQuestions },
    { ...all, openQuestions: customQuestions }], "nonstandard array prototypes rejected before methods execute");
  expect(subclassForEachCalls).toBe(0); expect(subclassToJsonCalls).toBe(0);
  expect(customForEachCalls).toBe(0); expect(customToJsonCalls).toBe(0);
  const oversizedBrief = { ...brief(), narrative: { ...brief().narrative,
    overview: text("ع".repeat(20000)), requirementsExplanation: text("ع".repeat(20000)) } };
  const oversizedRefinement = { ...refinement(), changes: [{ base: targets()[0]!, revised: oversizedBrief }] };
  const ordinaryBytes = new TextEncoder().encode(JSON.stringify(oversizedBrief)).byteLength;
  const refinementBytes = new TextEncoder().encode(JSON.stringify(oversizedRefinement)).byteLength;
  expect(ordinaryBytes).toBeGreaterThan(65536); expect(refinementBytes).toBeLessThan(262144);
  reject(c.PlanningBriefWireSchema, [oversizedBrief], "ordinary BRIEF byte ceiling");
  reject(c.PlanningRefinementWireSchema, [oversizedRefinement], "nested ordinary body retains its own byte ceiling");
  reject(c.PlanningProviderWireSchema, [oversizedRefinement], "provider union nested byte ceiling");
  const accessorRefinement = refinement();
  Object.defineProperty(accessorRefinement.changes[0]!.revised, "narrative",
    { enumerable: true, get: () => { getterReads++; return brief().narrative; } });
  const nestedMalformed = [
    { ...refinement(), changes: new Array(1) }, accessorRefinement,
    { ...refinement(), changes: [{ base: null, revised: brief() }] },
    { ...refinement(), changes: [{ base: targets()[0], revised: { kind: "BRIEF", narrative: null } }] },
    { ...refinement(), changes: [{ base: targets()[0], revised: { ...brief(), narrative: { ...brief().narrative, hypotheses: [undefined] } } }] },
    { ...refinement(), changes: [{ base: targets()[1], revised: { ...strategy(), recommendations: null } }] },
  ];
  reject(c.PlanningRefinementWireSchema, nestedMalformed, "malformed nested refinement is safeParse failure");
  reject(c.PlanningProviderWireSchema, nestedMalformed, "provider union malformed nesting");
  expect(getterReads).toBe(0);
  const contextualReply = c.planningProviderWireForFingerprintSchema(fingerprint());
  expect(contextualReply.parse(all)).toEqual(all);
  const unknownSource = clone(all); unknownSource.proposals[0]!.source.references[0]!.id = "source~missing";
  unknownSource.proposals[0]!.source.references = [unknownSource.proposals[0]!.source.references[0]!];
  const changedSource = clone(all); changedSource.proposals[0]!.source.references[0]!.sourceHash = h("different source version");
  expect(c.PlanningReplyWireSchema.safeParse(unknownSource).success).toBe(true);
  expect(c.PlanningReplyWireSchema.safeParse(changedSource).success).toBe(true);
  reject(contextualReply, [brief(), unknownSource, changedSource], "declared kind and source membership");
});

it("pins exact authority and input epochs without counter epochs, captures refinement target sets and preserves all confirmed customer BRIEF fields", async () => {
  const c = await load(); const own = fingerprint(); const client = clientFingerprint();
  for (const value of [own, client, fingerprint("BRIEF")]) {
    expect(c.PlanningScopeFingerprintSchema.parse(value)).toEqual(value);
    expect(c.planningScopeFingerprintHash(value)).toBe(canonicalHash({ domain: "infame-planning-scope-v1", ...value }));
    expect(c.planningScopeFingerprintHash({ ...value, binding: { campaignId: value.binding.campaignId,
      workspaceId: value.binding.workspaceId, scope: value.binding.scope } })).toBe(c.planningScopeFingerprintHash(value));
  }
  const broad = clone(own); const broadUser = "u".repeat(199) + "~";
  broad.actor.userId = broadUser; broad.brandOwner.userId = broadUser; broad.seat.userId = broadUser; broad.enrollment.subscriberUserId = broadUser;
  expect(c.PlanningScopeFingerprintSchema.parse(broad)).toEqual(broad);
  reject(c.PlanningScopeFingerprintSchema, [{ ...broad, actor: { ...broad.actor, userId: broadUser + "x" } },
    { ...own, pool: { ...own.pool, revision: 2 } }, { ...own, pool: { ...own.pool, brandId: "other" } },
    { ...own, cycle: { ...own.cycle, held: 1 } }, { ...own, cycle: { ...own.cycle, consumed: 1 } },
    { ...own, cycle: { ...own.cycle, revision: 2 } }, { ...own, sessionRevision: 2 },
    { ...own, actor: { ...own.actor, sessionId: "synthetic-private-session" } }, { ...own, sources: [{ ...refs()[0], originalText: text("words") }] },
    { ...own, seat: { ...own.seat, userId: "other" } }, { ...own, brandOwner: { ...own.brandOwner, userId: "other" } },
    { ...own, binding: { ...own.binding, scope: { kind: "OWN_BRAND", brandId: "other" } } },
    { ...own, organizationId: "organization~unexpected" }, { ...own, seat: { ...own.seat, membershipId: "unexpected" } },
    { ...own, cycle: { ...own.cycle, endsAt: own.cycle.startsAt } },
    { ...own, sources: refs().reverse() }, { ...own, sources: [refs()[0], refs()[0]] },
    { ...own, sources: [{ ...refs()[0], sourceHash: "A".repeat(64) }] }, { ...own, schemaVersion: 2 },
  ], "fingerprint joins, privacy and input-only identity");
  const allSources = clone(own); allSources.sources = Array.from({ length: 64 }, (_, index) => ({ id: "source~" + String(index).padStart(2, "0"), sourceHash: h(index) }));
  expect(c.PlanningScopeFingerprintSchema.safeParse(allSources).success).toBe(true);
  reject(c.PlanningScopeFingerprintSchema, [{ ...allSources, sources: [...allSources.sources, { id: "source~64", sourceHash: h(64) }] },
    { ...own, operation: { ...own.operation, selectedArtifacts: targets() } },
    { ...fingerprint("COMBINED_REFINEMENT"), operation: { ...fingerprint("COMBINED_REFINEMENT").operation, selectedArtifacts: [] } },
    { ...fingerprint("COMBINED_REFINEMENT"), confirmation: null }], "operation target and source bounds");
  const divergent = clone(client); divergent.authority!.plan.grantRevision++;
  const wrongMembership = clone(client); wrongMembership.seat.membershipId = "other";
  const wrongBrand = clone(client); wrongBrand.authority!.view.brandId = "other"; wrongBrand.authority!.plan.brandId = "other";
  reject(c.PlanningScopeFingerprintSchema, [divergent, wrongMembership, wrongBrand, { ...client, authority: null },
    { ...client, authority: { ...client.authority, plan: { ...client.authority!.plan, capability: "view" } } }], "paired CLIENT grants");
  const approved = clone(client); const contextHash = h("approved context");
  approved.snapshot.selection = { id: approved.snapshot.selection.id, revision: 4, kind: "APPROVED_CONTEXT", versionId: "context-version~1", contentHash: contextHash };
  approved.context = { contextId: "context~1", versionId: "context-version~1", version: 3, versionInputRevision: 4,
    contentHash: contextHash, submissionId: "context-submission~1" };
  expect(c.PlanningScopeFingerprintSchema.parse(approved)).toEqual(approved);
  reject(c.PlanningScopeFingerprintSchema, [{ ...approved, context: null }, { ...own, context: approved.context },
    { ...approved, context: { ...approved.context, contentHash: h("other context") } },
    { ...approved, context: { ...approved.context, versionId: "context-version~other" } },
    { ...approved, context: { ...approved.context, contextRevision: 99 } },
    { ...approved, context: { ...approved.context, inputRevision: 99 } }], "exact immutable selected context without draft epochs");
  const reselected = clone(approved); reselected.snapshot.selection.revision += 2;
  expect(reselected.context).toEqual(approved.context);
  expect(c.PlanningScopeFingerprintSchema.safeParse(reselected).success).toBe(true);
  expect(c.planningScopeFingerprintHash(reselected)).not.toBe(c.planningScopeFingerprintHash(approved));
  const epochs = [clone(client), clone(client), clone(client), clone(client), clone(client), clone(client)];
  epochs[0]!.agent.revision++; epochs[1]!.actor.sessionVersion++; epochs[2]!.sources[0]!.sourceHash = h("changed source");
  epochs[3]!.authority!.view.grantRevision++; epochs[3]!.authority!.plan.grantRevision++;
  epochs[4]!.snapshot.planningRevision++; epochs[5]!.snapshot.selection.revision++;
  for (const changed of epochs) {
    expect(changed.snapshot.fieldsHash).toBe(client.snapshot.fieldsHash);
    expect(c.PlanningScopeFingerprintSchema.safeParse(changed).success).toBe(true);
    expect(c.planningScopeFingerprintHash(changed)).not.toBe(c.planningScopeFingerprintHash(client));
  }
  const reviewed = fingerprint("BRIEF"); const missing = clone(reviewed); missing.confirmation = null;
  const unordered = clone(reviewed); unordered.confirmation!.fields.reverse();
  const duplicated = clone(reviewed); duplicated.confirmation!.fields[1]!.id = duplicated.confirmation!.fields[0]!.id;
  const oldSnapshot = clone(reviewed); oldSnapshot.confirmation!.reviewedSnapshot.planningRevision--;
  reject(c.PlanningScopeFingerprintSchema, [missing, unordered, duplicated, oldSnapshot,
    { ...reviewed, confirmation: { ...reviewed.confirmation, fields: reviewed.confirmation!.fields.slice(1) } }], "complete reviewed snapshot");

  const originals = [brief(), strategy(), ideas()]; const originalHashes = originals.map(canonicalHash);
  const requested = targets(); const requestedHash = canonicalHash(requested);
  const refinementScope = fingerprint("COMBINED_REFINEMENT");
  const targetValidator = c.planningRefinementForTargetsSchema(requested, refinementScope); const refined = refinement();
  expect(targetValidator.parse(refined)).toEqual(refined);
  expect(c.planningProviderWireForFingerprintSchema(refinementScope).parse(refined)).toEqual(refined);
  for (let index = 0; index < 3; index++) {
    const single = { kind: "COMBINED_REFINEMENT", changes: [refined.changes[index]] };
    const singleScope = fingerprint("COMBINED_REFINEMENT"); singleScope.operation.selectedArtifacts = [targets()[index]!];
    if (index !== 0) singleScope.confirmation = null;
    expect(c.planningRefinementForTargetsSchema([targets()[index]], singleScope).parse(single)).toEqual(single);
  }
  const wrongBase = clone(refined); wrongBase.changes[0]!.base.contentHash = h("different immutable base");
  const wrongKind = clone(refined); wrongKind.changes[0]!.revised = strategy();
  const providerFields = clone(refined) as { kind: string; changes: Array<{ base: ReturnType<typeof targets>[number]; revised: unknown }> };
  providerFields.changes[0]!.revised = { ...brief(), customerFields: fields };
  reject(targetValidator, [{ ...refined, changes: refined.changes.slice(1) }, { ...refined, changes: [refined.changes[0], refined.changes[0], refined.changes[2]] },
    wrongBase, wrongKind, providerFields, { ...refined, changes: [...refined.changes, refined.changes[0]] },
    { ...refined, changes: [{ ...refined.changes[0], base: { ...refined.changes[0]!.base, approved: true } }, ...refined.changes.slice(1)] }], "exact refinement request");
  expect(() => c.planningRefinementForTargetsSchema([], refinementScope)).toThrow();
  expect(() => c.planningRefinementForTargetsSchema(targets().reverse(), refinementScope)).toThrow();
  expect(() => c.planningRefinementForTargetsSchema([targets()[0], targets()[0]], refinementScope)).toThrow();
  expect(() => c.planningRefinementForTargetsSchema(targets().slice(1), refinementScope)).toThrow();
  expect(originals.map(canonicalHash)).toEqual(originalHashes); expect(canonicalHash(requested)).toBe(requestedHash);
  requested[0]!.contentHash = h("caller changed captured target");
  refinementScope.operation.selectedArtifacts[0]!.contentHash = h("caller changed captured fingerprint target");
  expect(targetValidator.parse(refined)).toEqual(refined);
  const mutatedTarget = clone(refined); mutatedTarget.changes[0]!.base.contentHash = requested[0]!.contentHash;
  reject(targetValidator, [mutatedTarget], "captured target immutability");

  const captured = fingerprint("BRIEF"); const briefValidator = c.planningBriefContentForFingerprintSchema(captured);
  const enriched = content(captured); const enrichedHash = canonicalHash(enriched);
  expect(c.PlanningBriefContentSchema.parse(enriched)).toEqual(enriched); expect(briefValidator.parse(enriched)).toEqual(enriched);
  expect(Object.keys(enriched.customerFields)).toEqual(keys);
  expect(enriched.customerFields.title).toBe(rawFields.title); expect(enriched.customerFields.originalLanguage).toBeNull();
  expect(enriched.customerFields.impressionsTarget).toBeNull(); expect(enriched.customerFields.budget).toEqual(rawFields.budget);
  for (const field of keys) {
    const incomplete: Record<string, unknown> = clone(enriched.customerFields); delete incomplete[field];
    reject(c.PlanningBriefContentSchema, [{ ...enriched, customerFields: incomplete }], "complete central field " + field);
    const wrongPin = fingerprint("BRIEF"); wrongPin.confirmation!.fields.find(pin => pin.field === field)!.valueHash = h("wrong pin " + field);
    reject(c.planningBriefContentForFingerprintSchema(wrongPin), [enriched], "exact confirmed value pin " + field);
  }
  const revisedFields = CampaignFieldsSchema.parse({ ...fields, title: "model rewrite", budget: { amountMinor: "1", currencyCode: "SAR" } });
  const internallyCoherentRewrite = { ...enriched, customerFields: revisedFields, fieldsHash: fieldsHash(revisedFields),
    snapshot: { ...enriched.snapshot, fieldsHash: fieldsHash(revisedFields) } };
  expect(c.PlanningBriefContentSchema.safeParse(internallyCoherentRewrite).success).toBe(true);
  reject(briefValidator, [internallyCoherentRewrite, { ...enriched, confirmationBatchId: "other" },
    { ...enriched, confirmationBatchHash: h("other batch") }, { ...enriched, binding: { ...enriched.binding, campaignId: "other" } },
    { ...enriched, snapshot: { ...enriched.snapshot, planningRevision: enriched.snapshot.planningRevision + 1 } },
    { ...enriched, sources: [{ ...enriched.sources[0], sourceHash: h("other source") }, enriched.sources[1]] },
    { ...enriched, sources: enriched.sources.slice(1) }, { ...enriched, confirmed: true }, { ...enriched, approved: true }], "server-enriched declared pins");
  reject(c.PlanningBriefContentSchema, [{ ...enriched, fieldsHash: h("wrong fields") },
    { ...enriched, customerFields: { ...fields, physicalPresenceRequired: true, presenceCountryCodes: [] } }], "complete cross-field and hash coherence");
  expect(() => c.planningBriefContentForFingerprintSchema(fingerprint())).toThrow();
  captured.confirmation!.batchHash = h("caller changed captured batch"); captured.sources[0]!.sourceHash = h("caller changed captured source");
  captured.binding.campaignId = "caller changed binding";
  expect(briefValidator.parse(enriched)).toEqual(enriched);
  reject(briefValidator, [{ ...enriched, confirmationBatchHash: captured.confirmation!.batchHash, binding: captured.binding, sources: captured.sources }], "captured fingerprint immutability");
  expect(canonicalHash(enriched)).toBe(enrichedHash);

  // These additional reviewed factories compare declarations only. Model/attempt
  // labels here are synthetic; native execution must resolve them independently.
  const additional = c as OutputContracts & { PlanningAiRequestSchema: Schema; PlanningRetainedContentSchema: Schema;
    planningRequestForFingerprintSchema(fingerprint: unknown): Schema;
    planningRetainedContentForFingerprintSchema(fingerprint: unknown): Schema };
  const request = { schemaVersion: 1, operationKey: "11111111-1111-4111-8111-111111111111", sessionId: own.sessionId,
    kind: own.operation.kind, ordinal: own.operation.ordinal, expectedFingerprintHash: c.planningScopeFingerprintHash(own),
    sourceMessage: refs()[0]!, requestedLanguage: null, selectedArtifacts: [] };
  expect(additional.PlanningAiRequestSchema.parse(request)).toEqual(request);
  const requestValidator = additional.planningRequestForFingerprintSchema(own);
  expect(requestValidator.parse(request)).toEqual(request);
  reject(requestValidator, [{ ...request, sessionId: "other" }, { ...request, ordinal: 2 },
    { ...request, expectedFingerprintHash: h("other fingerprint") },
    { ...request, sourceMessage: { ...request.sourceMessage, sourceHash: h("different source version") } }], "captured request context");
  reject(additional.PlanningAiRequestSchema, [{ ...request, sourceMessage: null }, { ...request, selectedArtifacts: targets() },
    { ...request, actorUserId: own.actor.userId }, { ...request, transcript: text("original words belong in native source storage") },
    { ...request, requestedLanguage: undefined }], "strict request authorship");
  const briefRequest = { ...request, kind: "BRIEF", expectedFingerprintHash: c.planningScopeFingerprintHash(reviewed), sourceMessage: null };
  expect(additional.planningRequestForFingerprintSchema(reviewed).parse(briefRequest)).toEqual(briefRequest);
  reject(additional.PlanningAiRequestSchema, [{ ...briefRequest, ordinal: 2 }], "one artifact inclusion");
  const freshRefinementScope = fingerprint("COMBINED_REFINEMENT");
  const refinementRequest = { ...request, kind: "COMBINED_REFINEMENT",
    expectedFingerprintHash: c.planningScopeFingerprintHash(freshRefinementScope), selectedArtifacts: targets() };
  expect(additional.planningRequestForFingerprintSchema(freshRefinementScope).parse(refinementRequest)).toEqual(refinementRequest);
  reject(additional.planningRequestForFingerprintSchema(freshRefinementScope),
    [{ ...refinementRequest, selectedArtifacts: targets().slice(1) }], "exact requested overlay targets");

  const retained = { schemaVersion: 1, attemptId: "synthetic-attempt~1", operationId: reviewed.operation.id, sessionId: reviewed.sessionId,
    binding: clone(reviewed.binding), snapshot: clone(reviewed.snapshot), scopeFingerprintHash: c.planningScopeFingerprintHash(reviewed),
    provider: { id: "ANTHROPIC", modelId: "synthetic-model", registryVersion: "synthetic-registry", requestId: null }, output: enriched };
  expect(additional.PlanningRetainedContentSchema.parse(retained)).toEqual(retained);
  const retainedValidator = additional.planningRetainedContentForFingerprintSchema(reviewed);
  expect(retainedValidator.parse(retained)).toEqual(retained);
  const newAgentEpoch = clone(reviewed); newAgentEpoch.agent.revision++;
  reject(additional.planningRetainedContentForFingerprintSchema(newAgentEpoch), [retained], "same values with a new agent epoch");
  reject(retainedValidator, [{ ...retained, operationId: "other" }, { ...retained, sessionId: "other" },
    { ...retained, scopeFingerprintHash: h("other fingerprint") }, { ...retained, output: strategy() },
    { ...retained, provider: { ...retained.provider, verified: true } }, { ...retained, approvedByUserId: own.actor.userId }], "retained declaration scope");
  // No synthetic assertion that a pure fingerprint can authenticate a provider,
  // model registry, external request ID or actual Attempt database identity.
  expect(retainedValidator.safeParse({ ...retained, attemptId: "synthetic-attempt~2",
    provider: { ...retained.provider, modelId: "another-synthetic-model", requestId: "synthetic-external-request" } }).success).toBe(true);
  const oversizedNarrative = { ...brief().narrative, overview: text("ع".repeat(20000)), requirementsExplanation: text("ع".repeat(20000)) };
  const oversizedEnriched = { ...enriched, narrative: oversizedNarrative };
  const oversizedRetainedBrief = { ...retained, output: oversizedEnriched };
  const oversizedReply = { kind: "REPLY", reply: text("ع".repeat(20000)), proposals: [], recommendations: [],
    openQuestions: Array(30).fill(text("ع".repeat(500))) };
  const oversizedRetainedReply = { ...retained, scopeFingerprintHash: c.planningScopeFingerprintHash(own), output: oversizedReply };
  for (const value of [oversizedRetainedBrief, oversizedRetainedReply]) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    expect(bytes).toBeGreaterThan(65536); expect(bytes).toBeLessThan(524288);
  }
  reject(c.PlanningBriefContentSchema, [oversizedEnriched], "enrichment does not enlarge the narrative allowance");
  reject(additional.PlanningRetainedContentSchema, [oversizedRetainedBrief, oversizedRetainedReply], "retained ordinary body has its own cap");
  reject(retainedValidator, [oversizedRetainedBrief], "contextual retained BRIEF cap");
  reject(additional.planningRetainedContentForFingerprintSchema(own), [oversizedRetainedReply], "contextual retained REPLY cap");
  const retainedRefinement = { ...retained, scopeFingerprintHash: c.planningScopeFingerprintHash(freshRefinementScope),
    output: { kind: "COMBINED_REFINEMENT", changes: [{ base: targets()[0]!, revised: content(freshRefinementScope) },
      { base: targets()[1]!, revised: strategy() }, { base: targets()[2]!, revised: ideas() }] } };
  const retainedRefinementValidator = additional.planningRetainedContentForFingerprintSchema(freshRefinementScope);
  expect(additional.PlanningRetainedContentSchema.parse(retainedRefinement)).toEqual(retainedRefinement);
  expect(retainedRefinementValidator.parse(retainedRefinement)).toEqual(retainedRefinement);
  const wrongNestedBinding = content(freshRefinementScope); wrongNestedBinding.binding.campaignId = "another-campaign~original";
  const wrongNestedSnapshot = content(freshRefinementScope); wrongNestedSnapshot.snapshot.planningRevision++;
  for (const revised of [wrongNestedBinding, wrongNestedSnapshot]) {
    expect(c.PlanningBriefContentSchema.safeParse(revised).success).toBe(true);
    const mismatchedEnvelope = { ...retainedRefinement, output: { ...retainedRefinement.output,
      changes: retainedRefinement.output.changes.map((change, index) => index === 0 ? { ...change, revised } : change) } };
    reject(additional.PlanningRetainedContentSchema, [mismatchedEnvelope], "generic retained envelope binds each nested BRIEF scope");
  }
  const oversizedRetainedRefinement = { ...retainedRefinement, output: { ...retainedRefinement.output,
    changes: retainedRefinement.output.changes.map((change, index) => index === 0 ? { ...change, revised: oversizedEnriched } : change) } };
  expect(new TextEncoder().encode(JSON.stringify(oversizedRetainedRefinement)).byteLength).toBeLessThan(524288);
  reject(additional.PlanningRetainedContentSchema, [oversizedRetainedRefinement], "retained refinement nested ordinary cap");
  reject(retainedRefinementValidator, [oversizedRetainedRefinement], "contextual retained refinement nested cap");
  let retainedGetterReads = 0;
  const accessorRetained = clone(retained);
  Object.defineProperty(accessorRetained.output.customerFields, "title",
    { enumerable: true, get: () => { retainedGetterReads++; return fields.title; } });
  const unsafeRetained = [accessorRetained, { ...retained, output: { ...enriched, sources: new Array(1) } },
    { ...retainedRefinement, output: { ...retainedRefinement.output, changes: [{ base: targets()[0], revised: { kind: "BRIEF", narrative: null } }] } }];
  reject(additional.PlanningRetainedContentSchema, unsafeRetained, "retained malformed nested JSON");
  expect(retainedGetterReads).toBe(0);
});
