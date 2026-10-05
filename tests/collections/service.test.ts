import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { withCollectionScope } from "@/lib/collections/scope";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { applyCollectionCommand } from "@/lib/collections/service";
import { getCollectionHeaders, getCollectionEntries, compareCollectionEntries } from "@/lib/collections/loaders";
import { CollectionCommandSchema, CollectionCommandResultSchema, CollectionHeadersPageSchema, CollectionEntriesPageSchema,
  CollectionComparisonSchema, type CollectionScope } from "@/lib/collections/contracts";
import { cleanupReviewedEvidence, reviewedOwnershipFixture } from "../helpers/reviewed-evidence";

// Root alone executes this native suite on the guarded disposable test target.
// Native sessions/scopes/commands/PG waits are real over guarded synthetic data.
// Explicit public/non-test fixture flags and local proof bytes are not live
// creator/team/provider/legal acceptance. No mocked identity producer or Date.
const users = new Set<string>(), creators = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID(), privateNote = " \tملاحظة أصلية\nOriginal private note\r ";
afterEach(async () => {
  const parents = await prisma.creatorCollection.findMany({ where: { brand: { userId: { in: [...users] } } }, select: { id: true } });
  const ids = parents.map(parent => parent.id);
  await prisma.creatorCollectionCommand.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.creatorCollectionEntry.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.creatorCollection.deleteMany({ where: { id: { in: ids } } });
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await cleanupReviewedEvidence(prisma, [...users], "test");
  await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.organizationCommand.deleteMany({ where: { OR: [{ actorUserId: { in: [...users] } }, { organizationId: { in: [...organizations] } }] } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); creators.clear(); organizations.clear();
});
async function person(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = key(), at = new Date(Date.now() - 120000); users.add(id);
  const user = await prisma.user.create({ data: { id, role, name: "Synthetic collection service actor", email: `${id}@example.invalid`, passwordHash: "not-a-login",
    active: true, isTest: role !== "CREATOR", emailVerifiedAt: at, createdAt: at } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), current = await resolveSession(token);
  if (!current) throw new Error("Synthetic native collection session did not resolve");
  const actor: OrganizationActor = { userId: current.userId, role: current.role, sessionId: current.sessionId, sessionVersion: current.sessionVersion };
  return { user, actor, at };
}
async function own() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id, slug: "col-" + key().replace(/-/g, "").slice(0, 16), name: "شركة أصلية Synthetic company", isTest: true } });
  const scope: CollectionScope = { kind: "OWN_BRAND", brandId: brand.id };
  return { ...owner, brand, scope };
}
async function publicCreator() {
  const owner = await person("CREATOR"), reviewer = await person("ADMIN"), at = owner.at;
  const creator = await prisma.creator.create({ data: { userId: owner.user.id, handle: "saved_" + key().replace(/-/g, "").slice(0, 16), displayName: "اسم أصلي Public alias",
    countryCode: "KW", languages: ["ar", "en"], nicheIds: ["tech"], isTest: false, publicConsentAt: at } }); creators.add(creator.id);
  const account = await prisma.socialAccount.create({ data: { creatorId: creator.id, platform: "INSTAGRAM", handle: "proof_" + key().replace(/-/g, "").slice(0, 16),
    intendedConfirmedAt: at, consentAt: at, providerAccountId: "synthetic-private-provider-" + key() } });
  const proof = await reviewedOwnershipFixture(prisma, owner.user.id, reviewer.user.id, account.id, "test", at);
  await prisma.socialAccount.update({ where: { id: account.id }, data: { publicVisible: true } });
  await prisma.portfolioVersion.create({ data: { creatorId: creator.id, version: 1, inputRevision: 1, approvedAt: at,
    content: { title: "Original approved title", bio: "سيرة أصلية\nOriginal public biography", sections: [], method: "APPROVED_FACT_TEMPLATE" } } });
  await prisma.creator.update({ where: { id: creator.id }, data: { primaryAccountId: account.id, state: "PUBLISHED", publicConsentAt: at } });
  return { owner, reviewer, creator, account, proof };
}
type Own = Awaited<ReturnType<typeof own>>;
const allCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true, signCustomer: true, financial: true, manageGrants: true };
async function agency(customer: Own, rights = { view: true, plan: true }, seatInput?: Awaited<ReturnType<typeof person>>) {
  const owner = await person(), seat = seatInput ?? await person();
  const organization = await prisma.organization.create({ data: { name: "Synthetic native agency", kind: "AGENCY", ownerUserId: owner.user.id } }); organizations.add(organization.id);
  const membership = await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: seat.user.id, state: "ACTIVE" } });
  const client = await prisma.organizationClient.create({ data: { organizationId: organization.id, brandId: customer.brand.id, state: "ACTIVE",
    authorizingUserId: customer.user.id, authorizingSessionVersion: customer.user.sessionVersion, allowedCapabilities: allCapabilities } });
  const grant = await prisma.clientGrant.create({ data: { organizationId: organization.id, membershipId: membership.id, clientId: client.id,
    active: true, ...allCapabilities, ...rights } });
  const scope: CollectionScope = { kind: "CLIENT", clientId: client.id };
  // These are explicitly synthetic current native authority rows. No historical
  // invitation or consent is claimed; the real loader verifies all bindings.
  return { ...seat, owner, organization, membership, client, grant, scope, customer };
}
type Agency = Awaited<ReturnType<typeof agency>>;
async function createClient(f: Agency, text: string) {
  const expectedAuthority = await getClientAuthority(f.actor, f.client.id, "plan");
  const command = { operationKey: key(), scope: f.scope, expectedAuthority, action: "CREATE", expectedParentRevision: 0, payload: { nameOriginal: { text, language: "en" } } };
  const result = await applyCollectionCommand(f.actor, command); expect(CollectionCommandResultSchema.safeParse(result).success).toBe(true);
  return { command, result };
}
async function create(f: Own, name = { text: "قائمة أصلية Original list", language: "ar" }) {
  const command = { operationKey: key(), scope: f.scope, action: "CREATE", expectedParentRevision: 0, payload: { nameOriginal: name } };
  const result = await applyCollectionCommand(f.actor, command); expect(CollectionCommandResultSchema.safeParse(result).success).toBe(true);
  return { command, result };
}
async function effects(f: Own) {
  return { parents: await prisma.creatorCollection.findMany({ where: { brandId: f.brand.id }, orderBy: { id: "asc" } }),
    receipts: await prisma.creatorCollectionCommand.findMany({ where: { actorUserId: f.user.id }, orderBy: { id: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { actorUserId: f.user.id }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: f.user.id } }, orderBy: { id: "asc" } }) };
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
type HeldTable = "User" | "ClientGrant" | "Creator" | "AdminAudit";
async function waitBlockedBy(monitor: PrismaClient, blocker: number, table: HeldTable, signal: AbortSignal) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new Error("Synthetic collection native wait witness cancelled");
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND ${blocker}=ANY(pg_blocking_pids(pid))
        AND query LIKE ${`%"${table}"%`} ORDER BY pid`;
    if (rows.length) return rows[0]!.pid;
    await delay(20);
  }
  throw new Error("Synthetic collection did not reach its actual native lock wait");
}
async function hold(table: HeldTable, id?: string, follow?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    if (table === "AdminAudit") await tx.$executeRaw`LOCK TABLE "AdminAudit" IN ACCESS EXCLUSIVE MODE`;
    else {
      if (!id) throw new Error("Synthetic collection native holder needs a task-local ID");
      // The identifier comes only from this closed union, never command input.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id=${id} FOR UPDATE`);
    }
    ready.resolve(rows[0]!.pid); await release.promise; if (follow) return follow(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let waiting: Promise<number> | undefined;
  try {
    const pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Synthetic collection writer ended before publishing its native lock"); })]);
    return { holding, release: () => release.resolve(), wait() { waiting = waitBlockedBy(monitor, pid, table, stop.signal); return waiting; },
      async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
  } catch (error) { release.resolve(); stop.abort(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
}
function lockObserver() {
  const locks: Array<{ table: string; values: unknown[] }> = [];
  const client = prisma.$extends({ query: { async $queryRaw({ args, query }) {
    if (/\bFOR\s+(?:SHARE|UPDATE)\b/i.test(args.sql)) {
      const table = /FROM\s+"([A-Za-z]+)"/i.exec(args.sql)?.[1] ?? "unknown";
      locks.push({ table, values: args.values.flat(Infinity) });
    }
    return query(args);
  } } }) as unknown as PrismaClient;
  return { client, locks };
}

describe("scoped creator collection service: actual native synthetic M02C4", () => {
  it("runs OWN_BRAND create/rename/archive/restore/add/edit/remove with original text and exact parent history", async () => {
    const f = await own(), publicIdentity = await publicCreator(), made = await create(f);
    const id = made.result.collectionId;
    expect(made.result).toMatchObject({ revision: 1, action: "CREATE", archived: false, replayed: false, entryId: null });
    const headers = await getCollectionHeaders(f.actor, { scope: f.scope }); expect(CollectionHeadersPageSchema.safeParse(headers).success).toBe(true);
    expect(headers.collections).toHaveLength(1); expect(headers.context).toEqual({ scope: f.scope, currentAuthority: null });
    const renamed = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "RENAME", collectionId: id, expectedParentRevision: 1, payload: { nameOriginal: { text: "اسم جديد Original renamed", language: "ar" } } }); expect(renamed.revision).toBe(2);
    const archived = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "SET_ARCHIVED", collectionId: id, expectedParentRevision: 2, payload: { archived: true } }); expect(archived).toMatchObject({ revision: 3, archived: true });
    expect((await getCollectionHeaders(f.actor, { scope: f.scope })).collections).toEqual([]);
    expect((await getCollectionHeaders(f.actor, { scope: f.scope, archived: true })).collections[0]).toMatchObject({ id, archived: true });
    await expect(applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "RENAME", collectionId: id, expectedParentRevision: 3, payload: { nameOriginal: { text: "Blocked archived edit", language: "en" } } })).rejects.toMatchObject({ status: 409 });
    const restored = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "SET_ARCHIVED", collectionId: id, expectedParentRevision: 3, payload: { archived: false } }); expect(restored).toMatchObject({ revision: 4, archived: false });
    const added = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "ADD_ENTRY", collectionId: id, expectedParentRevision: 4, payload: { creatorId: publicIdentity.creator.id, noteOriginal: { text: privateNote, language: "ar" } } }); expect(added).toMatchObject({ revision: 5, action: "ADD_ENTRY" }); expect(added.entryId).not.toBeNull();
    const editedNote = " \tنص معدل محفوظ\nEdited original\r ";
    const edited = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "EDIT_NOTE", collectionId: id, expectedParentRevision: 5, payload: { entryId: added.entryId, noteOriginal: { text: editedNote, language: "ar" } } }); expect(edited.revision).toBe(6);
    const entries = await getCollectionEntries(f.actor, { scope: f.scope, collectionId: id }); expect(CollectionEntriesPageSchema.safeParse(entries).success).toBe(true);
    expect(entries.entries[0]).toMatchObject({ entryId: added.entryId, noteOriginal: { text: editedNote, language: "ar" }, creator: { id: publicIdentity.creator.id } });
    const removed = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "REMOVE_ENTRY", collectionId: id, expectedParentRevision: 6, payload: { entryId: added.entryId } }); expect(removed.revision).toBe(7);
    expect((await getCollectionEntries(f.actor, { scope: f.scope, collectionId: id })).entries).toEqual([]);
    const raw = await prisma.creatorCollectionEntry.findUniqueOrThrow({ where: { id: added.entryId! } }); expect(raw.removedAt).not.toBeNull(); expect(raw.note).toBe(editedNote);
    expect(await prisma.creatorCollectionCommand.count({ where: { collectionId: id } })).toBe(7);
    for (const footprint of [await prisma.creatorCollectionCommand.findMany({ where: { collectionId: id } }),
      await prisma.adminAudit.findMany({ where: { actorUserId: f.user.id } }), await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: f.user.id } } })]) {
      const serialized = JSON.stringify(footprint); expect(serialized).not.toContain(privateNote); expect(serialized).not.toContain(editedNote); expect(serialized).not.toContain("اسم جديد Original renamed"); expect(serialized).not.toContain(publicIdentity.creator.displayName);
    }
  });

  it("replays exact lost replies without new effects and rejects conflicting key, stale/ABA and genuine concurrent revisions", async () => {
    const f = await own(), made = await create(f), id = made.result.collectionId, before = await effects(f);
    const replay = await applyCollectionCommand(f.actor, made.command); expect(replay).toEqual({ ...made.result, replayed: true }); expect(await effects(f)).toEqual(before);
    const receipt = await prisma.creatorCollectionCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.user.id, operationKey: made.command.operationKey } } });
    expect(receipt.payloadHash).toBe(canonicalHash({ purpose: "CREATOR_COLLECTION_COMMAND_V1", actorUserId: f.actor.userId, command: CollectionCommandSchema.parse(made.command) }));
    await expect(applyCollectionCommand(f.actor, { ...made.command, payload: { nameOriginal: { text: "Conflicting original", language: "en" } } })).rejects.toMatchObject({ status: 409 });
    const rename = (text: string) => ({ operationKey: key(), scope: f.scope, action: "RENAME", collectionId: id, expectedParentRevision: 1, payload: { nameOriginal: { text, language: "en" } } });
    const results = await Promise.allSettled([applyCollectionCommand(f.actor, rename("First actual writer")), applyCollectionCommand(f.actor, rename("Second actual writer"))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!; expect(rejected.reason).toMatchObject({ status: 409 });
    await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "SET_ARCHIVED", collectionId: id, expectedParentRevision: 2, payload: { archived: true } });
    await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "SET_ARCHIVED", collectionId: id, expectedParentRevision: 3, payload: { archived: false } });
    await expect(applyCollectionCommand(f.actor, rename("Stale before identical archive state"))).rejects.toMatchObject({ status: 409 });
    expect((await applyCollectionCommand(f.actor, made.command))).toEqual({ ...made.result, replayed: true });
    expect((await prisma.creatorCollection.findUniqueOrThrow({ where: { id } })).revision).toBe(4);
    expect(await prisma.creatorCollectionCommand.count({ where: { collectionId: id } })).toBe(4);
  });

  it("retains own notes with null cards after real withdrawal/Creator deletion and edits tombstones without projection or revival", async () => {
    const f = await own(), identity = await publicCreator(), made = await create(f), id = made.result.collectionId;
    const add = { operationKey: key(), scope: f.scope, action: "ADD_ENTRY", collectionId: id, expectedParentRevision: 1, payload: { creatorId: identity.creator.id, noteOriginal: { text: privateNote, language: "ar" } } };
    const added = await applyCollectionCommand(f.actor, add); expect(added.entryId).not.toBeNull();
    await prisma.creator.update({ where: { id: identity.creator.id }, data: { state: "HIDDEN" } });
    const hidden = await getCollectionEntries(f.actor, { scope: f.scope, collectionId: id }); expect(hidden.entries[0]).toMatchObject({ noteOriginal: { text: privateNote, language: "ar" }, creator: null });
    await prisma.creator.delete({ where: { id: identity.creator.id } });
    const tombstone = await prisma.creatorCollectionEntry.findUniqueOrThrow({ where: { id: added.entryId! } }); expect(tombstone.creatorId).toBeNull(); expect(tombstone.creatorReferenceId).toBe(identity.creator.id);
    expect((await prisma.creatorCollection.findUniqueOrThrow({ where: { id } })).revision).toBe(2);
    const queries: string[] = [];
    const client = prisma.$extends({ query: { async $allOperations({ model, args, query }) { if (model) queries.push(model); return query(args); } } }) as unknown as PrismaClient;
    const updated = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "EDIT_NOTE", collectionId: id, expectedParentRevision: 2, payload: { entryId: added.entryId, noteOriginal: { text: " \tملاحظة لاحقة\nAfter withdrawal ", language: "ar" } } }, { client }); expect(updated.revision).toBe(3);
    for (const model of ["Creator", "SocialAccount", "MetricsSnapshot", "PortfolioVersion"]) expect(queries).not.toContain(model);
    const current = await getCollectionEntries(f.actor, { scope: f.scope, collectionId: id }); expect(current.entries[0]!.creator).toBeNull(); expect(JSON.stringify(current)).not.toContain('"creatorReferenceId"');
    expect((await applyCollectionCommand(f.actor, add))).toMatchObject({ ...added, replayed: true });
    await expect(applyCollectionCommand(f.actor, { ...add, operationKey: key(), expectedParentRevision: 3 })).rejects.toMatchObject({ code: "CREATOR_UNAVAILABLE", status: 409 });
    expect((await prisma.creatorCollectionEntry.findUniqueOrThrow({ where: { id: added.entryId! } })).creatorId).toBeNull();
  });

  it("keeps OWN_BRAND and two actual agency CLIENT lists separate for the same Brand without fallback", async () => {
    const customer = await own(), seat = await person(), a = await agency(customer, { view: true, plan: true }, seat), b = await agency(customer, { view: true, plan: true }, seat);
    const ownList = await create(customer, { text: "Only company private list", language: "en" }), aList = await createClient(a, "Only agency A private list"), bList = await createClient(b, "Only agency B private list");
    const scopes = [{ actor: customer.actor, scope: customer.scope, made: ownList }, { actor: seat.actor, scope: a.scope, made: aList }, { actor: seat.actor, scope: b.scope, made: bList }];
    for (const [index, selected] of scopes.entries()) {
      const page = await getCollectionHeaders(selected.actor, { scope: selected.scope });
      expect(page.collections.map(row => row.id)).toEqual([selected.made.result.collectionId]);
      expect(page.context.scope).toEqual(selected.scope);
      if (selected.scope.kind === "CLIENT") expect(page.context.currentAuthority).toMatchObject({ clientId: selected.scope.clientId, capability: "view" });
      else expect(page.context.currentAuthority).toBeNull();
      for (const other of scopes.filter((_, otherIndex) => otherIndex !== index)) {
        await expect(getCollectionEntries(selected.actor, { scope: selected.scope, collectionId: other.made.result.collectionId })).rejects.toMatchObject({ status: 404 });
        await expect(compareCollectionEntries(selected.actor, { scope: selected.scope, collectionId: other.made.result.collectionId, entryIds: [] })).rejects.toMatchObject({ status: 404 });
      }
    }
    await expect(getCollectionHeaders(customer.actor, { scope: a.scope })).rejects.toMatchObject({ status: 404 });
  });

  it("enforces native view-only and plan-only rights independently, including metadata-only exact replay", async () => {
    const customer = await own(), viewer = await agency(customer, { view: true, plan: false }), planner = await agency(customer, { view: false, plan: true });
    const parent = await prisma.creatorCollection.create({ data: { scope: "CLIENT", brandId: customer.brand.id, organizationId: viewer.organization.id,
      clientId: viewer.client.id, name: "Synthetic private viewer list", nameLanguage: "en" } });
    const entry = await prisma.creatorCollectionEntry.create({ data: { collectionId: parent.id, creatorReferenceId: key(), note: privateNote, noteLanguage: "ar" } });
    const viewAuthority = await getClientAuthority(viewer.actor, viewer.client.id, "view");
    expect((await getCollectionEntries(viewer.actor, { scope: viewer.scope, collectionId: parent.id })).entries).toEqual([expect.objectContaining({ entryId: entry.id, creator: null, noteOriginal: { text: privateNote, language: "ar" } })]);
    // A syntactically plan-shaped version of genuine view metadata conveys no
    // authority: current native grant and delegation must independently allow it.
    await expect(applyCollectionCommand(viewer.actor, { operationKey: key(), scope: viewer.scope, expectedAuthority: { ...viewAuthority, capability: "plan" }, action: "RENAME",
      collectionId: parent.id, expectedParentRevision: 1, payload: { nameOriginal: { text: "Unauthorized private rename", language: "en" } } })).rejects.toMatchObject({ status: 404 });
    const made = await createClient(planner, "Plan-only original private name");
    expect(Object.keys(made.result).sort()).toEqual(["action", "archived", "collectionId", "entryId", "replayed", "revision"].sort());
    const replay = await applyCollectionCommand(planner.actor, made.command); expect(replay).toEqual({ ...made.result, replayed: true });
    expect(JSON.stringify(replay)).not.toContain("Plan-only original private name"); expect(JSON.stringify(replay)).not.toContain("currentAuthority");
    await expect(getCollectionHeaders(planner.actor, { scope: planner.scope })).rejects.toMatchObject({ status: 404 });
    await expect(getCollectionEntries(planner.actor, { scope: planner.scope, collectionId: made.result.collectionId })).rejects.toMatchObject({ status: 404 });
    await expect(compareCollectionEntries(planner.actor, { scope: planner.scope, collectionId: made.result.collectionId, entryIds: [] })).rejects.toMatchObject({ status: 404 });
  });

  it("requires current CLIENT authority before historical replay while only exact replay bypasses older revisions", async () => {
    const customer = await own(), client = await agency(customer), made = await createClient(client, "Native replay private original");
    await prisma.clientGrant.update({ where: { id: client.grant.id }, data: { revision: { increment: 1 } } });
    expect(await applyCollectionCommand(client.actor, made.command)).toEqual({ ...made.result, replayed: true });
    await expect(applyCollectionCommand(client.actor, { ...made.command, operationKey: key(), action: "RENAME", collectionId: made.result.collectionId,
      expectedParentRevision: 1, payload: { nameOriginal: { text: "New write with old authority", language: "en" } } })).rejects.toMatchObject({ status: 409 });
    await prisma.clientGrant.update({ where: { id: client.grant.id }, data: { active: false, revision: { increment: 1 } } });
    await expect(applyCollectionCommand(client.actor, made.command)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.creatorCollectionCommand.count({ where: { collectionId: made.result.collectionId } })).toBe(1);
    await prisma.authSession.update({ where: { id: client.actor.sessionId }, data: { revokedAt: new Date() } });
    await expect(applyCollectionCommand(client.actor, { malformed: "Private input is never parsed before current authentication" })).rejects.toMatchObject({ status: 401 });
    await expect(getCollectionHeaders(client.actor, { scope: client.scope })).rejects.toMatchObject({ status: 401 });
    const oldOwner = await own(), ownMade = await create(oldOwner), replacement = await person();
    await prisma.brand.update({ where: { id: oldOwner.brand.id }, data: { userId: replacement.user.id } });
    await expect(applyCollectionCommand(oldOwner.actor, ownMade.command)).rejects.toMatchObject({ status: 404 });
    await expect(getCollectionHeaders(oldOwner.actor, { scope: oldOwner.scope })).rejects.toMatchObject({ status: 404 });
    expect((await getCollectionHeaders(replacement.actor, { scope: oldOwner.scope })).collections.map(row => row.id)).toEqual([ownMade.result.collectionId]);
  });

  it("uses bounded exclusive header/entry cursors and exact caller-order comparison without padding or another list's entry", async () => {
    const f = await own(), prefix = key(), headerIds = Array.from({ length: 21 }, (_, i) => `header-${prefix}-${String(i).padStart(3, "0")}`);
    await prisma.creatorCollection.createMany({ data: headerIds.map((id, i) => ({ id, scope: "OWN_BRAND" as const, brandId: f.brand.id, name: `Synthetic bounded original ${i}`, nameLanguage: "en" })) });
    await prisma.creatorCollection.create({ data: { scope: "OWN_BRAND", brandId: f.brand.id, name: "Archived original outside active header scan", nameLanguage: "en", archived: true } });
    const observed: Array<{ model: string; take: number | undefined }> = [];
    const client = prisma.$extends({ query: { async $allOperations({ model, operation, args, query }) {
      if (operation === "findMany" && (model === "CreatorCollection" || model === "CreatorCollectionEntry")) observed.push({ model, take: (args as { take?: number }).take });
      return query(args);
    } } }) as unknown as PrismaClient;
    const first = await getCollectionHeaders(f.actor, { scope: f.scope }, { client });
    expect(first.collections.map(row => row.id)).toEqual(headerIds.slice(0, 20)); expect(first.nextCursor).toBe(headerIds[19]);
    const last = await getCollectionHeaders(f.actor, { scope: f.scope, after: first.nextCursor }, { client });
    expect(last.collections.map(row => row.id)).toEqual(headerIds.slice(20)); expect(last.nextCursor).toBeNull();
    expect((await getCollectionHeaders(f.actor, { scope: f.scope, after: headerIds[20] })).collections).toEqual([]);
    // Nullable INSERTs below are storage-only retained-history fixtures, not
    // genuine DELETE evidence. The earlier/later deletion witnesses use live FKs.
    const ids = Array.from({ length: 13 }, (_, i) => `entry-${prefix}-${String(i).padStart(3, "0")}`);
    await prisma.creatorCollectionEntry.createMany({ data: ids.map((id, i) => ({ id, collectionId: headerIds[0]!, creatorReferenceId: key(), note: ` \tOriginal unavailable ${i}\n `, noteLanguage: "en" })) });
    await prisma.creatorCollectionEntry.create({ data: { collectionId: headerIds[0]!, creatorReferenceId: key(), note: "Removed entry cannot crowd active page", removedAt: new Date() } });
    const foreign = await prisma.creatorCollectionEntry.create({ data: { collectionId: headerIds[1]!, creatorReferenceId: key(), note: "Other list private canary" } });
    const entries = await getCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0] }, { client });
    expect(entries.entries.map(row => row.entryId)).toEqual(ids.slice(0, 12)); expect(entries.nextCursor).toBe(ids[11]); expect(entries.entries.every(row => row.creator === null)).toBe(true);
    const tail = await getCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0], after: entries.nextCursor }, { client });
    expect(tail.entries.map(row => row.entryId)).toEqual(ids.slice(12)); expect(tail.nextCursor).toBeNull();
    expect((await getCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0], after: ids[12] })).entries).toEqual([]);
    const selection = [ids[10]!, ids[2]!, ids[12]!], comparison = await compareCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0], entryIds: selection }, { client });
    expect(CollectionComparisonSchema.safeParse(comparison).success).toBe(true); expect(comparison.entries.map(row => row.entryId)).toEqual(selection);
    expect(comparison.entries.map(row => row.noteOriginal.text)).toEqual([10, 2, 12].map(i => ` \tOriginal unavailable ${i}\n `));
    expect((await compareCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0], entryIds: [] })).entries).toEqual([]);
    await expect(compareCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0], entryIds: [ids[0], ids[0]] })).rejects.toMatchObject({ status: 422 });
    await expect(compareCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0], entryIds: ids })).rejects.toMatchObject({ status: 422 });
    await expect(compareCollectionEntries(f.actor, { scope: f.scope, collectionId: headerIds[0], entryIds: [foreign.id] })).rejects.toMatchObject({ status: 404 });
    expect(observed.filter(query => query.model === "CreatorCollection").every(query => typeof query.take === "number" && query.take <= 21)).toBe(true);
    expect(observed.filter(query => query.model === "CreatorCollectionEntry").every(query => typeof query.take === "number" && query.take <= 13)).toBe(true);
    expect(JSON.stringify(comparison)).not.toContain("Other list private canary"); expect(JSON.stringify(comparison)).not.toContain('"creatorReferenceId"');
  });

  it("rejects active duplicates/capacity/revision exhaustion and explicitly restores only a live removed public entry", async () => {
    const f = await own(), identity = await publicCreator(), made = await create(f), id = made.result.collectionId;
    const add = { operationKey: key(), scope: f.scope, action: "ADD_ENTRY", collectionId: id, expectedParentRevision: 1,
      payload: { creatorId: identity.creator.id, noteOriginal: { text: privateNote, language: "ar" } } };
    const added = await applyCollectionCommand(f.actor, add);
    await expect(applyCollectionCommand(f.actor, { ...add, operationKey: key(), expectedParentRevision: 2 })).rejects.toMatchObject({ status: 409 });
    await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "REMOVE_ENTRY", collectionId: id, expectedParentRevision: 2, payload: { entryId: added.entryId } });
    const restored = await applyCollectionCommand(f.actor, { ...add, operationKey: key(), expectedParentRevision: 3, payload: { ...add.payload, noteOriginal: { text: "  Explicit original restoration  ", language: "en" } } });
    expect(restored).toMatchObject({ entryId: added.entryId, revision: 4 }); expect(await prisma.creatorCollectionEntry.count({ where: { collectionId: id } })).toBe(1);
    await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "REMOVE_ENTRY", collectionId: id, expectedParentRevision: 4, payload: { entryId: added.entryId } });
    await prisma.creator.update({ where: { id: identity.creator.id }, data: { state: "HIDDEN" } });
    await expect(applyCollectionCommand(f.actor, { ...add, operationKey: key(), expectedParentRevision: 5 })).rejects.toMatchObject({ code: "CREATOR_UNAVAILABLE", status: 409 });
    await prisma.creator.update({ where: { id: identity.creator.id }, data: { state: "PUBLISHED" } });
    const full = await prisma.creatorCollection.create({ data: { scope: "OWN_BRAND", brandId: f.brand.id, name: "Synthetic full retained list", nameLanguage: "en" } });
    // This bounded storage fixture populates retained references only. Null
    // cards remain active entries and count toward the actual domain capacity.
    await prisma.creatorCollectionEntry.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ collectionId: full.id, creatorReferenceId: `synthetic-tombstone-${full.id}-${i}`, note: null })) });
    await expect(applyCollectionCommand(f.actor, { ...add, operationKey: key(), collectionId: full.id })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.creatorCollectionEntry.count({ where: { collectionId: full.id, removedAt: null } })).toBe(1000);
    expect((await prisma.creatorCollection.findUniqueOrThrow({ where: { id: full.id } })).revision).toBe(1);
    expect(await prisma.creatorCollectionCommand.count({ where: { collectionId: full.id } })).toBe(0);
    const exhausted = await prisma.creatorCollection.create({ data: { scope: "OWN_BRAND", brandId: f.brand.id, name: "Exhausted revision fixture", revision: 2147483646 } });
    await expect(applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "RENAME", collectionId: exhausted.id,
      expectedParentRevision: 2147483646, payload: { nameOriginal: { text: "Cannot advance", language: "en" } } })).rejects.toMatchObject({ status: 409 });
    expect((await prisma.creatorCollection.findUniqueOrThrow({ where: { id: exhausted.id } })).revision).toBe(2147483646);
  });

  it("rejects revoked native CLIENT history after a real grant wait and rolls back a write after real session expiry during audit waiting", async () => {
    const customer = await own(), agencyClient = await agency(customer), made = await createClient(agencyClient, "Current native client original");
    const heldGrant = await hold("ClientGrant", agencyClient.grant.id, tx => tx.clientGrant.update({ where: { id: agencyClient.grant.id }, data: { active: false, revision: { increment: 1 } } }));
    const replay = applyCollectionCommand(agencyClient.actor, made.command); void replay.catch(() => {});
    try {
      await Promise.race([heldGrant.wait(), replay.then(() => { throw new Error("Synthetic replay completed before its actual current grant wait"); })]);
      heldGrant.release(); await heldGrant.holding;
      await expect(replay).rejects.toMatchObject({ status: 404 });
      expect(await prisma.creatorCollectionCommand.count({ where: { collectionId: made.result.collectionId } })).toBe(1);
    } finally { await heldGrant.close(); await replay.catch(() => {}); }

    const f = await own(), ownMade = await create(f), before = await effects(f), expiry = new Date(Date.now() + 2000);
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: expiry } });
    const heldAudit = await hold("AdminAudit");
    const writing = applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "RENAME", collectionId: ownMade.result.collectionId,
      expectedParentRevision: 1, payload: { nameOriginal: { text: "Must roll back after actual final expiry", language: "en" } } }); void writing.catch(() => {});
    try {
      await Promise.race([heldAudit.wait(), writing.then(() => { throw new Error("Synthetic write completed before actual native audit wait"); })]);
      await delay(Math.max(0, expiry.getTime() - Date.now() + 50)); heldAudit.release(); await heldAudit.holding;
      await expect(writing).rejects.toMatchObject({ status: 401 }); expect(await effects(f)).toEqual(before);
    } finally { await heldAudit.close(); await writing.catch(() => {}); }
  });

  it("projects before selected Entry locking so a real Creator DELETE can detach FK notes without the old native cycle", async () => {
    const f = await own(), identity = await publicCreator(), made = await create(f);
    const saved = await applyCollectionCommand(f.actor, { operationKey: key(), scope: f.scope, action: "ADD_ENTRY", collectionId: made.result.collectionId,
      expectedParentRevision: 1, payload: { creatorId: identity.creator.id, noteOriginal: { text: privateNote, language: "ar" } } });
    const observed = lockObserver(), held = await hold("Creator", identity.creator.id, tx => tx.creator.delete({ where: { id: identity.creator.id } }));
    const reading = getCollectionEntries(f.actor, { scope: f.scope, collectionId: made.result.collectionId }, { client: observed.client }); void reading.catch(() => {});
    try {
      await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic collection page completed before genuine Creator wait"); })]);
      expect(observed.locks.some(lock => lock.table === "CreatorCollectionEntry")).toBe(false);
      held.release(); await held.holding;
      const outcome = await reading.then(page => ({ page }), (error: unknown) => ({ error }));
      if ("page" in outcome) expect(outcome.page.entries).toEqual([expect.objectContaining({ entryId: saved.entryId, creator: null, noteOriginal: { text: privateNote, language: "ar" } })]);
      else expect(outcome.error).toMatchObject({ code: "RETRY_REQUIRED", status: 503 });
      const retry = await getCollectionEntries(f.actor, { scope: f.scope, collectionId: made.result.collectionId });
      expect(retry.entries).toEqual([expect.objectContaining({ entryId: saved.entryId, creator: null, noteOriginal: { text: privateNote, language: "ar" } })]);
      expect((await prisma.creatorCollection.findUniqueOrThrow({ where: { id: made.result.collectionId } })).revision).toBe(2);
      const tombstone = await prisma.creatorCollectionEntry.findUniqueOrThrow({ where: { id: saved.entryId! } });
      expect(tombstone).toMatchObject({ creatorId: null, creatorReferenceId: identity.creator.id, note: privateNote });
    } finally { await held.close(); await reading.catch(() => {}); }
  });

  it("keeps a single real receipt deadline across grouped scope owner waiting and stops before AuthSession/domain work", async () => {
    const f = await own(), extra = await person("CREATOR"), observed = lockObserver(), held = await hold("User", extra.user.id);
    const started = performance.now(), reader = createEvidenceReceiptReader({ maxElapsedMs: 300 }); let entered = 0;
    // The trusted outer callback is the actual native scope interface. A reader
    // from before the wait cannot be replaced or restarted by authority work.
    const reading = withCollectionScope(f.actor, f.scope, "view", { write: false, userIds: [extra.user.id], reader,
      execute: async () => { entered++; return "unreachable"; } }, { client: observed.client }); void reading.catch(() => {});
    try {
      await Promise.race([held.wait(), reading.then(() => { throw new Error("Synthetic scope finished before actual grouped owner waiting"); })]);
      await delay(Math.max(0, started + 350 - performance.now())); held.release(); await held.holding;
      await expect(reading).rejects.toMatchObject({ code: "RETRY_REQUIRED", status: 503 }); expect(entered).toBe(0);
      expect(observed.locks.some(lock => lock.table === "AuthSession")).toBe(false);
      expect(observed.locks.some(lock => lock.table === "Brand")).toBe(false);
    } finally { await held.close(); await reading.catch(() => {}); }
  });
});
