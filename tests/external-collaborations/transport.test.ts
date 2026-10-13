import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession } from "@/lib/identity";
import { SESSION_COOKIE } from "@/lib/jwt";
import { cleanup, fixture, png } from "../evidence/fixtures";
import { inspectEvidence } from "@/lib/evidence/storage";
let token: string | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === SESSION_COOKIE && token ? { value: token } : undefined }) }));
const owners: string[] = [];
afterEach(async () => {
  token = null;
  await prisma.externalCollaborationCommand.deleteMany({ where: { actorUserId: { in: owners } } });
  await prisma.externalCollaborationAttachment.deleteMany({ where: { ownerUserId: { in: owners } } });
  await prisma.externalCollaboration.deleteMany({ where: { ownerUserId: { in: owners } } });
  owners.length = 0; await cleanup();
});
it("authenticates native requests, supports large valid original content and rejects hostile bodies and queries", async () => {
  const f = await fixture(); owners.push(f.owner);
  const s = await vi.importActual<typeof import("@/lib/external-collaborations/transport")>("@/lib/external-collaborations/transport");
  expect(typeof s.commandExternalCollaboration).toBe("function");
  const origin = process.env.APP_ORIGIN!;
  const request = (body: string, type = "application/json") => new Request(origin + "/api/external-collaborations", {
    method: "POST", headers: { origin, "content-type": type }, body });
  expect((await s.commandExternalCollaboration!(request("{"))).status).toBe(401);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: f.owner } });
  token = await openSession(u.id, u.sessionVersion, u.passwordHash);
  const input = { action: "CREATE", operationKey: randomUUID(), expectedRevision: 0, payload: { details: {
    schemaVersion: 1, clientDisplay: { text: "عميل", language: "ar" }, campaignDisplay: { text: "حملة", language: "ar" },
    declaredValue: null, period: null, notes: { text: "ن".repeat(10000), language: "ar" }, brief: { text: "ب".repeat(20000), language: "ar" },
    checklist: Array.from({ length: 10 }, () => ({ id: randomUUID(), label: { text: "ج".repeat(500), language: "ar" }, done: false })) } } };
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(65536);
  const response = await s.commandExternalCollaboration!(request(JSON.stringify(input)));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const result = (await response.json()).data;
  const detail = await s.loadExternalCollaboration!(new Request(origin + "/api/external-collaborations/" + result.collaborationId),
    { params: Promise.resolve({ id: result.collaborationId }) });
  expect(detail.status).toBe(200); expect((await detail.json()).data.collaboration.details).toEqual(input.payload.details);
  expect((await s.loadExternalCollaborations!(new Request(origin + "/api/external-collaborations?archived=false&archived=true"))).status).toBe(422);
  expect((await s.commandExternalCollaboration!(request(" ".repeat(524289)))).status).toBe(413);
  expect((await s.commandExternalCollaboration!(request("{}", "text/plain"))).status).toBe(422);
  const previousMode = process.env.EVIDENCE_STORAGE_MODE; process.env.EVIDENCE_STORAGE_MODE = "local";
  try {
    const upload = { action: "ATTACH_FILE", operationKey: randomUUID(), collaborationId: result.collaborationId,
      expectedRevision: 1, payload: { label: { text: "  ملف أصلي  ", language: "ar" }, file: inspectEvidence(png, "image/png") } };
    const form = new FormData();
    form.set("command", new Blob([JSON.stringify(upload)], { type: "application/json" }), "command.json");
    form.set("file", new Blob([png], { type: "image/png" }), "untrusted.png");
    const uploaded = await s.uploadExternalCollaborationFile!(new Request(origin + "/api/external-collaborations/" + result.collaborationId + "/attachments",
      { method: "POST", headers: { origin }, body: form }), { params: Promise.resolve({ id: result.collaborationId }) });
    expect(uploaded.status).toBe(200);
    const receipt = (await uploaded.json()).data;
    const downloaded = await s.downloadExternalCollaborationFile!(new Request(origin + "/api/external-collaborations/file"),
      { params: Promise.resolve({ id: result.collaborationId, attachmentId: receipt.attachmentId }) });
    expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(png);
    expect(downloaded.headers.get("content-disposition")).toBe('attachment; filename="collaboration.png"');
  } finally { if (previousMode === undefined) delete process.env.EVIDENCE_STORAGE_MODE; else process.env.EVIDENCE_STORAGE_MODE = previousMode; }
});
