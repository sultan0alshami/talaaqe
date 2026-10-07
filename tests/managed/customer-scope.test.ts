// Exactly two native groups; root owns guarded execution and suite integration.
// Independently authored failures preceded implementation. All records below are
// synthetic task-local fixtures, not commercial/legal/provider acceptance.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { canonicalHash, inputJson } from "@/lib/onboarding/drafts";
import type { OrganizationActor, OrganizationTransaction } from "@/lib/organizations/context";
import { OrganizationError, type ClientAuthorityDTO, type ClientCapabilities } from "@/lib/organizations/contracts";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { acceptMembership, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, setClientGrant } from "@/lib/organizations/service";
import { executeBrandContextCommand } from "@/lib/brand-context/service";
import { BrandContextContentSchema, type PlanningScope } from "@/lib/brand-context/contracts";
import { withManagedCustomerScope } from "@/lib/managed/customer-scope";

type Frame = { scope: PlanningScope; brandId: string; organizationId: string | null; clientId: string | null;
  workspaceId: string; currentAuthority: ClientAuthorityDTO | null; ownerIds: ReadonlySet<string> };
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>();
const key = () => randomUUID();
const canary = "synthetic-private-M04-prerequisite-content";
const action = "synthetic.managed_customer_scope";
const all: ClientCapabilities = { view: true, plan: true, approveShortlist: true, reviewContent: true,
  signCustomer: true, financial: true, manageGrants: true };
const none: ClientCapabilities = { view: false, plan: false, approveShortlist: false, reviewContent: false,
  signCustomer: false, financial: false, manageGrants: false };
const content = BrandContextContentSchema.parse({ schemaVersion: 1, positioning: { text: canary, language: "en" },
  values: [], tone: { text: null, language: null }, references: [], competitors: [] });

afterEach(async () => {
  if (brands.size) {
    const rows = await prisma.planningWorkspace.findMany({ where: { brandId: { in: [...brands] } }, select: { id: true } });
    if (rows.length) {
      const ids = rows.map(row => row.id);
      for (const table of ["PlanningReviewCommand", "BrandContextCommand", "CampaignPlanningCommand", "CampaignPlanningSubmission", "CampaignBriefProvenance",
        "CampaignProposalDependency", "CampaignPlanningState", "CampaignContextSelection", "CampaignPlanningBinding", "BrandContextVersion", "BrandContextSubmission", "BrandContext"] as const) {
        await prisma.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "workspaceId" IN (${Prisma.join(ids)})`);
      }
      await prisma.$executeRaw(Prisma.sql`DELETE FROM "PlanningWorkspace" WHERE id IN (${Prisma.join(ids)})`);
    }
  }
  await prisma.organizationCommand.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.clientGrant.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationClient.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [...organizations] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(id => ({ payload: { path: ["actorUserId"], equals: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const values of [users, brands, organizations]) values.clear();
});
async function person(role: "BRAND" | "ADMIN" = "BRAND") {
  const id = key(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, active: true, isTest: true, name: "Synthetic M04 scope actor",
    email: `${id}@example.invalid`, passwordHash: "not-a-login", emailVerifiedAt: new Date(Date.now() - 60000) } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Native synthetic managed-scope session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  return { user, actor, token };
}
async function company() {
  const owner = await person(), brand = await prisma.brand.create({ data: { userId: owner.user.id,
    slug: "managed-scope-" + key().replace(/-/g, ""), name: "Synthetic original company", countryCode: "KW", isTest: true, description: canary } });
  brands.add(brand.id); return { ...owner, brand };
}
type Company = Awaited<ReturnType<typeof company>>;
const own = (f: Company): PlanningScope => ({ kind: "OWN_BRAND", brandId: f.brand.id });
async function orgRevision(id: string) { return (await prisma.organization.findUniqueOrThrow({ where: { id } })).revision; }
async function agency(customer: Company, label: string) {
  const owner = await person(), seat = await person();
  const { organization } = await createOrganization(owner.actor, { operationKey: key(), kind: "AGENCY", nameOriginal: "Synthetic agency " + label });
  organizations.add(organization.id);
  const proposal = await proposeClientAssociation(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await orgRevision(organization.id), brandId: customer.brand.id });
  const { client } = await authorizeClientAssociation(customer.actor, proposal.client.id, { operationKey: key(), expectedRevision: proposal.client.revision, capabilities: all });
  const pending = await proposeMember(owner.actor, organization.id, { operationKey: key(), expectedOrganizationRevision: await orgRevision(organization.id), targetUserId: seat.user.id });
  const { membership } = await acceptMembership(seat.actor, pending.membership.id, { operationKey: key(), expectedRevision: pending.membership.revision });
  const { grant } = await setClientGrant(owner.actor, client.id, { operationKey: key(), expectedClientRevision: client.revision,
    membershipId: membership.id, expectedGrantRevision: null, capabilities: all });
  return { owner, seat, organization, client, membership, grant, customer };
}
type Agency = Awaited<ReturnType<typeof agency>>;
const client = (f: Agency): PlanningScope => ({ kind: "CLIENT", clientId: f.client.id });
async function createWorkspace(actor: OrganizationActor, scope: PlanningScope) {
  const expectedAuthority = scope.kind === "CLIENT" ? await getClientAuthority(actor, scope.clientId, "plan") : undefined;
  const result = await executeBrandContextCommand(actor, { operationKey: key(), scope, ...(expectedAuthority ? { expectedAuthority } : {}),
    action: "CREATE", expectedRevision: 0, payload: { nameOriginal: { text: "Synthetic native M03 prerequisite", language: "en" }, content } });
  if (!result.contextId) throw new Error("Native context command did not create its actual workspace");
  return (await prisma.brandContext.findUniqueOrThrow({ where: { id: result.contextId } })).workspaceId;
}
async function fixture() {
  const customer = await company(), other = await company(), a = await agency(customer, "A"), b = await agency(customer, "B");
  const ownWorkspace = await createWorkspace(customer.actor, own(customer));
  const aWorkspace = await createWorkspace(a.seat.actor, client(a)), bWorkspace = await createWorkspace(b.seat.actor, client(b));
  expect(new Set([ownWorkspace, aWorkspace, bWorkspace]).size).toBe(3);
  return { customer, other, a, b, ownWorkspace, aWorkspace, bWorkspace };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function rights(f: Agency, capabilities: ClientCapabilities) {
  const currentClient = await prisma.organizationClient.findUniqueOrThrow({ where: { id: f.client.id } });
  const currentGrant = await prisma.clientGrant.findUniqueOrThrow({ where: { id: f.grant.id } });
  return setClientGrant(f.owner.actor, f.client.id, { operationKey: key(), expectedClientRevision: currentClient.revision,
    membershipId: f.membership.id, expectedGrantRevision: currentGrant.revision, capabilities });
}
async function failure(operation: Promise<unknown>, code: string, status: number) {
  await expect(operation).rejects.toMatchObject({ code, status });
}
function probe() {
  const calls = { replay: 0, execute: 0 };
  return { calls, read: { write: false as const, execute: async (_tx: OrganizationTransaction, frame: Frame) => { calls.execute++; return frame; } },
    write: (expectedAuthority?: ClientAuthorityDTO) => ({ write: true as const, ...(expectedAuthority ? { expectedAuthority } : {}),
      replay: async (): Promise<{ found: false }> => { calls.replay++; return { found: false }; },
      execute: async (_tx: OrganizationTransaction, frame: Frame) => { calls.execute++; return frame; } }) };
}
async function effects(f: Fixture) {
  const [brand, commands, audits, events] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: f.customer.brand.id }, select: { description: true } }),
    prisma.organizationCommand.findMany({ where: { resourceType: "SyntheticManagedScope", actorUserId: f.a.seat.user.id }, orderBy: { id: "asc" } }),
    prisma.adminAudit.findMany({ where: { actorUserId: f.a.seat.user.id, action }, orderBy: { id: "asc" } }),
    prisma.outboxEvent.findMany({ where: { type: action, payload: { path: ["actorUserId"], equals: f.a.seat.user.id } }, orderBy: { id: "asc" } }),
  ]); return JSON.stringify({ brand, commands, audits, events });
}
type WorkResult = { workspaceId: string; value: string };
function work(f: Fixture, expectedAuthority: ClientAuthorityDTO, operationKey = key(), value = "synthetic native transaction witness") {
  const calls = { replay: 0, execute: 0 }, payloadHash = canonicalHash({ purpose: action, operationKey, value, expectedAuthority });
  const operation = { write: true as const, expectedAuthority,
    replay: async (tx: OrganizationTransaction, frame: Frame): Promise<{ found: false } | { found: true; result: WorkResult }> => {
      calls.replay++; expect(frame.workspaceId).toBe(f.aWorkspace); expect(frame.currentAuthority?.capability).toBe("signCustomer");
      const saved = await tx.organizationCommand.findUnique({ where: { actorUserId_operationKey: { actorUserId: f.a.seat.user.id, operationKey } } });
      if (!saved) return { found: false };
      if (saved.payloadHash !== payloadHash || saved.resourceType !== "SyntheticManagedScope" || saved.resourceId !== frame.workspaceId
        || saved.organizationId !== frame.organizationId) throw new OrganizationError("IDEMPOTENCY_CONFLICT");
      return { found: true, result: saved.result as WorkResult };
    },
    execute: async (tx: OrganizationTransaction, frame: Frame): Promise<WorkResult> => {
      calls.execute++; expect(frame.workspaceId).toBe(f.aWorkspace); expect(frame.organizationId).toBe(f.a.organization.id);
      // Existing Brand.description and OrganizationCommand are synthetic DB-only
      // witnesses, not managed order storage, commercial signatures or new APIs.
      await tx.brand.update({ where: { id: frame.brandId }, data: { description: value } });
      const result = { workspaceId: frame.workspaceId, value };
      const receipt = await tx.organizationCommand.create({ data: { actorUserId: f.a.seat.user.id, operationKey, payloadHash,
        organizationId: frame.organizationId!, resourceType: "SyntheticManagedScope", resourceId: frame.workspaceId, result: inputJson(result) } });
      await tx.adminAudit.create({ data: { actorUserId: f.a.seat.user.id, action, resourceType: "SyntheticManagedScope", resourceId: frame.workspaceId,
        snapshot: { clientId: frame.clientId, workspaceId: frame.workspaceId } } });
      await tx.outboxEvent.create({ data: { deduplicationKey: "synthetic-managed-scope:" + receipt.id, type: action,
        payload: { actorUserId: f.a.seat.user.id, workspaceId: frame.workspaceId } } });
      return result;
    } };
  return { operationKey, calls, operation };
}
function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type WaitTable = "User" | "ClientGrant" | "OrganizationCommand";
async function hold(table: WaitTable, id: string | null, afterRelease?: (tx: OrganizationTransaction) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>(), stop = new AbortController();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='4s'`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    if (table === "OrganizationCommand") await tx.$executeRaw`LOCK TABLE "OrganizationCommand" IN SHARE MODE`;
    else await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id=${id} FOR UPDATE`);
    ready.resolve(rows[0]!.pid); await release.promise; if (afterRelease) await afterRelease(tx);
  }, { maxWait: 5000, timeout: 12000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Blocker completed before acquiring the native lock"); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  let waiting: Promise<number> | undefined;
  return { holding, release: () => release.resolve(), wait() {
    waiting = (async () => {
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        if (stop.signal.aborted) throw new Error("Native managed-scope wait witness cancelled");
        const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND ${pid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`}
          AND (${table} <> 'OrganizationCommand' OR query ILIKE '%INSERT%') ORDER BY pid`;
        if (rows.length) return rows[0]!.pid;
        await delay(20);
      } throw new Error("Managed customer callback did not reach the required actual native wait");
    })(); return waiting;
  }, async close() { release.resolve(); stop.abort(); await holding.catch(() => {}); await waiting?.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function witnessedWait(blocker: Awaited<ReturnType<typeof hold>>, operation: Promise<unknown>) {
  void operation.catch(() => {});
  expect(await Promise.race([blocker.wait(), operation.then(() => { throw new Error("Managed operation completed before its native wait"); })])).toBeGreaterThan(0);
}

it("M04 customer prerequisite group 1: exact existing OWN/CLIENT workspace and independent view/sign/shortlist/financial capabilities", async () => {
  const f = await fixture(), p = probe();
  const ownFrame = await withManagedCustomerScope(f.customer.actor, own(f.customer), "view", p.read);
  expect(ownFrame).toMatchObject({ scope: own(f.customer), brandId: f.customer.brand.id, organizationId: null, clientId: null,
    workspaceId: f.ownWorkspace, currentAuthority: null });
  expect(ownFrame.ownerIds.has(f.customer.user.id)).toBe(true);
  const aFrame = await withManagedCustomerScope(f.a.seat.actor, client(f.a), "view", p.read);
  const bFrame = await withManagedCustomerScope(f.b.seat.actor, client(f.b), "view", p.read);
  expect(aFrame).toMatchObject({ brandId: f.customer.brand.id, workspaceId: f.aWorkspace, organizationId: f.a.organization.id, clientId: f.a.client.id });
  expect(bFrame).toMatchObject({ brandId: f.customer.brand.id, workspaceId: f.bWorkspace, organizationId: f.b.organization.id, clientId: f.b.client.id });
  expect(Object.keys(aFrame).sort()).toEqual(["scope", "brandId", "organizationId", "clientId", "workspaceId", "currentAuthority", "ownerIds"].sort());
  expect(JSON.stringify(aFrame)).not.toContain(canary);
  const denied = probe();
  for (const [actor, scope] of [[f.a.seat.actor, client(f.b)], [f.a.owner.actor, client(f.a)], [f.customer.actor, client(f.a)],
    [f.a.seat.actor, own(f.customer)], [f.other.actor, own(f.customer)], [f.other.actor, own(f.other)]] as const) {
    await failure(withManagedCustomerScope(actor, scope, "view", denied.read), "NOT_FOUND", 404);
  }
  expect(denied.calls).toEqual({ replay: 0, execute: 0 }); // Fresh own Brand with no M03 workspace does not get created here.
  await rights(f.a, { ...none, view: true, plan: true });
  await withManagedCustomerScope(f.a.seat.actor, client(f.a), "view", p.read);
  for (const capability of ["signCustomer", "approveShortlist", "financial"] as const) {
    const expected = { ...await getClientAuthority(f.a.seat.actor, f.a.client.id, "plan"), capability };
    await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), capability, denied.write(expected)), "NOT_FOUND", 404);
  }
  await rights(f.a, { ...none, plan: true });
  await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), "view", denied.read), "NOT_FOUND", 404);
  await rights(f.a, { ...none, financial: true });
  const financial = await getClientAuthority(f.a.seat.actor, f.a.client.id, "financial");
  await withManagedCustomerScope(f.a.seat.actor, client(f.a), "financial", p.write(financial));
  await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", denied.write({ ...financial, capability: "signCustomer" })), "NOT_FOUND", 404);
  for (const capability of ["signCustomer", "approveShortlist"] as const) {
    await rights(f.a, { ...none, [capability]: true });
    const expected = await getClientAuthority(f.a.seat.actor, f.a.client.id, capability);
    const frame = await withManagedCustomerScope(f.a.seat.actor, client(f.a), capability, p.write(expected));
    expect(frame.workspaceId).toBe(f.aWorkspace); expect(frame.currentAuthority?.capability).toBe(capability);
    await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), "view", denied.read), "NOT_FOUND", 404);
  }
  await failure(withManagedCustomerScope(f.customer.actor, own(f.customer), "signCustomer", p.read), "VALIDATION", 422);
  await failure(withManagedCustomerScope(f.customer.actor, own(f.customer), "view", p.write()), "VALIDATION", 422);
  expect(denied.calls).toEqual({ replay: 0, execute: 0 });
  const ownWrite = await withManagedCustomerScope(f.customer.actor, own(f.customer), "signCustomer", p.write());
  expect(ownWrite.workspaceId).toBe(f.ownWorkspace);
}, 60000);

it("M04 customer prerequisite group 2: native grant/User waits, captured authority/replay and actual-clock final rollback", async () => {
  const f = await fixture(), expected = await getClientAuthority(f.a.seat.actor, f.a.client.id, "signCustomer"), w = work(f, expected);
  const first = await withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", w.operation);
  expect(w.calls).toEqual({ replay: 1, execute: 1 });
  await rights(f.a, all); // harmless new authority revisions do not repeat an exact historical command.
  const saved = await effects(f);
  expect(await withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", w.operation)).toEqual(first);
  expect(w.calls).toEqual({ replay: 2, execute: 1 }); expect(await effects(f)).toBe(saved);
  const changed = work(f, expected, w.operationKey, "changed original payload");
  await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", changed.operation), "IDEMPOTENCY_CONFLICT", 409);
  const stale = work(f, expected);
  await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", stale.operation), "STALE_VERSION", 409);
  expect(stale.calls).toEqual({ replay: 1, execute: 0 }); expect(await effects(f)).toBe(saved);
  const wrong = probe(), otherAuthority = await getClientAuthority(f.b.seat.actor, f.b.client.id, "signCustomer");
  await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", wrong.write(otherAuthority)), "STALE_VERSION", 409);
  expect(wrong.calls).toEqual({ replay: 0, execute: 0 });
  const admin = await person("ADMIN");
  await failure(withManagedCustomerScope(admin.actor, own(f.customer), "signCustomer", wrong.write()), "FORBIDDEN", 403);
  expect(wrong.calls).toEqual({ replay: 0, execute: 0 });

  // Capture mutable caller values before the helper's first native wait.
  const actorInput = { ...f.a.seat.actor }, scopeInput: PlanningScope = { kind: "CLIENT", clientId: f.a.client.id };
  const authorityInput = { ...await getClientAuthority(f.a.seat.actor, f.a.client.id, "signCustomer") }, captured = probe();
  const operationInput = captured.write(authorityInput), captureBlock = await hold("User", f.a.seat.user.id);
  const capturedCall = withManagedCustomerScope(actorInput, scopeInput, "signCustomer", operationInput);
  try {
    await witnessedWait(captureBlock, capturedCall);
    actorInput.userId = admin.user.id; scopeInput.clientId = f.b.client.id; authorityInput.clientId = f.b.client.id;
    operationInput.execute = async () => { throw new Error("Mutated callback must not replace the captured function"); };
    captureBlock.release(); await captureBlock.holding;
    expect((await capturedCall).workspaceId).toBe(f.aWorkspace); expect(captured.calls).toEqual({ replay: 1, execute: 1 });
  } finally { await captureBlock.close(); await capturedCall.catch(() => {}); }

  const grantBlock = await hold("ClientGrant", f.a.grant.id, tx => tx.clientGrant.update({ where: { id: f.a.grant.id },
    data: { signCustomer: false, revision: { increment: 1 } } }));
  const deniedReplay = withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", w.operation);
  try {
    await witnessedWait(grantBlock, deniedReplay); expect(w.calls).toEqual({ replay: 2, execute: 1 });
    grantBlock.release(); await grantBlock.holding; await failure(deniedReplay, "NOT_FOUND", 404);
    expect(w.calls).toEqual({ replay: 2, execute: 1 }); expect(await effects(f)).toBe(saved);
    await failure(withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", w.operation), "NOT_FOUND", 404);
  } finally { await grantBlock.close(); await deniedReplay.catch(() => {}); }
  await rights(f.a, all);

  const current = await getClientAuthority(f.a.seat.actor, f.a.client.id, "signCustomer"), revoked = work(f, current);
  const userBlock = await hold("User", f.a.seat.user.id, tx => tx.authSession.update({ where: { id: f.a.seat.actor.sessionId }, data: { revokedAt: new Date() } }));
  const revokedCall = withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", revoked.operation);
  try {
    await witnessedWait(userBlock, revokedCall); expect(revoked.calls).toEqual({ replay: 0, execute: 0 });
    userBlock.release(); await userBlock.holding; await failure(revokedCall, "UNAUTHENTICATED", 401);
    expect(revoked.calls).toEqual({ replay: 0, execute: 0 }); expect(await effects(f)).toBe(saved);
  } finally { await userBlock.close(); await revokedCall.catch(() => {}); }
  // A new actual signed session, rather than undoing revocation of the old one.
  const token = await openSession(f.a.seat.user.id, f.a.seat.user.sessionVersion, f.a.seat.user.passwordHash), native = await resolveSession(token);
  if (!native) throw new Error("Fresh native session did not resolve");
  f.a.seat.actor = { userId: native.userId, role: native.role, sessionId: native.sessionId, sessionVersion: native.sessionVersion };
  const finalAuthority = await getClientAuthority(f.a.seat.actor, f.a.client.id, "signCustomer"), expiryWork = work(f, finalAuthority);
  const expiresAt = new Date(Date.now() + 2500);
  await prisma.authSession.update({ where: { id: native.sessionId }, data: { expiresAt } });
  const beforeExpiry = await effects(f), journalBlock = await hold("OrganizationCommand", null);
  const expired = withManagedCustomerScope(f.a.seat.actor, client(f.a), "signCustomer", expiryWork.operation);
  try {
    await witnessedWait(journalBlock, expired); expect(expiryWork.calls).toEqual({ replay: 1, execute: 1 });
    expect(Date.now()).toBeLessThan(expiresAt.getTime());
    while (Date.now() <= expiresAt.getTime()) await delay(Math.min(50, expiresAt.getTime() - Date.now() + 1));
    journalBlock.release(); await journalBlock.holding; await failure(expired, "UNAUTHENTICATED", 401);
    expect(await effects(f)).toBe(beforeExpiry); // native mutation/journal/audit/outbox all rolled back.
  } finally { await journalBlock.close(); await expired.catch(() => {}); }
}, 60000);
