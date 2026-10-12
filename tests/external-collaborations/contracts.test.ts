// P0 pure declarations only, at most two groups. Root alone adopts/runs.
// Synthetic values; passing schemas grants no native role/ownership, file custody,
// counterparty approval, money movement or verified earnings.
import { expect, it, vi } from "vitest";
import type { z } from "zod";
import { MoneySchema } from "@/lib/contracts/money";
import { DateRangeSchema, OriginalTextSchema } from "@/lib/contracts/vocabulary";
import { canonicalHash } from "@/lib/onboarding/drafts";

type Schema = Pick<z.ZodType, "parse" | "safeParse">;
type Contracts = {
  ExternalCollaborationError: new (code: string, status?: number) => Error & { code: string; status: number };
  ExternalCollaborationStatusSchema: Schema; ExternalCollaborationDetailsSchema: Schema;
  ExternalCollaborationCommandSchema: Schema; ExternalCollaborationReceiptSchema: Schema; ExternalCollaborationResultSchema: Schema;
  ExternalCollaborationHeaderSchema: Schema; ExternalCollaborationAttachmentSchema: Schema; ExternalCollaborationDetailSchema: Schema; ExternalCollaborationListSchema: Schema;
  EXTERNAL_COLLABORATION_LIMITS: Record<string, number>; EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE: string;
  canTransitionExternalCollaboration(from: string, to: string): boolean;
  externalCollaborationCommandHash(actor: unknown, input: unknown): string;
};
const modulePath = "@/lib/external-collaborations/contracts";
// Variable import occurs inside the test after a valid central fixture, avoiding
// missing-module collection failure. importActual is actual code, not a mock.
const load = async () => (await vi.importActual<Contracts>(modulePath).catch(() => undefined)) as Contracts;
const clone = <T,>(value: T): T => structuredClone(value);
const actorId = "creator*" + "x".repeat(192), collaborationId = "external*original";
const firstItem = "ffffffff-ffff-4fff-8fff-ffffffffffff", secondItem = "00000000-0000-4000-8000-000000000001";
const operationKey = "12345678-1234-4234-8234-123456789abc", checksum = "a".repeat(64);
const original = (text: string, language: string | null = "ar-SA") => OriginalTextSchema.parse({ text, language });
const details = () => ({ schemaVersion: 1, clientDisplay: original("  عميل أصلي\nOriginal client  "), campaignDisplay: original("\tOriginal campaign / حملة أصلية  ", null),
  declaredValue: MoneySchema.parse({ amountMinor: "9223372036854775807", currencyCode: "SAR" }),
  period: DateRangeSchema.parse({ startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-02T00:00:00.000Z", timeZone: "Asia/Riyadh" }),
  notes: original("  ملاحظات أصلية\nExact original notes\r\n  ", "ar"), brief: original(" \tExact private manual brief\n  ", "en-US"),
  checklist: [{ id: firstItem, label: original("  الأول في ترتيب المستخدم  "), done: false }, { id: secondItem, label: original("Second original label", "en"), done: true }] });
function commands() {
  const base = { operationKey, collaborationId, expectedRevision: 7 };
  return [
    { operationKey, action: "CREATE", expectedRevision: 0, payload: { details: details() } },
    { ...base, action: "SAVE_DETAILS", payload: { details: details() } },
    { ...base, action: "SET_STATUS", payload: { status: "IN_PROGRESS" } },
    { ...base, action: "SET_CHECKLIST", payload: { checklist: details().checklist } },
    { ...base, action: "SET_CHECKLIST_DONE", payload: { itemId: firstItem, done: true } },
    { ...base, action: "ATTACH_FILE", payload: { label: original("  Original attachment label  ", null), file: { checksum, contentType: "application/pdf", size: 10485760 } } },
    { ...base, action: "REMOVE_ATTACHMENT", payload: { attachmentId: "attachment*original" } },
    { ...base, action: "ARCHIVE", payload: {} }, { ...base, action: "RESTORE", payload: {} },
  ];
}
const header = (id = collaborationId) => ({ id, revision: 8, status: "DRAFT", archived: false, clientDisplay: details().clientDisplay, campaignDisplay: details().campaignDisplay,
  declaredValue: details().declaredValue, period: details().period, checklist: { total: 2, done: 1 }, attachmentCount: 0,
  createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00.000Z" });
const attachment = (id = "attachment*01", assetId = "asset*01") => ({ id, assetId, assetRevision: 1, label: original(" Original label ", null),
  contentType: "image/png", size: 1, attachedAt: "2026-10-12T00:00:00Z" });
const detail = () => ({ scope: "OWN_CREATOR", asOf: "2026-10-12T00:00:00.000Z", collaboration: { id: collaborationId, revision: 8, status: "PLANNED", archived: false,
  details: details(), createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00.000Z" }, attachments: [attachment()] });
const list = () => ({ scope: "OWN_CREATOR", asOf: "2026-10-12T00:00:00Z", collaborations: [header("external*01"), header("external*02")], nextCursor: "external*02" });
function invalid(schema: Schema, value: unknown) { expect(schema.safeParse(value).success).toBe(false); }
function validationError(work: () => unknown) {
  try { work(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const safe = error as { code?: string; status?: number }; return { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; }
}
const rejectedHash = { accepted: false, code: "VALIDATION", status: 422 };

it("preserves exact original declarations, all command/receipt variants, money/null/time/checklist order and private structural DTOs", async () => {
  const fixture = details();
  expect(actorId.length).toBe(200); expect(fixture.declaredValue.amountMinor).toBe("9223372036854775807");
  expect(DateRangeSchema.safeParse(fixture.period).success && OriginalTextSchema.safeParse(fixture.clientDisplay).success).toBe(true);
  const c = await load(); // First meaningful missing-export RED follows the valid central fixture.
  const parsed = c.ExternalCollaborationDetailsSchema.parse(fixture) as ReturnType<typeof details>;
  expect(canonicalHash(parsed)).toBe(canonicalHash(fixture)); expect(parsed.notes?.text === fixture.notes.text).toBe(true);
  expect(parsed.checklist.map(item => item.id)).toEqual([firstItem, secondItem]); expect(parsed.clientDisplay.language).toBe("ar-SA"); expect(parsed.campaignDisplay.language === null).toBe(true);
  const unknown = { ...fixture, declaredValue: null, period: null, notes: null, brief: null, checklist: [] };
  expect(canonicalHash(c.ExternalCollaborationDetailsSchema.parse(unknown))).toBe(canonicalHash(unknown));
  expect(Object.isFrozen(c.EXTERNAL_COLLABORATION_LIMITS)).toBe(true);
  expect(c.EXTERNAL_COLLABORATION_LIMITS).toEqual({ detailsBytes: 262144, commandBytes: 524288, dtoBytes: 524288, checklist: 30, attachments: 20, list: 30, attachmentBytes: 10485760 });
  expect(c.EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE).toBe("EXTERNAL_COLLABORATION_ATTACHMENT");
  const statuses = ["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  const transitions: Record<string, string[]> = { DRAFT: ["PLANNED", "IN_PROGRESS", "CANCELLED"], PLANNED: ["DRAFT", "IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["PLANNED", "COMPLETED", "CANCELLED"], COMPLETED: ["IN_PROGRESS"], CANCELLED: ["DRAFT"] };
  for (const from of statuses) for (const to of statuses) {
    expect(c.ExternalCollaborationStatusSchema.safeParse(from).success).toBe(true);
    expect(c.canTransitionExternalCollaboration(from, to)).toBe(transitions[from]!.includes(to));
  }
  for (const command of commands()) {
    const captured = c.ExternalCollaborationCommandSchema.parse(command), before = canonicalHash(command);
    expect(canonicalHash(captured)).toBe(before);
    const actual = c.externalCollaborationCommandHash(actorId, command);
    expect(actual).toBe(canonicalHash({ domain: "infame-external-collaboration-command-v1", actorUserId: actorId, command: captured }));
    expect(canonicalHash(command)).toBe(before);
    const receipt = { operationKey, collaborationId, action: command.action, revision: command.action === "CREATE" ? 1 : 8,
      status: command.action === "CREATE" ? "DRAFT" : "PLANNED", archived: command.action === "ARCHIVE",
      attachmentId: ["ATTACH_FILE", "REMOVE_ATTACHMENT"].includes(command.action) ? "attachment*original" : null };
    expect(canonicalHash(c.ExternalCollaborationReceiptSchema.parse(receipt))).toBe(canonicalHash(receipt));
    expect(canonicalHash(c.ExternalCollaborationResultSchema.parse({ ...receipt, replayed: true }))).toBe(canonicalHash({ ...receipt, replayed: true }));
  }
  for (const contentType of ["image/png", "image/jpeg", "image/webp", "application/pdf"]) {
    expect(c.ExternalCollaborationAttachmentSchema.safeParse({ ...attachment(), contentType }).success).toBe(true);
    expect(c.ExternalCollaborationCommandSchema.safeParse({ ...commands()[5], payload: { label: original("Manual label", null), file: { checksum, contentType, size: 1 } } }).success).toBe(true);
  }
  expect(canonicalHash(c.ExternalCollaborationHeaderSchema.parse(header()))).toBe(canonicalHash(header()));
  expect(canonicalHash(c.ExternalCollaborationDetailSchema.parse(detail()))).toBe(canonicalHash(detail()));
  expect(canonicalHash(c.ExternalCollaborationListSchema.parse(list()))).toBe(canonicalHash(list()));
  expect(c.ExternalCollaborationListSchema.safeParse({ scope: "OWN_CREATOR", asOf: "2026-10-12T00:00:00Z", collaborations: [], nextCursor: null }).success).toBe(true);
  // Max structural text/cardinality yields >64KiB valid details. The declared
  // aggregate cap is larger than reachable schema maxima; do not fake overflow.
  const maximum = { ...details(), clientDisplay: original("字".repeat(200), "ja"), campaignDisplay: original("字".repeat(200), "ja"),
    notes: original("字".repeat(10000), "ja"), brief: original("字".repeat(20000), "ja"),
    checklist: Array.from({ length: 30 }, (_, index) => ({ id: "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), label: original("字".repeat(500), "ja"), done: index % 2 === 0 })) };
  expect(new TextEncoder().encode(JSON.stringify(maximum)).byteLength > 65536).toBe(true); expect(c.ExternalCollaborationDetailsSchema.safeParse(maximum).success).toBe(true);
  const currentAttachments = Array.from({ length: 20 }, (_, index) => attachment("attachment*" + String(index).padStart(2, "0"), "asset*" + String(index).padStart(2, "0")));
  expect(c.ExternalCollaborationDetailSchema.safeParse({ ...detail(), attachments: currentAttachments }).success).toBe(true);
  const currentHeaders = Array.from({ length: 30 }, (_, index) => header("external*" + String(index).padStart(2, "0")));
  expect(c.ExternalCollaborationListSchema.safeParse({ ...list(), collaborations: currentHeaders, nextCursor: currentHeaders[29]!.id }).success).toBe(true);
});

it("rejects unsafe JSON, unknown fields, exact scalar/cardinality/state/date violations and protects parsed-command hash capture without authority claims", async () => {
  const c = await load(), base = details();
  for (const text of ["", " \t\n ", "bad\u0000control", "bad\u007fcontrol"]) {
    invalid(c.ExternalCollaborationDetailsSchema, { ...base, clientDisplay: { text, language: null } });
    invalid(c.ExternalCollaborationDetailsSchema, { ...base, notes: { text, language: null } });
    invalid(c.ExternalCollaborationDetailsSchema, { ...base, brief: { text, language: "en" } });
    invalid(c.ExternalCollaborationDetailsSchema, { ...base, checklist: [{ id: firstItem, label: { text, language: "en" }, done: false }] });
  }
  for (const value of [
    { ...base, schemaVersion: 2 }, { ...base, ownerUserId: actorId }, { ...base, brandId: "invented-counterparty" }, { ...base, earnedMinor: "1" },
    { ...base, clientDisplay: original("x".repeat(201)) }, { ...base, campaignDisplay: original("x".repeat(201)) },
    { ...base, notes: original("x".repeat(10001)) }, { ...base, brief: { text: "x".repeat(20001), language: "en" } },
    { ...base, notes: { text: "Original", language: "bad_language" } }, { ...base, brief: { text: "Original", language: "" } },
    { ...base, clientDisplay: { ...base.clientDisplay, translation: "Invented translation" } },
    { ...base, checklist: [...base.checklist, clone(base.checklist[0]!)] },
    { ...base, checklist: [{ ...base.checklist[0], id: "not-a-uuid" }] }, { ...base, checklist: [{ ...base.checklist[0], done: "true" }] },
    { ...base, checklist: [{ ...base.checklist[0], label: original("x".repeat(501)) }] },
    { ...base, checklist: Array.from({ length: 31 }, (_, index) => ({ id: "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"), label: original("Item"), done: false })) },
    { ...base, period: { ...base.period, endsAt: base.period.startsAt } },
    { ...base, period: { ...base.period, startsAt: "2026-11-03T00:00:00Z" } },
    { ...base, period: { ...base.period, startsAt: "2026-02-30T00:00:00Z" } },
    { ...base, period: { ...base.period, startsAt: "2026-11-01T03:00:00+03:00" } },
    { ...base, period: { ...base.period, timeZone: "Mars/Olympus" } }, { ...base, period: { startsAt: base.period.startsAt, endsAt: base.period.endsAt } },
  ]) invalid(c.ExternalCollaborationDetailsSchema, value);
  for (const amountMinor of [1, BigInt(1), "01", "-1", "1.5", "1e3", "9223372036854775808", "not-money"])
    invalid(c.ExternalCollaborationDetailsSchema, { ...base, declaredValue: { amountMinor, currencyCode: "SAR" } });
  for (const currencyCode of ["sar", "XXX", "XAU", ["SAR", "USD"]]) invalid(c.ExternalCollaborationDetailsSchema, { ...base, declaredValue: { amountMinor: "0", currencyCode } });
  expect(c.ExternalCollaborationDetailsSchema.safeParse({ ...base, declaredValue: { amountMinor: "0", currencyCode: "SAR" } }).success).toBe(true);
  const parsed = c.ExternalCollaborationCommandSchema.parse(commands()[0]) as Record<string, unknown>, parsedBefore = canonicalHash(parsed);
  const actualHash = c.externalCollaborationCommandHash(actorId, parsed);
  expect(canonicalHash(parsed)).toBe(parsedBefore); expect(actualHash).toBe(c.externalCollaborationCommandHash(actorId, clone(parsed)));
  expect(actualHash === c.externalCollaborationCommandHash("creator*different", parsed)).toBe(false);
  const raw = commands()[0]!, captured = c.ExternalCollaborationCommandSchema.parse(raw), capturedHash = canonicalHash(captured);
  (raw.payload as { details: ReturnType<typeof details> }).details.notes.text = "Later raw input mutation";
  expect(canonicalHash(captured)).toBe(capturedHash);
  const changed = clone(parsed) as { operationKey: string; payload: { details: ReturnType<typeof details> } };
  changed.payload.details.notes.text += " changed"; expect(c.externalCollaborationCommandHash(actorId, changed) === actualHash).toBe(false);
  const reordered = clone(parsed) as { payload: { details: ReturnType<typeof details> } }; reordered.payload.details.checklist.reverse();
  expect(c.externalCollaborationCommandHash(actorId, reordered) === actualHash).toBe(false);
  for (const actor of [undefined, {}, "", "unsafe id", "\nunsafe", "هوية", "x".repeat(201)]) expect(validationError(() => c.externalCollaborationCommandHash(actor, parsed))).toEqual(rejectedHash);
  const error = new c.ExternalCollaborationError("VALIDATION", 422); expect({ code: error.code, status: error.status }).toEqual({ code: "VALIDATION", status: 422 });
  const create = commands()[0]!;
  for (const value of [{ ...create, collaborationId }, { ...create, expectedRevision: 1 }, { ...create, serverAuth: { sessionId: "never-an-authority" } },
    { ...create, payload: { ...create.payload, role: "CREATOR" } }, { ...create, action: "DELETE" }, { ...create, operationKey: "not-a-uuid" }]) {
    invalid(c.ExternalCollaborationCommandSchema, value); expect(validationError(() => c.externalCollaborationCommandHash(actorId, value))).toEqual(rejectedHash);
  }
  for (const command of commands().slice(1)) {
    const { collaborationId: omitted, ...missingId } = command as Record<string, unknown>; void omitted;
    invalid(c.ExternalCollaborationCommandSchema, missingId); invalid(c.ExternalCollaborationCommandSchema, { ...command, expectedRevision: 0 });
    invalid(c.ExternalCollaborationCommandSchema, { ...command, expectedRevision: 2147483647 }); invalid(c.ExternalCollaborationCommandSchema, { ...command, unexpected: true });
  }
  for (const done of [null, 1, "false"]) invalid(c.ExternalCollaborationCommandSchema, { ...commands()[4], payload: { itemId: firstItem, done } });
  invalid(c.ExternalCollaborationCommandSchema, { ...commands()[4], payload: { itemId: "missing-uuid", done: true } });
  invalid(c.ExternalCollaborationCommandSchema, { ...commands()[8], payload: { consent: true } });
  for (const size of [0, 10485761, 1.5, "1", Number.NaN, Number.POSITIVE_INFINITY]) invalid(c.ExternalCollaborationCommandSchema, { ...commands()[5], payload: { label: original("Label"), file: { checksum, contentType: "image/png", size } } });
  for (const contentType of ["text/plain", "audio/wav", "image/svg+xml", "application/zip", "IMAGE/PNG"])
    invalid(c.ExternalCollaborationCommandSchema, { ...commands()[5], payload: { label: original("Label"), file: { checksum, contentType, size: 1 } } });
  for (const checksum of ["A".repeat(64), "f".repeat(63), "not-a-checksum"]) invalid(c.ExternalCollaborationCommandSchema, { ...commands()[5], payload: { label: original("Label"), file: { checksum, contentType: "image/png", size: 1 } } });
  invalid(c.ExternalCollaborationCommandSchema, { ...commands()[5], payload: { label: original("Label"), file: { checksum, contentType: "image/png", size: 1 }, bytes: new Uint8Array([1]) } });
  invalid(c.ExternalCollaborationCommandSchema, { ...commands()[5], payload: { label: original("x".repeat(201)), file: { checksum, contentType: "image/png", size: 1 } } });
  invalid(c.ExternalCollaborationCommandSchema, { ...commands()[6], payload: { attachmentId: "x".repeat(201) } });

  const receipt = { operationKey, collaborationId, action: "SAVE_DETAILS", revision: 8, status: "PLANNED", archived: false, attachmentId: null };
  for (const value of [{ ...receipt, revision: 1 }, { ...receipt, archived: true }, { ...receipt, attachmentId: "attachment*01" },
    { ...receipt, ownerUserId: actorId }, { ...receipt, notes: base.notes }, { ...receipt, revision: 2147483647 }, { ...receipt, status: "PAID" },
    { ...receipt, action: "ATTACH_FILE" }, { ...receipt, action: "REMOVE_ATTACHMENT" },
    { ...receipt, action: "ARCHIVE", archived: false }, { ...receipt, action: "RESTORE", archived: true },
    { ...receipt, action: "CREATE", revision: 2, status: "DRAFT" }, { ...receipt, action: "CREATE", revision: 1, status: "PLANNED" },
    { ...receipt, action: "CREATE", revision: 1, status: "DRAFT", archived: true }]) invalid(c.ExternalCollaborationReceiptSchema, value);
  invalid(c.ExternalCollaborationResultSchema, { ...receipt, replayed: "true" }); invalid(c.ExternalCollaborationResultSchema, receipt);
  for (const command of commands().slice(1)) invalid(c.ExternalCollaborationReceiptSchema, { ...receipt, action: command.action, revision: 1,
    archived: command.action === "ARCHIVE", attachmentId: ["ATTACH_FILE", "REMOVE_ATTACHMENT"].includes(command.action) ? "attachment*original" : null });
  for (const value of [{ ...header(), checklist: { total: 1, done: 2 } }, { ...header(), checklist: { total: 31, done: 0 } },
    { ...header(), attachmentCount: 21 }, { ...header(), declaredValue: { amountMinor: "1", currencyCode: "XXX" } },
    { ...header(), updatedAt: "2026-10-11T23:59:59.999Z" }, { ...header(), createdAt: "2026-10-12T00:00:00.001Z" },
    { ...header(), earnedMinor: "100" }, { ...header(), ownerUserId: actorId }]) invalid(c.ExternalCollaborationHeaderSchema, value);
  const wrongLists = [{ ...list(), collaborations: [...list().collaborations].reverse() }, { ...list(), collaborations: [header("same*id"), header("same*id")] },
    { ...list(), nextCursor: "external*01" }, { ...list(), collaborations: [], nextCursor: "external*02" },
    { ...list(), asOf: "2026-10-11T23:59:59.999Z" }, { ...list(), collaborations: [{ ...header("external*02"), updatedAt: "2026-10-12T00:00:00.001Z" }] },
    { ...list(), collaborations: Array.from({ length: 31 }, (_, index) => header("external*" + String(index).padStart(2, "0"))) },
    { ...list(), scope: "CLIENT" }, { ...list(), verifiedEarnings: "100" }];
  for (const value of wrongLists) invalid(c.ExternalCollaborationListSchema, value);
  for (const value of [{ ...attachment(), storageKey: "private/object" }, { ...attachment(), checksum }, { ...attachment(), providerUrl: "https://example.invalid/private" },
    { ...attachment(), size: 0 }, { ...attachment(), assetRevision: 0 }, { ...attachment(), label: original("x".repeat(201)) }]) invalid(c.ExternalCollaborationAttachmentSchema, value);
  for (const value of [{ ...detail(), scope: "PUBLIC" }, { ...detail(), asOf: "2026-10-11T23:59:59.999Z" },
    { ...detail(), attachments: [attachment("b", "asset*b"), attachment("a", "asset*a")] },
    { ...detail(), attachments: [attachment("same", "asset*a"), attachment("same", "asset*b")] },
    { ...detail(), attachments: [attachment("a", "same*asset"), attachment("b", "same*asset")] },
    { ...detail(), attachments: [{ ...attachment(), attachedAt: "2026-10-12T00:00:00.001Z" }] },
    { ...detail(), attachments: Array.from({ length: 21 }, (_, index) => attachment("attachment*" + String(index).padStart(2, "0"), "asset*" + String(index).padStart(2, "0"))) },
    { ...detail(), collaboration: { ...detail().collaboration, ownerContact: "not-exposed" } }]) invalid(c.ExternalCollaborationDetailSchema, value);

  let executed = 0;
  const getter = clone(details()); Object.defineProperty(getter, "brief", { enumerable: true, get() { executed++; return original("must-not-run"); } });
  const toJSON = { ...details(), toJSON() { executed++; return details(); } };
  const inherited = Object.assign(Object.create({ toJSON() { executed++; return details(); } }), details());
  const pollution = { ...details(), ...JSON.parse('{"__proto__":{"nativeOwner":true}}') };
  const sparse = clone(details()); delete sparse.checklist[0];
  const extraArray = clone(details()); Object.defineProperty(extraArray.checklist, "authority", { enumerable: true, value: "CREATOR" });
  const hidden = clone(details()); Object.defineProperty(hidden, "secretOwner", { value: actorId, enumerable: false });
  const symbol = clone(details()); Object.defineProperty(symbol, Symbol("authority"), { value: true, enumerable: true });
  class UnsafeArray extends Array<unknown> { toJSON() { executed++; return []; } }
  const subclass = { ...details(), checklist: new UnsafeArray(...details().checklist) };
  for (const unsafe of [getter, toJSON, inherited, pollution, sparse, extraArray, hidden, symbol, subclass,
    { ...details(), brief: { text: "Original", language: undefined } }, { ...details(), declaredValue: { amountMinor: BigInt(1), currencyCode: "SAR" } }]) {
    invalid(c.ExternalCollaborationDetailsSchema, unsafe);
    expect(validationError(() => c.externalCollaborationCommandHash(actorId, { ...create, payload: { details: unsafe } }))).toEqual(rejectedHash);
  }
  expect(executed).toBe(0);
  // Exact body/key capture is structural: a later session/owner permission, bytes
  // inspection and status CAS are independent native-service prerequisites.
});
