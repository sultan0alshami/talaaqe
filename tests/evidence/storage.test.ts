import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLocalEvidenceStorage, createSupabaseEvidenceStorage, inspectEvidence, MAX_EVIDENCE_BYTES } from "@/lib/evidence/storage";
import { png } from "./fixtures";
describe("actual private evidence byte storage", () => {
  it("validates actual length/signatures, ignores extension claims and rejects SVG/executable/active PDF content", () => {
    expect(inspectEvidence(png, "image/png")).toMatchObject({ contentType: "image/png", size: png.length, checksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    for (const [bytes, type] of [[png, "image/jpeg"], [Buffer.from('<svg onload="alert(1)"/>'), "image/png"], [Buffer.from("MZ executable"), "application/pdf"],
      [Buffer.from("%PDF-1.7\n/JavaScript (app.alert())\n%%EOF"), "application/pdf"], [new Uint8Array(MAX_EVIDENCE_BYTES + 1), "image/png"], [Buffer.alloc(0), "image/png"]] as const) {
      expect(() => inspectEvidence(bytes, type)).toThrow();
    }
    expect(inspectEvidence(Buffer.from("%PDF-1.7\n1 0 obj<</Type /Catalog>>endobj\n%%EOF"), "application/pdf").contentType).toBe("application/pdf");
  });
  it("persists real task-owned bytes privately, rejects traversal/overwrite and reports missing objects", async () => {
    const storage = await createLocalEvidenceStorage({ taskId: process.env.INFAME_TASK_ID!, target: "test" }), key = `${randomUUID()}/${randomUUID()}`;
    try {
      await storage.put(key, png, "image/png"); expect(Buffer.from(await storage.get(key))).toEqual(png);
      await storage.put(key, png, "image/png");
      await expect(storage.put(key, Buffer.concat([png, Buffer.from("altered")]), "image/png")).rejects.toMatchObject({ code: "STORAGE_CONFLICT" });
      await expect(storage.get("../outside")).rejects.toMatchObject({ code: "INVALID_STORAGE_KEY" });
      await expect(storage.put("/absolute", png, "image/png")).rejects.toMatchObject({ code: "INVALID_STORAGE_KEY" });
    } finally { await storage.remove(key); }
    await expect(storage.get(key)).rejects.toMatchObject({ code: "ASSET_BYTES_UNAVAILABLE" });
    await expect(createLocalEvidenceStorage({ taskId: "infame_000000000000", target: "test" })).rejects.toMatchObject({ code: "UNSAFE_LOCAL_STORAGE" });
  });
  it("requires a private Supabase bucket before operations and keeps service credentials server-side", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [], stored = new Map<string, Uint8Array>();
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes("/bucket/")) return Response.json({ id: "infame-evidence", public: false });
      if (init?.method === "POST") { stored.set("file", new Uint8Array(init.body as ArrayBuffer)); return Response.json({ Key: "file" }); }
      if (init?.method === "DELETE") { stored.delete("file"); return Response.json([]); }
      return new Response(stored.has("file") ? Buffer.from(stored.get("file")!) : null, { status: stored.has("file") ? 200 : 404 });
    }) as typeof fetch;
    const storage = createSupabaseEvidenceStorage({ url: "https://synthetic-project.supabase.co", serviceKey: "synthetic-server-test-only", bucket: "infame-evidence", transport }), key = `${randomUUID()}/${randomUUID()}`;
    await storage.put(key, png, "image/png"); expect(Buffer.from(await storage.get(key))).toEqual(png); await storage.remove(key);
    expect(calls.some(c => c.url.includes("/object/public/") || c.url.includes("synthetic-server-test-only"))).toBe(false);
    expect(calls.every(c => new Headers(c.init?.headers).get("Authorization") === "Bearer synthetic-server-test-only")).toBe(true);
    const publicStorage = createSupabaseEvidenceStorage({ url: "https://synthetic-project.supabase.co", serviceKey: "synthetic-server-test-only", bucket: "infame-evidence", transport: (async () => Response.json({ public: true })) as typeof fetch });
    await expect(publicStorage.put(key, png, "image/png")).rejects.toMatchObject({ code: "PRIVATE_BUCKET_REQUIRED" });
  });
});
