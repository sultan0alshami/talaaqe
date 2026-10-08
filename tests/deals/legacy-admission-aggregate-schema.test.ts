import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { Client, DatabaseError } from "pg";
import { afterEach, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { createCampaign, generateCampaignBrief, approveCampaignBrief } from "@/lib/campaigns/service";
import { createDealOffer, applyDealCommand } from "@/lib/deals/service";
import { LegacyDirectAdmissionContentSchema } from "@/lib/deals/legacy-admission-contracts";
import { cleanup, nativeFixture, user } from "./fixtures";
import { nativeDealActor } from "./native-actors";

// Exactly FOUR guarded native storage groups; root alone adopts/runs. Actual
// Campaign/Brief/Deal/firstOffer/journals and once-captured native sessions are
// produced through existing services. Their existing syntheticPolicy/reviewed
// evidence fixtures are synthetic, not live legal, provider or admission proof.
// Only three inert admission tables: no importer/manifest authority/application
// permission, producer verifier, global fixture bypass, auth/Date mock or DDL.
// Missing tables are a scaffold RED only, never behavioral guard acceptance.
type Table = "LegacyDirectAdmission" | "LegacyDirectAdmissionVersion" | "LegacyDirectAdmissionState";
type Fields = Record<string, unknown>;
type Db = PrismaClient | Prisma.TransactionClient;
const tables: Table[] = ["LegacyDirectAdmission", "LegacyDirectAdmissionVersion", "LegacyDirectAdmissionState"];
const owned = new Map<string, { users: string[]; brandId: string; creatorId: string }>();
const key = () => randomUUID(), provenance = "DEVELOPMENT_FIXTURE", cap = 131072;
const retention = ["23001", "23503"];

beforeAll(async () => {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production") {
    throw new Error("Admission storage witnesses require the guarded test task");
  }
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") {
    throw new Error("Admission storage fixture target identity mismatch");
  }
});
async function exists(table: Table) {
  return (await prisma.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS present`)[0]?.present === true;
}
async function requireStorage() {
  for (const table of tables) expect(await exists(table), `Frozen inert storage table ${table} must exist`).toBe(true);
}
function value(column: string, input: unknown) {
  if (input === null) return Prisma.sql`NULL`;
  if (column === "content") return Prisma.sql`${JSON.stringify(input)}::jsonb`;
  // Explicit civil UTC ISO strings avoid the prior native raw-Date timezone
  // mismatch. A malformed timestamp is still handed to PostgreSQL validation.
  if (column === "createdAt" || column === "updatedAt") {
    return Prisma.sql`${input instanceof Date ? input.toISOString() : input}::timestamp(3)`;
  }
  return Prisma.sql`${input}`;
}
async function insert(table: Table, data: Fields, db: Db = prisma) {
  const entries = Object.entries(data);
  return db.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw('"' + table + '"')}
    (${Prisma.join(entries.map(([column]) => Prisma.raw('"' + column + '"')))})
    VALUES (${Prisma.join(entries.map(([column, input]) => value(column, input)))})`);
}
async function patch(table: Table, id: string, data: Fields, db: Db = prisma) {
  const column = table === "LegacyDirectAdmissionState" ? "admissionId" : "id";
  return db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')}
    SET ${Prisma.join(Object.entries(data).map(([name, input]) => Prisma.sql`${Prisma.raw('"' + name + '"')}=${value(name, input)}`))}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`);
}
async function row(table: Table, id: string, db: Db = prisma) {
  const column = table === "LegacyDirectAdmissionState" ? "admissionId" : "id";
  return (await db.$queryRaw<Fields[]>(Prisma.sql`SELECT * FROM ${Prisma.raw('"' + table + '"')}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`))[0];
}
function rejectedSql(error: unknown, codes: readonly string[]) {
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected actual admission storage constraint rejection");
  expect(error.code).toBe("P2010"); expect(codes).toContain(String(error.meta?.code));
}
async function constrained(operation: Promise<unknown>, codes: readonly string[] = ["23514"]) {
  const failure = await operation.then(() => null, (error: unknown) => error);
  rejectedSql(failure, codes);
}
async function deferredCommit(body: (client: Client) => Promise<void>) {
  const taskId = process.env.INFAME_TASK_ID;
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || process.env.INFAME_ENV !== "test" || process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
    throw new Error("Deferred admission witnesses require the guarded test task");
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; kind: string; db: string; host: string }>(
      "SELECT id,kind,current_database() AS db,host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable");
    if (rows.length !== 1 || rows[0]?.id !== taskId || rows[0]?.kind !== "test" || rows[0]?.db !== taskId + "_test" || rows[0]?.host !== "127.0.0.1") {
      throw new Error("Deferred admission fixture target identity mismatch");
    }
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='4s'");
    await body(client); // Must succeed before the independent COMMIT witness.
    const failure: unknown = await client.query("COMMIT").then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(DatabaseError);
    if (!(failure instanceof DatabaseError)) throw new Error("Expected an actual PostgreSQL deferred COMMIT rejection");
    expect(failure.code).toBe("23514");
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
}
async function cleanupAggregates(requestedIds = [...owned.keys()]) {
  const ids = [...new Set(requestedIds)].sort();
  if (!ids.length) return;
  const present = new Set<Table>(); for (const table of tables) if (await exists(table)) present.add(table);
  const registrations = ids.map(id => owned.get(id)!);
  const brands = await prisma.brand.findMany({ where: { id: { in: registrations.map(item => item.brandId) } }, select: { userId: true } });
  const creators = await prisma.creator.findMany({ where: { id: { in: registrations.map(item => item.creatorId) } }, select: { userId: true } });
  const users = [...new Set([...registrations.flatMap(item => item.users), ...brands.map(item => item.userId), ...creators.flatMap(item => item.userId ? [item.userId] : [])])].sort();
  await prisma.$transaction(async tx => {
    if (users.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(users)}) ORDER BY id FOR UPDATE`);
    if (present.has("LegacyDirectAdmission")) await tx.$queryRaw(Prisma.sql`SELECT id FROM "LegacyDirectAdmission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    for (const table of ["LegacyDirectAdmissionState", "LegacyDirectAdmissionVersion", "LegacyDirectAdmission"] as const) {
      if (present.has(table)) await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')}
        WHERE ${Prisma.raw(table === "LegacyDirectAdmission" ? '"id"' : '"admissionId"')} IN (${Prisma.join(ids)})`);
    }
  }); // COMMIT has completed before any native fixture row can be removed.
  for (const id of ids) owned.delete(id);
}
afterEach(async () => {
  await cleanupAggregates();
  await cleanup(); // Never combine parent-held admission deletion with native deletion.
});

async function sourceFixture() {
  const f = await nativeFixture(2, "10001", { now: new Date(), target: "test" });
  await prisma.creator.update({ where: { id: f.target.id }, data: { state: "PUBLISHED", brandVisible: true } });
  // Produce the real max-edge receipt; never patch a journal or infer CREATE
  // fields/defaults from an approved current campaign after the producer ran.
  const originalCreate = { operationKey: "K".repeat(84) + key(), fields: f.campaign.fields };
  const created = await createCampaign(f.brandUserId, originalCreate, prisma, f.brandSession.actor);
  const generated = await generateCampaignBrief(f.brandUserId, created.campaign.id,
    { operationKey: key(), expectedRevision: created.campaign.revision }, prisma, f.brandSession.actor);
  const approved = await approveCampaignBrief(f.brandUserId, created.campaign.id,
    { operationKey: key(), expectedRevision: generated.campaign.revision, briefId: generated.brief.id, expectedBriefVersion: generated.brief.version },
    prisma, { channel: "FORM", serverAuth: f.brandSession.actor });
  const originalDealCreate = { ...f.input, operationKey: key(), campaignId: created.campaign.id,
    expectedCampaignRevision: approved.campaign.revision, expectedBriefVersion: generated.brief.version };
  const brandOptions = { policyVerifier: f.options.policyVerifier, serverAuth: f.brandSession.actor };
  const creatorOptions = { policyVerifier: f.options.policyVerifier, serverAuth: f.creatorSession.actor };
  const made = await createDealOffer(f.brandUserId, originalDealCreate, brandOptions);
  await applyDealCommand(f.target.userId, made.deal.id, { action: "ACCEPT", operationKey: key(), expectedVersion: made.deal.version,
    offerId: made.deal.currentOffer.id, expectedOfferVersion: made.deal.currentOffer.version, language: "ar" }, creatorOptions);
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: created.campaign.id }, select: { id: true, brandId: true } });
  const brief = await prisma.campaignBrief.findUniqueOrThrow({ where: { campaignId_version: { campaignId: campaign.id, version: generated.brief.version } } });
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: made.deal.id } });
  const firstOffer = await prisma.dealOffer.findUniqueOrThrow({ where: { dealId_version: { dealId: deal.id, version: 1 } } });
  const campaignSource = await prisma.campaignCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: {
    actorUserId: f.brandUserId, operationKey: `create:${originalCreate.operationKey}` } } });
  const dealSource = await prisma.dealCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: {
    actorUserId: f.brandUserId, operationKey: originalDealCreate.operationKey } } });
  expect(originalCreate.operationKey).toHaveLength(120);
  expect(campaignSource.operationKey).toBe(`create:${originalCreate.operationKey}`);
  expect(campaignSource.operationKey).toHaveLength(127);
  expect(campaignSource.campaignId).toBe(campaign.id);
  expect(dealSource.dealId).toBe(deal.id);
  expect(firstOffer).toMatchObject({ version: 1, proposerUserId: f.brandUserId, recipientUserId: f.target.userId });
  expect(brief.approvedByUserId).toBe(f.brandUserId); expect(brief.approvedAt).not.toBeNull();
  return { ...f, campaign, brief, deal, firstOffer, campaignSource, dealSource, originalCreate, originalDealCreate };
}
type Fixture = Awaited<ReturnType<typeof sourceFixture>>;
type Capability = "FRESH_PINNED_SCOPE" | "CONTINUE_PINNED_DEAL";
function parentData(f: Fixture, capability: Capability = "FRESH_PINNED_SCOPE", id = "admission~synthetic:" + key()) {
  owned.set(id, { users: [f.brandUserId, f.target.userId], brandId: f.brandId, creatorId: f.target.id });
  return { id, provenance, capability, campaignId: f.campaign.id, brandId: f.brandId, brandUserId: f.brandUserId,
    creatorId: f.target.id, creatorUserId: f.target.userId, createdAt: new Date() };
}
type Parent = ReturnType<typeof parentData>;
function stateData(parent: Parent, override: Fields = {}) {
  const createdAt = new Date(parent.createdAt.getTime() + 1);
  return { admissionId: parent.id, revision: 1, state: "DRAFT", currentVersionId: null, currentVersionNumber: null,
    currentSourceHash: null, createdAt, updatedAt: createdAt, ...override };
}
async function aggregate(f: Fixture, capability: Capability = "FRESH_PINNED_SCOPE", id?: string) {
  const parent = parentData(f, capability, id); await insert("LegacyDirectAdmission", parent);
  await insert("LegacyDirectAdmissionState", stateData(parent)); return parent;
}
function versionData(f: Fixture, parent: Parent, version = 1) {
  const continuation = parent.capability === "CONTINUE_PINNED_DEAL", receipt = continuation ? f.dealSource : f.campaignSource;
  // Digests of actual stored JSON/thin immutable identity are declaration pins
  // here. SQL does not recompute them or prove future exact producer semantics.
  const firstOfferContentHash = canonicalHash({ id: f.firstOffer.id, dealId: f.firstOffer.dealId, version: f.firstOffer.version,
    proposerUserId: f.firstOffer.proposerUserId, recipientUserId: f.firstOffer.recipientUserId, terms: f.firstOffer.terms,
    createdAt: f.firstOffer.createdAt.toISOString() });
  const existingDealHash = canonicalHash({ id: f.deal.id, campaignId: f.deal.campaignId, brandId: f.deal.brandId,
    creatorId: f.deal.creatorId, briefVersion: f.deal.briefVersion, origin: f.deal.origin,
    matchRunId: f.deal.matchRunId, slotOrdinal: f.deal.slotOrdinal, createdAt: f.deal.createdAt.toISOString() });
  const content = LegacyDirectAdmissionContentSchema.parse({ schemaVersion: 1, admissionId: parent.id, provenance: parent.provenance,
    capability: parent.capability, version,
    subject: { campaignId: parent.campaignId, brandId: parent.brandId, brandUserId: parent.brandUserId,
      creatorId: parent.creatorId, creatorUserId: parent.creatorUserId },
    approvedBrief: { id: f.brief.id, version: f.brief.version, inputRevision: f.brief.inputRevision,
      approvedByUserId: f.brief.approvedByUserId, contentHash: canonicalHash(f.brief.content) },
    validity: { validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", recheckAt: "2026-12-31T23:59:59.999Z" },
    manifest: { id: "manifest~unresolved:synthetic", entryId: "entry~unresolved:" + key() },
    source: { kind: continuation ? "DEAL_COMMAND" : "CAMPAIGN_COMMAND", id: receipt.id, actorUserId: receipt.actorUserId,
      operationKey: receipt.operationKey, payloadHash: receipt.payloadHash, resultHash: canonicalHash(receipt.result) },
    ...(continuation ? { existingDeal: { id: f.deal.id, sourceHash: existingDealHash, firstOffer: { id: f.firstOffer.id, version: 1,
      proposerUserId: f.firstOffer.proposerUserId, recipientUserId: f.firstOffer.recipientUserId, contentHash: firstOfferContentHash } } } : {}) });
  return { id: "admission-version~synthetic:" + key(), admissionId: parent.id, provenance: parent.provenance, capability: parent.capability,
    version, content, sourceHash: canonicalHash(content), createdAt: new Date(parent.createdAt.getTime() + 2 + version),
    approvedBriefId: f.brief.id, approvedBriefVersion: f.brief.version, approvedInputRevision: f.brief.inputRevision,
    approvedByUserId: f.brief.approvedByUserId!, approvedContentHash: content.approvedBrief.contentHash,
    manifestId: content.manifest.id, manifestEntryId: content.manifest.entryId,
    sourceActorUserId: receipt.actorUserId, sourceOperationKey: receipt.operationKey, sourcePayloadHash: receipt.payloadHash,
    sourceResultHash: content.source.resultHash, campaignCommandId: continuation ? null : receipt.id, dealCommandId: continuation ? receipt.id : null,
    existingDealId: continuation ? f.deal.id : null, existingDealHash: continuation ? existingDealHash : null,
    firstOfferId: continuation ? f.firstOffer.id : null, firstOfferVersion: continuation ? 1 : null,
    firstProposerUserId: continuation ? f.firstOffer.proposerUserId : null, firstRecipientUserId: continuation ? f.firstOffer.recipientUserId : null,
    firstOfferContentHash: continuation ? firstOfferContentHash : null };
}
type Version = ReturnType<typeof versionData>;
async function versions(parent: Parent) {
  return prisma.$queryRaw<Fields[]>`SELECT * FROM "LegacyDirectAdmissionVersion" WHERE "admissionId"=${parent.id} ORDER BY version`;
}
function changedContent(data: Version, content: unknown) { return { ...data, content, sourceHash: canonicalHash(content) }; }
function replaced(input: unknown, path: string[], replacement: unknown) {
  const copy = structuredClone(input) as Fields; let target = copy;
  for (const field of path.slice(0, -1)) target = target[field] as Fields;
  target[path.at(-1)!] = replacement; return copy;
}
function pointer(saved: Version) { return { currentVersionId: saved.id, currentVersionNumber: saved.version, currentSourceHash: saved.sourceHash }; }
function updateData(parent: Parent, revision: number, state: string, saved?: Version) {
  return { revision, state, ...(saved ? pointer(saved) : {}), updatedAt: new Date(parent.createdAt.getTime() + 100 + revision) };
}

it("retains exact inert FRESH/CONTINUE native subjects, briefs and source pins and rejects scalar/content/provenance/null-branch substitutions", async () => {
  await requireStorage(); const f = await sourceFixture(), other = await sourceFixture();
  for (const capability of ["FRESH_PINNED_SCOPE", "CONTINUE_PINNED_DEAL"] as const) {
    const parent = await aggregate(f, capability), data = versionData(f, parent), content = data.content;
    for (const changed of [{ provenance: "LIVE" }, { capability: capability === "FRESH_PINNED_SCOPE" ? "CONTINUE_PINNED_DEAL" : "FRESH_PINNED_SCOPE" },
      { approvedBriefId: other.brief.id }, { approvedBriefVersion: data.approvedBriefVersion + 1 }, { approvedInputRevision: data.approvedInputRevision + 1 },
      { approvedByUserId: other.brandUserId }, { approvedContentHash: "a".repeat(64) }, { manifestId: "swapped-manifest" }, { manifestEntryId: "swapped-entry" },
      { sourceActorUserId: other.brandUserId }, { sourceOperationKey: "changed-source-key" }, { sourcePayloadHash: "b".repeat(64) }, { sourceResultHash: "c".repeat(64) },
      { campaignCommandId: null, dealCommandId: null }, { campaignCommandId: f.campaignSource.id, dealCommandId: f.dealSource.id }]) {
      await constrained(insert("LegacyDirectAdmissionVersion", { ...data, ...changed }), ["23503", "23514", "23502"]);
    }
    for (const field of ["campaignId", "brandId", "brandUserId", "creatorId", "creatorUserId"] as const) {
      const swapped = field === "campaignId" ? other.campaign.id : field === "brandId" ? other.brandId
        : field === "brandUserId" ? other.brandUserId : field === "creatorId" ? other.target.id : other.target.userId;
      await constrained(insert("LegacyDirectAdmissionVersion", changedContent(data, replaced(content, ["subject", field], swapped))));
    }
    for (const malformed of [null, [], { ...content, schemaVersion: 2 }, { ...content, admissionId: "other-stable-identity" },
      { ...content, version: 2 }, { ...content, provenance: "LIVE" }, { ...content, subject: null }, { ...content, subject: [] },
      { ...content, approvedBrief: null }, { ...content, source: [] }, { ...content, manifest: null }, { ...content, wildcard: true }]) {
      await constrained(insert("LegacyDirectAdmissionVersion", changedContent(data, malformed)), ["23514", "23502"]);
    }
    const source = capability === "FRESH_PINNED_SCOPE" ? other.campaignSource : other.dealSource;
    const swappedSource = { ...content, source: { ...content.source, id: source.id, actorUserId: source.actorUserId,
      operationKey: source.operationKey, payloadHash: source.payloadHash, resultHash: canonicalHash(source.result) } };
    await constrained(insert("LegacyDirectAdmissionVersion", { ...changedContent(data, swappedSource), sourceActorUserId: source.actorUserId,
      sourceOperationKey: source.operationKey, sourcePayloadHash: source.payloadHash, sourceResultHash: canonicalHash(source.result),
      campaignCommandId: capability === "FRESH_PINNED_SCOPE" ? source.id : null, dealCommandId: capability === "CONTINUE_PINNED_DEAL" ? source.id : null }), ["23503", "23514"]);
    if (capability === "FRESH_PINNED_SCOPE") {
      for (const changed of [{ existingDealId: f.deal.id }, { existingDealHash: "d".repeat(64) }, { firstOfferId: f.firstOffer.id },
        { firstOfferVersion: 1 }, { firstProposerUserId: f.brandUserId }, { firstRecipientUserId: f.target.userId }, { firstOfferContentHash: "e".repeat(64) }]) {
        await constrained(insert("LegacyDirectAdmissionVersion", { ...data, ...changed }));
      }
      await constrained(insert("LegacyDirectAdmissionVersion", changedContent(data, { ...content, existingDeal: { id: f.deal.id } })));
    } else {
      for (const field of ["existingDealId", "existingDealHash", "firstOfferId", "firstOfferVersion", "firstProposerUserId", "firstRecipientUserId", "firstOfferContentHash"]) {
        await constrained(insert("LegacyDirectAdmissionVersion", { ...data, [field]: null }), ["23503", "23514", "23502"]);
      }
      for (const changed of [{ existingDealId: other.deal.id }, { firstOfferId: other.firstOffer.id }, { firstOfferVersion: 2 },
        { firstProposerUserId: f.target.userId }, { firstRecipientUserId: f.brandUserId }]) {
        await constrained(insert("LegacyDirectAdmissionVersion", { ...data, ...changed }), ["23503", "23514"]);
      }
      if (content.capability !== "CONTINUE_PINNED_DEAL") throw new Error("Expected the retained CONTINUE declaration");
      const { existingDeal: _existing, ...missing } = content; void _existing;
      await constrained(insert("LegacyDirectAdmissionVersion", changedContent(data, missing)));
    }
    expect(await versions(parent)).toEqual([]);
    await insert("LegacyDirectAdmissionVersion", data);
    expect(await row("LegacyDirectAdmissionVersion", data.id)).toMatchObject(data);
    expect((await row("LegacyDirectAdmissionVersion", data.id))?.content).toEqual(content);
  }
  for (const changed of [{ campaignId: other.campaign.id }, { brandUserId: f.target.userId }, { provenance: "UNKNOWN" }, { capability: "READ_ALL" }]) {
    await constrained(insert("LegacyDirectAdmission", { ...parentData(f), ...changed }), ["23503", "23514"]);
  }
  // The stored original users never follow mutable profile ownership.
  const replacement = await nativeDealActor(await user("CREATOR"));
  await prisma.creator.update({ where: { id: f.target.id }, data: { userId: replacement.actor.userId } });
  const retained = await aggregate(f, "CONTINUE_PINNED_DEAL"), retainedVersion = versionData(f, retained);
  await insert("LegacyDirectAdmissionVersion", retainedVersion);
  expect(await row("LegacyDirectAdmission", retained.id)).toMatchObject({ creatorUserId: f.target.userId });
  // Full central printable ASCII IDs, including literal '*', remain exact.
  expect(await row("LegacyDirectAdmission", "*")).toBeUndefined(); // Do not register/delete an existing unowned sentinel ID.
  const literalStar = await aggregate(other, "FRESH_PINNED_SCOPE", "*");
  await insert("LegacyDirectAdmissionVersion", versionData(other, literalStar));
  expect((await row("LegacyDirectAdmission", "*"))?.id).toBe("*");
  const wholeSecond = await aggregate(f), wholeSecondData = versionData(f, wholeSecond);
  const originalContent = { ...wholeSecondData.content, validity: { validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z", recheckAt: "2026-12-31T23:59:59Z" } };
  expect(LegacyDirectAdmissionContentSchema.parse(originalContent)).toEqual(originalContent);
  await insert("LegacyDirectAdmissionVersion", { ...wholeSecondData, content: originalContent, sourceHash: canonicalHash(originalContent) });
  expect((await row("LegacyDirectAdmissionVersion", wholeSecondData.id))?.content).toEqual(originalContent);
}, 90000);

function latch<T>() {
  let resolve!: (input: T | PromiseLike<T>) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (input: T) => resolve(input) };
}
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function waitForBlock(monitor: PrismaClient, waitingPid: number, blockingPid: number, table: string) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
      AND pid=${waitingPid} AND wait_event_type='Lock' AND ${blockingPid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${`%"${table}"%`}`;
    if (rows.length === 1) return rows[0]!.pid;
    await delay(20);
  }
  throw new Error("Admission writer/probe never reached its required actual native lock wait");
}
async function waitForParentBlock(monitor: PrismaClient, waitingPid: number, firstPid: number, holderPid: number, parentId: string) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT DISTINCT b.pid FROM pg_stat_activity b
      JOIN pg_locks tuple_lock ON tuple_lock.pid=b.pid AND tuple_lock.locktype='tuple'
        AND tuple_lock.relation='"LegacyDirectAdmission"'::regclass AND tuple_lock.mode='AccessExclusiveLock'
      JOIN "LegacyDirectAdmission" parent ON parent.id=${parentId}
        AND parent.ctid=('(' || tuple_lock.page || ',' || tuple_lock.tuple || ')')::tid
      WHERE b.datname=current_database() AND b.pid=${waitingPid} AND b.wait_event_type='Lock'
        AND b.query LIKE '%"LegacyDirectAdmissionVersion"%'
        AND ((NOT tuple_lock.granted AND ${firstPid}=ANY(pg_blocking_pids(b.pid))
          AND ${holderPid}=ANY(pg_blocking_pids(${firstPid}::int))
          AND EXISTS(SELECT 1 FROM pg_locks a_lock WHERE a_lock.pid=${firstPid} AND a_lock.locktype='tuple'
            AND a_lock.relation=tuple_lock.relation AND a_lock.page=tuple_lock.page AND a_lock.tuple=tuple_lock.tuple
            AND a_lock.mode='AccessExclusiveLock' AND a_lock.granted))
          OR (tuple_lock.granted AND ${holderPid}=ANY(pg_blocking_pids(b.pid))
            AND EXISTS(SELECT 1 FROM pg_locks tx_lock WHERE tx_lock.pid=b.pid AND tx_lock.locktype='transactionid'
              AND tx_lock.mode='ShareLock' AND NOT tx_lock.granted)))`;
    if (rows.length === 1) return rows[0]!.pid;
    await delay(20);
  }
  throw new Error("Admission writer B never reached the exact native parent tuple/direct-or-queued blocking chain");
}

it("keeps parent/version history immutable and enforces consecutive append, exact/latest lifecycle pointers and terminal revocation", async () => {
  await requireStorage(); const f = await sourceFixture(), a = await aggregate(f, "CONTINUE_PINNED_DEAL"), b = await aggregate(f);
  const first = versionData(f, a), other = versionData(f, b);
  await insert("LegacyDirectAdmissionVersion", first); await insert("LegacyDirectAdmissionVersion", other);
  const initial = await row("LegacyDirectAdmissionState", a.id);
  const noState = parentData(f); await insert("LegacyDirectAdmission", noState);
  await constrained(insert("LegacyDirectAdmissionVersion", versionData(f, noState)));
  for (const changed of [{ revision: 2 }, { state: "ACTIVE", ...pointer(first) }, { state: "PAUSED", ...pointer(first) },
    { state: "REVOKED" }, { state: "DRAFT", ...pointer(first) }, { updatedAt: new Date(noState.createdAt.getTime() - 1) }]) {
    await constrained(insert("LegacyDirectAdmissionState", stateData(noState, changed)), ["23503", "23514"]);
  }
  await insert("LegacyDirectAdmissionState", stateData(noState));
  for (const number of [0, 1, 3, 2147483647]) {
    const candidate = versionData(f, a), content = { ...candidate.content, version: number };
    await constrained(insert("LegacyDirectAdmissionVersion", { ...changedContent(candidate, content), version: number }), ["23514", "23505"]);
  }
  for (const changed of [{ id: key() }, { provenance: "LIVE" }, { capability: "FRESH_PINNED_SCOPE" }, { createdAt: new Date() },
    { campaignId: key() }, { brandId: key() }, { brandUserId: key() }, { creatorId: key() }, { creatorUserId: key() }]) {
    await constrained(patch("LegacyDirectAdmission", a.id, changed));
  }
  for (const changed of [{ id: key() }, { admissionId: b.id }, { provenance: "LIVE" }, { capability: "FRESH_PINNED_SCOPE" },
    { version: 2 }, { content: { ...first.content, manifest: { id: "another", entryId: "another" } } },
    { sourceHash: "b".repeat(64) }, { sourceOperationKey: "replacement-key" }, { createdAt: new Date() }]) {
    await constrained(patch("LegacyDirectAdmissionVersion", first.id, changed));
  }
  for (const changed of [{ revision: 1 }, { revision: 3 }, { admissionId: b.id }, { createdAt: new Date() },
    { updatedAt: new Date(a.createdAt.getTime()) }, pointer(other), { ...pointer(first), currentVersionNumber: 2 },
    { ...pointer(first), currentSourceHash: "a".repeat(64) }, { currentVersionId: null }, { currentVersionNumber: null }, { currentSourceHash: null }]) {
    await constrained(patch("LegacyDirectAdmissionState", a.id, { ...updateData(a, 2, "ACTIVE", first), ...changed }), ["23503", "23514"]);
  }
  expect(await row("LegacyDirectAdmissionState", a.id)).toEqual(initial);
  await patch("LegacyDirectAdmissionState", a.id, updateData(a, 2, "ACTIVE", first));
  const second = versionData(f, a, 2); await insert("LegacyDirectAdmissionVersion", second);
  await constrained(patch("LegacyDirectAdmissionState", a.id, updateData(a, 3, "ACTIVE", first)));
  await patch("LegacyDirectAdmissionState", a.id, updateData(a, 3, "ACTIVE", second));
  await constrained(patch("LegacyDirectAdmissionState", a.id, { ...updateData(a, 4, "DRAFT"), currentVersionId: null, currentVersionNumber: null, currentSourceHash: null }));
  await constrained(patch("LegacyDirectAdmissionState", a.id, updateData(a, 4, "PAUSED", first)));
  await patch("LegacyDirectAdmissionState", a.id, updateData(a, 4, "PAUSED", second));
  await constrained(patch("LegacyDirectAdmissionState", a.id, updateData(a, 5, "REVOKED", first)));
  await patch("LegacyDirectAdmissionState", a.id, updateData(a, 5, "REVOKED", second));
  const revoked = await row("LegacyDirectAdmissionState", a.id);
  for (const state of ["DRAFT", "ACTIVE", "PAUSED", "REVOKED"]) {
    await constrained(patch("LegacyDirectAdmissionState", a.id, updateData(a, 6, state, second)));
  }
  await constrained(insert("LegacyDirectAdmissionVersion", versionData(f, a, 3)));
  expect(await row("LegacyDirectAdmissionState", a.id)).toEqual(revoked);
  expect((await versions(a)).map(saved => saved.version)).toEqual([1, 2]);
  await patch("LegacyDirectAdmissionState", noState.id, updateData(noState, 2, "REVOKED"));
  expect(await row("LegacyDirectAdmissionState", noState.id)).toMatchObject({ state: "REVOKED", currentVersionId: null, currentVersionNumber: null, currentSourceHash: null });
  await constrained(insert("LegacyDirectAdmissionVersion", versionData(f, noState)));
}, 90000);

it("uses source-before-parent locks and one ordinal race winner, with UTC bounds and losing transaction orphan rollback", async () => {
  await requireStorage(); const f = await sourceFixture(), parent = await aggregate(f);
  const first = versionData(f, parent), second = versionData(f, parent);
  const sideA = parentData(f), sideB = parentData(f);
  const blocker = new PrismaClient(), writerA = new PrismaClient(), writerB = new PrismaClient(), sourceProbe = new PrismaClient(), monitor = new PrismaClient();
  const ready = latch<number>(), release = latch<void>(), aStarted = latch<number>(), bStarted = latch<number>(), probeStarted = latch<number>();
  let attemptA: Promise<void> | undefined, attemptB: Promise<void> | undefined, probing: Promise<void> | undefined;
  const holding = blocker.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
    // NO KEY UPDATE permits the FK's KEY SHARE; a wait here proves the stronger
    // append guard lock, not merely a native FK or duplicate ordinal-index wait.
    await tx.$queryRaw`SELECT id FROM "LegacyDirectAdmission" WHERE id=${parent.id} FOR NO KEY UPDATE`;
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(pid!); await release.promise;
  }, { maxWait: 5000, timeout: 18000 }); void holding.catch(() => {});
  async function write(client: PrismaClient, side: Parent, candidate: Version, started: ReturnType<typeof latch<number>>) {
    await client.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      started.resolve(pid!);
      await insert("LegacyDirectAdmission", side, tx); // Real tentative side effect, rolled back for the loser.
      await insert("LegacyDirectAdmissionVersion", candidate, tx);
    }, { maxWait: 5000, timeout: 18000 });
  }
  try {
    const blockingPid = await Promise.race([ready.promise, holding.then(() => { throw new Error("Admission parent blocker exited before ready"); })]);
    attemptA = write(writerA, sideA, first, aStarted); void attemptA.catch(() => {});
    const pidA = await Promise.race([aStarted.promise, attemptA.then(() => { throw new Error("Admission writer A exited before ready"); })]);
    expect(await Promise.race([waitForBlock(monitor, pidA, blockingPid, "LegacyDirectAdmissionVersion"),
      attemptA.then(() => { throw new Error("Admission writer A returned before its parent wait"); })])).toBe(pidA);
    attemptB = write(writerB, sideB, second, bStarted); void attemptB.catch(() => {});
    const pidB = await Promise.race([bStarted.promise, attemptB.then(() => { throw new Error("Admission writer B exited before ready"); })]);
    expect(pidB).toBeGreaterThan(0);
    expect(await Promise.race([waitForParentBlock(monitor, pidB, pidA, blockingPid, parent.id),
      attemptB.then(() => { throw new Error("Admission writer B returned before its parent wait"); })])).toBe(pidB);
    // While A is demonstrably awaiting parent, this actual separate connection
    // must await A's previously acquired exact journal lock. The FK runs after
    // BEFORE INSERT guards, so its later KEY SHARE cannot substitute for this.
    probing = sourceProbe.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      probeStarted.resolve(pid!);
      await tx.$queryRaw`SELECT id FROM "CampaignCommand" WHERE id=${f.campaignSource.id} FOR UPDATE`;
    }, { maxWait: 5000, timeout: 18000 }); void probing.catch(() => {});
    const probePid = await Promise.race([probeStarted.promise, probing.then(() => { throw new Error("Source probe exited before ready"); })]);
    expect(await Promise.race([waitForBlock(monitor, probePid, pidA, "CampaignCommand"),
      probing.then(() => { throw new Error("Version writer did not hold its native source before parent"); })])).toBe(probePid);
    release.resolve(); await holding;
    const outcomes = await Promise.allSettled([attemptA, attemptB]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const failed = outcomes.find(outcome => outcome.status === "rejected");
    expect(failed?.status).toBe("rejected");
    if (failed?.status !== "rejected") throw new Error("Expected one actual losing admission writer");
    rejectedSql(failed.reason, ["23514", "23505"]);
    await probing;
    const saved = await versions(parent); expect(saved).toHaveLength(1); expect(saved[0]?.version).toBe(1);
    const winner = outcomes[0]?.status === "fulfilled" ? first : second;
    expect(saved[0]?.id).toBe(winner.id);
    expect((saved[0]?.createdAt as Date).toISOString()).toBe(winner.createdAt.toISOString());
    for (const [index, side] of [sideA, sideB].entries()) {
      expect(Boolean(await row("LegacyDirectAdmission", side.id))).toBe(outcomes[index]?.status === "fulfilled");
      expect(await row("LegacyDirectAdmissionState", side.id)).toBeUndefined();
      expect(await versions(side)).toEqual([]);
    }
  } finally {
    release.resolve(); await holding.catch(() => {});
    await Promise.allSettled([attemptA, attemptB, probing].filter((promise): promise is Promise<void> => promise !== undefined));
    await Promise.all([blocker.$disconnect(), writerA.$disconnect(), writerB.$disconnect(), sourceProbe.$disconnect(), monitor.$disconnect()]);
  }

  const bounded = await aggregate(f), candidate = versionData(f, bounded);
  for (const createdAt of [new Date(bounded.createdAt.getTime() - 1), "0000-01-01T00:00:00.000Z", "10000-01-01T00:00:00.000Z"]) {
    await constrained(insert("LegacyDirectAdmissionVersion", { ...candidate, createdAt }), ["23514", "22007", "22008"]);
  }
  for (const sourceHash of ["A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
    await constrained(insert("LegacyDirectAdmissionVersion", { ...candidate, sourceHash }));
  }
  // Tight field bounds make huge known fields malformed. Verify native bounded,
  // null-safe rejection without invoking/claiming the runtime canonical codec.
  for (const size of [cap + 1, 524289]) {
    const content = replaced(candidate.content, ["manifest", "entryId"], "x".repeat(size));
    expect(Buffer.byteLength(JSON.stringify(content), "utf8")).toBeGreaterThan(cap);
    await constrained(insert("LegacyDirectAdmissionVersion", { ...candidate, content }));
  }
  expect(await versions(bounded)).toEqual([]);
  await insert("LegacyDirectAdmissionVersion", candidate);
  expect(((await row("LegacyDirectAdmissionVersion", candidate.id))?.createdAt as Date).toISOString()).toBe(candidate.createdAt.toISOString());
  expect(((await row("LegacyDirectAdmissionState", bounded.id))?.createdAt as Date).toISOString()).toBe(stateData(bounded).createdAt.toISOString());
  const rolledBack = parentData(f), invalid = versionData(f, rolledBack);
  await constrained(prisma.$transaction(async tx => {
    await insert("LegacyDirectAdmission", rolledBack, tx);
    await insert("LegacyDirectAdmissionState", stateData(rolledBack), tx);
    await insert("LegacyDirectAdmissionVersion", { ...invalid, sourceActorUserId: f.target.userId }, tx);
  }));
  expect(await row("LegacyDirectAdmission", rolledBack.id)).toBeUndefined();
  expect(await row("LegacyDirectAdmissionState", rolledBack.id)).toBeUndefined();
  expect(await versions(rolledBack)).toEqual([]);
}, 90000);

it("retains native sources and rejects surviving-parent state deletion/reset while atomic owned teardown commits before native cleanup", async () => {
  await requireStorage(); const f = await sourceFixture(), fresh = await aggregate(f), continued = await aggregate(f, "CONTINUE_PINNED_DEAL");
  const first = versionData(f, fresh), latest = versionData(f, fresh, 2), oldDeal = versionData(f, continued);
  await insert("LegacyDirectAdmissionVersion", first); await insert("LegacyDirectAdmissionVersion", latest);
  await insert("LegacyDirectAdmissionVersion", oldDeal);
  await patch("LegacyDirectAdmissionState", fresh.id, updateData(fresh, 2, "ACTIVE", latest));
  for (const operation of [
    () => prisma.$executeRaw`DELETE FROM "CampaignCommand" WHERE id=${f.campaignSource.id}`,
    () => prisma.$executeRaw`DELETE FROM "DealCommand" WHERE id=${f.dealSource.id}`,
    () => prisma.$executeRaw`DELETE FROM "CampaignBrief" WHERE id=${f.brief.id}`,
    () => prisma.$executeRaw`DELETE FROM "DealOffer" WHERE id=${f.firstOffer.id}`,
    () => prisma.$executeRaw`DELETE FROM "Deal" WHERE id=${f.deal.id}`,
    () => prisma.$executeRaw`DELETE FROM "Campaign" WHERE id=${f.campaign.id}`,
    () => prisma.$executeRaw`DELETE FROM "Brand" WHERE id=${f.brandId}`,
    () => prisma.$executeRaw`DELETE FROM "Creator" WHERE id=${f.target.id}`,
    () => prisma.$executeRaw`DELETE FROM "User" WHERE id=${f.brandUserId}`,
    () => prisma.$executeRaw`DELETE FROM "User" WHERE id=${f.target.userId}`,
  ]) await constrained(operation(), retention);
  expect(await prisma.campaignCommand.findUnique({ where: { id: f.campaignSource.id } })).toEqual(f.campaignSource);
  expect(await prisma.dealCommand.findUnique({ where: { id: f.dealSource.id } })).toEqual(f.dealSource);
  expect(await prisma.campaignBrief.findUnique({ where: { id: f.brief.id } })).toEqual(f.brief);
  expect(await prisma.dealOffer.findUnique({ where: { id: f.firstOffer.id } })).toEqual(f.firstOffer);
  const before = await row("LegacyDirectAdmissionState", fresh.id);
  await constrained(prisma.$executeRaw`DELETE FROM "LegacyDirectAdmissionVersion" WHERE id=${first.id}`, ["23514", ...retention]); // Noncurrent history.
  await constrained(prisma.$executeRaw`DELETE FROM "LegacyDirectAdmissionVersion" WHERE id=${latest.id}`, ["23514", ...retention]);
  await constrained(prisma.$executeRaw`DELETE FROM "LegacyDirectAdmission" WHERE id=${fresh.id}`, ["23514", ...retention]);

  let deletedBeforeCommit = false;
  await deferredCommit(async client => {
    const deleted = await client.query('DELETE FROM "LegacyDirectAdmissionState" WHERE "admissionId"=$1', [fresh.id]);
    expect(deleted.rowCount).toBe(1);
    const absent = await client.query('SELECT * FROM "LegacyDirectAdmissionState" WHERE "admissionId"=$1', [fresh.id]);
    expect(absent.rows[0]).toBeUndefined();
    deletedBeforeCommit = true; // Body succeeded; the deferred guard must reject COMMIT.
  });
  expect(deletedBeforeCommit).toBe(true);
  expect(await row("LegacyDirectAdmissionState", fresh.id)).toEqual(before);
  await constrained(prisma.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM "LegacyDirectAdmissionState" WHERE "admissionId"=${fresh.id}`;
    await insert("LegacyDirectAdmissionState", stateData(fresh), tx); // Retained versions forbid recreation/reset.
  }));
  expect(await row("LegacyDirectAdmissionState", fresh.id)).toEqual(before);
  expect((await versions(fresh)).map(saved => saved.version)).toEqual([1, 2]);
  // Removing versions in the same transaction still cannot reset a surviving
  // identity: the deferred deletion event checks parent absence at COMMIT.
  await deferredCommit(async client => {
    await client.query('DELETE FROM "LegacyDirectAdmissionState" WHERE "admissionId"=$1', [fresh.id]);
    await client.query('DELETE FROM "LegacyDirectAdmissionVersion" WHERE "admissionId"=$1', [fresh.id]);
    const initial = stateData(fresh);
    await client.query('INSERT INTO "LegacyDirectAdmissionState" ("admissionId",revision,state,"currentVersionId","currentVersionNumber","currentSourceHash","createdAt","updatedAt") VALUES ($1,1,\'DRAFT\',NULL,NULL,NULL,$2::timestamp(3),$3::timestamp(3))',
      [fresh.id, initial.createdAt.toISOString(), initial.updatedAt.toISOString()]);
  });
  expect(await row("LegacyDirectAdmissionState", fresh.id)).toEqual(before);
  expect((await versions(fresh)).map(saved => saved.version)).toEqual([1, 2]);
  const empty = await aggregate(f);
  let emptyDeletedBeforeCommit = false;
  await deferredCommit(async client => {
    const deleted = await client.query('DELETE FROM "LegacyDirectAdmissionState" WHERE "admissionId"=$1', [empty.id]);
    expect(deleted.rowCount).toBe(1);
    emptyDeletedBeforeCommit = true;
  });
  expect(emptyDeletedBeforeCommit).toBe(true);
  expect(await row("LegacyDirectAdmissionState", empty.id)).toMatchObject({ revision: 1, state: "DRAFT" });

  await cleanupAggregates([continued.id, fresh.id, empty.id, fresh.id]); // Dedupe/sort and atomic State→Versions→Parent, then COMMIT.
  for (const parent of [fresh, continued, empty]) {
    expect(await row("LegacyDirectAdmission", parent.id)).toBeUndefined();
    expect(await row("LegacyDirectAdmissionState", parent.id)).toBeUndefined();
    expect(await versions(parent)).toEqual([]);
  }
  // All actual native sources still exist AFTER aggregate teardown commits.
  expect(await prisma.campaignCommand.count({ where: { id: f.campaignSource.id } })).toBe(1);
  expect(await prisma.dealCommand.count({ where: { id: f.dealSource.id } })).toBe(1);
  expect(await prisma.campaignBrief.count({ where: { id: f.brief.id } })).toBe(1);
  expect(await prisma.dealOffer.count({ where: { id: f.firstOffer.id } })).toBe(1);
  await cleanup(); // Only now delete native fixtures; no TRUNCATE/trigger/FK bypass.
  expect(await prisma.campaign.findUnique({ where: { id: f.campaign.id } })).toBeNull();
  expect(await prisma.campaignBrief.findUnique({ where: { id: f.brief.id } })).toBeNull();
  expect(await prisma.deal.findUnique({ where: { id: f.deal.id } })).toBeNull();
  expect(await prisma.dealOffer.findUnique({ where: { id: f.firstOffer.id } })).toBeNull();
  expect(await prisma.campaignCommand.findUnique({ where: { id: f.campaignSource.id } })).toBeNull();
  expect(await prisma.dealCommand.findUnique({ where: { id: f.dealSource.id } })).toBeNull();
}, 90000);
