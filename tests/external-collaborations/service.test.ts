// P2 genuine native User/AuthSession + DB-only service witnesses, <=3 groups.
// Root alone adopts/runs; no bytes/provider/session mocks or guard bypass.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor, type OrganizationActor } from "@/lib/organizations/context";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { ExternalCollaborationDetailsSchema, externalCollaborationCommandHash,
  EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE, type ExternalCollaborationDetails,
  type ExternalCollaborationResult, type ExternalCollaborationDetail, type ExternalCollaborationList } from "@/lib/external-collaborations/contracts";

type Service = {
  executeExternalCollaborationCommand(actor: unknown, input: unknown, options?: { client?: PrismaClient }): Promise<ExternalCollaborationResult>;
  getExternalCollaboration(actor: unknown, input: unknown, options?: { client?: PrismaClient }): Promise<ExternalCollaborationDetail>;
  listExternalCollaborations(actor: unknown, input: unknown, options?: { client?: PrismaClient }): Promise<ExternalCollaborationList>;
};
const modulePath = "@/lib/external-collaborations/service";
const load = async () => await vi.importActual<Service>(modulePath).catch(() => undefined) as Service;
const users = new Set<string>(), parentIds = new Set<string>(), assets = new Set<string>(), peers = new Set<PrismaClient>();
const key = () => randomUUID(), words = "  كلماتي الأصلية\nOriginal external collaboration words  ";
const itemId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
function details(): ExternalCollaborationDetails { return ExternalCollaborationDetailsSchema.parse({ schemaVersion: 1,
  clientDisplay: { text: words, language: "ar-SA" }, campaignDisplay: { text: "  Original campaign\nحملة أصلية  ", language: null },
  declaredValue: { amountMinor: "0", currencyCode: "SAR" }, period: { startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-02T00:00:00.000Z", timeZone: "asia/riyadh" },
  notes: { text: words + " notes", language: "ar" }, brief: { text: words + " brief", language: "en" },
  checklist: [{ id: itemId, label: { text: " Original ordered checklist item ", language: null }, done: false }] }); }
async function signed(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Owned external collaboration native session did not resolve");
  return captureOrganizationActor(session);
}
async function fixture(role: "CREATOR" | "BRAND" | "ADMIN" = "CREATOR") {
  const id = "m12owner*" + key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic owner service fixture",
    email: key() + "@example.invalid", passwordHash: "not-a-login" } });
  return { user, actor: await signed(id) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function outcome(work: () => Promise<unknown>) {
  try { await work(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const safe = error as { code?: string; status?: number }; return { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; }
}
const denied = (code: string, status: number) => ({ accepted: false, code, status });
async function records(userId: string) {
  const ids = (await prisma.externalCollaboration.findMany({ where: { ownerUserId: userId }, select: { id: true } })).map(value => value.id);
  return { parents: await prisma.externalCollaboration.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }),
    commands: await prisma.externalCollaborationCommand.findMany({ where: { actorUserId: userId }, orderBy: { id: "asc" } }),
    bindings: await prisma.externalCollaborationAttachment.findMany({ where: { ownerUserId: userId }, orderBy: { id: "asc" } }),
    audits: await prisma.adminAudit.findMany({ where: { actorUserId: userId }, orderBy: { id: "asc" } }),
    events: await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: userId } }, orderBy: { id: "asc" } }) };
}
async function image(userId: string) { return createHash("sha256").update(JSON.stringify(await records(userId))).digest("hex"); }
function includesOriginal(value: unknown, original: string) { return JSON.stringify(value).includes(JSON.stringify(original).slice(1, -1)); }
async function write(c: Service, f: Fixture, input: unknown) {
  const before = await records(f.user.id), result = await c.executeExternalCollaborationCommand(f.actor, input);
  parentIds.add(result.collaborationId); const after = await records(f.user.id);
  expect(result.replayed).toBe(false); expect(after.commands.length).toBe(before.commands.length + 1);
  expect(after.audits.length).toBe(before.audits.length + 1); expect(after.events.length).toBe(before.events.length + 1);
  const retained = after.commands.find(value => value.operationKey.toLowerCase() === result.operationKey.toLowerCase())!;
  expect(retained.actorUserId).toBe(f.user.id); expect(retained.payloadHash).toBe(externalCollaborationCommandHash(f.user.id, input));
  const { replayed: _replayed, ...receipt } = result; void _replayed;
  expect(canonicalHash(retained.resultJson)).toBe(canonicalHash(receipt));
  const audit = after.audits.find(value => !before.audits.some(old => old.id === value.id))!;
  expect(audit.action).toBe("external_collaboration.command"); expect(audit.resourceType).toBe("ExternalCollaboration");
  expect(audit.resourceId).toBe(result.collaborationId); expect(canonicalHash(audit.snapshot)).toBe(canonicalHash(receipt));
  const event = after.events.find(value => !before.events.some(old => old.id === value.id))!;
  expect(event.type).toBe("external_collaboration.changed");
  expect(event.deduplicationKey.toLowerCase()).toBe(("external-collaboration:" + f.user.id + ":" + result.operationKey).toLowerCase());
  const envelope = event.payload as { aggregateId: string; aggregateType: string; aggregateVersion: number; payload: unknown };
  expect(envelope.aggregateId).toBe(result.collaborationId); expect(envelope.aggregateType).toBe("ExternalCollaboration"); expect(envelope.aggregateVersion).toBe(result.revision);
  expect(canonicalHash(envelope.payload)).toBe(canonicalHash({ action: result.action, status: result.status, archived: result.archived, attachmentId: result.attachmentId }));
  for (const event of after.events) { expect(event.status).toBe("PENDING"); expect(event.deliveredAt === null).toBe(true); }
  expect(includesOriginal(after.audits.map(value => value.snapshot), words)).toBe(false);
  expect(includesOriginal(after.events.map(value => value.payload), words)).toBe(false);
  return result;
}
function currentInput(current: ExternalCollaborationResult, action: string, payload: unknown, operationKey: string = key()) {
  return { operationKey, collaborationId: current.collaborationId, expectedRevision: current.revision, action, payload };
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function hold(table: "User" | "AuthSession" | "ExternalCollaboration" | "ExternalCollaborationCommand", id: string,
  mutate: (tx: Prisma.TransactionClient) => Promise<void> = async () => {}) {
  const db = new PrismaClient(); peers.add(db); const ready = latch(), release = latch(); let pid = 0;
  const done = db.$transaction(async tx => {
    pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    ready.release(); await release.promise; await mutate(tx);
  }, { maxWait: 10000, timeout: 15000 }); void done.catch(() => {}); await ready.promise;
  return { pid, release: release.release, done };
}
async function blockedBy(pid: number, table: string, expected = 1) {
  const deadline = Date.now() + 5000;
  do {
    const found = await prisma.$queryRaw<Array<{ pid: number }>>`WITH RECURSIVE blocked(pid) AS (
      SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
        WHERE a.datname=current_database() AND a.wait_event_type='Lock'
    ) SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=a.pid WHERE a.query LIKE ${'%"' + table + '"%'}`;
    if (found.length >= expected) return; await new Promise<void>(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error("External collaboration service never reached its actual native lock wait");
}
function observe() {
  const queries: string[] = [], db = new PrismaClient({ log: [{ emit: "event", level: "query" }] }); peers.add(db);
  db.$on("query", event => { queries.push(event.query); }); // SQL shape only, never params/session IDs/private bodies.
  return { db, queries };
}
function bodySelects(queries: string[]) {
  return queries.filter(query => /\bSELECT\b/i.test(query) && /"ExternalCollaboration(?:Command|Attachment)?"/.test(query)
    && /"(?:detailsJson|resultJson|label)"/.test(query));
}
async function blockEvent(actorUserId: string, operationKey: string, collaborationId: string) {
  const db = new PrismaClient(); peers.add(db); const ready = latch(), release = latch(), sentinel = new Error("Rollback owned scheduling-only outbox row"); let pid = 0;
  const done = db.$transaction(async tx => {
    pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    await tx.outboxEvent.create({ data: { deduplicationKey: "external-collaboration:" + actorUserId + ":" + operationKey,
      type: "external_collaboration.changed", payload: { actorUserId, aggregateId: collaborationId, schedulingOnlyFixture: true }, status: "PENDING" } });
    ready.release(); await release.promise; throw sentinel;
  }, { maxWait: 10000, timeout: 15000 }).catch(error => { if (error !== sentinel) throw error; });
  void done.catch(() => {}); await ready.promise;
  return { pid, release: release.release, done };
}
async function expireAtRealClock(date: Date) {
  await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, date.getTime() + 25 - Date.now())));
  expect(Date.now() >= date.getTime()).toBe(true);
}
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("External owner service requires guarded test target");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("External owner service disposable identity mismatch");
});
afterEach(async () => {
  await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.externalCollaborationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.externalCollaborationAttachment.deleteMany({ where: { ownerUserId: { in: [...users] } } });
  await prisma.externalCollaboration.deleteMany({ where: { ownerUserId: { in: [...users] } } });
  await prisma.privateAsset.deleteMany({ where: { id: { in: [...assets] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); parentIds.clear(); assets.clear(); for (const db of peers) await db.$disconnect(); peers.clear();
});

describe("M12 P2 exact owner service", () => {
  it("admits a genuine CREATOR without profile and atomically preserves original edits, semantic checklist IDs, historical replay and private reads", async () => {
    const f = await fixture(); expect(await prisma.creator.count({ where: { userId: f.user.id } })).toBe(0);
    expect(f.actor.userId).toBe(f.user.id); expect(f.actor.role).toBe("CREATOR");
    const c = await load(); // First missing-module/export RED after actual native User/AuthSession, not collection.
    const create = { operationKey: key().toUpperCase(), expectedRevision: 0, action: "CREATE", payload: { details: details() } };
    let current = await write(c, f, create); expect(current.revision).toBe(1); expect(current.status).toBe("DRAFT"); expect(current.archived).toBe(false);
    const initial = current, created = await c.getExternalCollaboration(f.actor, { collaborationId: current.collaborationId });
    expect(canonicalHash(created.collaboration.details)).toBe(canonicalHash(details())); expect(created.attachments.length).toBe(0);
    const changed = { ...details(), notes: { text: words + " changed in original language", language: "ar" } };
    const save = currentInput(current, "SAVE_DETAILS", { details: changed }); current = await write(c, f, save); expect(current.revision).toBe(2);
    const ordered = [{ id: itemId, label: { text: " Stored original identifier spelling ", language: null }, done: false },
      { id: "00000000-0000-4000-8000-000000000001", label: { text: "Second item", language: "en" }, done: true }];
    current = await write(c, f, currentInput(current, "SET_CHECKLIST", { checklist: ordered }));
    current = await write(c, f, currentInput(current, "SET_CHECKLIST_DONE", { itemId: itemId.toUpperCase(), done: true }));
    const read = await c.getExternalCollaboration(f.actor, { collaborationId: current.collaborationId });
    expect(read.collaboration.details.checklist.map(value => value.id)).toEqual(ordered.map(value => value.id));
    expect(read.collaboration.details.checklist[0]!.done).toBe(true); expect(read.collaboration.details.notes?.text === changed.notes.text).toBe(true);
    let before = await image(f.user.id);
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, currentInput(current, "SET_CHECKLIST_DONE", { itemId, done: true })))).toEqual(denied("INVALID_STATE", 409));
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, currentInput(current, "SET_CHECKLIST_DONE", { itemId: key(), done: true })))).toEqual(denied("NOT_FOUND", 404));
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, currentInput(current, "SET_STATUS", { status: "COMPLETED" })))).toEqual(denied("INVALID_STATE", 409));
    expect(await image(f.user.id)).toBe(before);
    current = await write(c, f, currentInput(current, "SET_STATUS", { status: "IN_PROGRESS" }));
    current = await write(c, f, currentInput(current, "ARCHIVE", {})); before = await image(f.user.id);
    const replayed = await c.executeExternalCollaborationCommand(await signed(f.user.id), structuredClone(create));
    expect(replayed.replayed).toBe(true); const { replayed: _flag, ...historical } = replayed; void _flag;
    const { replayed: _initialFlag, ...originalReceipt } = initial; void _initialFlag;
    expect(canonicalHash(historical)).toBe(canonicalHash(originalReceipt)); expect(await image(f.user.id)).toBe(before);
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, { ...create, payload: { details: changed } }))).toEqual(denied("IDEMPOTENCY_CONFLICT", 409));
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, currentInput(current, "SAVE_DETAILS", { details: changed })))).toEqual(denied("INVALID_STATE", 409));
    expect(await image(f.user.id)).toBe(before);
    current = await write(c, f, currentInput(current, "RESTORE", {})); before = await image(f.user.id);
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, { ...save, operationKey: key() }))).toEqual(denied("STALE_VERSION", 409));
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, currentInput(current, "ATTACH_FILE", {
      label: { text: "Original file label", language: null }, file: { checksum: "a".repeat(64), contentType: "image/png", size: 1 } })))).toEqual(denied("CAPABILITY_UNAVAILABLE", 503));
    expect(await image(f.user.id)).toBe(before);
    const dto = await c.getExternalCollaboration(f.actor, { collaborationId: current.collaborationId });
    expect(dto.scope).toBe("OWN_CREATOR"); expect(dto.collaboration.revision).toBe(current.revision);
    expect(JSON.stringify(dto).includes(f.actor.sessionId)).toBe(false); expect(JSON.stringify(dto).includes("passwordHash")).toBe(false);
    const list = await c.listExternalCollaborations(f.actor, { archived: false }); expect(list.collaborations.map(value => value.id)).toEqual([current.collaborationId]);
    expect(list.collaborations[0]!.declaredValue?.amountMinor).toBe("0"); expect(list.collaborations[0]!.checklist).toEqual({ total: 2, done: 2 });
    expect(includesOriginal(list, changed.notes.text)).toBe(false); expect(includesOriginal(list, details().brief!.text)).toBe(false);
  }, 15000);

  it("denies genuine wrong roles and forged/revoked/expired sessions before unsafe input or private bodies, isolates foreign owners, and captures callers before a real User wait", async () => {
    const f = await fixture(), foreign = await fixture(), brand = await fixture("BRAND"), admin = await fixture("ADMIN"), c = await load();
    const made = await write(c, f, { operationKey: key(), expectedRevision: 0, action: "CREATE", payload: { details: details() } });
    const observed = observe(); let executed = 0;
    const badCommand: Record<string, unknown> = { action: "CREATE", operationKey: key(), expectedRevision: 0 };
    Object.defineProperty(badCommand, "payload", { enumerable: true, get() { executed++; return { details: details() }; } });
    const badQuery: Record<string, unknown> = {};
    Object.defineProperty(badQuery, "collaborationId", { enumerable: true, get() { executed++; return made.collaborationId; } });
    const actors: unknown[] = [undefined, null, {}, { ...f.actor, sessionId: "malformed" },
      { ...f.actor, sessionId: randomBytes(32).toString("base64url") }, { ...f.actor, sessionVersion: f.actor.sessionVersion + 1 },
      { ...f.actor, role: "BRAND" }, { ...f.actor, sessionId: foreign.actor.sessionId }, { ...f.actor, userId: foreign.user.id }];
    const before = await image(f.user.id);
    for (const actor of actors) {
      expect(await outcome(() => c.executeExternalCollaborationCommand(actor, badCommand, { client: observed.db }))).toEqual(denied("UNAUTHENTICATED", 401));
      expect(await outcome(() => c.getExternalCollaboration(actor, badQuery, { client: observed.db }))).toEqual(denied("UNAUTHENTICATED", 401));
      expect(await outcome(() => c.listExternalCollaborations(actor, { bad: true }, { client: observed.db }))).toEqual(denied("UNAUTHENTICATED", 401));
    }
    for (const actual of [brand, admin]) {
      expect(await outcome(() => c.executeExternalCollaborationCommand(actual.actor, badCommand, { client: observed.db }))).toEqual(denied("FORBIDDEN", 403));
      expect(await outcome(() => c.getExternalCollaboration(actual.actor, badQuery, { client: observed.db }))).toEqual(denied("FORBIDDEN", 403));
      expect(await outcome(() => c.listExternalCollaborations(actual.actor, { bad: true }, { client: observed.db }))).toEqual(denied("FORBIDDEN", 403));
    }
    for (const kind of ["revoked", "expired", "inactive", "version"] as const) {
      const expired = await fixture();
      if (kind === "revoked") await prisma.authSession.update({ where: { id: expired.actor.sessionId }, data: { revokedAt: new Date() } });
      if (kind === "expired") await prisma.authSession.update({ where: { id: expired.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
      if (kind === "inactive") await prisma.user.update({ where: { id: expired.user.id }, data: { active: false } });
      if (kind === "version") await prisma.user.update({ where: { id: expired.user.id }, data: { sessionVersion: { increment: 1 } } });
      expect(await outcome(() => c.executeExternalCollaborationCommand(expired.actor, badCommand, { client: observed.db }))).toEqual(denied("UNAUTHENTICATED", 401));
      expect(await outcome(() => c.getExternalCollaboration(expired.actor, badQuery, { client: observed.db }))).toEqual(denied("UNAUTHENTICATED", 401));
      expect(await outcome(() => c.listExternalCollaborations(expired.actor, { bad: true }, { client: observed.db }))).toEqual(denied("UNAUTHENTICATED", 401));
    }
    expect(executed).toBe(0); expect(bodySelects(observed.queries).length).toBe(0); expect(await image(f.user.id)).toBe(before);
    observed.queries.length = 0;
    expect(await outcome(() => c.getExternalCollaboration(foreign.actor, { collaborationId: made.collaborationId }, { client: observed.db }))).toEqual(denied("NOT_FOUND", 404));
    expect(await outcome(() => c.executeExternalCollaborationCommand(foreign.actor, currentInput(made, "SAVE_DETAILS", { details: details() }), { client: observed.db }))).toEqual(denied("NOT_FOUND", 404));
    expect(bodySelects(observed.queries).length).toBe(0); expect(await image(f.user.id)).toBe(before);
    expect(await outcome(() => c.executeExternalCollaborationCommand(f.actor, badCommand))).toEqual(denied("VALIDATION", 422));
    expect(await outcome(() => c.getExternalCollaboration(f.actor, badQuery))).toEqual(denied("VALIDATION", 422));
    expect(await outcome(() => c.listExternalCollaborations(f.actor, { archived: false, limit: 100 }))).toEqual(denied("VALIDATION", 422));
    expect(executed).toBe(0);
    const blocker = await hold("User", f.user.id), alternate = observe();
    const capturedActor: OrganizationActor = { ...f.actor }, input = currentInput(made, "SAVE_DETAILS", { details: details() });
    const inputDetails = (input.payload as { details: ExternalCollaborationDetails }).details;
    inputDetails.notes = { text: words + " captured before wait", language: "ar" };
    const wantedHash = externalCollaborationCommandHash(f.user.id, structuredClone(input)), wantedWords = inputDetails.notes.text;
    const options = { client: observed.db };
    const pending = c.executeExternalCollaborationCommand(capturedActor, input, options); void pending.catch(() => {});
    try {
      await blockedBy(blocker.pid, "User");
      capturedActor.userId = foreign.user.id; capturedActor.sessionId = foreign.actor.sessionId; capturedActor.role = "BRAND";
      inputDetails.notes.text = "Later mutation must never persist"; input.operationKey = key(); options.client = alternate.db;
    } finally { blocker.release(); await blocker.done; }
    const captured = await pending; expect(captured.replayed).toBe(false); expect(alternate.queries.length).toBe(0);
    const retained = await prisma.externalCollaborationCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.user.id, operationKey: captured.operationKey } } });
    expect(retained.payloadHash).toBe(wantedHash);
    const saved = await c.getExternalCollaboration(f.actor, { collaborationId: made.collaborationId });
    expect(saved.collaboration.details.notes?.text === wantedWords).toBe(true);
    // An actual committed revocation while waiting denies before any parent body.
    const revoke = await hold("User", f.user.id, async tx => { await tx.authSession.update({ where: { id: f.actor.sessionId }, data: { revokedAt: new Date() } }); });
    observed.queries.length = 0; const beforeRevoke = await image(f.user.id);
    const waiting = outcome(() => c.getExternalCollaboration(f.actor, { collaborationId: made.collaborationId }, { client: observed.db }));
    try { await blockedBy(revoke.pid, "User"); } finally { revoke.release(); await revoke.done; }
    expect(await waiting).toEqual(denied("UNAUTHENTICATED", 401)); expect(bodySelects(observed.queries).length).toBe(0);
    expect(await image(f.user.id)).toBe(beforeRevoke);
  }, 15000);

  it("proves native parent/journal/outbox waits, exact one-effect concurrency, final-expiry rollback, byte-independent removal and bounded thin ASCII pages", async () => {
    const creating = await fixture(), c = await load(), simultaneousCreate = { operationKey: key().toUpperCase(), expectedRevision: 0, action: "CREATE", payload: { details: details() } };
    const creatorWait = await hold("User", creating.user.id);
    const newParentRace = [1, 2].map(() => c.executeExternalCollaborationCommand(creating.actor, structuredClone(simultaneousCreate))
      .then(value => ({ value, error: null }), error => ({ value: null, error: { code: String(error.code), status: Number(error.status) } })));
    try { await blockedBy(creatorWait.pid, "User", 2); } finally { creatorWait.release(); await creatorWait.done; }
    const creationResults = await Promise.all(newParentRace);
    expect(creationResults.map(result => result.error)).toEqual([null, null]);
    const created = creationResults.map(result => result.value!); created.forEach(result => parentIds.add(result.collaborationId));
    expect(created.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(created.map(result => result.collaborationId)).size).toBe(1); expect(created.every(result => result.revision === 1)).toBe(true);
    const createdImage = await records(creating.user.id);
    expect(createdImage.parents.length).toBe(1); expect(createdImage.commands.length).toBe(1); expect(createdImage.audits.length).toBe(1); expect(createdImage.events.length).toBe(1);
    expect(createdImage.commands[0]!.payloadHash).toBe(externalCollaborationCommandHash(creating.user.id, simultaneousCreate));
    const f = await fixture();
    const create = { operationKey: key(), expectedRevision: 0, action: "CREATE", payload: { details: details() } };
    let current = await write(c, f, create), before = await records(f.user.id);
    const one = currentInput(current, "SAVE_DETAILS", { details: { ...details(), notes: { text: words + " first concurrent candidate", language: "ar" } } });
    const two = currentInput(current, "SAVE_DETAILS", { details: { ...details(), notes: { text: words + " second concurrent candidate", language: "ar" } } });
    const parentWait = await hold("ExternalCollaboration", current.collaborationId);
    const races = [one, two].map(input => c.executeExternalCollaborationCommand(f.actor, input)
      .then(value => ({ value, error: null }), error => ({ value: null, error: { code: String(error.code), status: Number(error.status) } })));
    try { await blockedBy(parentWait.pid, "ExternalCollaboration"); } finally { parentWait.release(); await parentWait.done; }
    const results = await Promise.all(races), wins = results.filter(result => result.value !== null), failures = results.filter(result => result.error !== null);
    expect(wins.length).toBe(1); expect(failures.map(result => result.error)).toEqual([{ code: "STALE_VERSION", status: 409 }]);
    current = wins[0]!.value!; expect(current.revision).toBe(2);
    let after = await records(f.user.id);
    expect(after.commands.length).toBe(before.commands.length + 1); expect(after.audits.length).toBe(before.audits.length + 1); expect(after.events.length).toBe(before.events.length + 1);
    before = after; const same = currentInput(current, "SET_STATUS", { status: "PLANNED" }, key().toUpperCase());
    const both = await Promise.all([c.executeExternalCollaborationCommand(f.actor, structuredClone(same)), c.executeExternalCollaborationCommand(f.actor, structuredClone(same))]);
    expect(both.map(result => result.replayed).sort()).toEqual([false, true]); expect(both.every(result => result.revision === 3)).toBe(true);
    const receipts = both.map(({ replayed: _flag, ...receipt }) => { void _flag; return receipt; });
    expect(canonicalHash(receipts[0])).toBe(canonicalHash(receipts[1])); current = both[0]!;
    after = await records(f.user.id); expect(after.commands.length).toBe(before.commands.length + 1);
    expect(after.audits.length).toBe(before.audits.length + 1); expect(after.events.length).toBe(before.events.length + 1);

    const originalJournal = after.commands.find(value => value.operationKey === create.operationKey)!;
    const journalExpiry = new Date(Date.now() + 2000);
    await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: journalExpiry } });
    const beforeJournal = await image(f.user.id), journal = await hold("ExternalCollaborationCommand", originalJournal.id);
    const replay = outcome(() => c.executeExternalCollaborationCommand(f.actor, structuredClone(create)));
    try { await blockedBy(journal.pid, "ExternalCollaborationCommand"); await expireAtRealClock(journalExpiry); }
    finally { journal.release(); await journal.done; }
    expect(await replay).toEqual(denied("UNAUTHENTICATED", 401)); expect(await image(f.user.id)).toBe(beforeJournal);
    f.actor = await signed(f.user.id); // Fresh native session, not an injected clock or borrowed identity.
    const pendingBody = currentInput(current, "SAVE_DETAILS", { details: { ...details(), notes: { text: words + " must roll back", language: "ar" } } });
    const expiresAt = new Date(Date.now() + 2000); await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt } });
    const beforeExpiry = await image(f.user.id), blocked = await blockEvent(f.user.id, pendingBody.operationKey, current.collaborationId), observed = observe();
    const tentative = outcome(() => c.executeExternalCollaborationCommand(f.actor, pendingBody, { client: observed.db }));
    try {
      await blockedBy(blocked.pid, "OutboxEvent");
      expect(observed.queries.some(query => /\bINSERT\b/i.test(query) && /"ExternalCollaborationCommand"/.test(query))).toBe(true);
      expect(observed.queries.some(query => /\bINSERT\b/i.test(query) && /"AdminAudit"/.test(query))).toBe(true);
      await expireAtRealClock(expiresAt);
    } finally { blocked.release(); await blocked.done; }
    expect(await tentative).toEqual(denied("UNAUTHENTICATED", 401)); expect(await image(f.user.id)).toBe(beforeExpiry);
    f.actor = await signed(f.user.id);

    // Actual owned native metadata, deliberately no usable bytes: detail keeps
    // labels after deletion and REMOVE does only the native tombstone/touch.
    const assetId = "m12asset*" + key(); assets.add(assetId);
    const file = await prisma.privateAsset.create({ data: { id: assetId, ownerUserId: f.user.id, purpose: EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE,
      contentType: "application/pdf", size: 1, storageKey: "owned-no-bytes/" + key(), checksum: "b".repeat(64) } });
    const bindingId = "m12binding*" + key(), label = { text: " Original retained unavailable-file label ", language: null };
    await prisma.externalCollaborationAttachment.create({ data: { id: bindingId, collaborationId: current.collaborationId, ownerUserId: f.user.id,
      assetId: file.id, assetPurpose: EXTERNAL_COLLABORATION_ATTACHMENT_PURPOSE, label, attachedAt: new Date() } });
    await prisma.privateAsset.update({ where: { id: file.id }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
    const withLostBytes = await c.getExternalCollaboration(f.actor, { collaborationId: current.collaborationId });
    expect(withLostBytes.attachments.length).toBe(1); expect(canonicalHash(withLostBytes.attachments[0]!.label)).toBe(canonicalHash(label));
    expect(withLostBytes.attachments[0]!.assetRevision).toBe(2); expect(JSON.stringify(withLostBytes).includes(file.storageKey)).toBe(false);
    expect(JSON.stringify(withLostBytes).includes(file.checksum)).toBe(false);
    current = { ...current, revision: withLostBytes.collaboration.revision };
    const removal = currentInput(current, "REMOVE_ATTACHMENT", { attachmentId: bindingId });
    current = await write(c, f, removal); expect(current.revision).toBe(withLostBytes.collaboration.revision + 1);
    expect((await prisma.externalCollaborationAttachment.findUniqueOrThrow({ where: { id: bindingId } })).removedAt !== null).toBe(true);
    expect((await prisma.privateAsset.findUniqueOrThrow({ where: { id: file.id } })).storageKey === file.storageKey).toBe(true);
    current = await write(c, f, currentInput(current, "ARCHIVE", {})); const beforeRemovedReplay = await image(f.user.id);
    const removedReplay = await c.executeExternalCollaborationCommand(f.actor, removal); expect(removedReplay.replayed).toBe(true);
    expect(removedReplay.revision).toBe(current.revision - 1); expect(await image(f.user.id)).toBe(beforeRemovedReplay);

    const pageOwner = await fixture(), pageTag = key().replaceAll("-", ""),
      ids = Array.from({ length: 31 }, (_, index) => (index % 2 ? "a" : "A") + "*m12page" + pageTag + String(index).padStart(2, "0"));
    await prisma.$transaction(async tx => {
      for (const id of ids) { parentIds.add(id); const timestamp = new Date();
        await tx.externalCollaboration.create({ data: { id, ownerUserId: pageOwner.user.id, revision: 1, status: "DRAFT", archived: false,
          detailsJson: details() as Prisma.InputJsonValue, createdAt: timestamp, updatedAt: timestamp } }); }
    });
    const listing = observe(), ordered = [...ids].sort();
    const first = await c.listExternalCollaborations(pageOwner.actor, { archived: false }, { client: listing.db });
    expect(first.collaborations.map(value => value.id)).toEqual(ordered.slice(0, 30)); expect(first.nextCursor).toBe(ordered[29]);
    const second = await c.listExternalCollaborations(pageOwner.actor, { archived: false, after: first.nextCursor! }, { client: listing.db });
    expect(second.collaborations.map(value => value.id)).toEqual([ordered[30]]); expect(second.nextCursor).toBeNull();
    const empty = await c.listExternalCollaborations(pageOwner.actor, { archived: false, after: ordered.at(-1)! }, { client: listing.db });
    expect(empty.collaborations.length).toBe(0); expect(empty.nextCursor).toBeNull();
    expect(await outcome(() => c.listExternalCollaborations(pageOwner.actor,
      { archived: false, after: "~".repeat(200) }, { client: listing.db }))).toEqual(denied("NOT_FOUND", 404));
    expect(first.collaborations.every(value => value.attachmentCount === 0 && value.checklist.total === 1 && value.checklist.done === 0)).toBe(true);
    expect(includesOriginal(first, details().notes!.text)).toBe(false); expect(includesOriginal(first, details().brief!.text)).toBe(false);
    const selects = listing.queries.filter(query => /\bSELECT\b/i.test(query));
    expect(selects.some(query => /"PrivateAsset"|"label"/.test(query))).toBe(false);
    expect(selects.some(query => /"ExternalCollaboration"/.test(query) && /(?:'notes'|'brief'|"detailsJson"\s*(?:,|FROM))/i.test(query))).toBe(false);
    const reads = await prisma.adminAudit.findMany({ where: { actorUserId: pageOwner.user.id } });
    expect(reads.length).toBe(3); expect(reads.every(value => value.action === "external_collaboration.list" && value.resourceType === "ExternalCollaborationList")).toBe(true);
    expect(includesOriginal(reads.map(value => value.snapshot), words)).toBe(false);
  }, 15000);
});
