import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

// Independent native collection schema witness; root alone runs the
// guarded schema RED/deployment. Raw SQL intentionally uses the absent new
// tables before migration, never nonexistent generated Prisma delegates.
// Every record is owned synthetic disposable DB data, not domain authority.
const users = new Set<string>(), brands = new Set<string>(), organizations = new Set<string>(), clients = new Set<string>();
const creators = new Set<string>(), collections = new Set<string>(), oldCommands = new Set<string>();
const key = () => randomUUID();
async function tableExists(table: "CreatorCollection" | "CreatorCollectionEntry" | "CreatorCollectionCommand") {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass(${`"${table}"`}) IS NOT NULL AS "exists"`;
  return rows[0]?.exists === true;
}
afterEach(async () => {
  if (collections.size) {
    if (await tableExists("CreatorCollectionCommand")) await prisma.$executeRaw(Prisma.sql`DELETE FROM "CreatorCollectionCommand" WHERE "collectionId" IN (${Prisma.join([...collections])})`);
    if (await tableExists("CreatorCollectionEntry")) await prisma.$executeRaw(Prisma.sql`DELETE FROM "CreatorCollectionEntry" WHERE "collectionId" IN (${Prisma.join([...collections])})`);
    if (await tableExists("CreatorCollection")) await prisma.$executeRaw(Prisma.sql`DELETE FROM "CreatorCollection" WHERE id IN (${Prisma.join([...collections])})`);
  }
  await prisma.organizationCommand.deleteMany({ where: { id: { in: [...oldCommands] } } });
  await prisma.organizationClient.deleteMany({ where: { id: { in: [...clients] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [...organizations] } } });
  await prisma.creator.deleteMany({ where: { id: { in: [...creators] } } });
  await prisma.brand.deleteMany({ where: { id: { in: [...brands] } } });
  await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
  for (const set of [users, brands, organizations, clients, creators, collections, oldCommands]) set.clear();
});
async function user() {
  const id = key(); users.add(id);
  return prisma.user.create({ data: { id, role: "BRAND", name: "Synthetic collection schema actor", email: `${id}@example.invalid`, passwordHash: "not-a-login", isTest: true } });
}
async function fixture() {
  const customer = await user(), agencyA = await user(), agencyB = await user();
  const brand = await prisma.brand.create({ data: { userId: customer.id, slug: "collection-" + key().replace(/-/g, "").slice(0, 16), name: "Synthetic original Brand", isTest: true } }); brands.add(brand.id);
  const otherCustomer = await user(), otherBrand = await prisma.brand.create({ data: { userId: otherCustomer.id, slug: "collection-" + key().replace(/-/g, "").slice(0, 16), name: "Synthetic other Brand", isTest: true } }); brands.add(otherBrand.id);
  const orgA = await prisma.organization.create({ data: { kind: "AGENCY", name: "Synthetic agency A", ownerUserId: agencyA.id } }); organizations.add(orgA.id);
  const orgB = await prisma.organization.create({ data: { kind: "AGENCY", name: "Synthetic agency B", ownerUserId: agencyB.id } }); organizations.add(orgB.id);
  const clientA = await prisma.organizationClient.create({ data: { organizationId: orgA.id, brandId: brand.id } }); clients.add(clientA.id);
  const clientB = await prisma.organizationClient.create({ data: { organizationId: orgB.id, brandId: brand.id } }); clients.add(clientB.id);
  return { customer, brand, otherBrand, orgA, orgB, clientA, clientB };
}
type Header = { id: string; scope: string; brandId: string; organizationId: string | null; clientId: string | null; name: string; nameLanguage: string | null; revision: number; archived: boolean; createdAt: Date; updatedAt: Date };
async function insertHeader(data: { scope: "OWN_BRAND" | "CLIENT" | "INVALID"; brandId: string; organizationId?: string | null; clientId?: string | null; name?: string; language?: string | null; revision?: number }) {
  const id = key(); collections.add(id);
  const scope = data.scope === "OWN_BRAND" ? Prisma.sql`'OWN_BRAND'` : data.scope === "CLIENT" ? Prisma.sql`'CLIENT'` : Prisma.sql`'INVALID'`;
  await prisma.$executeRaw(Prisma.sql`INSERT INTO "CreatorCollection" (id,scope,"brandId","organizationId","clientId",name,"nameLanguage",revision,archived,"createdAt","updatedAt")
    VALUES (${id},${scope},${data.brandId},${data.organizationId ?? null},${data.clientId ?? null},${data.name ?? "  قائمة أصلية / Original list  "},${data.language === undefined ? "ar" : data.language},${data.revision ?? 1},false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  return id;
}
async function header(id: string) { return (await prisma.$queryRaw<Header[]>`SELECT * FROM "CreatorCollection" WHERE id=${id}`)[0]!; }
async function constrained(operation: Promise<unknown>, allowedCodes = ["23514", "23503", "23505", "22P02"]) {
  const error = await operation.then(() => null, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error("Expected an actual native PostgreSQL constraint failure");
  expect(error.code).toBe("P2010"); expect(allowedCodes).toContain(String(error.meta?.code));
}
async function creator() {
  const id = key(); creators.add(id);
  return prisma.creator.create({ data: { id, handle: "c4_" + id.replace(/-/g, "").slice(0, 16), displayName: "Synthetic live Creator reference", isTest: true } });
}
type Entry = { id: string; collectionId: string; creatorReferenceId: string; creatorId: string | null; note: string | null; noteLanguage: string | null; removedAt: Date | null; createdAt: Date; updatedAt: Date };
async function insertEntry(collectionId: string, creatorReferenceId: string, liveId: string | null, note: string | null = "  ملاحظة أصلية\nOriginal note  ", language: string | null = "ar") {
  const id = key();
  await prisma.$executeRaw`INSERT INTO "CreatorCollectionEntry" (id,"collectionId","creatorReferenceId","creatorId",note,"noteLanguage","removedAt","createdAt","updatedAt")
    VALUES (${id},${collectionId},${creatorReferenceId},${liveId},${note},${language},NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
  return id;
}
async function entry(id: string) { return (await prisma.$queryRaw<Entry[]>`SELECT * FROM "CreatorCollectionEntry" WHERE id=${id}`)[0]!; }
async function command(collectionId: string, actorUserId: string, operationKey = key(), hash = "a".repeat(64)) {
  const id = key();
  await prisma.$executeRaw`INSERT INTO "CreatorCollectionCommand" (id,"actorUserId","operationKey","payloadHash","collectionId",action,result,"createdAt")
    VALUES (${id},${actorUserId},${operationKey},${hash},${collectionId},'CREATE',${JSON.stringify({ collectionId, revision: 1, archived: false })}::jsonb,CURRENT_TIMESTAMP)`;
  return id;
}

describe("creator collection additive schema: native synthetic M02C4", () => {
  it("persists OWN_BRAND and two separate CLIENT headers for the same actual Brand without aliasing scope", async () => {
    const f = await fixture(), own = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id });
    const first = await insertHeader({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgA.id, clientId: f.clientA.id });
    const second = await insertHeader({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgB.id, clientId: f.clientB.id });
    expect(await header(own)).toMatchObject({ scope: "OWN_BRAND", brandId: f.brand.id, organizationId: null, clientId: null, revision: 1, archived: false, name: "  قائمة أصلية / Original list  ", nameLanguage: "ar" });
    expect(await header(first)).toMatchObject({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgA.id, clientId: f.clientA.id });
    expect(await header(second)).toMatchObject({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgB.id, clientId: f.clientB.id });
    expect(new Set([own, first, second]).size).toBe(3);
  });

  it("rejects exclusive-scope violations and every substituted component of the CLIENT Brand binding", async () => {
    const f = await fixture(); await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id });
    await constrained(insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id, organizationId: f.orgA.id }));
    await constrained(insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id, clientId: f.clientA.id }));
    await constrained(insertHeader({ scope: "CLIENT", brandId: f.brand.id, clientId: f.clientA.id }));
    await constrained(insertHeader({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgA.id }));
    await constrained(insertHeader({ scope: "CLIENT", brandId: f.otherBrand.id, organizationId: f.orgA.id, clientId: f.clientA.id }));
    await constrained(insertHeader({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgB.id, clientId: f.clientA.id }));
    await constrained(insertHeader({ scope: "INVALID", brandId: f.brand.id }));
  });

  it("keeps header identity and createdAt immutable while requiring exact next supported revision", async () => {
    const f = await fixture(), id = await insertHeader({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgA.id, clientId: f.clientA.id });
    const before = await header(id);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET id=${key()},revision=revision+1 WHERE id=${id}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET scope='OWN_BRAND',"organizationId"=NULL,"clientId"=NULL,revision=revision+1 WHERE id=${id}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET "brandId"=${f.otherBrand.id},revision=revision+1 WHERE id=${id}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET "organizationId"=${f.orgB.id},"clientId"=${f.clientB.id},revision=revision+1 WHERE id=${id}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET "createdAt"="createdAt"+INTERVAL '1 millisecond',revision=revision+1 WHERE id=${id}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET name='Skipped revision',revision=revision+2 WHERE id=${id}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET name='Same revision' WHERE id=${id}`);
    expect(await header(id)).toEqual(before);
    await prisma.$executeRaw`UPDATE "CreatorCollection" SET name='اسم أصلي جديد',"nameLanguage"=NULL,revision=revision+1 WHERE id=${id}`;
    await prisma.$executeRaw`UPDATE "CreatorCollection" SET archived=true,revision=revision+1 WHERE id=${id}`;
    expect(await header(id)).toMatchObject({ id, revision: 3, archived: true, name: "اسم أصلي جديد", nameLanguage: null, createdAt: before.createdAt });
    const exhausted = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id, revision: 2147483646 });
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollection" SET revision=2147483647 WHERE id=${exhausted}`);
    const maximumText = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id, name: "ن".repeat(200), language: "a".repeat(100) });
    expect(await header(maximumText)).toMatchObject({ name: "ن".repeat(200), nameLanguage: "a".repeat(100) });
    for (const data of [{ revision: 0 }, { revision: 2147483647 }, { name: "" }, { name: "   " }, { name: "\t\n" }, { name: "ن".repeat(201) }, { language: "a" }, { language: "a".repeat(101) }]) await constrained(insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id, ...data }));
  });

  it("binds live Creator to immutable retained entry identity and unique collection reference", async () => {
    const f = await fixture(), id = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id }), other = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id });
    const first = await creator(), second = await creator(), entryId = await insertEntry(id, first.id, first.id), before = await entry(entryId);
    await constrained(insertEntry(id, first.id, first.id));
    await constrained(insertEntry(id, second.id, first.id));
    const missing = key(); await constrained(insertEntry(id, missing, missing));
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET id=${key()} WHERE id=${entryId}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "collectionId"=${other} WHERE id=${entryId}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "creatorReferenceId"=${second.id},"creatorId"=${second.id} WHERE id=${entryId}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "createdAt"="createdAt"+INTERVAL '1 millisecond' WHERE id=${entryId}`);
    expect(await entry(entryId)).toEqual(before);
    await constrained(insertEntry(other, first.id, first.id, "ن".repeat(2001)));
    await constrained(insertEntry(other, first.id, first.id, "Original", "a"));
    await constrained(insertEntry(other, first.id, first.id, "Original", "a".repeat(101)));
    const boundary = await insertEntry(other, first.id, first.id, "ن".repeat(2000), null);
    expect(await entry(boundary)).toMatchObject({ note: "ن".repeat(2000), noteLanguage: null });
    const nullable = await insertEntry(other, second.id, null, null, null);
    expect(await entry(nullable)).toMatchObject({ creatorReferenceId: second.id, creatorId: null, note: null, noteLanguage: null });
  });

  it("allows an actual Creator DELETE to clear only the live link while retaining notes/reference and parent revision", async () => {
    const f = await fixture(), id = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id }), live = await creator();
    const entryId = await insertEntry(id, live.id, live.id), before = await entry(entryId), parent = await header(id);
    await prisma.creator.delete({ where: { id: live.id } });
    expect(await entry(entryId)).toEqual({ ...before, creatorId: null });
    expect(await header(id)).toEqual(parent);
    expect(await prisma.creator.findUnique({ where: { id: live.id } })).toBeNull();
  });

  it("rejects manual live nulling, reference reassignment and null-to-live revival even after ID reuse", async () => {
    const f = await fixture(), id = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id }), live = await creator(), other = await creator();
    const entryId = await insertEntry(id, live.id, live.id), before = await entry(entryId);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "creatorId"=NULL WHERE id=${entryId}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "creatorId"=NULL,note='Changed during manual unlink' WHERE id=${entryId}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "creatorId"=${other.id} WHERE id=${entryId}`);
    expect(await entry(entryId)).toEqual(before);
    await prisma.creator.delete({ where: { id: live.id } });
    await prisma.creator.create({ data: { id: live.id, handle: "reused_" + key().replace(/-/g, "").slice(0, 16), displayName: "Synthetic reused ID", isTest: true } });
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "creatorId"=${live.id} WHERE id=${entryId}`);
    await constrained(prisma.$executeRaw`UPDATE "CreatorCollectionEntry" SET "creatorReferenceId"=${other.id},"creatorId"=${other.id} WHERE id=${entryId}`);
    expect(await entry(entryId)).toEqual({ ...before, creatorId: null });
  });

  it("stores immutable scalar actor/key/hash commands and forbids replay identity changes", async () => {
    const f = await fixture(), id = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id }), other = await insertHeader({ scope: "OWN_BRAND", brandId: f.brand.id });
    const scalarActor = await user(), operationKey = key(), receiptId = await command(id, scalarActor.id, operationKey);
    await constrained(command(other, scalarActor.id, operationKey));
    for (const hash of ["A".repeat(64), "a".repeat(63), "g".repeat(64)]) await constrained(command(id, scalarActor.id, key(), hash));
    for (const update of [Prisma.sql`id=${key()}`, Prisma.sql`"actorUserId"=${key()}`, Prisma.sql`"operationKey"=${key()}`,
      Prisma.sql`"payloadHash"=${"b".repeat(64)}`, Prisma.sql`"collectionId"=${other}`, Prisma.sql`action='RENAME'`,
      Prisma.sql`result='{}'::jsonb`, Prisma.sql`"createdAt"="createdAt"+INTERVAL '1 millisecond'`]) await constrained(prisma.$executeRaw(Prisma.sql`UPDATE "CreatorCollectionCommand" SET ${update} WHERE id=${receiptId}`));
    await prisma.user.delete({ where: { id: scalarActor.id } });
    const receipts = await prisma.$queryRaw<Array<{ id: string; actorUserId: string; operationKey: string; payloadHash: string }>>`SELECT id,"actorUserId","operationKey","payloadHash" FROM "CreatorCollectionCommand" WHERE id=${receiptId}`;
    expect(receipts).toEqual([{ id: receiptId, actorUserId: scalarActor.id, operationKey, payloadHash: "a".repeat(64) }]);
  });

  it("restricts Brand/client/collection deletion and leaves existing organization history retention intact", async () => {
    const f = await fixture(), own = await insertHeader({ scope: "OWN_BRAND", brandId: f.otherBrand.id }), client = await insertHeader({ scope: "CLIENT", brandId: f.brand.id, organizationId: f.orgA.id, clientId: f.clientA.id });
    const live = await creator(), entryId = await insertEntry(own, live.id, live.id); await command(own, f.customer.id);
    const retentionCodes = ["23001", "23503"];
    await constrained(prisma.$executeRaw`DELETE FROM "Brand" WHERE id=${f.otherBrand.id}`, retentionCodes);
    await constrained(prisma.$executeRaw`DELETE FROM "OrganizationClient" WHERE id=${f.clientA.id}`, retentionCodes);
    await constrained(prisma.$executeRaw`DELETE FROM "CreatorCollection" WHERE id=${own}`, retentionCodes);
    await prisma.$executeRaw`DELETE FROM "CreatorCollectionEntry" WHERE id=${entryId}`;
    await constrained(prisma.$executeRaw`DELETE FROM "CreatorCollection" WHERE id=${own}`, retentionCodes);
    const existingId = key(); oldCommands.add(existingId);
    await prisma.organizationCommand.create({ data: { id: existingId, actorUserId: f.customer.id, operationKey: key(), payloadHash: "a".repeat(64),
      organizationId: f.orgB.id, resourceType: "Organization", resourceId: f.orgB.id, result: { revision: 1 } } });
    await constrained(prisma.$executeRaw`DELETE FROM "Organization" WHERE id=${f.orgB.id}`, retentionCodes);
    expect(await header(client)).toMatchObject({ clientId: f.clientA.id, organizationId: f.orgA.id, brandId: f.brand.id });
    expect(await prisma.organizationCommand.findUnique({ where: { id: existingId } })).not.toBeNull();
  });
});
