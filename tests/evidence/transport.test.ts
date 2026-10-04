import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/jwt";
import { loadEvidence, uploadEvidence, downloadEvidence, commandEvidence, loadEvidenceQueue } from "@/lib/evidence/transport";
import { MAX_EVIDENCE_BYTES } from "@/lib/evidence/limits";
import { cleanup, fixture, png } from "./fixtures";

let currentSession: Session | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => currentSession }));
afterEach(async () => { currentSession = null; vi.unstubAllEnvs(); await cleanup(); });
async function authenticated(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const sessionId = randomBytes(32).toString("base64url");
  await prisma.authSession.create({ data: { id: sessionId, userId, version: user.sessionVersion, expiresAt: new Date(Date.now() + 60_000) } });
  currentSession = { userId, role: user.role, name: user.name, email: user.email, sessionId, sessionVersion: user.sessionVersion };
  vi.stubEnv("EVIDENCE_STORAGE_MODE", "local");
  return sessionId;
}
function request(path: string, body?: BodyInit, extra: Record<string, string> = {}) {
  return new Request(`${process.env.APP_ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", body,
    headers: { origin: process.env.APP_ORIGIN!, ...extra } });
}
function upload(bytes: Uint8Array = png, extra: Record<string, string> = {}) {
  return uploadEvidence(request("/api/evidence/assets", new Uint8Array(bytes), { "content-type": "image/png", "x-evidence-purpose": "OWNERSHIP_PROOF", "x-operation-key": randomUUID(), ...extra }));
}

it("denies anonymous evidence, upload and administrative queue reads", async () => {
  expect((await loadEvidence(request("/api/evidence"))).status).toBe(401);
  expect((await upload()).status).toBe(401);
  expect((await loadEvidenceQueue(request("/api/evidence/reviews?kind=OWNERSHIP"))).status).toBe(401);
});
it("uploads real guarded bytes and returns an owner-only authenticated attachment", async () => {
  const f = await fixture(); await authenticated(f.owner);
  const uploaded = await upload(); expect(uploaded.status).toBe(200);
  const { data } = await uploaded.json();
  const row = await prisma.privateAsset.findUniqueOrThrow({ where: { id: data.asset.id } });
  expect(row.ownerUserId).toBe(f.owner);
  const downloaded = await downloadEvidence(request(`/api/evidence/assets/${row.id}`), { params: Promise.resolve({ id: row.id }) });
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers.get("content-type")).toBe("image/png");
  expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
  expect(downloaded.headers.get("content-disposition")).toBe('attachment; filename="evidence.png"');
  expect(downloaded.headers.get("content-security-policy")).toContain("sandbox");
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(png);
  await authenticated(f.outsider);
  const foreign = await downloadEvidence(request(`/api/evidence/assets/${row.id}`), { params: Promise.resolve({ id: row.id }) });
  expect(foreign.status).toBe(404);
  expect(await foreign.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
});
it("does not let an owner select an administrative review action", async () => {
  const f = await fixture(); await authenticated(f.owner);
  const response = await commandEvidence(request("/api/evidence/commands", JSON.stringify({ action: "OWNERSHIP_REVIEW", resourceId: f.account.id, command: {} }), { "content-type": "application/json" }));
  expect(response.status).toBe(403);
  expect(await prisma.adminAudit.count({ where: { actorUserId: f.owner } })).toBe(0);
});
it("rejects a client-supplied authentication context before executing a command", async () => {
  const f = await fixture(); await authenticated(f.owner);
  const response = await commandEvidence(request("/api/evidence/commands", JSON.stringify({ action: "OWNERSHIP_START", command: {}, serverAuth: { userId: f.admin, role: "ADMIN" } }), { "content-type": "application/json" }));
  expect(response.status).toBe(400);
  expect(await prisma.ownershipChallenge.count({ where: { ownerUserId: f.owner } })).toBe(0);
});
it("keeps unconfigured storage unavailable instead of claiming an upload succeeded", async () => {
  const f = await fixture(); await authenticated(f.owner); vi.stubEnv("EVIDENCE_STORAGE_MODE", "unavailable");
  const response = await upload(); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "CAPABILITY_UNAVAILABLE", retryable: true } });
  expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
});
it("bounds actual bytes even when a content-length header understates the body", async () => {
  const f = await fixture(); await authenticated(f.owner);
  expect((await upload(png, { "content-length": String(MAX_EVIDENCE_BYTES + 1) })).status).toBe(413);
  expect((await upload(new Uint8Array(MAX_EVIDENCE_BYTES + 1), { "content-length": "1" })).status).toBe(413);
  expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
});
it("rechecks a revoked database session despite stale server adapter claims", async () => {
  const f = await fixture(), sessionId = await authenticated(f.owner);
  await prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  const response = await upload(); expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
});
it("requires the exact mutation origin on evidence uploads", async () => {
  const f = await fixture(); await authenticated(f.owner);
  expect((await upload(png, { origin: "https://foreign.example.invalid" })).status).toBe(403);
  expect(await prisma.privateAsset.count({ where: { ownerUserId: f.owner } })).toBe(0);
});
