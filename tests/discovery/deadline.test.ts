import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import type { OrganizationActor } from "@/lib/organizations/context";
import * as receiptReaders from "@/lib/evidence/receipt-reader";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { DiscoveryPageSchema, type PublicDiscoveryCreator } from "@/lib/discovery/contracts";
import { projectPublicCreatorIdentities } from "@/lib/discovery/public-identity";
import { getDiscoveryPage } from "@/lib/discovery/service";

// Root alone activates and executes this guarded native witness. The producer
// leaf is mocked; User/AuthSession authorization, candidate queries, reader,
// real page parsing and audit transaction remain native. A controlled CPU delay
// exercises the deadline boundary, never live metric/publication acceptance.
vi.mock("@/lib/discovery/public-identity", () => ({ projectPublicCreatorIdentities: vi.fn() }));
const projection = vi.mocked(projectPublicCreatorIdentities);
const users: string[] = [], creators: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); projection.mockReset();
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.creator.deleteMany({ where: { id: { in: creators } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  users.length = 0; creators.length = 0;
});

it("stops before the native audit query when real page parsing and controlled CPU work exhaust the shared deadline", async () => {
  const at = new Date(Date.now() - 60_000);
  const brandId = randomUUID(), ownerId = randomUUID(); users.push(brandId, ownerId);
  const brand = await prisma.user.create({ data: { id: brandId, role: "BRAND", name: "Synthetic deadline BRAND",
    email: `${brandId}@example.invalid`, passwordHash: "synthetic-deadline-not-a-login", active: true, isTest: true } });
  await prisma.user.create({ data: { id: ownerId, role: "CREATOR", name: "Synthetic deadline creator",
    email: `${ownerId}@example.invalid`, passwordHash: "synthetic-deadline-not-a-login", active: true,
    isTest: false, emailVerifiedAt: at } });
  const handle = "dline_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const creator = await prisma.creator.create({ data: { userId: ownerId, handle,
    displayName: "اختبار زمن / Deadline fixture", state: "PUBLISHED", isTest: false, publicConsentAt: at } });
  creators.push(creator.id);
  const token = await openSession(brand.id, brand.sessionVersion, brand.passwordHash), session = await resolveSession(token);
  if (!session) throw new Error("Synthetic native deadline session did not resolve");
  const actor: OrganizationActor = { userId: session.userId, role: session.role,
    sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  const card: PublicDiscoveryCreator = { id: creator.id, handle, displayName: creator.displayName,
    bio: "Synthetic adapter-only public biography", residenceCountryCode: null, languages: [], nicheSlugs: [], accounts: [] };
  projection.mockImplementation(async (_tx, capture, _actors, reader) => {
    reader.checkpoint();
    return capture.records.some(record => record.creator.id === creator.id) ? [card] : [];
  });

  const nativeFactory = receiptReaders.createEvidenceReceiptReader;
  vi.spyOn(receiptReaders, "createEvidenceReceiptReader").mockImplementation(() => nativeFactory({ maxElapsedMs: 500 }));
  const nativeParse = DiscoveryPageSchema.parse.bind(DiscoveryPageSchema);
  let parsedPages = 0, cpuElapsed = 0;
  vi.spyOn(DiscoveryPageSchema, "parse").mockImplementation((input, parameters) => {
    const page = nativeParse(input, parameters);
    parsedPages++;
    const start = performance.now();
    // Actual synchronous hashing, not fake Date/timers or an event-loop sleep.
    do { canonicalHash({ scope: page.scope, asOf: page.asOf, returned: page.creators.length }); }
    while (performance.now() - start < 600);
    cpuElapsed = performance.now() - start;
    return page;
  });
  let auditQueries = 0;
  const client = prisma.$extends({ query: { adminAudit: { async create({ args, query }) {
    auditQueries++;
    return query(args);
  } } } }) as unknown as PrismaClient;
  const outcome = await getDiscoveryPage(actor, { q: handle, limit: 1 }, { client })
    .then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  expect(parsedPages).toBe(1);
  expect(cpuElapsed).toBeGreaterThanOrEqual(600);
  expect(outcome).toMatchObject({ ok: false, error: { code: "RETRY_REQUIRED", status: 503 } });
  expect(auditQueries).toBe(0);
  expect(await prisma.adminAudit.findMany({ where: { actorUserId: brand.id, action: "discovery.public_accessed" } })).toEqual([]);
});
