import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { revokeSession } from "@/lib/identity";
import { uploadPrivateAsset, getPrivateAsset, getCreatorEvidence } from "@/lib/evidence/service";
import { EvidenceError, type EvidenceStorage } from "@/lib/evidence/storage";
import { cleanup, fixture, png } from "./fixtures";

afterEach(cleanup);
async function authenticated(f: Awaited<ReturnType<typeof fixture>>) {
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: f.owner, version: 1, expiresAt: new Date(Date.now() + 60_000) } });
  return { ...f.options, serverAuth: { userId: f.owner, role: "CREATOR" as const, sessionId, sessionVersion: 1 } };
}
const input = () => ({ operationKey: randomUUID(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png });
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

it("rejects an existing receipt replay after real sign-out without deleting its committed bytes", async () => {
  const f = await fixture(), options = await authenticated(f), command = input();
  const first = await uploadPrivateAsset(f.owner, command, options);
  expect((await uploadPrivateAsset(f.owner, command, options)).replayed).toBe(true);
  const row = await prisma.privateAsset.findUniqueOrThrow({ where: { id: first.asset.id } });
  await revokeSession(options.serverAuth.sessionId);
  await expect(uploadPrivateAsset(f.owner, command, options)).rejects.toMatchObject({ status: 401 });
  await expect(getPrivateAsset(f.owner, first.asset.id, options)).rejects.toMatchObject({ status: 401 });
  expect(Buffer.from(await options.storage.get(row.storageKey.replace(/^local:/, "")))).toEqual(png);
  expect(await prisma.evidenceCommand.count({ where: { actorUserId: f.owner, operationKey: command.operationKey } })).toBe(1);
});

it("rechecks a real role change and rejects missing production context", async () => {
  const f = await fixture(), options = await authenticated(f);
  await prisma.user.update({ where: { id: f.owner }, data: { role: "BRAND" } });
  await expect(getCreatorEvidence(f.owner, f.creator.id, options)).rejects.toMatchObject({ status: 401 });
  vi.stubEnv("NODE_ENV", "production");
  try { await expect(getCreatorEvidence(f.owner, f.creator.id, f.options)).rejects.toMatchObject({ status: 401 }); }
  finally { vi.unstubAllEnvs(); }
});

it.each(["revoked", "version", "expired"] as const)("rechecks %s authentication after a User lock wait before storage IO", async change => {
  const f = await fixture(), options = await authenticated(f), locked = latch(), release = latch(), sessionRead = latch();
  const client = prisma.$extends({ query: { authSession: { async findUnique({ args, query }) {
    const value = await query(args); sessionRead.release(); return value;
  } } } }) as unknown as PrismaClient;
  const put = vi.fn(options.storage.put.bind(options.storage));
  const holding = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${f.owner} FOR UPDATE`;
    locked.release(); await release.promise;
    if (change === "version") await tx.user.update({ where: { id: f.owner }, data: { sessionVersion: 2 } });
  });
  try {
    await locked.promise;
    const operation = uploadPrivateAsset(f.owner, input(), { ...options, client, storage: { ...options.storage, put } });
    const assertion = expect(operation).rejects.toMatchObject({ status: 401 });
    await sessionRead.promise;
    if (change === "revoked") await revokeSession(options.serverAuth.sessionId);
    if (change === "expired") await prisma.authSession.update({ where: { id: options.serverAuth.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    release.release(); await holding; await assertion;
    expect(put).not.toHaveBeenCalled();
  } finally { release.release(); await holding; }
});

it.each(["revoked", "expired"] as const)("removes only newly created bytes when authentication becomes %s during upload", async change => {
  const f = await fixture(), options = await authenticated(f), inside = latch(), release = latch();
  let objectKey = "";
  const storage = { ...options.storage, async put(key: string, bytes: Uint8Array, type: Parameters<EvidenceStorage["put"]>[2]) {
    objectKey = key; const receipt = await options.storage.put(key, bytes, type); inside.release(); await release.promise; return receipt;
  } };
  const operation = uploadPrivateAsset(f.owner, input(), { ...options, storage });
  const assertion = expect(operation).rejects.toMatchObject({ status: 401 });
  try {
    await inside.promise;
    if (change === "revoked") await revokeSession(options.serverAuth.sessionId);
    else await prisma.authSession.update({ where: { id: options.serverAuth.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
    release.release(); await assertion;
    expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
    await expect(options.storage.get(objectKey)).rejects.toMatchObject({ code: "ASSET_BYTES_UNAVAILABLE" });
  } finally { release.release(); if (objectKey) await options.storage.remove(objectKey); }
});

it("preserves an existing immutable object on failed reconciliation and reports cleanup failure honestly", async () => {
  const f = await fixture(), options = await authenticated(f), inside = latch(), release = latch(), command = input();
  let objectKey = "";
  const storage = { ...options.storage, async put(key: string, bytes: Uint8Array, type: Parameters<EvidenceStorage["put"]>[2]) {
    objectKey = key; const receipt = await options.storage.put(key, bytes, type); inside.release(); await release.promise; return receipt;
  }, async remove() { throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503); } };
  const operation = uploadPrivateAsset(f.owner, command, { ...options, storage });
  const assertion = expect(operation).rejects.toMatchObject({ code: "ASSET_ROLLBACK_UNAVAILABLE", status: 503 });
  try {
    await inside.promise; await revokeSession(options.serverAuth.sessionId); release.release(); await assertion;
    expect(Buffer.from(await options.storage.get(objectKey))).toEqual(png);
    expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
    const replacement = await authenticated(f), remove = vi.fn(options.storage.remove.bind(options.storage));
    const reconciliation = { ...options.storage, remove, async put(key: string, bytes: Uint8Array, type: Parameters<EvidenceStorage["put"]>[2]) {
      const receipt = await options.storage.put(key, bytes, type); await revokeSession(replacement.serverAuth.sessionId); return receipt;
    } };
    await expect(uploadPrivateAsset(f.owner, command, { ...replacement, storage: reconciliation })).rejects.toMatchObject({ status: 401 });
    expect(remove).not.toHaveBeenCalled();
    expect(Buffer.from(await options.storage.get(objectKey))).toEqual(png);
    const recovered = await uploadPrivateAsset(f.owner, command, await authenticated(f));
    expect(recovered.asset.id).toBeTruthy();
  } finally { release.release(); if (objectKey) await options.storage.remove(objectKey); }
});
