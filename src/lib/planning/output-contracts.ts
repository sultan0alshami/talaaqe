import { z } from "zod";
import { CampaignFieldObjectSchema, CampaignFieldsSchema } from "@/lib/campaigns/contracts";
import { AgentBindingSchema, AgentSnapshotSchema, CampaignAgentFieldKeys } from "@/lib/campaign-agent/contracts";
import { OriginalTextSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { ClientAuthoritySchema, OrganizationIdSchema as id, OrganizationRevisionSchema as rev } from "@/lib/organizations/contracts";
import { COMMERCIAL_POLICY_VERSION } from "@/lib/commercial/contracts";
import { canonicalHash, checkedJson } from "@/lib/onboarding/drafts";
import { PlanningAiOperationKindSchema } from "./contracts";

// Pure, server-side declarations. A valid declaration is never native authority,
// source entailment, customer confirmation or evidence of provider execution.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const opaque = id.refine(value => !value.includes("://"), "Opaque reference required");
const field = CampaignFieldObjectSchema.keyof();
function plain(value: unknown, limit: number) {
  const walk = (item: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (item === null || ["string", "boolean"].includes(typeof item)) return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object") return false;
    if (Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype)) return false;
    if (Array.isArray(item) && item.length > limit) return false;
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))) return false;
    if (Array.isArray(item) && Object.keys(descriptors).some(key => key !== "length"
      && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))) return false;
    if (Array.isArray(item) && Array.from({ length: item.length }, (_, i) => String(i)).some(key => !Object.hasOwn(descriptors, key))) return false;
    return Object.entries(descriptors).every(([key, descriptor]) => Array.isArray(item) && key === "length"
      ? true : "value" in descriptor && descriptor.enumerable && walk(descriptor.value, depth + 1));
  };
  try { return walk(value, 0) && !!checkedJson(value, limit); } catch { return false; }
}
function bounded<T extends z.ZodType>(schema: T, limit: number) {
  return z.unknown().superRefine((value, ctx) => {
    if (!plain(value, limit)) ctx.addIssue({ code: "custom", message: "Expected bounded plain JSON" });
  }).pipe(schema);
}
function digest(value: unknown) { try { return canonicalHash(value); } catch { return null; } }
const equal = (a: unknown, b: unknown) => digest(a) !== null && digest(a) === digest(b);
const text = (maximum: number) => OriginalTextSchema.extend({ text: z.string().min(1).max(maximum)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/).refine(value => value.trim().length > 0) }).strict();
const questions = z.array(text(500)).max(30);
const fields = z.array(field).max(30).refine(value => new Set(value).size === value.length);
const sourceRef = z.object({ id, sourceHash: hash }).strict();
const sources = (min: number, max: number) => z.array(sourceRef).min(min).max(max)
  .refine(value => value.every((item, i) => i === 0 || value[i - 1]!.id < item.id), "Unique ordered sources required");
const artifactKinds = ["BRIEF", "STRATEGY", "IDEAS_PACK"] as const;
const artifactRef = z.object({ id, kind: z.enum(artifactKinds), contentHash: hash }).strict();
const artifacts = z.array(artifactRef).max(3).refine(value => new Set(value.map(item => item.id)).size === value.length
  && value.every((item, i) => i === 0 || artifactKinds.indexOf(value[i - 1]!.kind) < artifactKinds.indexOf(item.kind)), "Unique canonical targets required");
const operation = z.object({ id, kind: PlanningAiOperationKindSchema, ordinal: z.number().int().min(1).max(10), selectedArtifacts: artifacts }).strict()
  .refine(value => (value.kind === "REPLY" || value.ordinal === 1)
    && (value.kind === "COMBINED_REFINEMENT" ? value.selectedArtifacts.length > 0 : value.selectedArtifacts.length === 0));
const confirmationPin = z.object({ field, id, valueHash: hash, confirmationHash: hash }).strict();
const confirmation = z.object({ batchId: id, batchHash: hash, reviewedSnapshot: AgentSnapshotSchema,
  fields: z.array(confirmationPin).length(30).refine(value => new Set(value.map(item => item.id)).size === value.length
    && value.every((item, i) => item.field === CampaignAgentFieldKeys[i])) }).strict();
const fingerprint = z.object({ schemaVersion: z.literal(1), binding: AgentBindingSchema, brandId: id,
  organizationId: id.nullable(), clientId: id.nullable(),
  actor: z.object({ userId: id, role: z.literal("BRAND"), sessionVersion: z.number().int().min(1).max(2147483647) }).strict(),
  brandOwner: z.object({ userId: id, sessionVersion: z.number().int().min(1).max(2147483647) }).strict(),
  authority: z.object({ view: ClientAuthoritySchema.extend({ capability: z.literal("view") }).strict(),
    plan: ClientAuthoritySchema.extend({ capability: z.literal("plan") }).strict() }).strict().nullable(),
  pool: z.object({ id, scope: z.enum(["OWN_BRAND", "CLIENT"]), brandId: id.nullable(), organizationId: id.nullable() }).strict(),
  enrollment: z.object({ id, revision: rev, subscriberUserId: id }).strict(),
  seat: z.object({ id, userId: id, revision: rev, membershipId: id.nullable() }).strict(),
  cycle: z.object({ id, startsAt: UtcDateTimeSchema, endsAt: UtcDateTimeSchema, planId: z.enum(["TRIAL", "STARTER", "GROWTH", "PRO"]),
    policyVersion: z.literal(COMMERCIAL_POLICY_VERSION), priceVersion: opaque.nullable() }).strict()
    .refine(value => Date.parse(value.startsAt) < Date.parse(value.endsAt) && (value.planId === "TRIAL" ? value.priceVersion === null : value.priceVersion !== null)),
  sessionId: id, operation, agent: z.object({ id, revision: rev, stateHash: hash }).strict(), snapshot: AgentSnapshotSchema,
  context: z.object({ contextId: id, versionId: id, version: rev, versionInputRevision: rev, contentHash: hash, submissionId: id }).strict().nullable(),
  sources: sources(0, 64), confirmation: confirmation.nullable(),
}).strict().refine(value => {
  if (value.seat.userId !== value.actor.userId) return false;
  if (value.binding.scope.kind === "OWN_BRAND") {
    if (value.organizationId !== null || value.clientId !== null || value.authority !== null || value.seat.membershipId !== null
      || value.binding.scope.brandId !== value.brandId || value.actor.userId !== value.brandOwner.userId
      || value.actor.sessionVersion !== value.brandOwner.sessionVersion || value.pool.scope !== "OWN_BRAND"
      || value.pool.brandId !== value.brandId || value.pool.organizationId !== null) return false;
  } else {
    const authority = value.authority;
    if (!authority || !value.organizationId || !value.clientId || value.binding.scope.clientId !== value.clientId
      || value.pool.scope !== "CLIENT" || value.pool.brandId !== null || value.pool.organizationId !== value.organizationId) return false;
    const { capability: viewCapability, ...view } = authority.view;
    const { capability: planCapability, ...plan } = authority.plan;
    if (viewCapability !== "view" || planCapability !== "plan" || !equal(view, plan) || plan.organizationId !== value.organizationId
      || plan.clientId !== value.clientId || plan.brandId !== value.brandId || plan.membershipId !== value.seat.membershipId) return false;
  }
  const selection = value.snapshot.selection;
  if (selection.kind === "NONE" ? value.context !== null : !value.context || value.context.versionId !== selection.versionId || value.context.contentHash !== selection.contentHash) return false;
  const needsConfirmation = value.operation.kind === "BRIEF" || value.operation.selectedArtifacts.some(item => item.kind === "BRIEF");
  return (!needsConfirmation || value.confirmation !== null) && (value.confirmation === null || equal(value.confirmation.reviewedSnapshot, value.snapshot));
}, "Inconsistent declared fingerprint");
export const PlanningScopeFingerprintSchema = bounded(fingerprint, 65536);
export type PlanningScopeFingerprint = z.infer<typeof PlanningScopeFingerprintSchema>;
export function planningScopeFingerprintHash(input: unknown) {
  return canonicalHash({ domain: "infame-planning-scope-v1", ...PlanningScopeFingerprintSchema.parse(input) });
}

const recommendation = z.object({ kind: z.literal("UNVERIFIED_RECOMMENDATION"), title: text(200), body: text(2000), relatedFields: fields }).strict();
const proposalOptions = CampaignAgentFieldKeys.map(key => z.object({ kind: z.literal("SOURCE_PROPOSAL"), field: z.literal(key),
  value: CampaignFieldObjectSchema.shape[key], source: z.object({ kind: z.literal("CUSTOMER_TEXT"), references: sources(1, 4) }).strict() }).strict());
const proposal = z.union(proposalOptions as [typeof proposalOptions[number], ...typeof proposalOptions[number][]]);
const reply = z.object({ kind: z.literal("REPLY"), reply: text(20000), proposals: z.array(proposal).max(30)
  .refine(value => new Set(value.map(item => item.field)).size === value.length), recommendations: z.array(recommendation).max(20), openQuestions: questions }).strict();
const narrative = z.object({ overview: text(20000), requirementsExplanation: text(20000), hypotheses: questions, openQuestions: questions }).strict();
const brief = z.object({ kind: z.literal("BRIEF"), narrative }).strict();
const strategy = z.object({ kind: z.literal("STRATEGY"), summary: text(20000), audienceApproach: text(5000), channelApproach: text(5000),
  measurementApproach: text(5000), recommendations: z.array(recommendation).min(1).max(20), hypotheses: questions, openQuestions: questions }).strict();
const ideas = z.object({ kind: z.literal("IDEAS_PACK"), ideas: z.array(z.object({ ordinal: z.number().int().min(1).max(20), title: text(200),
  concept: text(5000), executionNotes: text(2000), relatedFields: fields }).strict()).min(1).max(20)
  .refine(value => value.every((item, i) => item.ordinal === i + 1)), hypotheses: questions, openQuestions: questions }).strict();
const revised = z.discriminatedUnion("kind", [brief, strategy, ideas]);
const refinement = z.object({ kind: z.literal("COMBINED_REFINEMENT"), changes: z.array(z.object({ base: artifactRef, revised }).strict())
  .min(1).max(3).refine(value => artifacts.safeParse(value.map(item => item.base)).success
    && value.every(item => item.base.kind === item.revised.kind && plain(item.revised, 65536))) }).strict();
export const PlanningReplyWireSchema = bounded(reply, 65536);
export const PlanningBriefWireSchema = bounded(brief, 65536);
export const PlanningStrategyWireSchema = bounded(strategy, 65536);
export const PlanningIdeasPackWireSchema = bounded(ideas, 65536);
export const PlanningRefinementWireSchema = bounded(refinement, 262144);
const provider = z.discriminatedUnion("kind", [reply, brief, strategy, ideas, refinement]);
export const PlanningProviderWireSchema = bounded(provider, 262144).refine(value => value.kind === "COMBINED_REFINEMENT" || plain(value, 65536));
export type PlanningProviderWire = z.infer<typeof PlanningProviderWireSchema>;

const briefContent = z.object({ kind: z.literal("BRIEF"), narrative, customerFields: CampaignFieldsSchema, fieldsHash: hash,
  confirmationBatchId: id, confirmationBatchHash: hash, binding: AgentBindingSchema, snapshot: AgentSnapshotSchema, sources: sources(0, 64) }).strict()
  .refine(value => value.fieldsHash === value.snapshot.fieldsHash && value.fieldsHash === digest({ domain: "infame-campaign-fields-v1", fields: value.customerFields }))
  .refine(value => PlanningBriefWireSchema.safeParse({ kind: "BRIEF", narrative: value.narrative }).success && plain(value.customerFields, 65536));
export const PlanningBriefContentSchema = bounded(briefContent, 524288);
export function planningBriefContentForFingerprintSchema(input: unknown) {
  const fp = PlanningScopeFingerprintSchema.refine(value => value.confirmation !== null
    && (value.operation.kind === "BRIEF" || value.operation.selectedArtifacts.some(item => item.kind === "BRIEF"))).parse(input);
  return PlanningBriefContentSchema.refine(value => fp.confirmation !== null && equal(value.binding, fp.binding) && equal(value.snapshot, fp.snapshot)
    && equal(value.sources, fp.sources) && value.confirmationBatchId === fp.confirmation.batchId && value.confirmationBatchHash === fp.confirmation.batchHash
    && fp.confirmation.fields.every(pin => pin.valueHash === digest({ domain: "infame-campaign-field-value-v1", field: pin.field, value: value.customerFields[pin.field] })));
}
export function planningRefinementForTargetsSchema(targetInput: unknown, fingerprintInput: unknown) {
  const fp = PlanningScopeFingerprintSchema.refine(value => value.operation.kind === "COMBINED_REFINEMENT").parse(fingerprintInput);
  const targets = bounded(artifacts.min(1).refine(value => equal(value, fp.operation.selectedArtifacts)), 4096).parse(targetInput);
  return PlanningRefinementWireSchema.refine(value => fp.operation.kind === "COMBINED_REFINEMENT" && equal(targets, fp.operation.selectedArtifacts)
    && equal(value.changes.map(item => item.base), targets));
}
export function planningProviderWireForFingerprintSchema(input: unknown) {
  const fp = PlanningScopeFingerprintSchema.parse(input);
  return PlanningProviderWireSchema.refine(value => {
    if (value.kind !== fp.operation.kind) return false;
    if (value.kind === "REPLY") return value.proposals.every(item => item.source.references.every(ref => fp.sources.some(source => equal(source, ref))));
    if (value.kind === "COMBINED_REFINEMENT") return equal(value.changes.map(item => item.base), fp.operation.selectedArtifacts);
    return true;
  });
}
const request = z.object({ schemaVersion: z.literal(1), operationKey: z.uuid(), sessionId: id, kind: PlanningAiOperationKindSchema,
  ordinal: z.number().int().min(1).max(10), expectedFingerprintHash: hash, sourceMessage: sourceRef.nullable(),
  requestedLanguage: OriginalTextSchema.shape.language, selectedArtifacts: artifacts }).strict().refine(value =>
  (value.kind === "REPLY" || value.ordinal === 1) && (["REPLY", "COMBINED_REFINEMENT"].includes(value.kind) ? value.sourceMessage !== null : true)
  && (value.kind === "COMBINED_REFINEMENT" ? value.selectedArtifacts.length > 0 : value.selectedArtifacts.length === 0));
export const PlanningAiRequestSchema = bounded(request, 16384);
export function planningRequestForFingerprintSchema(input: unknown) {
  const fp = PlanningScopeFingerprintSchema.parse(input), fpHash = planningScopeFingerprintHash(fp);
  return PlanningAiRequestSchema.refine(value => value.sessionId === fp.sessionId && value.kind === fp.operation.kind && value.ordinal === fp.operation.ordinal
    && value.expectedFingerprintHash === fpHash && equal(value.selectedArtifacts, fp.operation.selectedArtifacts)
    && (value.sourceMessage === null || fp.sources.some(ref => equal(ref, value.sourceMessage))));
}
export function planningRequestHash(actorUserId: string, input: unknown) {
  return canonicalHash({ domain: "infame-planning-request-v1", actorUserId: id.parse(actorUserId), request: PlanningAiRequestSchema.parse(input) });
}

const retainedRefinement = z.object({ kind: z.literal("COMBINED_REFINEMENT"), changes: z.array(z.object({ base: artifactRef,
  revised: z.union([briefContent, strategy, ideas]) }).strict()).min(1).max(3)
  .refine(value => artifacts.safeParse(value.map(item => item.base)).success && value.every(item => item.base.kind === item.revised.kind)) }).strict();
const retained = z.object({ schemaVersion: z.literal(1), attemptId: id, operationId: id, sessionId: id,
  binding: AgentBindingSchema, snapshot: AgentSnapshotSchema, scopeFingerprintHash: hash,
  provider: z.object({ id: z.literal("ANTHROPIC"), modelId: id, registryVersion: opaque, requestId: id.nullable() }).strict(),
  output: z.union([reply, briefContent, strategy, ideas, retainedRefinement]),
}).strict().refine(value => value.output.kind === "BRIEF"
  ? equal(value.output.binding, value.binding) && equal(value.output.snapshot, value.snapshot)
  : value.output.kind !== "COMBINED_REFINEMENT" || value.output.changes.every(item => item.revised.kind !== "BRIEF"
    || (equal(item.revised.binding, value.binding) && equal(item.revised.snapshot, value.snapshot))))
  .refine(value => value.output.kind === "BRIEF" ? PlanningBriefContentSchema.safeParse(value.output).success
    : value.output.kind === "COMBINED_REFINEMENT" ? value.output.changes.every(item => item.revised.kind === "BRIEF"
      ? PlanningBriefContentSchema.safeParse(item.revised).success : PlanningProviderWireSchema.safeParse(item.revised).success)
    : PlanningProviderWireSchema.safeParse(value.output).success);
export const PlanningRetainedContentSchema = bounded(retained, 524288);
export function planningRetainedContentForFingerprintSchema(input: unknown) {
  const fp = PlanningScopeFingerprintSchema.parse(input), fpHash = planningScopeFingerprintHash(fp);
  return PlanningRetainedContentSchema.refine(value => {
    if (value.operationId !== fp.operation.id || value.sessionId !== fp.sessionId || value.scopeFingerprintHash !== fpHash
      || !equal(value.binding, fp.binding) || !equal(value.snapshot, fp.snapshot) || value.output.kind !== fp.operation.kind) return false;
    if (value.output.kind === "BRIEF") return planningBriefContentForFingerprintSchema(fp).safeParse(value.output).success;
    if (value.output.kind === "COMBINED_REFINEMENT") return equal(value.output.changes.map(item => item.base), fp.operation.selectedArtifacts)
      && value.output.changes.every(item => item.revised.kind !== "BRIEF" || planningBriefContentForFingerprintSchema(fp).safeParse(item.revised).success);
    return planningProviderWireForFingerprintSchema(fp).safeParse(value.output).success;
  });
}
