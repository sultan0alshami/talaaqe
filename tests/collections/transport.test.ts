import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import { GET as headersGET } from "@/app/api/collections/route";
import { GET as entriesGET } from "@/app/api/collections/entries/route";
import { POST as commandPOST } from "@/app/api/collections/commands/route";
import { POST as comparisonPOST } from "@/app/api/collections/comparison/route";
import { CollectionCommandResultSchema, CollectionHeadersPageSchema, CollectionEntriesPageSchema, CollectionComparisonSchema } from "@/lib/collections/contracts";

// Only Next's request-cookie context is an adapter seam. Signed JWTs, current
// PostgreSQL sessions, domain commands/authorization and all four routes are
// genuine native calls over task-local synthetic data. No producer/API/Date mock.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>();
afterEach(async () => {
  const parents = await prisma.creatorCollection.findMany({ where: { brand: { userId: { in: [...users] } } }, select: { id: true } });
  const ids = parents.map(row => row.id);
  await prisma.creatorCollectionCommand.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.creatorCollectionEntry.deleteMany({ where: { collectionId: { in: ids } } });
  await prisma.creatorCollection.deleteMany({ where: { id: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.adminAudit.deleteMany({ where: { actorUserId: { in: [...users] } } });
  await prisma.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  users.clear(); token = null;
});
async function actor(role: "BRAND" | "CREATOR" | "ADMIN" = "BRAND") {
  const id = randomUUID(); users.add(id);
  const user = await prisma.user.create({ data: { id, role, name: "Synthetic original transport actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", active: true, isTest: true } });
  token = await openSession(user.id, user.sessionVersion, user.passwordHash);
  const session = await resolveSession(token); if (!session) throw new Error("Synthetic signed collection session did not resolve");
  return { user, session, token };
}
async function fixture() {
  const current = await actor(), brand = await prisma.brand.create({ data: { userId: current.user.id, slug: "transport-" + randomUUID().replace(/-/g, "").slice(0, 16), name: "Synthetic original company", isTest: true } });
  return { ...current, brand, scope: { kind: "OWN_BRAND" as const, brandId: brand.id } };
}
const origin = () => new URL(process.env.APP_ORIGIN!).origin;
function get(search: string, entries = false) { return (entries ? entriesGET : headersGET)(new Request(`${origin()}/api/collections${entries ? "/entries" : ""}${search}`)); }
function postRequest(path: "commands" | "comparison", body: string, requestOrigin: string | null = origin(), search = "") {
  return new Request(`${origin()}/api/collections/${path}${search}`, { method: "POST", headers: { "Content-Type": "application/json", ...(requestOrigin ? { origin: requestOrigin } : {}) }, body });
}
function command(input: unknown, requestOrigin: string | null = origin(), search = "") { return commandPOST(postRequest("commands", JSON.stringify(input), requestOrigin, search)); }
function compare(input: unknown, requestOrigin: string | null = origin(), search = "") { return comparisonPOST(postRequest("comparison", JSON.stringify(input), requestOrigin, search)); }
function newList(f: Awaited<ReturnType<typeof fixture>>) { return { operationKey: randomUUID(), scope: f.scope, action: "CREATE", expectedParentRevision: 0,
  payload: { nameOriginal: { text: "قائمة أصلية Transport original", language: "ar" } } }; }
async function envelope(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  const body = await response.json(); expect(body.requestId).toBe(response.headers.get("x-request-id")); return body;
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); const body = await envelope(response);
  expect(Object.keys(body).sort()).toEqual(["error", "requestId"]);
  expect(Object.keys(body.error).sort()).toEqual(["code", "message", "requestId", "retryable"]);
  expect(body.error).toEqual({ code, message: code, requestId: body.requestId, retryable: status === 503 || status === 429 }); return body;
}

describe("collection transport: signed native synthetic actors and real route exports", () => {
  it("authenticates before invalid private query/body parsing and rejects genuine non-BRAND roles", async () => {
    await failure(await get("?scope=INVALID&limit=garbage"), 401, "UNAUTHENTICATED");
    for (const route of [commandPOST, comparisonPOST]) {
      const request = postRequest(route === commandPOST ? "commands" : "comparison", "{ malformed private input");
      await failure(await route(request), 401, "UNAUTHENTICATED"); expect(request.bodyUsed).toBe(false);
    }
    for (const role of ["CREATOR", "ADMIN"] as const) {
      await actor(role); await failure(await get("?scope=INVALID"), 403, "FORBIDDEN");
      await failure(await command({ malformed: "unparsed private input" }), 403, "FORBIDDEN");
    }
  });

  it("rereads real revocation, expiry, version, suspension and role despite an unchanged signed cookie", async () => {
    for (const change of ["revoked", "expired", "version", "inactive", "role"] as const) {
      const f = await fixture();
      if (change === "revoked") await prisma.authSession.update({ where: { id: f.session.sessionId }, data: { revokedAt: new Date() } });
      if (change === "expired") await prisma.authSession.update({ where: { id: f.session.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      if (change === "version") await prisma.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
      if (change === "inactive") await prisma.user.update({ where: { id: f.user.id }, data: { active: false } });
      if (change === "role") await prisma.user.update({ where: { id: f.user.id }, data: { role: "CREATOR" } });
      await failure(await get("?unknown=private&limit=bad"), 401, "UNAUTHENTICATED");
      const request = postRequest("commands", "{ private invalid JSON"); await failure(await commandPOST(request), 401, "UNAUTHENTICATED"); expect(request.bodyUsed).toBe(false);
      expect(await prisma.creatorCollectionCommand.count({ where: { actorUserId: f.user.id } })).toBe(0);
    }
  });

  it("rejects duplicate/unknown/mixed scope flags and noncanonical numbers instead of coercing a private query", async () => {
    const f = await fixture(), scope = `?scope=OWN_BRAND&brandId=${f.brand.id}`;
    for (const search of ["?scope=OWN_BRAND", "?scope=CLIENT", "?scope=OWN_BRAND&brandId=", `${scope}&clientId=another`, `${scope}&brandId=another`,
      `${scope}&scope=CLIENT`, `${scope}&actorUserId=other`, `${scope}&archived=1`, `${scope}&archived=True`, `${scope}&after=`, `${scope}&after=x&after=y`, `${scope}&collectionId=private`]) {
      await failure(await get(search), 422, "VALIDATION");
    }
    for (const number of ["0", "01", "%2B1", "1.0", "1e1", "%201", "NaN", "Infinity", "100", "21"]) await failure(await get(`${scope}&limit=${number}`), 422, "VALIDATION");
    for (const suffix of ["&limit=13", "&archived=false", "&collectionId=a&collectionId=b"]) await failure(await get(`${scope}&collectionId=missing${suffix}`, true), 422, "VALIDATION");
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.user.id } })).toBe(0);
  });

  it("returns allowlisted receipt/replay and authorized native headers, empty entries and empty comparison", async () => {
    const f = await fixture(), input = newList(f), first = await command(input); expect(first.status).toBe(200);
    const saved = CollectionCommandResultSchema.parse((await envelope(first)).data);
    expect(saved).toMatchObject({ revision: 1, action: "CREATE", replayed: false, entryId: null, archived: false });
    const repeat = await command(input); expect(repeat.status).toBe(200); expect(CollectionCommandResultSchema.parse((await envelope(repeat)).data)).toEqual({ ...saved, replayed: true });
    expect(await prisma.creatorCollectionCommand.count({ where: { collectionId: saved.collectionId } })).toBe(1);
    const scope = `?scope=OWN_BRAND&brandId=${f.brand.id}`;
    const headerResponse = await get(scope); expect(headerResponse.status).toBe(200); const headers = CollectionHeadersPageSchema.parse((await envelope(headerResponse)).data);
    expect(headers.collections).toHaveLength(1); expect(headers.collections[0]!.nameOriginal).toEqual(input.payload.nameOriginal); expect(headers.context).toEqual({ scope: f.scope, currentAuthority: null });
    const entriesResponse = await get(`${scope}&collectionId=${saved.collectionId}`, true); expect(entriesResponse.status).toBe(200);
    const entries = CollectionEntriesPageSchema.parse((await envelope(entriesResponse)).data); expect(entries.entries).toEqual([]); expect(entries.nextCursor).toBeNull();
    const comparisonResponse = await compare({ scope: f.scope, collectionId: saved.collectionId, entryIds: [] }); expect(comparisonResponse.status).toBe(200);
    const comparison = CollectionComparisonSchema.parse((await envelope(comparisonResponse)).data); expect(comparison.entries).toEqual([]);
    for (const data of [saved, headers, entries, comparison]) for (const canary of [f.token, f.session.sessionId, f.user.email, "passwordHash", "creatorReferenceId"]) expect(JSON.stringify(data)).not.toContain(canary);
  });

  it("requires exact mutation/read-POST origin, strict bodies and a bounded real request body before any write", async () => {
    const f = await fixture(), input = newList(f);
    for (const badOrigin of [null, "https://wrong.example.invalid", origin() + "/path-is-not-origin"]) {
      await failure(await command(input, badOrigin), 403, "FORBIDDEN");
      await failure(await compare({ scope: f.scope, collectionId: "missing", entryIds: [] }, badOrigin), 403, "FORBIDDEN");
    }
    await failure(await command(input, origin(), "?unexpected=private"), 422, "VALIDATION");
    await failure(await compare({ scope: f.scope, collectionId: "missing", entryIds: [] }, origin(), "?unexpected=private"), 422, "VALIDATION");
    for (const body of [{ ...input, actorUserId: f.user.id }, { ...input, collectionId: "unexpected" }, { ...input, payload: { ...input.payload, note: "Private canary" } },
      { ...input, scope: { ...f.scope, clientId: "unexpected" } }, { ...input, payload: { nameOriginal: { text: "Unsafe\u0000name", language: "en" } } }]) await failure(await command(body), 422, "VALIDATION");
    await failure(await commandPOST(postRequest("commands", "{ malformed JSON")), 400, "VALIDATION");
    await failure(await commandPOST(postRequest("commands", "x".repeat(65537))), 413, "PAYLOAD_TOO_LARGE");
    expect(await prisma.creatorCollection.count({ where: { brandId: f.brand.id } })).toBe(0);
    expect(await prisma.creatorCollectionCommand.count({ where: { actorUserId: f.user.id } })).toBe(0);
  });

  it("denies current foreign scope/parent before private content and returns metadata-only conflict errors", async () => {
    const owner = await fixture(), input = newList(owner), response = await command(input), saved = CollectionCommandResultSchema.parse((await envelope(response)).data);
    const conflict = await failure(await command({ ...input, payload: { nameOriginal: { text: "Conflict private text canary", language: "en" } } }), 409, "OPERATION_KEY_REUSED");
    expect(JSON.stringify(conflict)).not.toContain("Conflict private text canary");
    const foreign = await fixture();
    const denied = await failure(await get(`?scope=OWN_BRAND&brandId=${owner.brand.id}`), 404, "NOT_FOUND");
    await failure(await get(`?scope=OWN_BRAND&brandId=${foreign.brand.id}&collectionId=${saved.collectionId}`, true), 404, "NOT_FOUND");
    await failure(await compare({ scope: foreign.scope, collectionId: saved.collectionId, entryIds: [] }), 404, "NOT_FOUND");
    for (const canary of [input.payload.nameOriginal.text, owner.user.email, owner.session.sessionId]) expect(JSON.stringify(denied)).not.toContain(canary);
    expect((await prisma.creatorCollection.findUniqueOrThrow({ where: { id: saved.collectionId } })).revision).toBe(1);
  });
});
