import { describe, expect, it } from "vitest";
import { domainHandler } from "@/lib/domain-api";
import { EvidenceError } from "@/lib/evidence/storage";

describe("private domain response transport", () => {
  it("preserves authenticated attachment bytes without serializing a Response", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const run = domainHandler(async () => new Response(bytes, { headers: {
      "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="evidence.png"',
      "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff",
    } }));
    const response = await run(new Request("https://infame.example.invalid/api/evidence/assets/synthetic"));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="evidence.png"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
  it("keeps the canonical JSON envelope for ordinary domain results", async () => {
    const response = await domainHandler(async () => ({ status: "PENDING", unknown: null }))(new Request("https://infame.example.invalid/api/evidence"));
    expect(await response.json()).toMatchObject({ data: { status: "PENDING", unknown: null }, requestId: expect.any(String) });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("returns a bounded private error envelope for failed attachment authorization", async () => {
    const response = await domainHandler(async () => { throw new EvidenceError("NOT_FOUND", 404); })(new Request("https://infame.example.invalid/api/evidence/assets/foreign"));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND", message: "NOT_FOUND", retryable: false } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
