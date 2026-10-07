import { describe, expect, it } from "vitest";
import { CampaignBriefContentSchema } from "@/lib/campaigns/contracts";
import { ApprovedBrandContextVersionSchema, BrandContextContentSchema } from "@/lib/brand-context/contracts";
import { ManagedOrderCommandSchema, ManagedOrderSnapshotSchema, ManagedOrderReceiptSchema } from "@/lib/managed/contracts";
import { campaignFields } from "../campaigns/fixtures";

const ownScope = { kind: "OWN_BRAND", brandId: "beneficiary-brand" } as const;
const clientScope = { kind: "CLIENT", clientId: "client-a" } as const;
const authority = {
  organizationId: "agency-a", clientId: "client-a", brandId: "beneficiary-brand", membershipId: "seat-a", grantId: "grant-a",
  capability: "signCustomer", organizationRevision: 2, membershipRevision: 3, clientRevision: 4, grantRevision: 5,
} as const;
const ownCommand = {
  action: "SUBMIT", operationKey: "a01f8aa1-63d7-4a90-9eac-f4c6f2111dd0", scope: ownScope,
  campaignId: "campaign-a", expectedCampaignRevision: 7, expectedPlanningRevision: 6,
  expectedSelectionId: "selection-a", expectedSelectionRevision: 2, briefId: "brief-a", expectedBriefVersion: 2,
  disclosureVersion: "infame-order-disclosure-v1",
} as const;
const createdAt = "2026-10-07T01:00:00.000Z", approvedAt = "2026-10-07T02:00:00.000Z";
const context = ApprovedBrandContextVersionSchema.parse({
  id: "context-version-a", contextId: "context-a", version: 2, inputRevision: 3,
  nameOriginal: { text: "سياق الشركة الأصلي", language: "ar" },
  content: BrandContextContentSchema.parse({
    schemaVersion: 1, positioning: { text: "  تموضع أصلي\nكلمات العميل نفسها  ", language: "ar" },
    values: [{ text: "  قيمة أصلية  ", language: "ar" }], tone: { text: null, language: null },
    references: [{ label: { text: "مرجع أصلي", language: "ar" }, url: null, notes: { text: "", language: null } }], competitors: [],
  }),
  contentHash: "a".repeat(64), approvedAt,
});
const manifest = {
  kind: "MANIFEST", id: "manifest-a", revision: 2, hash: "b".repeat(64),
  items: [{ bindingId: "binding-a", assetId: "asset-a", contentType: "image/png", size: 123,
    labelOriginal: { text: "  مرجع الصورة الأصلي  ", language: "ar" }, notesOriginal: { text: null, language: null } }],
} as const;
function snapshot(withContext = false) {
  const content = CampaignBriefContentSchema.parse({
    schemaVersion: 1, requirements: { ...structuredClone(campaignFields), title: "  حملة أصلية\nبدون ترجمة  ",
      impressionsTarget: null, campaignId: "campaign-a", version: 2, brandCountryCode: "KW", mandatoryPolicyVersionIds: [] },
    approvedByUserId: "original-owner", inputRevision: 3, policyReview: null,
  });
  return {
    schemaVersion: 1,
    brief: { id: "brief-a", campaignId: "campaign-a", version: 2, inputRevision: 3, content,
      approvedAt, approvedByUserId: "original-owner", createdAt },
    provenance: { selectionId: "selection-a", selectionRevision: 2,
      versionId: withContext ? context.id : null, contentHash: withContext ? context.contentHash : null },
    selectedContext: withContext ? structuredClone(context) : null,
    references: withContext ? structuredClone(manifest) : { kind: "NO_CONTEXT" as const },
  };
}
const receipt = {
  action: "SUBMIT", orderId: "order-a", submissionId: "order-submission-a", campaignId: "campaign-a",
  revision: 1, submissionVersion: 1, briefId: "brief-a", briefVersion: 2, selectionId: "selection-a", selectionRevision: 2,
} as const;

// Fill only already-valid, bounded original-content fields. Multi-byte text makes
// the aggregate UTF8 boundary meaningful while every individual field still fits.
function snapshotBytes(target: number) {
  const value = snapshot(), fields = value.brief.content.requirements;
  fields.summary = "s"; fields.productService = "p"; fields.usageRights = "u"; fields.tone = "t";
  fields.kpis = Array.from({ length: 30 }, (_, index) => ({ name: `K${index}`, target: "t" }));
  fields.assumptions = Array.from({ length: 30 }, (_, index) => `A${index}`);
  fields.openQuestions = Array.from({ length: 30 }, (_, index) => `Q${index}`);
  fields.noGoTopics = Array.from({ length: 50 }, (_, index) => `N${index}`);
  const slots: Array<{ maximum: number; get: () => string; set: (text: string) => void }> = [
    { maximum: 5000, get: () => fields.summary, set: text => { fields.summary = text; } },
    { maximum: 5000, get: () => fields.productService, set: text => { fields.productService = text; } },
    // usageRights retains the shared text schema's original 5000 bound.
    { maximum: 5000, get: () => fields.usageRights, set: text => { fields.usageRights = text; } },
    { maximum: 500, get: () => fields.tone, set: text => { fields.tone = text; } },
  ];
  for (const row of fields.kpis) slots.push(
    { maximum: 200, get: () => row.name, set: text => { row.name = text; } },
    { maximum: 1000, get: () => row.target, set: text => { row.target = text; } },
  );
  for (const [rows, maximum] of [[fields.assumptions, 500], [fields.openQuestions, 500], [fields.noGoTopics, 200]] as const) {
    for (let index = 0; index < rows.length; index++) slots.push({ maximum, get: () => rows[index]!, set: text => { rows[index] = text; } });
  }
  let remaining = target - Buffer.byteLength(JSON.stringify(value), "utf8");
  for (const slot of slots) {
    if (remaining === 0) break;
    const old = slot.get(), capacity = slot.maximum - old.length;
    const triples = Math.min(capacity, Math.floor(remaining / 3));
    let added = "字".repeat(triples); remaining -= triples * 3;
    const singles = Math.min(capacity - triples, remaining);
    added += "a".repeat(singles); remaining -= singles;
    slot.set(old + added);
  }
  if (remaining !== 0) throw new Error("Invalid bounded managed snapshot fixture");
  return value;
}

describe("managed order customer submission pure contracts", () => {
  it("binds an explicit disclosure-only SUBMIT to exact own or client signCustomer scope without payer, signer or commercial inputs", () => {
    const client = { ...ownCommand, scope: clientScope, expectedAuthority: authority };
    expect(ManagedOrderCommandSchema.parse(ownCommand)).toEqual(ownCommand);
    expect(ManagedOrderCommandSchema.parse(client)).toEqual(client);
    for (const invalid of [
      { ...ownCommand, action: "ACCEPT" }, { ...ownCommand, operationKey: "not-a-uuid" },
      { ...ownCommand, disclosureVersion: "infame-order-disclosure-v2" }, { ...ownCommand, expectedCampaignRevision: 0 },
      { ...ownCommand, expectedPlanningRevision: 2147483647 }, { ...ownCommand, expectedSelectionId: null },
      { ...ownCommand, expectedSelectionRevision: 0 }, { ...ownCommand, expectedBriefVersion: 0 },
      { ...ownCommand, scope: { ...ownScope, clientId: "client-a" } }, { ...ownCommand, expectedAuthority: authority },
      { ...client, expectedAuthority: undefined }, { ...client, expectedAuthority: { ...authority, clientId: "client-b" } },
      { ...client, expectedAuthority: { ...authority, capability: "plan" } },
      { ...client, expectedAuthority: { ...authority, capability: "financial" } },
      { ...client, expectedAuthority: { ...authority, role: "ADMIN" } },
      { ...ownCommand, buyer: { brandId: "beneficiary-brand" } }, { ...ownCommand, payerOrganizationId: "agency-a" },
      { ...ownCommand, signedAt: approvedAt }, { ...ownCommand, taxTreatment: { treatment: "EXEMPT" } },
      { ...ownCommand, supplierCostMinor: "1" }, { ...ownCommand, transcript: "private unsubmitted conversation" },
    ]) expect(ManagedOrderCommandSchema.safeParse(invalid).success).toBe(false);
  });

  it("preserves approved original Arabic, null versus empty values and requested budget while leaving retail quote values absent", () => {
    const noContext = snapshot(), selected = snapshot(true);
    expect(ManagedOrderSnapshotSchema.parse(noContext)).toEqual(noContext);
    const parsed = ManagedOrderSnapshotSchema.parse(selected);
    expect(parsed).toEqual(selected);
    expect(parsed.brief.content.requirements.title).toBe("  حملة أصلية\nبدون ترجمة  ");
    expect(parsed.brief.content.requirements.budget).toEqual({ amountMinor: "123456", currencyCode: "KWD" });
    expect(parsed.brief.content.requirements.impressionsTarget).toBeNull();
    expect(parsed.selectedContext?.content.positioning.text).toBe("  تموضع أصلي\nكلمات العميل نفسها  ");
    expect(parsed.selectedContext?.content.tone.text).toBeNull();
    expect(parsed.selectedContext?.content.references[0]?.notes.text).toBe("");
    for (const field of ["quote", "price", "net", "tax", "gross", "payer", "signature", "taxTreatment"]) expect(Object.hasOwn(parsed, field)).toBe(false);
    expect(ManagedOrderSnapshotSchema.parse({ ...selected, references: { kind: "LEGACY_ABSENT" } }).references).toEqual({ kind: "LEGACY_ABSENT" });
    expect(ManagedOrderSnapshotSchema.parse({ ...selected, references: { ...manifest, items: [] } }).references).toEqual({ ...manifest, items: [] });
  });

  it("rejects contradictory approval, brief/context/reference pins, invalid dates and hidden private content, enforcing the compact UTF8 aggregate bound", () => {
    const absent = snapshot(), selected = snapshot(true), brief = selected.brief;
    for (const invalid of [
      { ...selected, brief: { ...brief, campaignId: "another-campaign" } },
      { ...selected, brief: { ...brief, version: 3 } }, { ...selected, brief: { ...brief, inputRevision: 4 } },
      { ...selected, brief: { ...brief, approvedByUserId: "different-owner" } },
      { ...selected, brief: { ...brief, content: { ...brief.content, approvedByUserId: null } } },
      { ...selected, brief: { ...brief, approvedAt: null } }, { ...selected, brief: { ...brief, approvedAt: "2026-02-30T01:00:00.000Z" } },
      { ...selected, brief: { ...brief, createdAt: "2026-10-07T01:00:00+03:00" } },
      { ...selected, brief: { ...brief, createdAt: "2026-10-07T03:00:00.000Z" } },
      { ...selected, provenance: { ...selected.provenance, versionId: "other-context-version" } },
      { ...selected, provenance: { ...selected.provenance, contentHash: "c".repeat(64) } },
      { ...selected, provenance: { ...selected.provenance, contentHash: null } }, { ...selected, selectedContext: null },
      { ...selected, selectedContext: { ...context, approvedAt: "2026-10-07T02:00:00.001Z" } },
      { ...selected, references: { kind: "NO_CONTEXT" } }, { ...absent, selectedContext: context },
      { ...absent, references: manifest }, { ...absent, references: { kind: "LEGACY_ABSENT" } },
      { ...selected, supplierCostMinor: "1" }, { ...selected, transcript: "private unsubmitted words" },
      { ...selected, brief: { ...brief, transcript: "private unsubmitted words" } },
      { ...selected, brief: { ...brief, content: { ...brief.content, supplierCostMinor: "1" } } },
      { ...selected, selectedContext: { ...context, transcript: "private unsubmitted words" } },
      { ...selected, references: { ...manifest, items: [{ ...manifest.items[0], storageKey: "private/storage/path" }] } },
    ]) expect(ManagedOrderSnapshotSchema.safeParse(invalid).success).toBe(false);
    const boundary = snapshotBytes(262144), oversized = snapshotBytes(262145);
    expect(Buffer.byteLength(JSON.stringify(boundary), "utf8")).toBe(262144);
    expect(CampaignBriefContentSchema.safeParse(boundary.brief.content).success).toBe(true);
    expect(ManagedOrderSnapshotSchema.safeParse(boundary).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(oversized), "utf8")).toBe(262145);
    expect(CampaignBriefContentSchema.safeParse(oversized.brief.content).success).toBe(true);
    expect(ManagedOrderSnapshotSchema.safeParse(oversized).success).toBe(false);
  });

  it("permits only the immutable first-submission scalar journal receipt and rejects signing, payment, tax, content or replay metadata", () => {
    expect(ManagedOrderReceiptSchema.parse(receipt)).toEqual(receipt);
    for (const invalid of [
      { ...receipt, action: "ACCEPT" }, { ...receipt, revision: 2 }, { ...receipt, submissionVersion: 2 },
      { ...receipt, submissionId: null }, { ...receipt, orderId: "" }, { ...receipt, briefVersion: 0 },
      { ...receipt, selectionRevision: 0 }, { ...receipt, briefVersion: 2147483647 },
      { ...receipt, replayed: true }, { ...receipt, contentHash: "a".repeat(64) }, { ...receipt, payloadHash: "a".repeat(64) },
      { ...receipt, content: snapshot() }, { ...receipt, transcript: "private unsubmitted words" },
      { ...receipt, signerUserId: "original-owner" }, { ...receipt, payerOrganizationId: "agency-a" },
      { ...receipt, taxTreatment: { treatment: "STANDARD_RATE", rateBasisPoints: 1500 } },
      { ...receipt, valueMinor: "123456" }, { ...receipt, supplierCostMinor: "1" },
      { ...receipt, result: { accepted: true } }, { ...receipt, sessionToken: "synthetic-private-canary" },
    ]) expect(ManagedOrderReceiptSchema.safeParse(invalid).success).toBe(false);
  });
});
