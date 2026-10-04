import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { listLicencePolicyOptions, reviewAdvertisingLicence, submitAdvertisingLicence, uploadPrivateAsset } from "@/lib/evidence/service";
import { cleanup, fixture, now, png, user } from "./fixtures";

const policies: string[] = [];
afterEach(async () => { await prisma.policyVersion.deleteMany({ where: { id: { in: policies.splice(0) } } }); await cleanup(); });
const key = () => randomUUID();
const content = { schemaVersion: 1, kind: "MARKET", marketCountryCode: "KW", brandCountryCodes: ["KW"], creatorCountryCodes: ["KW"], licenceRequired: true,
  licencePolicyId: "synthetic-only-licence-policy", reviewReference: "Synthetic private local legal-policy fixture; no live legal approval", reviewedBasis: "FOUNDER_APPROVED_LEGAL_REVIEW" };
async function proof(owner: string, purpose: string, options: Awaited<ReturnType<typeof fixture>>["options"]) {
  return (await uploadPrivateAsset(owner, { operationKey: key(), purpose, contentType: "image/png", bytes: png }, options)).asset;
}
async function policy(reviewer: string, evidenceAssetId: string, overrides: Partial<Prisma.PolicyVersionUncheckedCreateInput> = {}) {
  const id = randomUUID(); policies.push(id);
  return prisma.policyVersion.create({ data: { id, kind: "MARKET", status: "VERIFIED", countryCodes: ["KW"], content,
    evidenceAssetId, reviewedBy: reviewer, reviewedAt: now, createdAt: new Date(now.getTime() - 60_000), expiresAt: new Date(now.getTime() + 600_000), ...overrides } });
}
async function prepared() {
  const f = await fixture(), licenceProof = await proof(f.owner, "ADVERTISING_LICENCE", f.options), policyProof = await proof(f.admin, "LEGAL_POLICY_REVIEW", f.options);
  const licence = (await submitAdvertisingLicence(f.owner, { operationKey: key(), creatorId: f.creator.id, jurisdiction: "KW", issuer: "Synthetic issuer", holderName: "Synthetic holder",
    licenceNumber: "Synthetic local test only", type: "Synthetic scoped licence", scope: "Synthetic account scope", accountBindings: [{ accountId: f.account.id, mappingRevision: 1 }],
    platformScope: ["INSTAGRAM"], evidenceAssetId: licenceProof.id, validFrom: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() }, f.options)).licence;
  const valid = await policy(f.admin, policyProof.id);
  return { ...f, licence, valid };
}
describe("private trusted advertising licence policy options", () => {
  it("lists the actual scoped row ID and original review reference while omitting private evidence and receipts", async () => {
    const f = await prepared(), listed = await listLicencePolicyOptions(f.admin, f.licence.id, f.options);
    expect(listed).toMatchObject({ licenceId: f.licence.id, jurisdiction: "KW", creatorCountryCode: "KW", options: [{ id: f.valid.id,
      licencePolicyId: content.licencePolicyId, marketCountryCode: "KW", reviewReference: content.reviewReference, reviewedAt: now.toISOString(), expiresAt: f.valid.expiresAt!.toISOString() }], nextCursor: null });
    for (const privateKey of ["storageKey", "evidenceAssetId", "payloadHash", "operationKey", "resultJson", "sessionId"]) expect(JSON.stringify(listed)).not.toContain(`"${privateKey}"`);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" } })).toBe(1);
    await expect(listLicencePolicyOptions(f.owner, f.licence.id, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listLicencePolicyOptions(f.outsider, f.licence.id, f.options)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["wrong kind", "wrong jurisdiction", "wrong creator country", "expired", "future review", "review before creation", "inactive reviewer", "wrong reviewer role",
    "missing proof", "deleted proof", "wrong proof owner", "wrong proof purpose", "invalid upload receipt", "malformed content"])("excludes %s without hiding the independently valid option", async failure => {
    const f = await prepared(), reviewer = await user("ADMIN"), asset = await proof(reviewer, "LEGAL_POLICY_REVIEW", f.options);
    // Reviewed policy metadata is immutable. Create each invalid historical
    // variant at insertion so the selector, rather than a forbidden UPDATE,
    // decides whether it is a usable option.
    const invalid: Partial<Prisma.PolicyVersionUncheckedCreateInput> = {};
    if (failure === "wrong kind") invalid.kind = "GOVERNING_TERMS";
    if (failure === "wrong jurisdiction") invalid.content = { ...content, marketCountryCode: "SA" };
    if (failure === "wrong creator country") invalid.content = { ...content, creatorCountryCodes: ["GB"] };
    if (failure === "expired") invalid.expiresAt = now;
    if (failure === "future review") invalid.reviewedAt = new Date(now.getTime() + 60_000);
    if (failure === "review before creation") invalid.reviewedAt = new Date(now.getTime() - 120_000);
    if (failure === "inactive reviewer") await prisma.user.update({ where: { id: reviewer }, data: { active: false } });
    if (failure === "wrong reviewer role") await prisma.user.update({ where: { id: reviewer }, data: { role: "CREATOR" } });
    if (failure === "missing proof") invalid.evidenceAssetId = null;
    if (failure === "deleted proof") await prisma.privateAsset.update({ where: { id: asset.id }, data: { deletedAt: now } });
    if (failure === "wrong proof owner") invalid.evidenceAssetId = (await proof(f.admin, "LEGAL_POLICY_REVIEW", f.options)).id;
    if (failure === "wrong proof purpose") invalid.evidenceAssetId = (await proof(reviewer, "CONTACT_VERIFICATION", f.options)).id;
    if (failure === "invalid upload receipt") await prisma.evidenceCommand.updateMany({ where: { resourceType: "PrivateAsset", resourceId: asset.id }, data: { payloadHash: "0".repeat(64) } });
    if (failure === "malformed content") invalid.content = { kind: "MARKET", licencePolicyId: "unreviewed" };
    await policy(reviewer, asset.id, invalid);
    const listed = await listLicencePolicyOptions(f.admin, f.licence.id, f.options);
    expect(listed.options.map(option => option.id)).toEqual([f.valid.id]);
  });
  it("rechecks a previously listed policy on verification and rejects an expired option without changing the licence", async () => {
    const f = await prepared();
    expect((await listLicencePolicyOptions(f.admin, f.licence.id, f.options)).options.map(option => option.id)).toContain(f.valid.id);
    await expect(reviewAdvertisingLicence(f.admin, f.licence.id, { operationKey: key(), expectedRevision: f.licence.revision, decision: "VERIFIED", policyVersionId: f.valid.id,
      note: { text: "Synthetic test verification only", language: "en" } }, { ...f.options, now: f.valid.expiresAt! })).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    expect(await prisma.advertisingLicence.findUnique({ where: { id: f.licence.id } })).toMatchObject({ revision: 1, status: "PENDING", policyVersion: null });
  });
});

// Supplemental witnesses use separate native PostgreSQL connections. Wait for
// the actual row-lock wait rather than relying on a simulated request delay.
function optionLatch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
async function waitForOptionLock(table: "PrivateAsset" | "SocialAccount") {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%"${table}"%`}`;
    if (rows[0]?.count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Selector did not reach the expected ${table} row-lock wait`);
}
async function holdOptionRow(table: "PrivateAsset" | "SocialAccount", id: string, change?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const peer = new PrismaClient(), held = optionLatch(), release = optionLatch();
  const holding = peer.$transaction(async tx => {
    if (table === "PrivateAsset") await tx.$queryRaw`SELECT id FROM "PrivateAsset" WHERE id=${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE id=${id} FOR UPDATE`;
    held.release(); await release.promise;
    if (change) await change(tx);
  }, { maxWait: 5000, timeout: 15000 });
  await held.promise;
  return { release: release.release, async close() { release.release(); try { await holding; } finally { await peer.$disconnect(); } } };
}

describe("policy option cursor and native wait boundaries", () => {
  it("excludes an option that expires during an actual private-asset wait and audits only current options", async () => {
    const f = await prepared(), held = await holdOptionRow("PrivateAsset", f.valid.evidenceAssetId!);
    let currentTime = now;
    const options = { ...f.options, get now() { return currentTime; } };
    const reading = listLicencePolicyOptions(f.admin, f.licence.id, options);
    void reading.catch(() => {});
    try {
      await waitForOptionLock("PrivateAsset");
      currentTime = f.valid.expiresAt!;
      held.release();
      expect((await reading).options).toEqual([]);
      const audit = await prisma.adminAudit.findFirstOrThrow({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" }, orderBy: { createdAt: "desc" } });
      expect(audit.snapshot).toMatchObject({ count: 0 });
      expect(audit.createdAt).toEqual(currentTime);
    } finally { await held.close(); await reading.catch(() => {}); }
  });

  it("advances a bounded candidate cursor past excluded rows, preserves original references and performs no storage reads", async () => {
    const f = await prepared();
    await prisma.policyVersion.delete({ where: { id: f.valid.id } });
    const ids = [key(), key(), key()].sort(), originalReference = "  مرجع أصلي — Synthetic original reference\n ";
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index]!; policies.push(id);
      await prisma.policyVersion.create({ data: { id, kind: "MARKET", status: "VERIFIED", countryCodes: ["KW"],
        content: { ...content, reviewReference: originalReference }, evidenceAssetId: f.valid.evidenceAssetId, reviewedBy: f.admin,
        reviewedAt: now, createdAt: new Date(now.getTime() - 60_000), expiresAt: index === 0 ? now : new Date(now.getTime() + 600_000) } });
    }
    const get = vi.fn(async (): Promise<Uint8Array> => { throw new Error("Private bytes must not be read by the options selector"); });
    const options = { ...f.options, storage: { ...f.options.storage, get } };
    let cursor: string | undefined;
    const seen: string[] = [];
    for (let index = 0; index < ids.length; index++) {
      const page = await listLicencePolicyOptions(f.admin, f.licence.id, options, { limit: 1, ...(cursor ? { cursor } : {}) });
      expect(page.options.map(option => option.id)).toEqual(index === 0 ? [] : [ids[index]]);
      for (const option of page.options) { expect(option.reviewReference).toBe(originalReference); seen.push(option.id); }
      expect(page.nextCursor).toBe(index < ids.length - 1 ? ids[index] : null);
      cursor = page.nextCursor ?? undefined;
    }
    expect(seen).toEqual(ids.slice(1));
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects a real admin session revoked while the selector waits on private evidence metadata", async () => {
    const f = await prepared(), sessionId = randomBytes(32).toString("base64url");
    const sessionVersion = (await prisma.user.findUniqueOrThrow({ where: { id: f.admin } })).sessionVersion;
    await prisma.authSession.create({ data: { id: sessionId, userId: f.admin, version: sessionVersion, expiresAt: new Date(Date.now() + 60_000) } });
    const options = { ...f.options, serverAuth: { userId: f.admin, role: "ADMIN" as const, sessionId, sessionVersion } };
    const held = await holdOptionRow("PrivateAsset", f.valid.evidenceAssetId!);
    const reading = listLicencePolicyOptions(f.admin, f.licence.id, options).then(value => ({ code: "EXPOSED", value }), (error: unknown) => error);
    try {
      await waitForOptionLock("PrivateAsset");
      await prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      held.release();
      expect(await reading).toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" } })).toBe(0);
    } finally { await held.close(); await reading; }
  });

  it("rejects an account remapped during the selector's actual account row-lock wait", async () => {
    const f = await prepared();
    const held = await holdOptionRow("SocialAccount", f.account.id, tx => tx.socialAccount.update({ where: { id: f.account.id }, data: { handle: "remapped_synthetic_account", mappingRevision: { increment: 1 } } }));
    const reading = listLicencePolicyOptions(f.admin, f.licence.id, f.options).then(value => ({ code: "EXPOSED", value }), (error: unknown) => error);
    try {
      await waitForOptionLock("SocialAccount");
      held.release();
      expect(await reading).toMatchObject({ code: "STALE_IDENTITY" });
      expect(await prisma.adminAudit.count({ where: { actorUserId: f.admin, action: "evidence.licence_policy_options_accessed" } })).toBe(0);
    } finally { await held.close(); await reading; }
  });
});
