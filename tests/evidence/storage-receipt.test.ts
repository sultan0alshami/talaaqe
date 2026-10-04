import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createLocalEvidenceStorage, createSupabaseEvidenceStorage } from "@/lib/evidence/storage";
import { png } from "./fixtures";

it("returns distinct creation receipts for new and already present local bytes", async () => {
  const storage = await createLocalEvidenceStorage({ taskId: process.env.INFAME_TASK_ID!, target: "test" }), key = `${randomUUID()}/${randomUUID()}`;
  try {
    expect(await storage.put(key, png, "image/png")).toEqual({ created: true });
    expect(await storage.put(key, png, "image/png")).toEqual({ created: false });
  } finally { await storage.remove(key); }
});

it("returns a Supabase creation receipt only after confirmed creation; duplicate and uncertain responses never confer ownership", async () => {
  let present = false;
  const transport = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (String(_url).includes("/bucket/")) return Response.json({ public: false });
    if (init?.method === "POST") {
      if (present) return new Response(null, { status: 409 });
      present = true; return Response.json({ Key: "synthetic" });
    }
    return new Response(png);
  }) as typeof fetch;
  const storage = createSupabaseEvidenceStorage({ url: "https://synthetic-project.supabase.co", serviceKey: "synthetic-test-only", bucket: "infame-evidence", transport });
  const key = `${randomUUID()}/${randomUUID()}`;
  expect(await storage.put(key, png, "image/png")).toEqual({ created: true });
  expect(await storage.put(key, png, "image/png")).toEqual({ created: false });
  const uncertain = createSupabaseEvidenceStorage({ url: "https://synthetic-project.supabase.co", serviceKey: "synthetic-test-only", bucket: "infame-evidence", transport: (async (url: RequestInfo | URL) => {
    if (String(url).includes("/bucket/")) return Response.json({ public: false });
    throw new Error("Synthetic lost response");
  }) as typeof fetch });
  await expect(uncertain.put(key, png, "image/png")).rejects.toMatchObject({ code: "ASSET_BYTES_UNAVAILABLE" });
});
