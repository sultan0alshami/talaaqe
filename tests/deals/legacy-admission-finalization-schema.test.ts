import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
import { Client, DatabaseError } from "pg";
import { afterEach, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { createCampaign, generateCampaignBrief, approveCampaignBrief } from "@/lib/campaigns/service";
import { createDealOffer, applyDealCommand } from "@/lib/deals/service";
import { LegacyDirectAdmissionContentSchema, LegacyDirectAdmissionManifestContentSchema } from "@/lib/deals/legacy-admission-contracts";
import { cleanup, nativeFixture } from "./fixtures";

// Exactly FOUR native guarded storage groups. Root alone adopts/runs.
// Existing23 helpers are copied, never imported as a registered test module.
// Actual producer rows/sessions and explicitly synthetic legal/ownership fixture
// evidence prove storage bindings only, not trusted review/import/CREATE semantics.
// No runtime authority, importer/API/global fixture bypass, mocks/reset or DDL.
// Four absent new tables are scaffold RED only, never behavioral validation.
type Table = "LegacyDirectAdmission" | "LegacyDirectAdmissionVersion" | "LegacyDirectAdmissionState"
  | "LegacyAdmissionManifest" | "LegacyAdmissionManifestEntry" | "LegacyAdmissionImportReceipt" | "FreshDealAdmissionLink";
type Fields = Record<string, unknown>;
type Db = PrismaClient | Prisma.TransactionClient;
const finalTables: Table[] = ["LegacyAdmissionManifest", "LegacyAdmissionManifestEntry", "LegacyAdmissionImportReceipt", "FreshDealAdmissionLink"];
const tables: Table[] = ["LegacyDirectAdmission", "LegacyDirectAdmissionVersion", "LegacyDirectAdmissionState", ...finalTables];
const owned = new Map<string, { users: string[]; brandId: string; creatorId: string; campaignId: string }>();
const manifests = new Set<string>(), key = () => randomUUID(), provenance = "DEVELOPMENT_FIXTURE";
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

function value(column: string, input: unknown) {
  if (input === null) return Prisma.sql`NULL`;
  if (column === "importKey") return Prisma.sql`${input}::uuid`;
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
  const column = table === "LegacyDirectAdmissionState" || table === "FreshDealAdmissionLink" ? "admissionId" : "id";
  return db.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')}
    SET ${Prisma.join(Object.entries(data).map(([name, input]) => Prisma.sql`${Prisma.raw('"' + name + '"')}=${value(name, input)}`))}
    WHERE ${Prisma.raw('"' + column + '"')}=${id}`);
}

async function row(table: Table, id: string, db: Db = prisma) {
  const column = table === "LegacyDirectAdmissionState" || table === "FreshDealAdmissionLink" ? "admissionId" : "id";
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

async function rejectsRepeatableRead(action: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let statementCompleted = false;
  await constrained(prisma.$transaction(async tx => {
    const [settings] = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
    expect(settings?.isolation).toBe('repeatable read');
    await action(tx);
    statementCompleted = true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 }));
  // A lifetime DELETE can otherwise fail only at deferred COMMIT. Unsupported
  // snapshot isolation must reject the actual mutation before it completes.
  expect(statementCompleted).toBe(false);
}

async function rejectsWhileHeld(operation: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([constrained(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Finalized deletion waited for held source/parent locks instead of rejecting safely')), 3000);
    })]);
  } finally { clearTimeout(timer); }
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
  owned.set(id, { users: [f.brandUserId, f.target.userId], brandId: f.brandId, creatorId: f.target.id, campaignId: f.campaign.id });
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

async function requireStorage() {
  for (const table of finalTables) expect(await exists(table), 'Frozen inert finalization table ' + table + ' must exist').toBe(true);
}
async function entryRow(manifestId: string, entryId: string) {
  return (await prisma.$queryRaw<Fields[]>`SELECT * FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=${manifestId} AND "entryId"=${entryId}`)[0];
}
async function cleanupGraph(requestedParents = [...owned.keys()], requestedManifests = [...manifests]) {
  const ids = [...new Set(requestedParents)].sort(), mids = [...new Set(requestedManifests)].sort();
  if (!ids.length && !mids.length) return;
  if (ids.some(id => !owned.has(id)) || mids.some(id => !manifests.has(id))) throw new Error('Refuse unowned finalization graph cleanup');
  const present = new Set<Table>(); for (const table of tables) if (await exists(table)) present.add(table);
  const memberQuery = Prisma.sql`SELECT * FROM "LegacyAdmissionManifestEntry" WHERE
    ${mids.length ? Prisma.sql`"manifestId" IN (${Prisma.join(mids)})` : Prisma.sql`FALSE`}
    OR ${ids.length ? Prisma.sql`"admissionId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`}`;
  const memberRows = present.has('LegacyAdmissionManifestEntry') ? await prisma.$queryRaw<Fields[]>(memberQuery) : [];
  if (memberRows.some(item => !mids.includes(String(item.manifestId)) || !ids.includes(String(item.admissionId)))) throw new Error('Refuse shared foreign entry graph cleanup');
  const versionQuery = Prisma.sql`SELECT * FROM "LegacyDirectAdmissionVersion" WHERE ${ids.length ? Prisma.sql`"admissionId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`}`;
  const linkQuery = Prisma.sql`SELECT * FROM "FreshDealAdmissionLink" WHERE
    ${ids.length ? Prisma.sql`"admissionId" IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`}
    OR ${mids.length ? Prisma.sql`"manifestId" IN (${Prisma.join(mids)})` : Prisma.sql`FALSE`}`;
  const versionRows = present.has('LegacyDirectAdmissionVersion') ? await prisma.$queryRaw<Fields[]>(versionQuery) : [];
  const linkRows = present.has('FreshDealAdmissionLink') ? await prisma.$queryRaw<Fields[]>(linkQuery) : [];
  if (linkRows.some(item => !ids.includes(String(item.admissionId)) || !mids.includes(String(item.manifestId)))) throw new Error('Refuse shared foreign receipt/link graph cleanup');
  const registrations = ids.map(id => owned.get(id)!);
  const brands = await prisma.brand.findMany({ where: { id: { in: registrations.map(item => item.brandId) } }, select: { userId: true } });
  const creators = await prisma.creator.findMany({ where: { id: { in: registrations.map(item => item.creatorId) } }, select: { userId: true } });
  const unique = (items: unknown[]) => [...new Set(items.filter((item): item is string => typeof item === 'string'))].sort();
  const userIds = unique([...registrations.flatMap(item => item.users), ...brands.map(item => item.userId), ...creators.map(item => item.userId)]);
  const native: Array<[string, string[]]> = [
    ['Brand', unique(registrations.map(item => item.brandId))], ['Creator', unique(registrations.map(item => item.creatorId))],
    ['Campaign', unique(registrations.map(item => item.campaignId))],
    ['Deal', unique([...versionRows.map(item => item.existingDealId), ...linkRows.map(item => item.dealId)])],
    ['DealOffer', unique([...versionRows.map(item => item.firstOfferId), ...linkRows.map(item => item.firstOfferId)])],
    ['CampaignBrief', unique([...versionRows.map(item => item.approvedBriefId), ...linkRows.map(item => item.approvedBriefId)])],
    ['CampaignCommand', unique(versionRows.map(item => item.campaignCommandId))],
    ['DealCommand', unique([...versionRows.map(item => item.dealCommandId), ...linkRows.map(item => item.createCommandId)])],
  ];
  await prisma.$transaction(async tx => {
    if (userIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`);
    for (const [table, nativeIds] of native) if (nativeIds.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw('"' + table + '"')} WHERE id IN (${Prisma.join(nativeIds)}) ORDER BY id FOR SHARE`);
    if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "LegacyDirectAdmission" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    if (versionRows.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "LegacyDirectAdmissionVersion" WHERE id IN (${Prisma.join(versionRows.map(item => String(item.id)).sort())}) ORDER BY id FOR UPDATE`);
    if (mids.length && present.has('LegacyAdmissionManifest')) await tx.$queryRaw(Prisma.sql`SELECT id FROM "LegacyAdmissionManifest" WHERE id IN (${Prisma.join(mids)}) ORDER BY id FOR UPDATE`);
    // Captures discover locks only. Refuse changed/shared inventories after all
    // parent/manifest locks; never acquire late native or foreign parent locks.
    const signature = (rows: Fields[]) => rows.map(item => JSON.stringify(item)).sort().join('\n');
    for (const [table, query, captured] of [
      ['LegacyAdmissionManifestEntry', memberQuery, memberRows], ['LegacyDirectAdmissionVersion', versionQuery, versionRows],
      ['FreshDealAdmissionLink', linkQuery, linkRows],
    ] as Array<[Table, Prisma.Sql, Fields[]]>) if (present.has(table) && signature(await tx.$queryRaw<Fields[]>(query)) !== signature(captured)) {
      throw new Error('Finalization cleanup inventory changed; refuse and retry before any deletion');
    }
    for (const [table, column, keys] of [
      ['LegacyDirectAdmissionState', 'admissionId', ids], ['FreshDealAdmissionLink', 'admissionId', ids],
      ['LegacyAdmissionImportReceipt', 'manifestId', mids], ['LegacyAdmissionManifestEntry', 'manifestId', mids],
      ['LegacyDirectAdmissionVersion', 'admissionId', ids], ['LegacyAdmissionManifest', 'id', mids], ['LegacyDirectAdmission', 'id', ids],
    ] as Array<[Table, string, string[]]>) if (keys.length && present.has(table)) await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE ${Prisma.raw('"' + column + '"')} IN (${Prisma.join(keys)})`);
  }); // Whole owned graph COMMIT, then and only then original native cleanup.
  for (const id of ids) owned.delete(id); for (const id of mids) manifests.delete(id);
}
afterEach(async () => { await cleanupGraph(); await cleanup(); });

async function bundle(f: Fixture, capabilities: Capability[] = ['FRESH_PINNED_SCOPE', 'CONTINUE_PINNED_DEAL'], existing?: { parent: Parent; version: number }) {
  const manifestId = 'manifest~synthetic:' + key(); manifests.add(manifestId);
  const slots = [];
  for (const capability of capabilities) {
    const parent = existing?.parent ?? await aggregate(f, capability), base = versionData(f, parent, existing?.version ?? 1), entryId = 'entry~synthetic:' + key();
    const content = { ...base.content, manifest: { id: manifestId, entryId } };
    const data = { ...base, content, sourceHash: canonicalHash(content), manifestId, manifestEntryId: entryId };
    await insert('LegacyDirectAdmissionVersion', data);
    slots.push({ parent, data });
  }
  const createdAt = new Date(Math.max(Date.now(), ...slots.map(slot => slot.data.createdAt.getTime())) + 10);
  const content = LegacyDirectAdmissionManifestContentSchema.parse({ schemaVersion: 1, manifestId, provenance,
    createdAt: createdAt.toISOString(), reviewReferenceOriginal: { text: '  مرجع تخزين اصطناعي\nSynthetic storage reference only  ', language: 'ar' },
    entries: slots.map(slot => ({ entryId: slot.data.manifestEntryId, admissionId: slot.parent.id, version: slot.data.version, sourceHash: slot.data.sourceHash })) });
  const manifest = { id: manifestId, provenance, content, digest: canonicalHash(content), createdAt };
  const entries = slots.map((slot, index) => ({ manifestId, entryId: slot.data.manifestEntryId, ordinal: index + 1,
    versionId: slot.data.id, admissionId: slot.parent.id, provenance, capability: slot.parent.capability,
    version: slot.data.version, sourceHash: slot.data.sourceHash, createdAt: new Date(createdAt.getTime() + index + 1) }));
  const receipt = { id: 'import~synthetic:' + key(), importKey: key(), manifestId, provenance, digest: manifest.digest,
    bundleHash: canonicalHash({ manifest: content, versions: slots.map(slot => slot.data.content) }), verifierVersion: 'storage-witness-v1',
    entryCount: entries.length, createdAt: new Date(createdAt.getTime() + 100) };
  return { f, slots, manifest, entries, receipt };
}
type Bundle = Awaited<ReturnType<typeof bundle>>;
async function store(b: Bundle, count = b.entries.length) {
  await insert('LegacyAdmissionManifest', b.manifest);
  for (const entry of b.entries.slice(0, count)) await insert('LegacyAdmissionManifestEntry', entry);
}
async function finalized(f: Fixture, capabilities?: Capability[]) {
  const b = await bundle(f, capabilities); await store(b); await insert('LegacyAdmissionImportReceipt', b.receipt); return b;
}
function linkData(b: Bundle, index = 0, native = b.f) {
  const slot = b.slots[index]!, entry = b.entries[index]!;
  return { admissionId: slot.parent.id, dealId: native.deal.id, versionId: slot.data.id, version: slot.data.version,
    sourceHash: slot.data.sourceHash, provenance, capability: 'FRESH_PINNED_SCOPE', manifestId: entry.manifestId, manifestEntryId: entry.entryId,
    digest: b.manifest.digest, importReceiptId: b.receipt.id, firstOfferId: native.firstOffer.id, firstOfferVersion: 1,
    brandUserId: native.firstOffer.proposerUserId, creatorUserId: native.firstOffer.recipientUserId,
    approvedBriefId: b.f.brief.id, approvedBriefVersion: b.f.brief.version,
    createCommandId: native.dealSource.id, createOperationKey: native.dealSource.operationKey,
    createPayloadHash: native.dealSource.payloadHash, createResultHash: canonicalHash(native.dealSource.result),
    createdAt: new Date(Math.max(b.receipt.createdAt.getTime(), native.deal.createdAt.getTime()) + 1) };
}

it('binds exact ordered members/provenance/hash/version tuples, rejects Repeatable Read mutations, accepts Serializable and keeps all four records immutable and inert', async () => {
  await requireStorage(); const f = await sourceFixture(), b = await bundle(f), foreign = await bundle(f);
  const content = b.manifest.content, first = content.entries[0]!, second = content.entries[1]!;
  const withoutCreatedAt: Fields = { ...content }; delete withoutCreatedAt.createdAt;
  const withoutReference: Fields = { ...content }; delete withoutReference.reviewReferenceOriginal;
  const missingReferenceLanguage: Fields = { ...content.reviewReferenceOriginal }; delete missingReferenceLanguage.language;
  for (const envelopeMismatch of [{ ...content, manifestId: foreign.manifest.id }, { ...content, provenance: 'LIVE' }]) {
    expect(LegacyDirectAdmissionManifestContentSchema.safeParse(envelopeMismatch).success).toBe(true);
    await constrained(insert('LegacyAdmissionManifest', { ...b.manifest, content: envelopeMismatch }), ['23514']);
  }
  const malformedManifests = [
    { ...content, unknownAuthority: true }, { ...content, schemaVersion: '1' },
    withoutCreatedAt, withoutReference, { ...content, manifestId: 123 }, { ...content, manifestId: 'unsafe identifier' },
    { ...content, createdAt: 123 }, { ...content, createdAt: '2026-02-30T00:00:00.000Z' },
    { ...content, createdAt: '2026-01-01T00:00:00.000+00:00' }, { ...content, createdAt: '2026-01-01T00:00:00.0Z' },
    { ...content, reviewReferenceOriginal: 'original reference' },
    { ...content, reviewReferenceOriginal: { ...content.reviewReferenceOriginal, text: 123 } },
    { ...content, reviewReferenceOriginal: { ...content.reviewReferenceOriginal, text: ' \n\t ' } },
    { ...content, reviewReferenceOriginal: { ...content.reviewReferenceOriginal, text: 'unsafe\u0001reference' } },
    { ...content, reviewReferenceOriginal: { ...content.reviewReferenceOriginal, text: 'x'.repeat(2001) } },
    { ...content, reviewReferenceOriginal: { ...content.reviewReferenceOriginal, language: 123 } },
    { ...content, reviewReferenceOriginal: { ...content.reviewReferenceOriginal, language: 'invalid_language' } },
    { ...content, reviewReferenceOriginal: { ...content.reviewReferenceOriginal, unknownAuthority: true } },
    { ...content, reviewReferenceOriginal: missingReferenceLanguage },
    { ...content, entries: [{ ...first, version: '1' }, second] },
    { ...content, entries: [{ ...first, entryId: 123 }, second] },
    { ...content, entries: [{ ...first, admissionId: 123 }, second] },
    { ...content, entries: [{ ...first, entryId: 'unsafe identifier' }, second] },
    { ...content, entries: [{ ...first, unknownAuthority: true }, second] },
    { ...content, entries: [first, { ...second, entryId: first.entryId }] },
    { ...content, entries: [first, { ...second, admissionId: first.admissionId, version: first.version }] },
  ];
  for (const malformed of malformedManifests) {
    expect(LegacyDirectAdmissionManifestContentSchema.safeParse(malformed).success).toBe(false);
    await constrained(insert('LegacyAdmissionManifest', { ...b.manifest, content: malformed }), ['23514']);
  }
  await insert('LegacyAdmissionManifest', b.manifest); await store(foreign);
  await rejectsRepeatableRead(tx => insert('LegacyAdmissionManifestEntry', b.entries[0]!, tx));
  expect(await entryRow(b.entries[0]!.manifestId, b.entries[0]!.entryId)).toBeUndefined();
  for (const [index, entry] of b.entries.entries()) {
    for (const changed of [{ manifestId: foreign.manifest.id }, { entryId: foreign.entries[index]!.entryId }, { ordinal: index === 0 ? 2 : 1 },
      { versionId: foreign.slots[index]!.data.id }, { admissionId: foreign.slots[index]!.parent.id }, { provenance: 'LIVE' },
      { capability: entry.capability === 'FRESH_PINNED_SCOPE' ? 'CONTINUE_PINNED_DEAL' : 'FRESH_PINNED_SCOPE' },
      { version: 2 }, { sourceHash: 'a'.repeat(64) }]) {
      await constrained(insert('LegacyAdmissionManifestEntry', { ...entry, ...changed }), ['23503', '23514']);
    }
    await insert('LegacyAdmissionManifestEntry', entry);
    expect(await entryRow(entry.manifestId, entry.entryId)).toMatchObject(entry);
  }
  await rejectsRepeatableRead(tx => tx.$executeRaw`DELETE FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=${b.entries[0]!.manifestId} AND "entryId"=${b.entries[0]!.entryId}`);
  expect(await entryRow(b.entries[0]!.manifestId, b.entries[0]!.entryId)).toMatchObject(b.entries[0]!);
  for (const changed of [{ provenance: 'LIVE' }, { digest: foreign.manifest.digest }, { entryCount: 1 }, { entryCount: 3 }, { manifestId: foreign.manifest.id }]) {
    await constrained(insert('LegacyAdmissionImportReceipt', { ...b.receipt, ...changed }), ['23503', '23514']);
  }
  await rejectsRepeatableRead(tx => insert('LegacyAdmissionImportReceipt', b.receipt, tx));
  expect(await row('LegacyAdmissionImportReceipt', b.receipt.id)).toBeUndefined();
  await insert('LegacyAdmissionImportReceipt', b.receipt);
  await rejectsRepeatableRead(tx => tx.$executeRaw`DELETE FROM "LegacyAdmissionImportReceipt" WHERE id=${b.receipt.id}`);
  expect(await row('LegacyAdmissionImportReceipt', b.receipt.id)).toMatchObject(b.receipt);
  const link = linkData(b);
  await rejectsRepeatableRead(tx => insert('FreshDealAdmissionLink', link, tx));
  expect(await row('FreshDealAdmissionLink', link.admissionId)).toBeUndefined();
  await insert('FreshDealAdmissionLink', link);
  await rejectsRepeatableRead(tx => tx.$executeRaw`DELETE FROM "FreshDealAdmissionLink" WHERE "admissionId"=${link.admissionId}`);
  expect(await row('FreshDealAdmissionLink', link.admissionId)).toMatchObject(link);
  expect(await row('LegacyAdmissionManifest', b.manifest.id)).toMatchObject(b.manifest);
  expect(await row('LegacyAdmissionImportReceipt', b.receipt.id)).toMatchObject(b.receipt);
  expect(await row('FreshDealAdmissionLink', link.admissionId)).toMatchObject(link);
  expect((await row('LegacyAdmissionManifest', b.manifest.id))?.content).toEqual(b.manifest.content);
  await constrained(patch('LegacyAdmissionManifest', b.manifest.id, { digest: 'b'.repeat(64) }));
  await constrained(prisma.$executeRaw`UPDATE "LegacyAdmissionManifestEntry" SET ordinal=2 WHERE "manifestId"=${b.entries[0]!.manifestId} AND "entryId"=${b.entries[0]!.entryId}`);
  await constrained(patch('LegacyAdmissionImportReceipt', b.receipt.id, { verifierVersion: 'replacement' }));
  await constrained(patch('FreshDealAdmissionLink', link.admissionId, { createOperationKey: 'replacement' }));
  expect(f.campaignSource.id).not.toBe(link.createCommandId);
  expect(link.createCommandId).toBe(f.dealSource.id); expect(link.createOperationKey).toBe(f.dealSource.operationKey);

  // Supported SERIALIZABLE still accepts the exact full finalization graph;
  // all earlier valid INSERTs and the race witnesses use default READ COMMITTED.
  const serialFixture = await sourceFixture(), serialBundle = await bundle(serialFixture, ['FRESH_PINNED_SCOPE']);
  const serialLink = linkData(serialBundle);
  await prisma.$transaction(async tx => {
    const [settings] = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
    expect(settings?.isolation).toBe('serializable');
    await insert('LegacyAdmissionManifest', serialBundle.manifest, tx);
    await insert('LegacyAdmissionManifestEntry', serialBundle.entries[0]!, tx);
    await insert('LegacyAdmissionImportReceipt', serialBundle.receipt, tx);
    await insert('FreshDealAdmissionLink', serialLink, tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
  expect(await row('LegacyAdmissionImportReceipt', serialBundle.receipt.id)).toMatchObject(serialBundle.receipt);
  expect(await row('FreshDealAdmissionLink', serialLink.admissionId)).toMatchObject(serialLink);
  for (const slot of [...b.slots, ...serialBundle.slots]) {
    expect(await row('LegacyDirectAdmissionState', slot.parent.id)).toMatchObject({ state: 'DRAFT', revision: 1,
      currentVersionId: null, currentVersionNumber: null, currentSourceHash: null });
  }
}, 90000);

function latch<T>() { let resolve!: (value: T | PromiseLike<T>) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function holdMutation(action: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), monitor = new PrismaClient(), ready = latch<number>(), release = latch<void>();
  const holding = peer.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='6s'`; await action(tx);
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    ready.resolve(pid!); await release.promise;
  }, { maxWait: 5000, timeout: 15000 }); void holding.catch(() => {});
  let pid: number;
  try { pid = await Promise.race([ready.promise, holding.then(() => { throw new Error('Finalization blocker exited before ready'); })]); }
  catch (error) { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); throw error; }
  return { pid, holding, monitor, release: () => release.resolve(), async close() { release.resolve(); await holding.catch(() => {}); await peer.$disconnect(); await monitor.$disconnect(); } };
}
async function waitForBlock(monitor: PrismaClient, waitingPid: number, blockingPid: number, table: string) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
      AND pid=${waitingPid} AND wait_event_type='Lock' AND ${blockingPid}=ANY(pg_blocking_pids(pid)) AND query LIKE ${'%"' + table + '"%'}`;
    if (rows.length === 1) return rows[0]!.pid; await delay(20);
  }
  throw new Error('Finalization operation did not reach the required actual parent/membership lock');
}
async function startedWrite(action: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const client = new PrismaClient(), started = latch<number>();
  const result = client.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout='6s'`;
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
    started.resolve(pid!); await action(tx);
  }, { maxWait: 5000, timeout: 15000 }); void result.catch(() => {});
  const pid = await Promise.race([started.promise, result.then(() => { throw new Error('Finalization writer exited before ready'); })]);
  return { result, pid, async close() { await result.catch(() => {}); await client.$disconnect(); } };
}

it('rejects incomplete/duplicate finalization, serializes deletion-first Receipt INSERT and safely aborts finalizer-first Entry DELETE without a broken bijection', async () => {
  await requireStorage(); const f = await sourceFixture(), incomplete = await bundle(f); await store(incomplete, 1);
  await constrained(insert('LegacyAdmissionImportReceipt', incomplete.receipt));
  expect(await row('LegacyAdmissionImportReceipt', incomplete.receipt.id)).toBeUndefined();
  await insert('LegacyAdmissionManifestEntry', incomplete.entries[1]!);
  await insert('LegacyAdmissionImportReceipt', incomplete.receipt);
  await constrained(insert('LegacyAdmissionImportReceipt', { ...incomplete.receipt, id: 'duplicate~' + key(), importKey: key() }), ['23505', '23514']);
  const sameKey = await bundle(f); await store(sameKey);
  await constrained(insert('LegacyAdmissionImportReceipt', { ...sameKey.receipt, importKey: incomplete.receipt.importKey }), ['23505']);
  expect(await row('LegacyAdmissionImportReceipt', sameKey.receipt.id)).toBeUndefined();

  const deletedFirst = await bundle(f); await store(deletedFirst); const target = deletedFirst.entries[0]!;
  const deletion = await holdMutation(tx => tx.$executeRaw`DELETE FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=${target.manifestId} AND "entryId"=${target.entryId}`);
  let importing: Awaited<ReturnType<typeof startedWrite>> | undefined;
  try {
    importing = await startedWrite(tx => insert('LegacyAdmissionImportReceipt', deletedFirst.receipt, tx));
    expect(await Promise.race([waitForBlock(deletion.monitor, importing.pid, deletion.pid, 'LegacyAdmissionImportReceipt'),
      importing.result.then(() => { throw new Error('Receipt returned before captured-parent membership wait'); })])).toBe(importing.pid);
    deletion.release(); await deletion.holding; await constrained(importing.result, ['23514', '40001']);
    expect(await row('LegacyAdmissionImportReceipt', deletedFirst.receipt.id)).toBeUndefined();
    expect(await entryRow(target.manifestId, target.entryId)).toBeUndefined();
    for (const slot of deletedFirst.slots) expect((await row('LegacyDirectAdmissionVersion', slot.data.id))?.content).toEqual(slot.data.content);
    await insert('LegacyAdmissionManifestEntry', target); await insert('LegacyAdmissionImportReceipt', deletedFirst.receipt);
  } finally { deletion.release(); await deletion.close(); await importing?.close(); }

  const importedFirst = await bundle(f); await store(importedFirst);
  const finalizing = await holdMutation(tx => insert('LegacyAdmissionImportReceipt', importedFirst.receipt, tx));
  let deleting: Awaited<ReturnType<typeof startedWrite>> | undefined;
  try {
    const entry = importedFirst.entries[0]!;
    deleting = await startedWrite(tx => tx.$executeRaw`DELETE FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=${entry.manifestId} AND "entryId"=${entry.entryId}`);
    // The actual Receipt INSERT already holds the captured parent/manifest and
    // remains uncommitted. DELETE must abort while it still holds its Entry
    // tuple, before waiting for those parents and forming a reverse FK cycle.
    await rejectsWhileHeld(deleting.result);
    finalizing.release(); await finalizing.holding;
    expect(await entryRow(entry.manifestId, entry.entryId)).toMatchObject(entry);
    expect(await row('LegacyAdmissionImportReceipt', importedFirst.receipt.id)).toMatchObject(importedFirst.receipt);
  } finally { finalizing.release(); await finalizing.close(); await deleting?.close(); }
}, 90000);

async function waitForParentBlock(monitor: PrismaClient, waitingPid: number, firstPid: number, holderPid: number, parentId: string) {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    const rows = await monitor.$queryRaw<Array<{ pid: number }>>`SELECT DISTINCT b.pid FROM pg_stat_activity b
      JOIN pg_locks tuple_lock ON tuple_lock.pid=b.pid AND tuple_lock.locktype='tuple'
        AND tuple_lock.relation='"LegacyDirectAdmission"'::regclass AND tuple_lock.mode='AccessExclusiveLock'
      JOIN "LegacyDirectAdmission" parent ON parent.id=${parentId}
        AND parent.ctid=('(' || tuple_lock.page || ',' || tuple_lock.tuple || ')')::tid
      WHERE b.datname=current_database() AND b.pid=${waitingPid} AND b.wait_event_type='Lock'
        AND b.query LIKE '%"FreshDealAdmissionLink"%'
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

async function cancelNative(f: Fixture, dealId: string) {
  const current = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
  await applyDealCommand(f.brandUserId, dealId, { action: 'CANCEL', operationKey: key(), expectedVersion: current.version,
    reason: { text: 'إلغاء اصطناعي لاختبار قيد الاستهلاك / Synthetic lifetime witness', language: 'ar' } },
    { policyVerifier: f.options.policyVerifier, serverAuth: f.brandSession.actor });
}
async function newNativeDeal(f: Fixture) {
  const command = { ...f.originalDealCreate, operationKey: key() };
  const made = await createDealOffer(f.brandUserId, command, { policyVerifier: f.options.policyVerifier, serverAuth: f.brandSession.actor });
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: made.deal.id } });
  const firstOffer = await prisma.dealOffer.findUniqueOrThrow({ where: { dealId_version: { dealId: deal.id, version: 1 } } });
  const dealSource = await prisma.dealCommand.findUniqueOrThrow({ where: { actorUserId_operationKey: { actorUserId: f.brandUserId, operationKey: command.operationKey } } });
  return { ...f, deal, firstOffer, dealSource, originalDealCreate: command };
}

it('binds new native Deal/firstOffer/CREATE pins separately from old Campaign source and consumes one lifetime link across keys, cancellation, versions and races', async () => {
  await requireStorage(); const f = await sourceFixture(), b = await finalized(f, ['FRESH_PINNED_SCOPE']);
  const foreignFixture = await sourceFixture(), foreign = await finalized(foreignFixture, ['FRESH_PINNED_SCOPE']);
  const link = linkData(b);
  for (const changed of [{ versionId: foreign.slots[0]!.data.id }, { version: 2 }, { sourceHash: 'a'.repeat(64) }, { provenance: 'LIVE' },
    { capability: 'CONTINUE_PINNED_DEAL' }, { manifestId: foreign.manifest.id }, { manifestEntryId: foreign.entries[0]!.entryId },
    { digest: foreign.manifest.digest }, { importReceiptId: foreign.receipt.id }, { dealId: foreignFixture.deal.id },
    { firstOfferId: foreignFixture.firstOffer.id }, { firstOfferVersion: 2 }, { brandUserId: f.target.userId }, { creatorUserId: f.brandUserId },
    { approvedBriefId: foreignFixture.brief.id }, { approvedBriefVersion: f.brief.version + 1 },
    { createCommandId: f.campaignSource.id }, { createCommandId: foreignFixture.dealSource.id },
    { createOperationKey: 'different-native-key' }, { createPayloadHash: 'b'.repeat(64) }, { createResultHash: 'c'.repeat(64) }]) {
    await constrained(insert('FreshDealAdmissionLink', { ...link, ...changed }), ['23503', '23514']);
  }
  const continuing = await finalized(f, ['CONTINUE_PINNED_DEAL']);
  await constrained(insert('FreshDealAdmissionLink', linkData(continuing)), ['23503', '23514']);
  await insert('FreshDealAdmissionLink', link);
  await constrained(insert('FreshDealAdmissionLink', link), ['23505', '23514']);
  await cancelNative(f, f.deal.id);
  const replacement = await newNativeDeal(f);
  expect(replacement.dealSource.operationKey).not.toBe(f.dealSource.operationKey);
  expect(replacement.deal.id).not.toBe(f.deal.id);
  await constrained(insert('FreshDealAdmissionLink', linkData(b, 0, replacement)), ['23505', '23514']);
  const later = await bundle(f, ['FRESH_PINNED_SCOPE'], { parent: b.slots[0]!.parent, version: 2 });
  await store(later); await insert('LegacyAdmissionImportReceipt', later.receipt);
  await constrained(insert('FreshDealAdmissionLink', linkData(later, 0, replacement)), ['23505', '23514']);
  expect(await row('FreshDealAdmissionLink', link.admissionId)).toMatchObject(link);

  const raced = await finalized(f, ['FRESH_PINNED_SCOPE']), candidate = linkData(raced, 0, replacement);
  const sideA = parentData(f), sideB = parentData(f);
  const held = await holdMutation(tx => tx.$queryRaw`SELECT id FROM "LegacyDirectAdmission" WHERE id=${candidate.admissionId} FOR NO KEY UPDATE`);
  let a: Awaited<ReturnType<typeof startedWrite>> | undefined, other: Awaited<ReturnType<typeof startedWrite>> | undefined, probe: Awaited<ReturnType<typeof startedWrite>> | undefined;
  try {
    a = await startedWrite(async tx => { await insert('LegacyDirectAdmission', sideA, tx); await insert('FreshDealAdmissionLink', candidate, tx); });
    expect(await Promise.race([waitForBlock(held.monitor, a.pid, held.pid, 'FreshDealAdmissionLink'),
      a.result.then(() => { throw new Error('Link A returned before its actual parent wait'); })])).toBe(a.pid);
    other = await startedWrite(async tx => { await insert('LegacyDirectAdmission', sideB, tx); await insert('FreshDealAdmissionLink', candidate, tx); });
    expect(await Promise.race([waitForParentBlock(held.monitor, other.pid, a.pid, held.pid, candidate.admissionId),
      other.result.then(() => { throw new Error('Link B returned before its exact parent queue wait'); })])).toBe(other.pid);
    probe = await startedWrite(tx => tx.$queryRaw`SELECT id FROM "DealCommand" WHERE id=${replacement.dealSource.id} FOR UPDATE`);
    expect(await Promise.race([waitForBlock(held.monitor, probe.pid, a.pid, 'DealCommand'),
      probe.result.then(() => { throw new Error('Link did not hold the actual new CREATE source before parent'); })])).toBe(probe.pid);
    held.release(); await held.holding;
    const results = await Promise.allSettled([a.result, other.result]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status !== 'rejected') throw new Error('Expected one actual lifetime-link loser');
    rejectedSql(failed.reason, ['23505', '23514']); await probe.result;
    expect(await row('FreshDealAdmissionLink', candidate.admissionId)).toMatchObject(candidate);
    for (const [index, side] of [sideA, sideB].entries()) expect(Boolean(await row('LegacyDirectAdmission', side.id))).toBe(results[index]?.status === 'fulfilled');
    expect(await prisma.dealCommand.findUnique({ where: { id: replacement.dealSource.id } })).toEqual(replacement.dealSource);
    expect(await prisma.dealOffer.findUnique({ where: { id: replacement.firstOffer.id } })).toEqual(replacement.firstOffer);
  } finally { held.release(); await held.close(); await Promise.all([a?.close(), other?.close(), probe?.close()]); }
}, 90000);

it('retains consumed receipts/reverse members and rejects surviving-parent Link reset at native COMMIT while preserving old unfinalized versions and atomic graph cleanup', async () => {
  await requireStorage(); const f = await sourceFixture();
  const oldParent = await aggregate(f), oldVersion = versionData(f, oldParent);
  await insert('LegacyDirectAdmissionVersion', oldVersion); // Unresolved IDs remain valid: no Version→Entry backlink/backfill.
  const oldBefore = await row('LegacyDirectAdmissionVersion', oldVersion.id);
  const b = await finalized(f), link = linkData(b);
  const parentHolder = await holdMutation(tx => tx.$queryRaw`SELECT id FROM "LegacyDirectAdmission" WHERE id=${link.admissionId} FOR NO KEY UPDATE`);
  let linking: Awaited<ReturnType<typeof startedWrite>> | undefined;
  let deletingMember: Awaited<ReturnType<typeof startedWrite>> | undefined;
  let deletingReceipt: Awaited<ReturnType<typeof startedWrite>> | undefined;
  try {
    linking = await startedWrite(tx => insert('FreshDealAdmissionLink', link, tx));
    expect(await Promise.race([waitForBlock(parentHolder.monitor, linking.pid, parentHolder.pid, 'FreshDealAdmissionLink'),
      linking.result.then(() => { throw new Error('Link returned before the actual retained-parent wait'); })])).toBe(linking.pid);
    const entry = b.entries[0]!;
    deletingMember = await startedWrite(tx => tx.$executeRaw`DELETE FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=${entry.manifestId} AND "entryId"=${entry.entryId}`);
    await rejectsWhileHeld(deletingMember.result);
    deletingReceipt = await startedWrite(tx => tx.$executeRaw`DELETE FROM "LegacyAdmissionImportReceipt" WHERE id=${b.receipt.id}`);
    await rejectsWhileHeld(deletingReceipt.result);
    // Both DELETEs relinquished their native Entry/Receipt tuple locks without
    // releasing the parent holder or allowing Link to take its automatic FKs.
    expect(await waitForBlock(parentHolder.monitor, linking.pid, parentHolder.pid, 'FreshDealAdmissionLink')).toBe(linking.pid);
    expect(await entryRow(entry.manifestId, entry.entryId)).toMatchObject(entry);
    expect(await row('LegacyAdmissionImportReceipt', b.receipt.id)).toMatchObject(b.receipt);
    parentHolder.release(); await parentHolder.holding; await linking.result;
    expect(await row('FreshDealAdmissionLink', link.admissionId)).toMatchObject(link);
  } finally {
    parentHolder.release(); await parentHolder.close();
    await Promise.all([linking?.close(), deletingMember?.close(), deletingReceipt?.close()]);
  }
  await constrained(prisma.$executeRaw`DELETE FROM "LegacyAdmissionImportReceipt" WHERE id=${b.receipt.id}`, retention);
  for (const entry of b.entries) await constrained(prisma.$executeRaw`DELETE FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=${entry.manifestId} AND "entryId"=${entry.entryId}`, ["23514", "23001", "23503"]);
  const continuing = b.slots[1]!;
  await constrained(prisma.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM "LegacyDirectAdmissionState" WHERE "admissionId"=${continuing.parent.id}`;
    await tx.$executeRaw`DELETE FROM "LegacyDirectAdmissionVersion" WHERE id=${continuing.data.id}`;
  }), retention); // State removed tentatively: the unconsumed reverse Entry FK itself must retain Version.
  expect(await row('LegacyDirectAdmissionState', continuing.parent.id)).toMatchObject({ state: 'DRAFT', revision: 1 });
  expect((await row('LegacyDirectAdmissionVersion', continuing.data.id))?.content).toEqual(continuing.data.content);
  expect(await entryRow(b.entries[1]!.manifestId, b.entries[1]!.entryId)).toMatchObject(b.entries[1]!);
  let deletedBeforeCommit = false;
  await deferredCommit(async client => {
    const deleted = await client.query('DELETE FROM "FreshDealAdmissionLink" WHERE "admissionId"=$1', [link.admissionId]);
    expect(deleted.rowCount).toBe(1);
    const absent = await client.query('SELECT * FROM "FreshDealAdmissionLink" WHERE "admissionId"=$1', [link.admissionId]);
    expect(absent.rows[0]).toBeUndefined(); deletedBeforeCommit = true;
  });
  expect(deletedBeforeCommit).toBe(true); expect(await row('FreshDealAdmissionLink', link.admissionId)).toMatchObject(link);
  await deferredCommit(async client => {
    await client.query('DELETE FROM "FreshDealAdmissionLink" WHERE "admissionId"=$1', [link.admissionId]);
    const fields = Object.entries(link); // Literal fixture constructor fields, never external identifiers.
    await client.query('INSERT INTO "FreshDealAdmissionLink" (' + fields.map(([column]) => '"' + column + '"').join(',') + ') VALUES ('
      + fields.map(([column], index) => '$' + (index + 1) + (column === 'createdAt' ? '::timestamp(3)' : '')).join(',') + ')',
      fields.map(([, input]) => input instanceof Date ? input.toISOString() : input));
  });
  expect(await row('FreshDealAdmissionLink', link.admissionId)).toMatchObject(link);
  expect(await row('LegacyAdmissionImportReceipt', b.receipt.id)).toMatchObject(b.receipt);
  expect(await row('LegacyDirectAdmissionVersion', oldVersion.id)).toEqual(oldBefore);
  expect((await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "LegacyAdmissionManifestEntry" WHERE "versionId"=${oldVersion.id}`)[0]?.count).toBe(0);
  await cleanupGraph(b.slots.map(slot => slot.parent.id), [b.manifest.id]);
  expect(await row('LegacyAdmissionManifest', b.manifest.id)).toBeUndefined();
  expect(await row('LegacyAdmissionImportReceipt', b.receipt.id)).toBeUndefined();
  expect(await row('FreshDealAdmissionLink', link.admissionId)).toBeUndefined();
  for (const entry of b.entries) expect(await entryRow(entry.manifestId, entry.entryId)).toBeUndefined();
  expect(await row('LegacyDirectAdmissionVersion', oldVersion.id)).toEqual(oldBefore); // Other old unfinalized history was not purged.
  expect(await prisma.campaignCommand.count({ where: { id: f.campaignSource.id } })).toBe(1);
  expect(await prisma.dealCommand.count({ where: { id: f.dealSource.id } })).toBe(1);
  await cleanupGraph(); // Remaining owned old aggregate COMMIT before native sources.
  await cleanup();
  expect(await prisma.campaign.findUnique({ where: { id: f.campaign.id } })).toBeNull();
  expect(await prisma.deal.findUnique({ where: { id: f.deal.id } })).toBeNull();
  expect(await prisma.campaignCommand.findUnique({ where: { id: f.campaignSource.id } })).toBeNull();
  expect(await prisma.dealCommand.findUnique({ where: { id: f.dealSource.id } })).toBeNull();
}, 90000);
