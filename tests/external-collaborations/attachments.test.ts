import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { executeExternalCollaborationCommand as command, getExternalCollaboration } from "@/lib/external-collaborations/service";
import { inspectEvidence } from "@/lib/evidence/storage";
import { cleanup, fixture, png } from "../evidence/fixtures";

const owners: string[] = [];
afterEach(async () => {
  await prisma.externalCollaborationCommand.deleteMany({ where: { actorUserId: { in: owners } } });
  await prisma.externalCollaborationAttachment.deleteMany({ where: { ownerUserId: { in: owners } } });
  await prisma.externalCollaboration.deleteMany({ where: { ownerUserId: { in: owners } } });
  owners.length = 0; await cleanup();
});
async function setup() {
  const f = await fixture(); owners.push(f.owner);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: f.owner } });
  const resolved = await resolveSession(await openSession(u.id, u.sessionVersion, u.passwordHash));
  if (!resolved) throw new Error("Native fixture session missing");
  const actor = captureOrganizationActor(resolved);
  const made = await command(actor, { action: "CREATE", operationKey: randomUUID(), expectedRevision: 0,
    payload: { details: { schemaVersion: 1, clientDisplay: { text: "عميل", language: "ar" },
      campaignDisplay: { text: "حملة", language: "ar" }, declaredValue: null, period: null, notes: null, brief: null, checklist: [] } } });
  const input = { action: "ATTACH_FILE", operationKey: randomUUID(), collaborationId: made.collaborationId,
    expectedRevision: made.revision, payload: { label: { text: "  Original file اسم  ", language: null }, file: inspectEvidence(png, "image/png") } };
  return { ...f, actor, made, input };
}
async function service() {
  return vi.importActual<typeof import("@/lib/external-collaborations/service") & {
    attachExternalCollaborationFile: (...args: unknown[]) => Promise<{ attachmentId: string; revision: number; replayed: boolean }>;
    getExternalCollaborationFile: (...args: unknown[]) => Promise<{ bytes: Uint8Array; headers: Record<string, string> }>;
  }>("@/lib/external-collaborations/service");
}
it("stores actual private bytes, replays once and denies removed binding downloads", async () => {
  const f = await setup(), s = await service(), options = { storage: f.options.storage };
  expect(typeof s.attachExternalCollaborationFile).toBe("function");
  const saved = await s.attachExternalCollaborationFile(f.actor, f.input, png, options);
  expect(saved.revision).toBe(2); expect(saved.replayed).toBe(false);
  const query = { collaborationId: f.made.collaborationId, attachmentId: saved.attachmentId };
  for (const userId of [f.outsider, f.admin]) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const resolved = await resolveSession(await openSession(u.id, u.sessionVersion, u.passwordHash));
    if (!resolved) throw new Error("Foreign fixture session missing");
    await expect(s.getExternalCollaborationFile(captureOrganizationActor(resolved), query, options))
      .rejects.toMatchObject({ status: userId === f.admin ? 403 : 404 });
  }
  const file = await s.getExternalCollaborationFile(f.actor, query, options);
  expect(Buffer.from(file.bytes)).toEqual(png);
  expect(file.headers).toMatchObject({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  expect((await getExternalCollaboration(f.actor, { collaborationId: query.collaborationId })).attachments[0]?.label).toEqual(f.input.payload.label);
  expect(await s.attachExternalCollaborationFile(f.actor, f.input, png, options)).toMatchObject({ revision: 2, replayed: true });
  await command(f.actor, { operationKey: randomUUID(), collaborationId: query.collaborationId, expectedRevision: 2,
    action: "REMOVE_ATTACHMENT", payload: { attachmentId: saved.attachmentId } });
  await expect(s.getExternalCollaborationFile(f.actor, query, options)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  expect(await s.attachExternalCollaborationFile(f.actor, f.input, png, options)).toMatchObject({ revision: 2, replayed: true });
  expect((await getExternalCollaboration(f.actor, { collaborationId: query.collaborationId })).attachments).toEqual([]);
});
it("rejects descriptor mismatch before storage and expires after delayed byte IO", async () => {
  const f = await setup(), s = await service();
  let writes = 0;
  const storage = { ...f.options.storage, async put(...args: Parameters<typeof f.options.storage.put>) {
    writes++; return f.options.storage.put(...args);
  } };
  expect(typeof s.attachExternalCollaborationFile).toBe("function");
  await expect(s.attachExternalCollaborationFile(f.actor, { ...f.input, payload: { ...f.input.payload,
    file: { ...f.input.payload.file, checksum: "a".repeat(64) } } }, png, { storage })).rejects.toMatchObject({ code: "VALIDATION", status: 422 });
  expect(writes).toBe(0);
  await prisma.authSession.update({ where: { id: f.actor.sessionId }, data: { expiresAt: new Date(Date.now() + 1500) } });
  const delayed = { ...storage, async put(...args: Parameters<typeof storage.put>) {
    const receipt = await storage.put(...args); await new Promise(resolve => setTimeout(resolve, 1800)); return receipt;
  } };
  await expect(s.attachExternalCollaborationFile(f.actor, f.input, png, { storage: delayed })).rejects.toMatchObject({ status: 401 });
  expect(await prisma.externalCollaborationAttachment.count({ where: { ownerUserId: f.owner } })).toBe(0);
  expect((await prisma.externalCollaboration.findUniqueOrThrow({ where: { id: f.made.collaborationId } })).revision).toBe(1);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: f.owner } });
  const renewed = await resolveSession(await openSession(u.id, u.sessionVersion, u.passwordHash));
  if (!renewed) throw new Error("Renewed native session missing");
  // Retry the original key and bytes against the object retained after rollback.
  const recovered = await s.attachExternalCollaborationFile(captureOrganizationActor(renewed), f.input, png, { storage });
  expect(recovered).toMatchObject({ revision: 2, replayed: false });
  expect(await prisma.externalCollaborationAttachment.count({ where: { ownerUserId: f.owner } })).toBe(1);
});
