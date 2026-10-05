import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CollectionScopeSchema, CollectionCommandSchema, CollectionNameOriginalSchema, CollectionNoteOriginalSchema,
  CollectionReadContextSchema, CollectionCommandResultSchema, CollectionComparisonQuerySchema, CollectionComparisonSchema,
  CollectionEntrySchema, CollectionHeadersQuerySchema, CollectionEntriesQuerySchema,
} from "@/lib/collections/contracts";

// IGNORED DRAFT: eventual tests/collections/contracts.test.ts. Pure contract
// witnesses only; root alone executes. No DB/native authorization or live
// publication claim follows from syntactically accepted fixture data.
const id = () => randomUUID();
const brandId = id(), clientId = id(), collectionId = id(), entryId = id();
const own = { kind: "OWN_BRAND", brandId };
const client = { kind: "CLIENT", clientId };
const authority = { organizationId: id(), clientId, brandId, membershipId: id(), grantId: id(), capability: "plan",
  organizationRevision: 1, membershipRevision: 2, clientRevision: 3, grantRevision: 4 };
const name = { text: "قائمة أصلية Original list", language: "ar" };
const note = { text: " \tملاحظة أصلية\nOriginal note\r ", language: "ar" };
const create = { operationKey: id(), scope: own, action: "CREATE", expectedParentRevision: 0, payload: { nameOriginal: name } };
const at = "2026-10-05T09:00:00.000Z";
const header = { id: collectionId, nameOriginal: name, revision: 1, archived: false, createdAt: at, updatedAt: at };
const card = { id: id(), handle: "synthetic_public", displayName: "اسم أصلي Original alias", bio: "Original public biography",
  residenceCountryCode: "KW", languages: ["ar", "en"], nicheSlugs: ["tech"],
  accounts: [{ platform: "INSTAGRAM", handle: "synthetic_account", ownership: "VERIFIED", followersObservation: null }] };
const unsupported = [...Array.from({ length: 32 }, (_, code) => code).filter(code => ![9, 10, 13].includes(code)), 127];

describe("creator collection strict pure contracts", () => {
  it("keeps OWN_BRAND and CLIENT scope explicit and client plan authority bound to the requested client", () => {
    expect(CollectionScopeSchema.parse(own)).toEqual(own); expect(CollectionScopeSchema.parse(client)).toEqual(client);
    for (const scope of [{ ...own, clientId }, { ...client, brandId }, { kind: "CLIENT", brandId }, { kind: "OWN_BRAND", clientId }, { ...client, organizationId: authority.organizationId }]) expect(CollectionScopeSchema.safeParse(scope).success).toBe(false);
    expect(CollectionCommandSchema.safeParse({ ...create, scope: client, expectedAuthority: authority }).success).toBe(true);
    expect(CollectionCommandSchema.safeParse({ ...create, scope: client }).success).toBe(false);
    expect(CollectionCommandSchema.safeParse({ ...create, expectedAuthority: authority }).success).toBe(false);
    expect(CollectionCommandSchema.safeParse({ ...create, scope: client, expectedAuthority: { ...authority, clientId: id() } }).success).toBe(false);
    expect(CollectionCommandSchema.safeParse({ ...create, scope: client, expectedAuthority: { ...authority, capability: "view" } }).success).toBe(false);
  });

  it("requires separately bound view authority for private read DTO context instead of plan or owner inference", () => {
    const view = { ...authority, capability: "view" };
    expect(CollectionReadContextSchema.parse({ scope: own, currentAuthority: null })).toEqual({ scope: own, currentAuthority: null });
    expect(CollectionReadContextSchema.safeParse({ scope: client, currentAuthority: view }).success).toBe(true);
    for (const context of [{ scope: client, currentAuthority: authority }, { scope: client, currentAuthority: null },
      { scope: own, currentAuthority: view }, { scope: client, currentAuthority: { ...view, clientId: id() } },
      { scope: client, currentAuthority: { ...view, owner: true } }]) expect(CollectionReadContextSchema.safeParse(context).success).toBe(false);
  });

  it("reserves revision0 for CREATE and requires exact supported positive existing-parent revisions", () => {
    expect(CollectionCommandSchema.safeParse(create).success).toBe(true);
    expect(CollectionCommandSchema.safeParse({ ...create, expectedParentRevision: 1 }).success).toBe(false);
    expect(CollectionCommandSchema.safeParse({ ...create, collectionId }).success).toBe(false);
    const existing = { operationKey: id(), scope: own, action: "EDIT_NOTE", collectionId, expectedParentRevision: 1, payload: { entryId, noteOriginal: note } };
    expect(CollectionCommandSchema.safeParse(existing).success).toBe(true);
    expect(CollectionCommandSchema.safeParse({ ...existing, expectedParentRevision: 2147483646 }).success).toBe(true);
    for (const revision of [0, -1, 1.5, 2147483647]) expect(CollectionCommandSchema.safeParse({ ...existing, expectedParentRevision: revision }).success).toBe(false);
    expect(CollectionCommandSchema.safeParse({ ...existing, payload: { ...existing.payload, parentRevision: 1 } }).success).toBe(false);
    expect(CollectionCommandSchema.safeParse({ ...existing, operationKey: "not-a-uuid" }).success).toBe(false);
  });

  it("preserves original note whitespace/null while keeping declared name/language and text bounds", () => {
    expect(CollectionNoteOriginalSchema.parse(note)).toEqual(note);
    expect(CollectionNoteOriginalSchema.safeParse({ text: null, language: null }).success).toBe(true);
    expect(CollectionNameOriginalSchema.parse({ text: "  قائمة أصلية\nOriginal list  ", language: "ar" }).text).toBe("قائمة أصلية\nOriginal list");
    expect(CollectionNameOriginalSchema.safeParse({ text: " \t\n\r ", language: "ar" }).success).toBe(false);
    expect(CollectionNameOriginalSchema.safeParse({ text: "ن".repeat(200), language: null }).success).toBe(true);
    expect(CollectionNameOriginalSchema.safeParse({ text: "ن".repeat(201), language: "ar" }).success).toBe(false);
    expect(CollectionNoteOriginalSchema.safeParse({ text: "ن".repeat(2000), language: "en" }).success).toBe(true);
    expect(CollectionNoteOriginalSchema.safeParse({ text: "ن".repeat(2001), language: "en" }).success).toBe(false);
    expect(CollectionNoteOriginalSchema.safeParse({ ...note, translatedText: "Unrequested duplicate content" }).success).toBe(false);
  });

  it("rejects NUL, unsupported C0 and DEL inside collection names", () => {
    for (const code of unsupported) expect(CollectionNameOriginalSchema.safeParse({ text: `Before${String.fromCharCode(code)}After`, language: "en" }).success, `Unsupported name control U+${code.toString(16).padStart(4, "0")}`).toBe(false);
    expect(CollectionNameOriginalSchema.safeParse({ text: "Before\tMiddle\nAfter\rEnd", language: "en" }).success).toBe(true);
  });

  it("rejects NUL, unsupported C0 and DEL in notes without stripping allowed tab/LF/CR", () => {
    for (const code of unsupported) expect(CollectionNoteOriginalSchema.safeParse({ text: `Before${String.fromCharCode(code)}After`, language: "en" }).success, `Unsupported note control U+${code.toString(16).padStart(4, "0")}`).toBe(false);
    const allowed = { text: " \tBefore\nAfter\r ", language: "en" };
    expect(CollectionNoteOriginalSchema.parse(allowed)).toEqual(allowed);
  });

  it("bounds comparison12 with unique selected saved entry IDs and keeps header/entry query shapes strict", () => {
    const entryIds = Array.from({ length: 12 }, id), query = { scope: own, collectionId, entryIds };
    expect(CollectionComparisonQuerySchema.parse(query)).toEqual(query);
    expect(CollectionComparisonQuerySchema.safeParse({ ...query, entryIds: [...entryIds, id()] }).success).toBe(false);
    expect(CollectionComparisonQuerySchema.safeParse({ ...query, entryIds: [entryIds[0], entryIds[0]] }).success).toBe(false);
    expect(CollectionComparisonQuerySchema.safeParse({ ...query, creatorIds: [card.id] }).success).toBe(false);
    expect(CollectionHeadersQuerySchema.safeParse({ scope: own, limit: 20 }).success).toBe(true);
    expect(CollectionHeadersQuerySchema.safeParse({ scope: own, limit: 21 }).success).toBe(false);
    expect(CollectionEntriesQuerySchema.safeParse({ scope: client, collectionId, limit: 12 }).success).toBe(true);
    expect(CollectionEntriesQuerySchema.safeParse({ scope: client, collectionId, limit: 13 }).success).toBe(false);
  });

  it("keeps mutation receipts minimal and saved entries limited to original notes plus current existing public cards", () => {
    const result = { collectionId, entryId: null, revision: 1, archived: false, action: "CREATE", replayed: false };
    expect(CollectionCommandResultSchema.parse(result)).toEqual(result);
    for (const extra of [{ noteOriginal: note }, { nameOriginal: name }, { creator: card }, { expectedAuthority: authority }, { contact: "private" }, { payloadHash: "a".repeat(64) }]) expect(CollectionCommandResultSchema.safeParse({ ...result, ...extra }).success).toBe(false);
    const entry = { entryId, noteOriginal: note, createdAt: at, updatedAt: at, creator: card };
    expect(CollectionEntrySchema.parse(entry)).toEqual(entry);
    expect(CollectionEntrySchema.safeParse({ ...entry, creator: null }).success).toBe(true);
    for (const extra of [{ creatorReferenceId: card.id }, { creatorId: card.id }, { askingPrice: "private" }, { score: 90 }, { assetId: "private" }]) expect(CollectionEntrySchema.safeParse({ ...entry, ...extra }).success).toBe(false);
    expect(CollectionEntrySchema.safeParse({ ...entry, creator: { ...card, userId: "private-owner" } }).success).toBe(false);
    expect(CollectionEntrySchema.safeParse({ ...entry, creator: { ...card, accounts: [{ ...card.accounts[0], providerAccountId: "private" }] } }).success).toBe(false);
    expect(CollectionComparisonSchema.safeParse({ context: { scope: own, currentAuthority: null }, asOf: at, collection: header, entries: [entry] }).success).toBe(true);
  });
});
