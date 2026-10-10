import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { SESSION_COOKIE } from "@/lib/jwt";
import { canonicalHash, type DraftDTO } from "@/lib/onboarding/drafts";
import { GET, POST as initialize } from "@/app/api/onboarding/route";
import { POST as command } from "@/app/api/onboarding/[id]/commands/route";

// Exactly two native transport groups. Only Next cookie context is a seam;
// signed JWT/User/AuthSession, actual API/service/Prisma writes and stored
// receipts are real owned disposable fixtures. No auth/domain/time/query mock,
// registered test import, provider call, SQL wait duplication or reset.
// Source declarations/jobs/observations are synthetic; not live ownership,
// import/provider/publication proof. Root alone runs gates and these tests.
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { name, value: token } : undefined }) }));
const users = new Set<string>(), key = () => randomUUID();
const privateWords = "كلمات اختبار خاصة Private transport fixture words";
beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") throw new Error("Native onboarding transport requires guarded test target");
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") throw new Error("Onboarding transport disposable identity mismatch");
});
afterEach(async () => {
  token = null;
  if (users.size) await prisma.outboxEvent.deleteMany({ where: { OR: [...users].map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await prisma.creator.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.brand.deleteMany({ where: { userId: { in: [...users] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } }); users.clear();
});
async function signed(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const value = await openSession(user.id, user.sessionVersion, user.passwordHash), session = await resolveSession(value);
  if (!session) throw new Error("Owned transport native session did not resolve");
  return { actor: captureOrganizationActor(session), token: value };
}
async function person(role: "CREATOR" | "BRAND" | "ADMIN" = "CREATOR", withProfile = true) {
  const id = key(), suffix = key().replaceAll("-", "").slice(0, 16); users.add(id);
  const user = await prisma.user.create({ data: { id, name: "Synthetic onboarding API actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", role, active: true, isTest: true } });
  if (withProfile && role === "CREATOR") await prisma.creator.create({ data: { userId: id, handle: "nt_" + suffix, displayName: privateWords, state: "PRIVATE", isTest: true } });
  if (withProfile && role === "BRAND") await prisma.brand.create({ data: { userId: id, slug: "nt-" + suffix, name: privateWords, state: "PRIVATE", isTest: true } });
  return { user, suffix, ...await signed(id) };
}
type Account = Awaited<ReturnType<typeof person>>;
function origin() { if (!process.env.APP_ORIGIN) throw new Error("Native onboarding API requires guarded APP_ORIGIN"); return new URL(process.env.APP_ORIGIN).origin; }
const get = (search = "") => new Request(origin() + "/api/onboarding" + search);
function post(path: string, input?: unknown, search = "", sentOrigin = origin()) {
  return new Request(origin() + path + search, { method: "POST", headers: { Origin: sentOrigin, "Content-Type": "application/json" }, body: input === undefined ? undefined : typeof input === "string" ? input : JSON.stringify(input) });
}
function send(id: string, input: unknown, search = "", sentOrigin = origin()) {
  const request = post(`/api/onboarding/${id}/commands`, input, search, sentOrigin);
  return { request, response: () => command(request, { params: Promise.resolve({ id }) }) };
}
function privateSafe(value: unknown, account?: Account) {
  const text = JSON.stringify(value);
  for (const forbidden of ["serverAuth", "sessionId", "sessionVersion", "passwordHash", "executionTokenHash", ...(account ? [account.token, account.actor.sessionId] : [])]) expect(text.includes(forbidden)).toBe(false);
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const requestId = response.headers.get("x-request-id"), body = await response.json(); expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(body).toEqual({ error: { code, message: code, requestId, retryable: status === 503 || status === 429 }, requestId }); privateSafe(body);
  expect(JSON.stringify(body).includes(privateWords)).toBe(false);
}
async function success<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["data", "requestId"]);
  expect(body.requestId).toBe(response.headers.get("x-request-id")); expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/); privateSafe(body);
  return body.data as T;
}
type Current = { draft: DraftDTO | null; owner: { role: string; profile: { id: string; displayName: string; state: string } } | null };
type DraftResult = { draft: DraftDTO; replayed: boolean };
type QueueResult = DraftResult & { job: { id: string; status: string } };
async function image(userId: string) {
  const drafts = await prisma.onboardingDraft.findMany({ where: { userId }, orderBy: { id: "asc" } }), ids = drafts.map(row => row.id);
  const state = { drafts,
    commands: await prisma.draftCommand.findMany({ where: { draftId: { in: ids } }, orderBy: { id: "asc" } }),
    jobs: await prisma.sourceJob.findMany({ where: { draftId: { in: ids } }, orderBy: { id: "asc" } }),
    creator: await prisma.creator.findUnique({ where: { userId }, include: { accounts: true, rates: true, portfolios: true } }),
    brand: await prisma.brand.findUnique({ where: { userId }, include: { portfolios: true } }),
    outbox: await prisma.outboxEvent.findMany({ where: { payload: { path: ["actorUserId"], equals: userId } }, orderBy: { id: "asc" } }) };
  return createHash("sha256").update(JSON.stringify(state, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
}
function profile(account: Account) {
  return { displayName: privateWords, infameHandle: "nt_" + account.suffix, bio: privateWords, location: { countryCode: "EG", cityKey: null, cityLabel: null, timeZone: "Africa/Cairo" }, languages: ["ar"], dialects: [], nicheSlugs: ["tech"], fameIndustries: [], contentStyles: [], preferredCurrency: "KWD", minimumMinor: "12005", availability: { status: "UNKNOWN", startsAt: null, endsAt: null }, travelWilling: false, ratesVisibility: "PRIVATE", rates: [{ platform: "INSTAGRAM", format: "REEL", currencyCode: "KWD", amountMinor: "12005" }], primarySourceKey: null };
}

describe("native onboarding transport", () => {
  it("uses actual cookies for auth-before-query/body, current missing/null reads and strict private denial without effects", async () => {
    await failure(await GET(get("?actorUserId=forged&role=ADMIN&role=ADMIN")), 401, "UNAUTHENTICATED");
    const anonymousInit = post("/api/onboarding", "{malformed", "?unexpected=1"); await failure(await initialize(anonymousInit), 401, "UNAUTHENTICATED"); expect(anonymousInit.bodyUsed).toBe(false);
    const anonymous = send("unknown-owned-draft", "{malformed", "?unexpected=1"); await failure(await anonymous.response(), 401, "UNAUTHENTICATED"); expect(anonymous.request.bodyUsed).toBe(false);
    const external = send("unknown-owned-draft", "{malformed", "?unexpected=1", "https://unrelated.example.invalid"); await failure(await external.response(), 403, "FORBIDDEN"); expect(external.request.bodyUsed).toBe(false);
    const admin = await person("ADMIN"); token = admin.token;
    await failure(await GET(get("?unexpected=1")), 403, "FORBIDDEN");
    const wrong = send("unknown-owned-draft", "{malformed", "?unexpected=1"); await failure(await wrong.response(), 403, "FORBIDDEN"); expect(wrong.request.bodyUsed).toBe(false);
    expect(await prisma.onboardingDraft.count({ where: { userId: admin.user.id } })).toBe(0);
    const empty = await person("BRAND", false); token = empty.token; const pristine = await image(empty.user.id);
    expect(await success<Current>(await GET(get()))).toEqual({ draft: null, owner: null }); expect(await image(empty.user.id)).toBe(pristine);
    for (const query of ["?userId=other", "?role=CREATOR", "?draftId=other", "?limit=1&limit=1", "?anything="]) {
      await failure(await GET(get(query)), 422, "VALIDATION");
      const requestedInit = post("/api/onboarding", "{malformed", query); await failure(await initialize(requestedInit), 422, "VALIDATION"); expect(requestedInit.bodyUsed).toBe(false);
      const requestedCommand = send("unknown-owned-draft", "{malformed", query); await failure(await requestedCommand.response(), 422, "VALIDATION"); expect(requestedCommand.request.bodyUsed).toBe(false);
    }
    expect(await image(empty.user.id)).toBe(pristine);
    const missing = send("unknown-owned-draft", { kind: "DRAFT", command: { action: "SAVE_DRAFT", operationKey: key(), expectedRevision: 1, payload: {} } }); await failure(await missing.response(), 404, "NOT_FOUND"); expect(await image(empty.user.id)).toBe(pristine);
    await prisma.authSession.update({ where: { id: empty.actor.sessionId }, data: { revokedAt: new Date() } }); expect(await resolveSession(empty.token)).toBeNull();
    await failure(await GET(get()), 401, "UNAUTHENTICATED"); const revoked = send("unknown-owned-draft", "{malformed", "?anything="); await failure(await revoked.response(), 401, "UNAUTHENTICATED"); expect(revoked.request.bodyUsed).toBe(false);
    expect(await image(empty.user.id)).toBe(pristine);
    for (const change of ["suspended", "version", "role", "expired"] as const) {
      const account = await person(); token = account.token; const stable = await image(account.user.id);
      if (change === "suspended") await prisma.user.update({ where: { id: account.user.id }, data: { active: false } });
      if (change === "version") await prisma.user.update({ where: { id: account.user.id }, data: { sessionVersion: { increment: 1 } } });
      if (change === "role") await prisma.user.update({ where: { id: account.user.id }, data: { role: "BRAND" } });
      if (change === "expired") await prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
      await failure(await GET(get("?malformed=1")), 401, "UNAUTHENTICATED"); const denied = send("unknown-owned-draft", "{malformed"); await failure(await denied.response(), 401, "UNAUTHENTICATED"); expect(denied.request.bodyUsed).toBe(false); expect(await image(account.user.id)).toBe(stable);
    }
  }, 60000);

  it("persists exact owner form commands/hashes and renewed replay over APIs while rejecting foreign/unknown/oversized input without effects", async () => {
    const account = await person(); token = account.token;
    const before = await success<Current>(await GET(get())); expect(before.draft).toBeNull(); expect(before.owner?.role).toBe("CREATOR"); expect(await prisma.onboardingDraft.count({ where: { userId: account.user.id } })).toBe(0);
    const initialized = await success<Current>(await initialize(post("/api/onboarding"))); if (!initialized.draft) throw new Error("Actual explicit init did not create an owned draft");
    let current = initialized.draft; expect((await success<Current>(await initialize(post("/api/onboarding")))).draft?.id).toBe(current.id);
    const answer = { action: "SET_ANSWER", operationKey: key(), expectedRevision: current.revision, payload: { field: "displayName", value: privateWords } };
    const saved = await success<DraftResult>(await send(current.id, { kind: "DRAFT", command: answer }).response()); expect(saved.replayed).toBe(false); expect(saved.draft.input.answers.displayName).toBe(privateWords); current = saved.draft;
    const profileBody = { action: "SAVE_PROFILE", operationKey: key(), expectedRevision: current.revision, payload: profile(account) };
    const profiled = await success<DraftResult>(await send(current.id, { kind: "PROFILE", command: profileBody }).response()); expect(profiled.replayed).toBe(false); current = profiled.draft;
    const identity = { platform: "INSTAGRAM", providerAccountId: "synthetic-transport-provider", normalizedHandle: "native_transport", confirmedOrigin: null };
    for (const [action, payload] of [["SET_ANSWER", { field: "sourceMapping", value: { sourceKey: "instagram", source: "INSTAGRAM", identity } }], ["CONFIRM_ACCOUNT", { sourceKey: "instagram", identity }], ["GRANT_IMPORT_CONSENT", { sourceKey: "instagram", identity, scopes: ["public-profile"], consentVersion: "native-api-v1", granted: true }]] as const) {
      current = (await success<DraftResult>(await send(current.id, { kind: "DRAFT", command: { action, operationKey: key(), expectedRevision: current.revision, payload } }).response())).draft;
    }
    const queueBody = { operationKey: key(), expectedRevision: current.revision, sourceKey: "instagram" };
    const queued = await success<QueueResult>(await send(current.id, { kind: "IMPORT", command: queueBody }).response()); expect(queued.replayed).toBe(false); expect(queued.job.status).toBe("QUEUED"); current = queued.draft;
    const receipts = await prisma.draftCommand.findMany({ where: { draftId: current.id } });
    for (const [prefix, body, hashBody] of [["draft:", answer, { ...answer, channel: "FORM" }], ["profile:", profileBody, profileBody], ["import:", queueBody, { ...queueBody, channel: "FORM" }]] as const) expect(receipts.find(row => row.operationKey === prefix + body.operationKey)?.payloadHash).toBe(canonicalHash(hashBody));
    const job = await prisma.sourceJob.findUniqueOrThrow({ where: { id: queued.job.id } }); expect(job.payloadHash).toBe(canonicalHash({ ...queueBody, channel: "FORM" })); privateSafe({ receipts, identity: job.identity, result: job.result }, account);
    const ownedRead = await success<Current>(await GET(get())); expect(ownedRead.draft?.id).toBe(current.id); expect(ownedRead.owner?.profile.displayName).toBe(privateWords); expect(ownedRead.owner?.profile.state).toBe("PRIVATE");
    const stable = await image(account.user.id);
    await prisma.authSession.update({ where: { id: account.actor.sessionId }, data: { revokedAt: new Date() } });
    const staleReplay = send(current.id, { kind: "DRAFT", command: answer }); await failure(await staleReplay.response(), 401, "UNAUTHENTICATED"); expect(staleReplay.request.bodyUsed).toBe(false);
    const renewed = await signed(account.user.id); token = renewed.token;
    expect(await success<DraftResult>(await send(current.id, { kind: "DRAFT", command: { ...answer, payload: { value: privateWords, field: "displayName" } } }).response())).toEqual({ ...saved, replayed: true });
    expect(await success<DraftResult>(await send(current.id, { kind: "PROFILE", command: profileBody }).response())).toEqual({ ...profiled, replayed: true });
    expect(await success<QueueResult>(await send(current.id, { kind: "IMPORT", command: queueBody }).response())).toEqual({ ...queued, replayed: true }); expect(await image(account.user.id)).toBe(stable);
    // Valid JSON padding proves the actual shared64KiB reader boundary, with a
    // committed exact-key replay so neither boundary success writes a new row.
    const wire = JSON.stringify({ kind: "DRAFT", command: answer }), exact = wire + " ".repeat(65536 - Buffer.byteLength(wire, "utf8"));
    expect(Buffer.byteLength(exact, "utf8")).toBe(65536); expect((await success<DraftResult>(await send(current.id, exact).response())).replayed).toBe(true);
    await failure(await send(current.id, exact + " ").response(), 413, "PAYLOAD_TOO_LARGE");
    for (const input of ["{malformed", { kind: "UNKNOWN", command: answer }, { kind: "DRAFT", command: answer, serverAuth: renewed.actor }, { kind: "DRAFT", command: answer, channel: "VOICE" }]) await failure(await send(current.id, input).response(), 400, "VALIDATION");
    for (const input of [{ ...answer, operationKey: key(), action: "UNKNOWN" }, { ...answer, operationKey: key(), serverAuth: renewed.actor }]) await failure(await send(current.id, { kind: "DRAFT", command: input }).response(), 400, "INVALID_COMMAND");
    await failure(await send(current.id, { kind: "DRAFT", command: { ...answer, payload: { ...answer.payload, value: "Changed reused key" } } }).response(), 409, "IDEMPOTENCY_CONFLICT");
    const voiceConsent = { action: "CONFIRM_ACCOUNT", operationKey: key(), expectedRevision: current.revision, channel: "VOICE", payload: { sourceKey: "instagram", identity } }; await failure(await send(current.id, { kind: "DRAFT", command: voiceConsent }).response(), 400, "EXPLICIT_CONFIRMATION_REQUIRED");
    expect(await image(account.user.id)).toBe(stable);
    const outsider = await person(); token = outsider.token; const otherState = await image(outsider.user.id);
    const denied = await send(current.id, { kind: "DRAFT", command: { action: "SAVE_DRAFT", operationKey: key(), expectedRevision: current.revision, payload: {} } }).response(); await failure(denied, 404, "NOT_FOUND");
    expect((await success<Current>(await GET(get()))).draft).toBeNull(); expect(await image(outsider.user.id)).toBe(otherState); expect(await image(account.user.id)).toBe(stable);
    // Four SSR adapter mounts and late-callback privacy remain separately
    // verified browser journeys; direct handler tests do not claim SSR mounting.
  }, 60000);
});
