import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { uploadPrivateAsset, getCreatorEvidence } from "@/lib/evidence/service";
import { cleanup, fixture, png } from "./fixtures";

afterEach(cleanup);
async function authenticated(f: Awaited<ReturnType<typeof fixture>>) {
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId: f.owner, version: 1, expiresAt: new Date(Date.now() + 60_000) } });
  return { ...f.options, serverAuth: { userId: f.owner, role: "CREATOR" as const, sessionId, sessionVersion: 1 } };
}

it("rejects a revoked or mismatched trusted session before private evidence mutation and replay", async () => {
  const f = await fixture(), options = await authenticated(f);
  const input = { operationKey: randomUUID(), purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png };
  await expect(uploadPrivateAsset(f.outsider, input, options)).rejects.toMatchObject({ status: 401 });
  await prisma.authSession.update({ where: { id: options.serverAuth.sessionId }, data: { revokedAt: new Date() } });
  await expect(uploadPrivateAsset(f.owner, input, options)).rejects.toMatchObject({ status: 401 });
  await expect(getCreatorEvidence(f.owner, f.creator.id, options)).rejects.toMatchObject({ status: 401 });
  expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
});

it("rolls back mutation, receipt and events when a session is revoked during byte IO", async () => {
  const f = await fixture(), options = await authenticated(f);
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const inside = new Promise<void>(resolve => { entered = resolve; });
  const storage = { ...options.storage, async put(key: string, bytes: Uint8Array, type: Parameters<typeof options.storage.put>[2]) {
    const result = await options.storage.put(key, bytes, type); entered(); await waiting; return result;
  } };
  const operationKey = randomUUID();
  const running = uploadPrivateAsset(f.owner, { operationKey, purpose: "OWNERSHIP_PROOF", contentType: "image/png", bytes: png }, { ...options, storage });
  const assertion = expect(running).rejects.toMatchObject({ status: 401 });
  try {
    await inside;
    await prisma.authSession.update({ where: { id: options.serverAuth.sessionId }, data: { revokedAt: new Date() } });
    release(); await assertion;
    expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
    expect(await prisma.evidenceCommand.count({ where: { actorUserId: f.owner, operationKey } })).toBe(0);
    expect(await prisma.adminAudit.count({ where: { actorUserId: f.owner } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { type: "evidence.uploaded", payload: { path: ["actorUserId"], equals: f.owner } } })).toBe(0);
  } finally { release(); }
});

it("rechecks expiry and current role/version with the actual clock instead of a historical resource clock", async () => {
  const f = await fixture(), options = await authenticated(f);
  await prisma.authSession.update({ where: { id: options.serverAuth.sessionId }, data: { expiresAt: new Date(Date.now() - 1) } });
  await expect(getCreatorEvidence(f.owner, f.creator.id, { ...options, now: new Date("2020-01-01T00:00:00.000Z") })).rejects.toMatchObject({ status: 401 });
  await prisma.authSession.update({ where: { id: options.serverAuth.sessionId }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  await prisma.user.update({ where: { id: f.owner }, data: { sessionVersion: 2 } });
  await expect(getCreatorEvidence(f.owner, f.creator.id, options)).rejects.toMatchObject({ status: 401 });
});
