// S1a candidate, exactly three native groups; root alone adopts/runs.
// Actual native sessions, accepted memberships/delegations, SQL guards and waits.
// Scope fixtures prove authorization plumbing, never live consent/provider access.
import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { type ClientCapabilities } from "@/lib/organizations/contracts";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation, proposeMember, setClientGrant } from "@/lib/organizations/service";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { clientAuthorityInternals, type ClientPlanningAuthorityProof } from "@/lib/organizations/authority";
import { brandContextScopeInternals, type BrandContextPlanningProof } from "@/lib/brand-context/scope";
import { type PlanningScope } from "@/lib/brand-context/contracts";
import { beginPlanningCall } from "@/lib/campaign-planning/scope";
import { createAiBudgetLedger, readAiPlanningNativeFrame, type AiPlanningNativeFrame } from "@/lib/ai-budget/ledger";

const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), peers = new Set<PrismaClient>();
const privateWords = "synthetic-private-brand-name-and-content-scope-canary";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function capabilities(plan = true, view = true): ClientCapabilities {
  return { plan, view, approveShortlist: false, reviewContent: false, signCustomer: false, financial: false, manageGrants: false };
}
async function actor() {
  const userId = randomUUID(); users.add(userId);
  const user = await prisma.user.create({ data: { id: userId, role: "BRAND", active: true, isTest: true, name: "Synthetic native scope actor",
    email: userId + "@example.invalid", passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 1000) } });
  const token = await openSession(user.id, user.sessionVersion, user.passwordHash), resolved = await resolveSession(token);
  if (!resolved) throw new Error("Owned actual scope session failed to resolve");
  return { userId, token, actor: captureOrganizationActor(resolved) };
}
type Actor = Awaited<ReturnType<typeof actor>>;
async function business() {
  const own = await actor();
  const brand = await prisma.brand.create({ data: { userId: own.userId, slug: "scope-" + randomUUID(), name: privateWords,
    description: privateWords, profileFacts: { syntheticPrivate: privateWords }, isTest: true } }); brands.add(brand.id);
  return { ...own, brand };
}
async function orgRevision(id: string) { return (await prisma.organization.findUniqueOrThrow({ where: { id }, select: { revision: true } })).revision; }
async function prepared(granted = capabilities()) {
  const owner = await actor(), customer = await business(), seat = await actor();
  const organization = (await createOrganization(owner.actor, { operationKey: randomUUID(), nameOriginal: "وكالة اختبار أصلية", kind: "AGENCY" })).organization;
  organizations.add(organization.id);
  const proposedMember = (await proposeMember(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(organization.id), targetUserId: seat.userId })).membership;
  const membership = (await acceptMembership(seat.actor, proposedMember.id, { operationKey: randomUUID(), expectedRevision: proposedMember.revision })).membership;
  const proposedClient = (await proposeClientAssociation(owner.actor, organization.id, { operationKey: randomUUID(), expectedOrganizationRevision: await orgRevision(organization.id), brandId: customer.brand.id })).client;
  const client = (await authorizeClientAssociation(customer.actor, proposedClient.id, { operationKey: randomUUID(), expectedRevision: proposedClient.revision, capabilities: capabilities() })).client;
  const grant = (await setClientGrant(customer.actor, client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: granted })).grant;
  return { owner, customer, seat, organization, membership, client, grant };
}
type Fixture = Awaited<ReturnType<typeof prepared>>;
async function updateGrant(f: Fixture, granted: ClientCapabilities) {
  const client = await prisma.organizationClient.findUniqueOrThrow({ where: { id: f.client.id }, select: { revision: true } });
  const grant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.grant.id }, select: { revision: true } });
  await setClientGrant(f.customer.actor, f.client.id, { operationKey: randomUUID(), expectedClientRevision: client.revision,
    membershipId: f.membership.id, expectedGrantRevision: grant.revision, capabilities: granted });
}
async function updateDelegation(f: Fixture, allowed: ClientCapabilities) {
  const client = await prisma.organizationClient.findUniqueOrThrow({ where: { id: f.client.id }, select: { revision: true } });
  await authorizeClientAssociation(f.customer.actor, f.client.id, { operationKey: randomUUID(), expectedRevision: client.revision, capabilities: allowed });
}
function observedDb() {
  const queries: string[] = [], userLocks: string[] = [];
  const db = new PrismaClient({ log: [{ level: "query", emit: "event" }] }); peers.add(db);
  db.$on("query", event => {
    queries.push(event.query); // SQL shapes only; never log or retain other params.
    if (/\bFROM\s+"User"(?:\s|$)/.test(event.query) && /FOR\s+(?:UPDATE|SHARE)/.test(event.query)) {
      const values: unknown = JSON.parse(event.params);
      if (Array.isArray(values)) for (const value of values) if (typeof value === "string") userLocks.push(value);
    }
  });
  return { db, queries, userLocks, clear: () => { queries.length = 0; userLocks.length = 0; } };
}
type Observer = ReturnType<typeof observedDb>;
function service(db: PrismaClient = prisma) { return createAiBudgetLedger({ client: db, caps: { userDailyMicros: "1000000", platformDailyMicros: "1000000000" } }); }
function thin(observer: Observer) {
  expect(observer.queries.some(query => /\bSELECT\b/.test(query) && query.includes('"Brand"') && query.includes('"name"'))).toBe(false);
}
function privateSafe(value: unknown, actors: readonly Actor[]) {
  const encoded = JSON.stringify(value);
  for (const word of [privateWords, ...actors.flatMap(f => [f.token, f.actor.sessionId])]) expect(encoded.includes(word)).toBe(false);
  for (const field of ["executionToken", "sessionId", "name", "description", "profileFacts", "input"]) expect(encoded.includes('"' + field + '"')).toBe(false);
}
const scopeMissing = { accepted: false, code: "NOT_FOUND", status: 404 };
const scopeUnavailable = { accepted: false, code: "SCOPE_PROOF_UNAVAILABLE", status: 503 };
const baseUnavailable = { accepted: false, code: "PLANNING_FRAME_UNAVAILABLE", status: 503 };
const retry = { accepted: false, code: "RETRY_REQUIRED", status: 503 };
const unauthorized = { accepted: false, code: "UNAUTHENTICATED", status: 401 };
async function observe(work: () => Promise<unknown>) {
  try { await work(); return { accepted: true, code: "ACCEPTED", status: 200 }; }
  catch (error) { const safe = error as { code?: string; status?: number }; return { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; }
}
function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() }; }
async function heldRow(table: "User" | "Brand" | "ClientGrant" | "OrganizationClient", id: string, mutation: (tx: Prisma.TransactionClient) => Promise<void> = async () => {}) {
  const db = new PrismaClient(); peers.add(db); const ready = latch(), release = latch(); let pid = 0;
  const done = db.$transaction(async tx => {
    pid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`)[0]!.pid;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    ready.release(); await release.promise; await mutation(tx);
  }, { maxWait: 10000, timeout: 15000 }); void done.catch(() => {}); await ready.promise;
  return { pid, release: release.release, done };
}
async function blockedBy(pid: number, table: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT a.pid::int AS pid FROM pg_stat_activity a WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE ${'%"' + table + '"%'}`;
    if (rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Native scope did not reach required actual PostgreSQL wait");
}
async function closedBrand(frame: AiPlanningNativeFrame, proof: BrandContextPlanningProof) {
  expect(await observe(() => brandContextScopeInternals.readPlanningProof(frame, proof))).toEqual(baseUnavailable);
  expect(await observe(() => brandContextScopeInternals.recheckPlanningProof(frame, proof))).toEqual(baseUnavailable);
}
async function captureBrand(own: Actor, scope: PlanningScope, observer: Observer) {
  const call = await beginPlanningCall(own.actor, { client: observer.db });
  const capture = await brandContextScopeInternals.capturePlanningIdentity(call, scope);
  return { call, capture };
}
async function boundClient(f: Fixture, observer: Observer) {
  const { call, capture } = await captureBrand(f.seat, { kind: "CLIENT", clientId: f.client.id }, observer);
  const ledger = service(observer.db);
  return ledger.withPlanningActorTransaction(f.seat.actor, async () => ({ ownerIds: capture.ownerIds, reviewerIds: [] }), async frame => {
    const proof = await brandContextScopeInternals.bindPlanningInFrame(frame, capture, call.checkpoint);
    const view = await brandContextScopeInternals.readPlanningProof(frame, proof); privateSafe(view, [f.owner, f.customer, f.seat]);
    await brandContextScopeInternals.recheckPlanningProof(frame, proof); return view;
  });
}
async function image(f: Fixture) {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id }, select: { id: true, userId: true, description: true } });
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: f.organization.id }, select: { id: true, ownerUserId: true, revision: true, active: true } });
  const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
  const client = await prisma.organizationClient.findUniqueOrThrow({ where: { id: f.client.id } });
  const grant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.grant.id } });
  return sha(JSON.stringify({ brand, organization, membership, client, grant }));
}
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Native scope fixtures require guarded target");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Native scope disposable identity mismatch");
});
afterEach(async () => {
  const owned = [...users], orgs = [...organizations];
  const reservations = await prisma.aiReservation.findMany({ where: { userId: { in: owned } }, select: { id: true, status: true } });
  if (reservations.some(row => row.status === "RUNNING" || row.status === "UNKNOWN")) throw new Error("Scope fixture unexpectedly retained an execution claim");
  for (const row of reservations) if (row.status === "RESERVED") {
    const user = await prisma.aiReservation.findUniqueOrThrow({ where: { id: row.id }, select: { userId: true } });
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    const token = await openSession(saved.id, saved.sessionVersion, saved.passwordHash), session = await resolveSession(token);
    if (!session) throw new Error("Owned scope cleanup session failed");
    await service().releaseUnclaimed(captureOrganizationActor(session), row.id);
  }
  await prisma.outboxEvent.deleteMany({ where: { OR: owned.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: owned } } });
  await prisma.aiReservation.deleteMany({ where: { userId: { in: owned } } });
  await prisma.organizationCommand.deleteMany({ where: { OR: [{ actorUserId: { in: owned } }, { organizationId: { in: orgs } }] } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: owned } } });
  await prisma.user.deleteMany({ where: { id: { in: owned } } }); users.clear(); brands.clear(); organizations.clear();
  for (const db of peers) await db.$disconnect(); peers.clear();
});

describe("S1a native scope proofs in the existing accounting frame", () => {
  it("binds actual OWN and accepted CLIENT plan plus view, rejects one-sided rights and isolates proof/capture/frame identities", async () => {
    const own = await business(), observer = observedDb(), ledger = service(observer.db), ownScope = { kind: "OWN_BRAND" as const, brandId: own.brand.id };
    expect((await resolveSession(own.token))?.userId).toBe(own.userId);
    // First meaningful missing-method RED has a genuine current OWN fixture.
    const { call, capture } = await captureBrand(own, ownScope, observer); thin(observer);
    expect(capture.actor.sessionId === own.actor.sessionId).toBe(true); expect(capture.ownerIds).toEqual([own.userId]);
    let oldFrame!: AiPlanningNativeFrame, ownProof!: BrandContextPlanningProof;
    const ownResult = await ledger.withPlanningActorTransaction(own.actor, async () => ({ ownerIds: capture.ownerIds, reviewerIds: [] }), async frame => {
      oldFrame = frame; ownProof = await brandContextScopeInternals.bindPlanningInFrame(frame, capture, call.checkpoint);
      const view = await brandContextScopeInternals.readPlanningProof(frame, ownProof); privateSafe(view, [own]);
      expect(view).toEqual({ scope: ownScope, brandId: own.brand.id, organizationId: null, clientId: null, currentAuthority: null, viewAuthority: null,
        targetOwnerUserId: own.userId, targetOwnerSessionVersion: own.actor.sessionVersion, currentClientRevision: null });
      expect(Object.isFrozen(view) && Object.isFrozen(view.scope)).toBe(true);
      for (const forged of [{}, { ...ownProof }, view]) expect(await observe(() => brandContextScopeInternals.readPlanningProof(frame, forged as unknown as BrandContextPlanningProof))).toEqual(scopeUnavailable);
      await brandContextScopeInternals.recheckPlanningProof(frame, ownProof); return { ownerBound: true };
    });
    expect(ownResult.executionClaim === null).toBe(true); privateSafe(ownResult.value, [own]); thin(observer); await closedBrand(oldFrame, ownProof);
    const alternate = await actor(); observer.clear();
    await ledger.withPlanningActorTransaction(own.actor, async () => ({ ownerIds: capture.ownerIds, reviewerIds: [] }), async frame => {
      expect(await observe(() => brandContextScopeInternals.readPlanningProof(frame, ownProof))).toEqual(scopeUnavailable);
      expect(await observe(() => brandContextScopeInternals.bindPlanningInFrame(frame, { ...capture, actor: alternate.actor }, call.checkpoint))).toEqual(scopeUnavailable);
      return true;
    }); expect(observer.queries.some(query => query.includes('"Brand"'))).toBe(false);
    const invalid = await actor(); await prisma.authSession.update({ where: { id: invalid.actor.sessionId }, data: { revokedAt: new Date() } });
    expect(await observe(() => ledger.withPlanningActorTransaction(invalid.actor, async () => ({ ownerIds: [], reviewerIds: [] }), async frame => brandContextScopeInternals.bindPlanningInFrame(frame, capture, call.checkpoint)))).toEqual(unauthorized);

    const f = await prepared(capabilities(true, false));
    for (const granted of [capabilities(true, false), capabilities(false, true)]) {
      await updateGrant(f, granted); observer.clear(); expect(await observe(() => boundClient(f, observer))).toEqual(scopeMissing); thin(observer);
    }
    await updateGrant(f, capabilities());
    for (const allowed of [capabilities(true, false), capabilities(false, true)]) {
      await updateDelegation(f, allowed); observer.clear(); expect(await observe(() => boundClient(f, observer))).toEqual(scopeMissing); thin(observer);
    }
    await updateDelegation(f, capabilities());
    const plan = await getClientAuthority(f.seat.actor, f.client.id, "plan"), view = await getClientAuthority(f.seat.actor, f.client.id, "view");
    observer.clear(); const clientCall = await beginPlanningCall(f.seat.actor, { client: observer.db });
    const clientCapture = await clientAuthorityInternals.capturePlanningIdentity(clientCall, f.client.id);
    let clientFrame!: AiPlanningNativeFrame, clientProof!: ClientPlanningAuthorityProof;
    const clientResult = await ledger.withPlanningActorTransaction(f.seat.actor, async () => ({ ownerIds: clientCapture.ownerIds, reviewerIds: [] }), async frame => {
      clientFrame = frame; clientProof = await clientAuthorityInternals.bindPlanningInFrame(frame, clientCapture, clientCall.checkpoint);
      const current = await clientAuthorityInternals.readPlanningProof(frame, clientProof); privateSafe(current, [f.owner, f.customer, f.seat]);
      expect(current).toEqual({ clientId: f.client.id, organizationId: f.organization.id, brandId: f.customer.brand.id, planAuthority: plan, viewAuthority: view,
        targetOwnerUserId: f.customer.userId, targetOwnerSessionVersion: f.customer.actor.sessionVersion, currentClientRevision: plan.clientRevision });
      expect(Object.isFrozen(current) && Object.isFrozen(current.planAuthority) && Object.isFrozen(current.viewAuthority)).toBe(true);
      expect(await observe(() => clientAuthorityInternals.readPlanningProof(frame, { ...clientProof } as ClientPlanningAuthorityProof))).toEqual(scopeUnavailable);
      await clientAuthorityInternals.recheckPlanningProof(frame, clientProof); return { clientBound: true };
    });
    expect(clientResult.executionClaim === null).toBe(true); thin(observer);
    expect(await observe(() => clientAuthorityInternals.readPlanningProof(clientFrame, clientProof))).toEqual(baseUnavailable);
    await ledger.withPlanningActorTransaction(f.seat.actor, async () => ({ ownerIds: clientCapture.ownerIds, reviewerIds: [] }), async frame => {
      expect(await observe(() => clientAuthorityInternals.readPlanningProof(frame, clientProof))).toEqual(scopeUnavailable); return true;
    });
    observer.clear(); const both = await boundClient(f, observer); expect(both.executionClaim === null).toBe(true); thin(observer);
    privateSafe(both.value, [f.owner, f.customer, f.seat]); expect(both.value.currentAuthority).toEqual(plan); expect(both.value.viewAuthority).toEqual(view);
  }, 60000);

  it("rejects a committed owner change across an actual User wait without late owner locks or private Brand hydration", async () => {
      const f = await prepared(), observer = observedDb(), ledger = service(observer.db), replacement = await actor();
      const { call, capture } = await captureBrand(f.seat, { kind: "CLIENT", clientId: f.client.id }, observer);
      const held = await heldRow("User", f.customer.userId, async tx => {
        await tx.brand.update({ where: { id: f.customer.brand.id }, data: { userId: replacement.userId } });
      }); observer.clear(); let hydration = 0, pending: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
      try {
        pending = observe(() => ledger.withPlanningActorTransaction(f.seat.actor, async () => ({ ownerIds: capture.ownerIds, reviewerIds: [f.customer.userId] }), async frame => {
          const proof = await brandContextScopeInternals.bindPlanningInFrame(frame, capture, call.checkpoint);
          await brandContextScopeInternals.readPlanningProof(frame, proof); hydration++; return true;
        }));
        await blockedBy(held.pid, "User"); held.release(); await held.done;
        expect(await pending).toEqual(retry); expect(hydration).toBe(0); thin(observer);
        expect(observer.userLocks.includes(f.customer.userId)).toBe(true); expect(observer.userLocks.includes(replacement.userId)).toBe(false);
      } finally { held.release(); await held.done; await pending; }
    const successful = await prepared(), overlapObserver = observedDb(), overlap = await captureBrand(successful.seat, { kind: "CLIENT", clientId: successful.client.id }, overlapObserver);
    const success = await service(overlapObserver.db).withPlanningActorTransaction(successful.seat.actor,
      async () => ({ ownerIds: overlap.capture.ownerIds, reviewerIds: [successful.customer.userId] }), async frame => {
        const base = await readAiPlanningNativeFrame(frame);
        expect(base.ownerIds.includes(successful.customer.userId)).toBe(true); expect(base.reviewerIds.includes(successful.customer.userId)).toBe(false);
        const proof = await brandContextScopeInternals.bindPlanningInFrame(frame, overlap.capture, overlap.call.checkpoint);
        await brandContextScopeInternals.recheckPlanningProof(frame, proof); return true;
      }); expect(success.executionClaim === null).toBe(true); thin(overlapObserver);
  }, 60000);

  it("rechecks original held rows without relocking, rolls back changed scope and owned work, and denies real expiry and closed proofs", async () => {
    const f = await prepared(), replacement = await actor(), observer = observedDb(), ledger = service(observer.db), original = await image(f);
    for (const mode of ["OWNER", "GRANT"] as const) {
      const { call, capture } = await captureBrand(f.seat, { kind: "CLIENT", clientId: f.client.id }, observer);
      let frameSaved!: AiPlanningNativeFrame, proofSaved!: BrandContextPlanningProof, changed = false, recheckFailure: Awaited<ReturnType<typeof observe>> | undefined;
      const outcome = await observe(() => ledger.withPlanningActorTransaction(f.seat.actor,
        async () => ({ ownerIds: [...capture.ownerIds, replacement.userId], reviewerIds: [] }), async frame => {
          frameSaved = frame; proofSaved = await brandContextScopeInternals.bindPlanningInFrame(frame, capture, call.checkpoint);
          const base = await readAiPlanningNativeFrame(frame);
          await base.tx.brand.update({ where: { id: f.customer.brand.id }, data: { description: "Synthetic work requiring final scope recheck" } });
          if (mode === "OWNER") await base.tx.brand.update({ where: { id: f.customer.brand.id }, data: { userId: replacement.userId } });
          if (mode === "GRANT") await base.tx.clientGrant.update({ where: { id: f.grant.id }, data: { view: false, revision: { increment: 1 } } });
          changed = true; observer.clear();
          try { await brandContextScopeInternals.recheckPlanningProof(frame, proofSaved); }
          catch (error) { const safe = error as { code?: string; status?: number }; recheckFailure = { accepted: false, code: safe.code ?? "OTHER_ERROR", status: safe.status ?? 0 }; throw error; }
          return true;
        }));
      expect(changed).toBe(true); expect(recheckFailure).toEqual(retry); expect(outcome).toEqual(retry);
      expect(observer.queries.some(query => /FOR\s+(?:UPDATE|SHARE)|pg_advisory_xact_lock/.test(query))).toBe(false);
      expect(await image(f)).toBe(original); await closedBrand(frameSaved, proofSaved);
    }
    const own = await business(), { call, capture } = await captureBrand(own, { kind: "OWN_BRAND", brandId: own.brand.id }, observer);
    const before = sha((await prisma.user.findUniqueOrThrow({ where: { id: own.userId }, select: { name: true } })).name);
    const held = await heldRow("Brand", own.brand.id); let waiting: Promise<Awaited<ReturnType<typeof observe>>> | undefined;
    try {
      const expiresAt = new Date(Date.now() + 3000); await prisma.authSession.update({ where: { id: own.actor.sessionId }, data: { expiresAt } });
      observer.clear(); waiting = observe(() => ledger.withPlanningActorTransaction(own.actor, async () => ({ ownerIds: capture.ownerIds, reviewerIds: [] }), async frame => {
        const base = await readAiPlanningNativeFrame(frame); await base.tx.user.update({ where: { id: own.userId }, data: { name: "Synthetic expiry rollback witness" } });
        await brandContextScopeInternals.bindPlanningInFrame(frame, capture, call.checkpoint); return true;
      }));
      await blockedBy(held.pid, "Brand"); expect(Date.now() < expiresAt.getTime()).toBe(true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 40)));
      held.release(); await held.done; expect(await waiting).toEqual(unauthorized);
      expect(sha((await prisma.user.findUniqueOrThrow({ where: { id: own.userId }, select: { name: true } })).name)).toBe(before);
      expect(await resolveSession(own.token) === null).toBe(true); thin(observer);
    } finally { held.release(); await held.done; await waiting; }
  }, 60000);
});
