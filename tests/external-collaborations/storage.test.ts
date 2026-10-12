// P1 native storage only, at most three groups; root alone adopts/runs.
// Real owned User/PrivateAsset rows are structural fixtures, not native sessions,
// usable bytes, signatures, work/payment verification or permission grants.
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { ExternalCollaborationDetailsSchema, ExternalCollaborationReceiptSchema, externalCollaborationCommandHash,
  EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE } from "@/lib/external-collaborations/contracts";

type Table = "ExternalCollaboration" | "ExternalCollaborationCommand" | "ExternalCollaborationAttachment";
type Db = PrismaClient | Prisma.TransactionClient;
type Fields = Record<string, unknown>;
const users = new Set<string>(), assets = new Set<string>(), parents = new Set<string>(), peers = new Set<PrismaClient>();
const key = (prefix = "m12~*") => prefix + ":" + randomUUID(), at = () => new Date(Date.now() - 1000);
const jsonColumns = new Set(["detailsJson", "resultJson", "label"]);
function sqlValue(column: string, value: unknown) {
  if (value === null) return Prisma.sql`NULL`;
  if (value instanceof Date) return Prisma.sql`${value.toISOString()}::timestamp(3)`;
  if (jsonColumns.has(column)) return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  if (column === "operationKey") return Prisma.sql`${value}::uuid`;
  return Prisma.sql`${value}`;
}
async function insert(db: Db, table: Table, fields: Fields) {
  const entries = Object.entries(fields);
  return db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')} (${Prisma.join(entries.map(([name]) => Prisma.raw('"' + name + '"')))})
    VALUES (${Prisma.join(entries.map(([name, value]) => sqlValue(name, value)))})`);
}
async function patch(db: Db, table: Table, id: string, fields: Fields) {
  return db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')} SET
    ${Prisma.join(Object.entries(fields).map(([name, value]) => Prisma.sql`${Prisma.raw('"' + name + '"')}=${sqlValue(name, value)}`))} WHERE id=${id}`);
}
async function row(db: Db, table: Table, id: string) { return (await db.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id}`))[0]; }
function sqlRejected(error: unknown, codes: readonly string[] = ["23514"]) {
  expect(error instanceof Prisma.PrismaClientKnownRequestError).toBe(true);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected actual native storage constraint rejection");
  expect(error.code).toBe("P2010"); expect(codes).toContain(String(error.meta?.code));
}
async function constrained(tx: Prisma.TransactionClient, work: () => Promise<unknown>, codes: readonly string[] = ["23514"]) {
  await tx.$executeRaw`SAVEPOINT external_storage_witness`;
  let failure: unknown = null; try { await work(); } catch (error) { failure = error; }
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT external_storage_witness`; await tx.$executeRaw`RELEASE SAVEPOINT external_storage_witness`;
  sqlRejected(failure, codes);
}
async function rollback(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  const sentinel = new Error("Deliberate entire external storage fixture rollback");
  try { await prisma.$transaction(async tx => { await work(tx); throw sentinel; }, { maxWait: 10000, timeout: 60000 }); throw new Error("Storage fixture unexpectedly committed"); }
  catch (error) { if (error !== sentinel) throw error; }
}
async function user(db: Db) {
  const id = key("owner"), createdAt = new Date(Date.now() - 60000); users.add(id);
  return db.user.create({ data: { id, role: "CREATOR", active: true, isTest: true, name: "Synthetic external collaboration storage owner",
    email: randomUUID() + "@example.invalid", passwordHash: "no-login-fixture", createdAt, emailVerifiedAt: new Date(createdAt.getTime() + 1000) } });
}
function details() {
  return ExternalCollaborationDetailsSchema.parse({ schemaVersion: 1, clientDisplay: { text: "  عميل أصلي / Original client  ", language: "ar-SA" },
    campaignDisplay: { text: "\tOriginal manual campaign\n  ", language: null }, declaredValue: { amountMinor: "9223372036854775807", currencyCode: "SAR" },
    period: { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-02T00:00:00.000Z", timeZone: "Asia/Riyadh" },
    notes: { text: "  Original notes\nملاحظات أصلية  ", language: "ar" }, brief: { text: "Original private manual brief", language: "en" },
    checklist: [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", label: { text: "  First in supplied order  ", language: "en" }, done: false },
      { id: "00000000-0000-4000-8000-000000000001", label: { text: "ثانٍ أصلي", language: "ar" }, done: true }] });
}
function parent(ownerUserId: string, override: Fields = {}) {
  const createdAt = at(), id = key("parent"); parents.add(id);
  return { id, ownerUserId, revision: 1, status: "DRAFT", archived: false, detailsJson: details(), createdAt, updatedAt: createdAt, ...override };
}
async function asset(db: Db, ownerUserId: string, override: Fields = {}) {
  const id = key("asset"); assets.add(id);
  return db.privateAsset.create({ data: { id, ownerUserId, purpose: EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE, contentType: "image/png", size: 1,
    storageKey: "m12fixture/" + randomUUID(), checksum: "a".repeat(64), createdAt: new Date(Date.now() - 2000), ...override } as Prisma.PrivateAssetUncheckedCreateInput });
}
function attachment(parentId: string, ownerUserId: string, assetId: string, override: Fields = {}) {
  return { id: key("attachment"), collaborationId: parentId, ownerUserId, assetId, assetPurpose: EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE,
    label: { text: "  Original private attachment label  ", language: null }, attachedAt: new Date(), removedAt: null, ...override };
}
function receipt(current: Fields, operationKey: string, action: string, attachmentId: string | null = null) {
  return ExternalCollaborationReceiptSchema.parse({ operationKey, collaborationId: current.id, action,
    revision: current.revision, status: current.status, archived: current.archived, attachmentId });
}
function command(actorUserId: string, collaborationId: string, action: string, operationKey: string, resultJson: unknown,
  payloadHash: string, override: Fields = {}) {
  return { id: key("command"), actorUserId, collaborationId, action, operationKey, resultJson, payloadHash, createdAt: new Date(), ...override };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function holdParent(id: string) {
  const db = new PrismaClient(); peers.add(db); const ready = deferred<{ tx: Prisma.TransactionClient; pid: number }>(), release = deferred<void>();
  const done = db.$transaction(async tx => {
    const pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    await tx.$queryRaw`SELECT id FROM "ExternalCollaboration" WHERE id=${id} FOR UPDATE`;
    ready.resolve({ tx, pid }); await release.promise;
  }, { maxWait: 10000, timeout: 20000 });
  void done.catch(() => {});
  return { ...await ready.promise, release: () => release.resolve(), done };
}
async function blockedBy(pid: number) {
  const until = Date.now() + 5000;
  do {
    const found = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid::int AS pid FROM pg_stat_activity a
      WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid))
      AND a.query LIKE '%"ExternalCollaborationAttachment"%'`;
    if (found.length) return;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  } while (Date.now() < until);
  throw new Error("Expected actual separate-connection attachment lock wait");
}
async function attachmentImage(parentId: string) {
  const current = await row(prisma, "ExternalCollaboration", parentId);
  const bindings = await prisma.$queryRaw<Fields[]>`SELECT * FROM "ExternalCollaborationAttachment" WHERE "collaborationId"=${parentId} ORDER BY id COLLATE "C"`;
  return canonicalHash(JSON.parse(JSON.stringify({ current, bindings })));
}
async function nativeOutcome(work: () => Promise<unknown>) {
  try { await work(); return { accepted: true, code: "ACCEPTED" }; }
  catch (error) { return { accepted: false, code: error instanceof Prisma.PrismaClientKnownRequestError ? String(error.meta?.code ?? error.code) : "OTHER_ERROR" }; }
}
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("External storage requires guarded test target");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("External storage disposable identity mismatch");
});
afterEach(async () => {
  for (const table of ["ExternalCollaborationCommand", "ExternalCollaborationAttachment", "ExternalCollaboration"] as const) {
    const present = (await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`)[0]?.present === true;
    if (present && parents.size) await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE ${Prisma.raw(table === "ExternalCollaboration" ? '"id"' : '"collaborationId"')} IN (${Prisma.join([...parents])})`);
  }
  await prisma.privateAsset.deleteMany({ where: { id: { in: [...assets] } } }); await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); assets.clear(); parents.clear(); for (const db of peers) await db.$disconnect(); peers.clear();
});

describe("M12 P1 owner-private native storage", () => {
  it("stores exact P0 details after a real CREATOR fixture and enforces initial/identity/next revision/status/archive/chronology with full rollback", async () => {
    await rollback(async tx => {
      const owner = await user(tx), other = await user(tx), made = parent(owner.id);
      expect(ExternalCollaborationDetailsSchema.safeParse(made.detailsJson).success).toBe(true);
      // First actual missing-table RED follows admitted native User/P0 fixtures.
      await insert(tx, "ExternalCollaboration", made);
      const saved = (await row(tx, "ExternalCollaboration", made.id))!;
      expect(saved.ownerUserId).toBe(owner.id); expect(saved.revision).toBe(1); expect(saved.status).toBe("DRAFT"); expect(saved.archived).toBe(false);
      expect(canonicalHash(saved.detailsJson)).toBe(canonicalHash(made.detailsJson));
      const emoji = "😀".repeat(100), overlongEmoji = "😀".repeat(101);
      expect(emoji.length).toBe(200); expect(overlongEmoji.length).toBe(202);
      const zeroEmoji = { ...details(), declaredValue: { amountMinor: "0", currencyCode: "SAR" },
        clientDisplay: { text: emoji, language: "ar" }, campaignDisplay: { text: emoji, language: null } };
      expect(ExternalCollaborationDetailsSchema.safeParse(zeroEmoji).success).toBe(true);
      const zeroMade = parent(owner.id, { detailsJson: zeroEmoji }); await insert(tx, "ExternalCollaboration", zeroMade);
      expect(canonicalHash((await row(tx, "ExternalCollaboration", zeroMade.id))!.detailsJson)).toBe(canonicalHash(zeroEmoji));
      for (const field of ["clientDisplay", "campaignDisplay"]) {
        const tooLong = { ...zeroEmoji, [field]: { text: overlongEmoji, language: "ar" } };
        expect(ExternalCollaborationDetailsSchema.safeParse(tooLong).success).toBe(false);
        await constrained(tx, () => insert(tx, "ExternalCollaboration", parent(owner.id, { detailsJson: tooLong })));
      }
      const yearOne = new Date("0001-01-01T00:00:00.000Z");
      for (const timeZone of ["UTC", "Asia/Riyadh", "asia/riyadh"]) {
        const supported = { ...details(), period: { startsAt: "0001-01-01T00:00:00Z", endsAt: "0001-01-02T00:00:00.000Z", timeZone } };
        const early = parent(owner.id, { detailsJson: supported, createdAt: yearOne, updatedAt: yearOne });
        await insert(tx, "ExternalCollaboration", early);
        const native = (await row(tx, "ExternalCollaboration", early.id))!;
        expect(canonicalHash(native.detailsJson)).toBe(canonicalHash(supported));
        expect((native.createdAt as Date).toISOString()).toBe(yearOne.toISOString());
        expect((native.updatedAt as Date).toISOString()).toBe(yearOne.toISOString());
      }
      for (const period of [
        { startsAt: "0000-01-01T00:00:00Z", endsAt: "0001-01-01T00:00:00Z", timeZone: "UTC" },
        { startsAt: "0000-01-01T00:00:00Z", endsAt: "0000-01-02T00:00:00.000Z", timeZone: "Asia/Riyadh" },
        { ...details().period!, timeZone: "utc" }, { ...details().period!, timeZone: "Mars/Olympus" },
      ]) await constrained(tx, () => insert(tx, "ExternalCollaboration", parent(owner.id, { detailsJson: { ...details(), period } })));
      for (const fields of [{ id: key("changed") }, { ownerUserId: other.id }, { createdAt: new Date(made.createdAt.getTime() + 1) }])
        await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, { revision: 2, ...fields }));
      for (const fields of [{ revision: 1 }, { revision: 3 }, { revision: 2, updatedAt: new Date(made.createdAt.getTime() - 1) }, { revision: 2, status: "COMPLETED" }])
        await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, fields));
      for (const fields of [{ revision: 2 }, { status: "PLANNED" }, { archived: true }, { id: "unsafe id" }]) {
        const bad = parent(owner.id, fields); await constrained(tx, () => insert(tx, "ExternalCollaboration", bad));
      }
      const value = details(), badDetails: unknown[] = [ { ...value, schemaVersion: 2 }, { ...value, unknown: true },
        { ...value, declaredValue: { amountMinor: 1, currencyCode: "SAR" } }, { ...value, declaredValue: { amountMinor: "9223372036854775808", currencyCode: "SAR" } },
        { ...value, declaredValue: { amountMinor: "0", currencyCode: "XXX" } }, { ...value, notes: { text: "bad\u007fcontrol", language: "en" } },
        { ...value, period: { ...value.period!, endsAt: value.period!.startsAt } }, { ...value, clientDisplay: { text: " ", language: null } },
        { ...value, checklist: [...value.checklist, { ...value.checklist[0]!, id: value.checklist[0]!.id.toUpperCase() }] } ];
      for (const detailsJson of badDetails) await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, { revision: 2, detailsJson }));
      const unknown = { ...value, declaredValue: null, period: null, notes: null, brief: null, checklist: [] };
      await patch(tx, "ExternalCollaboration", made.id, { revision: 2, detailsJson: unknown });
      expect(canonicalHash((await row(tx, "ExternalCollaboration", made.id))!.detailsJson)).toBe(canonicalHash(unknown));
      await patch(tx, "ExternalCollaboration", made.id, { revision: 3, status: "PLANNED" });
      await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, { revision: 4, status: "IN_PROGRESS", archived: true }));
      await patch(tx, "ExternalCollaboration", made.id, { revision: 4, archived: true });
      await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, { revision: 5, detailsJson: value }));
      await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, { revision: 5 }));
      await patch(tx, "ExternalCollaboration", made.id, { revision: 5, archived: false });
      for (const status of ["IN_PROGRESS", "COMPLETED", "IN_PROGRESS", "CANCELLED", "DRAFT"]) {
        const current = (await row(tx, "ExternalCollaboration", made.id))!; await patch(tx, "ExternalCollaboration", made.id, { revision: Number(current.revision) + 1, status });
      }
      expect((await row(tx, "ExternalCollaboration", made.id))!.status).toBe("DRAFT");
      const maximum = (await tx.$queryRaw<Array<{ next: number }>>`SELECT infame_external_collaboration_next_revision(2147483645::integer) AS next`)[0]!.next;
      expect(maximum).toBe(2147483646);
      for (const input of [null, 0, 2147483646, 2147483647]) await constrained(tx, () => tx.$queryRaw`SELECT infame_external_collaboration_next_revision(${input}::integer)`);
    });
    if (parents.size) expect((await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT count(*)::int AS count FROM "ExternalCollaboration" WHERE id IN (${Prisma.join([...parents])})`))[0]!.count).toBe(0);
  }, 60000);

  it("retains exact actor/UUID receipt pins and immutable owned attachment metadata with one automatic parent touch, including unlink after asset loss", async () => {
    await rollback(async tx => {
      const owner = await user(tx), foreign = await user(tx), made = parent(owner.id), other = parent(foreign.id);
      await insert(tx, "ExternalCollaboration", made); await insert(tx, "ExternalCollaboration", other);
      const operationKey = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF", initial = receipt(made, operationKey, "CREATE");
      const hash = externalCollaborationCommandHash(owner.id, { operationKey, expectedRevision: 0, action: "CREATE", payload: { details: made.detailsJson } });
      const first = command(owner.id, made.id, "CREATE", operationKey, initial, hash);
      await insert(tx, "ExternalCollaborationCommand", first);
      const saved = (await row(tx, "ExternalCollaborationCommand", first.id))!;
      expect(saved.operationKey).toBe(operationKey.toLowerCase()); expect(saved.payloadHash).toBe(hash);
      expect(canonicalHash(saved.resultJson)).toBe(canonicalHash(initial));
      expect((saved.resultJson as { operationKey: string }).operationKey).toBe(operationKey);
      await constrained(tx, () => insert(tx, "ExternalCollaborationCommand", { ...first, id: key("alias"), operationKey: operationKey.toLowerCase() }), ["23505"]);
      await constrained(tx, () => insert(tx, "ExternalCollaborationCommand", { ...first, id: key("foreign"), actorUserId: foreign.id }), ["23514", "23503"]);
      const freshKey = randomUUID();
      for (const badReceipt of [{ ...initial, revision: 2 }, { ...initial, collaborationId: other.id }, { ...initial, status: "PLANNED" },
        { ...initial, operationKey: freshKey }, { ...initial, archived: true }, { ...initial, attachmentId: key("absent") },
        { ...initial, revision: "1" }, { ...initial, extra: true }])
        await constrained(tx, () => insert(tx, "ExternalCollaborationCommand", { ...first, id: key("badreceipt"), resultJson: badReceipt }));
      for (const fields of [{ action: "SAVE_DETAILS" }, { payloadHash: "A".repeat(64) }, { createdAt: new Date(made.updatedAt.getTime() - 1) }])
        await constrained(tx, () => insert(tx, "ExternalCollaborationCommand", { ...first, id: key("badscalar"), ...fields }));
      for (const fields of [{ resultJson: { ...initial, revision: 2 } }, { payloadHash: "b".repeat(64) }, { actorUserId: foreign.id }, { createdAt: new Date() }])
        await constrained(tx, () => patch(tx, "ExternalCollaborationCommand", first.id, fields));

      const file = await asset(tx, owner.id), linked = attachment(made.id, owner.id, file.id);
      await insert(tx, "ExternalCollaborationAttachment", linked);
      let current = (await row(tx, "ExternalCollaboration", made.id))!;
      expect(current.revision).toBe(2); expect((current.updatedAt as Date).getTime()).toBe(linked.attachedAt.getTime());
      expect(canonicalHash((await row(tx, "ExternalCollaborationAttachment", linked.id))!.label)).toBe(canonicalHash(linked.label));
      const attachKey = randomUUID(), attachReceipt = receipt(current, attachKey, "ATTACH_FILE", linked.id);
      await insert(tx, "ExternalCollaborationCommand", command(owner.id, made.id, "ATTACH_FILE", attachKey, attachReceipt,
        externalCollaborationCommandHash(owner.id, { operationKey: attachKey, collaborationId: made.id, expectedRevision: 1,
          action: "ATTACH_FILE", payload: { label: linked.label, file: { checksum: file.checksum, contentType: file.contentType, size: file.size } } })));
      const removeEarly = randomUUID();
      await constrained(tx, () => insert(tx, "ExternalCollaborationCommand", command(owner.id, made.id, "REMOVE_ATTACHMENT", removeEarly,
        receipt(current, removeEarly, "REMOVE_ATTACHMENT", linked.id), "c".repeat(64))));
      await constrained(tx, () => insert(tx, "ExternalCollaborationCommand", command(owner.id, made.id, "ATTACH_FILE", freshKey,
        receipt(current, freshKey, "ATTACH_FILE", key("missingbinding")), "c".repeat(64))));
      for (const fields of [{ id: key("changed") }, { collaborationId: other.id }, { ownerUserId: foreign.id }, { assetId: key("missingasset") },
        { assetPurpose: "PROFILE_LOGO" }, { label: { text: "Replacement", language: "en" } }, { attachedAt: new Date(linked.attachedAt.getTime() + 1) }])
        await constrained(tx, () => patch(tx, "ExternalCollaborationAttachment", linked.id, fields));
      await constrained(tx, () => patch(tx, "ExternalCollaborationAttachment", linked.id, { removedAt: new Date(linked.attachedAt.getTime() - 1) }));
      const duplicate = attachment(made.id, owner.id, file.id);
      await constrained(tx, () => insert(tx, "ExternalCollaborationAttachment", duplicate), ["23505"]);
      const fresh = await asset(tx, owner.id);
      await constrained(tx, () => insert(tx, "ExternalCollaborationAttachment", attachment(made.id, owner.id, fresh.id, { removedAt: new Date() })));
      for (const [assetOwner, fields] of [[foreign.id, {}], [owner.id, { purpose: "PROFILE_LOGO" }], [owner.id, { deletedAt: new Date() }],
        [owner.id, { contentType: "text/plain" }]] as Array<[string, Fields]>) {
        const badFile = await asset(tx, assetOwner, fields);
        await constrained(tx, () => insert(tx, "ExternalCollaborationAttachment", attachment(made.id, owner.id, badFile.id)), ["23514", "23503"]);
      }
      // The inherited PrivateAsset ceiling rejects oversize metadata itself;
      // do not fabricate an impossible row to claim attachment-guard coverage.
      const oversizedId = key("oversized"); assets.add(oversizedId);
      await constrained(tx, () => tx.$executeRaw`INSERT INTO "PrivateAsset"
        (id,"ownerUserId",purpose,"contentType",size,"storageKey",checksum,"createdAt") VALUES
        (${oversizedId},${owner.id},${EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE},'image/png',10485761,
          ${"m12fixture/" + randomUUID()},${"a".repeat(64)},${at()}::timestamp(3))`);
      // Losing bytes/availability must not trap an owned binding. Native metadata
      // is deliberately deleted without claiming any real file ever existed.
      await tx.privateAsset.update({ where: { id: file.id }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
      const removedAt = new Date(); await patch(tx, "ExternalCollaborationAttachment", linked.id, { removedAt });
      current = (await row(tx, "ExternalCollaboration", made.id))!; expect(current.revision).toBe(3);
      expect((current.updatedAt as Date).getTime()).toBe(removedAt.getTime());
      const removeKey = randomUUID(), removeReceipt = receipt(current, removeKey, "REMOVE_ATTACHMENT", linked.id);
      await insert(tx, "ExternalCollaborationCommand", command(owner.id, made.id, "REMOVE_ATTACHMENT", removeKey, removeReceipt,
        externalCollaborationCommandHash(owner.id, { operationKey: removeKey, collaborationId: made.id, expectedRevision: 2,
          action: "REMOVE_ATTACHMENT", payload: { attachmentId: linked.id } })));
      for (const removed of [null, removedAt, new Date(removedAt.getTime() + 1)])
        await constrained(tx, () => patch(tx, "ExternalCollaborationAttachment", linked.id, { removedAt: removed }));
      const afterRemoval = randomUUID();
      await constrained(tx, () => insert(tx, "ExternalCollaborationCommand", command(owner.id, made.id, "ATTACH_FILE", afterRemoval,
        receipt(current, afterRemoval, "ATTACH_FILE", linked.id), "d".repeat(64))));
      // Historical CREATE/ATTACH receipts remain exact after later parent edits.
      expect(canonicalHash((await row(tx, "ExternalCollaborationCommand", first.id))!.resultJson)).toBe(canonicalHash(initial));
      const next = attachment(made.id, owner.id, fresh.id); await insert(tx, "ExternalCollaborationAttachment", next);
      await patch(tx, "ExternalCollaboration", made.id, { revision: 5, archived: true });
      const archivedImage = canonicalHash(JSON.parse(JSON.stringify(await row(tx, "ExternalCollaboration", made.id))));
      await constrained(tx, () => patch(tx, "ExternalCollaborationAttachment", next.id, { removedAt: new Date() }));
      const unused = await asset(tx, owner.id);
      await constrained(tx, () => insert(tx, "ExternalCollaborationAttachment", attachment(made.id, owner.id, unused.id)));
      expect(canonicalHash(JSON.parse(JSON.stringify(await row(tx, "ExternalCollaboration", made.id))))).toBe(archivedImage);
      await patch(tx, "ExternalCollaboration", made.id, { revision: 6, archived: false });
      await patch(tx, "ExternalCollaborationAttachment", next.id, { removedAt: new Date() });
      expect((await row(tx, "ExternalCollaboration", made.id))!.revision).toBe(7);
      const maximumFile = await asset(tx, owner.id, { size: 10485760 });
      const maximumBinding = attachment(made.id, owner.id, maximumFile.id);
      await insert(tx, "ExternalCollaborationAttachment", maximumBinding);
      expect((await row(tx, "ExternalCollaborationAttachment", maximumBinding.id))!.assetId).toBe(maximumFile.id);
      expect((await row(tx, "ExternalCollaboration", made.id))!.revision).toBe(8);
    });
  }, 60000);

  it("serializes the actual twentieth attachment across connections, rejects reverse-order tombstones NOWAIT, and preserves every binding/revision on failure or rollback", async () => {
    const owner = await user(prisma), made = parent(owner.id), retained: ReturnType<typeof attachment>[] = [];
    await prisma.$transaction(async tx => {
      await insert(tx, "ExternalCollaboration", made);
      for (let index = 0; index < 19; index++) {
        const file = await asset(tx, owner.id), linked = attachment(made.id, owner.id, file.id);
        await insert(tx, "ExternalCollaborationAttachment", linked); retained.push(linked);
      }
    }, { maxWait: 10000, timeout: 20000 });
    expect((await row(prisma, "ExternalCollaboration", made.id))!.revision).toBe(20);
    const winningFile = await asset(prisma, owner.id), losingFile = await asset(prisma, owner.id);
    const winner = attachment(made.id, owner.id, winningFile.id), loser = attachment(made.id, owner.id, losingFile.id);
    const blocker = await holdParent(made.id);
    const db = new PrismaClient(); peers.add(db);
    const losing = nativeOutcome(() => insert(db, "ExternalCollaborationAttachment", loser));
    try {
      await blockedBy(blocker.pid); // proves the second real connection reached the parent wait
      await insert(blocker.tx, "ExternalCollaborationAttachment", winner);
      expect((await row(blocker.tx, "ExternalCollaboration", made.id))!.revision).toBe(21);
    } finally { blocker.release(); await blocker.done; }
    expect(await losing).toEqual({ accepted: false, code: "23514" });
    expect((await row(prisma, "ExternalCollaboration", made.id))!.revision).toBe(21);
    expect((await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "ExternalCollaborationAttachment"
      WHERE "collaborationId"=${made.id} AND "removedAt" IS NULL`)[0]!.count).toBe(20);
    expect((await row(prisma, "ExternalCollaborationAttachment", loser.id)) === undefined).toBe(true);
    const full = await attachmentImage(made.id);
    // UPDATE owns the child row before its trigger. It must not wait for an
    // ancestor held elsewhere, which could complete a parent/child lock cycle.
    const reverse = await holdParent(made.id);
    const reversing = nativeOutcome(() => patch(db, "ExternalCollaborationAttachment", retained[0]!.id, { removedAt: new Date() }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = { accepted: false, code: "UNEXPECTED_WAIT" };
    try {
      const result = await Promise.race([reversing, new Promise<typeof timedOut>(resolve => { timer = setTimeout(() => resolve(timedOut), 2000); })]);
      expect(result).toEqual({ accepted: false, code: "55P03" });
    } finally { if (timer !== undefined) clearTimeout(timer); reverse.release(); await reverse.done; await reversing; }
    expect(await attachmentImage(made.id)).toBe(full);
    await rollback(async tx => {
      // A legitimate same-transaction removal frees a slot, but rolling back
      // both mutations restores the cap, exact timestamps and both touches.
      await patch(tx, "ExternalCollaborationAttachment", retained[0]!.id, { removedAt: new Date() });
      await insert(tx, "ExternalCollaborationAttachment", loser);
      expect((await row(tx, "ExternalCollaboration", made.id))!.revision).toBe(23);
      expect((await tx.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "ExternalCollaborationAttachment"
        WHERE "collaborationId"=${made.id} AND "removedAt" IS NULL`)[0]!.count).toBe(20);
    });
    expect(await attachmentImage(made.id)).toBe(full);
    await rollback(async tx => {
      await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, { revision: 21 }));
      await constrained(tx, () => patch(tx, "ExternalCollaboration", made.id, { revision: 23 }));
      await constrained(tx, () => insert(tx, "ExternalCollaborationAttachment", loser));
    });
    expect(await attachmentImage(made.id)).toBe(full);
    await prisma.$transaction(async tx => {
      await patch(tx, "ExternalCollaborationAttachment", retained[0]!.id, { removedAt: new Date() });
      await insert(tx, "ExternalCollaborationAttachment", loser);
    });
    expect((await row(prisma, "ExternalCollaboration", made.id))!.revision).toBe(23);
    expect((await row(prisma, "ExternalCollaborationAttachment", retained[0]!.id))!.removedAt !== null).toBe(true);
    expect((await row(prisma, "ExternalCollaborationAttachment", loser.id))!.removedAt).toBeNull();
    expect((await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "ExternalCollaborationAttachment"
      WHERE "collaborationId"=${made.id} AND "removedAt" IS NULL`)[0]!.count).toBe(20);
  }, 60000);
});
