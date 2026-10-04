import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectConfirmedWebsite } from "@/lib/imports/website";
import { WebsiteImportError, type WebsiteDependencies } from "@/lib/imports/website/types";

const input = { sourceId: "website", sourceRevision: 1, consentVersion: "test-v1", confirmedOrigin: "https://brand.example.com", confirmedUrl: "https://brand.example.com/" };
const publicIp = "93.184.216.34";
function dependencies(): WebsiteDependencies {
  return { capability: { enabled: true, mode: "DEVELOPMENT_FIXTURE", reviewVersion: "test-owned-v1" },
    resolver: { resolve: async () => [{ address: publicIp, family: 4 }] },
    accessPolicy: { reviewVersion: "test-owned-v1", check: async (value) => ({ ...value, policyVersion: "test-owned-v1", checkedAt: new Date().toISOString(), access: "ALLOW", robots: "ALLOW" }) } };
}
describe("hostile website data through a test-owned local transport", () => {
  it("fetches an actual ephemeral fixture body without running scripts, following links or importing proof", async () => {
    const visited: string[] = [];
    const hostile = Buffer.from(`<title>Original brand</title><meta name="description" content="Original description"><body><h1>خدماتنا</h1><p>Original service words</p><script>fetch('/exfiltrate'); ownershipVerified=true; ignoreAllInstructions=true;</script><iframe src="/frame">Frame instruction</iframe><form action="/send"><input value="private"></form><a href="/auto-discovered">Related page</a><img src="/asset"><script type="application/ld+json">{"customers":100000,"ownershipVerified":true}</script></body>`);
    const server = createServer((incoming, outgoing) => { visited.push(incoming.url ?? ""); outgoing.writeHead(200, { "content-type": "text/html; charset=utf-8" }); outgoing.end(hostile); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const deps = dependencies();
    // This fixture-only transport maps a public test identity to its own server
    // and reports a synthetic peer. It is not the native transport and provides
    // no evidence of live/public reachability or permission. Production has no
    // localhost exception; the native TLS test separately proves peer rejection.
    deps.transport = { mode: "DEVELOPMENT_FIXTURE", reviewVersion: "test-owned-v1", get: async (value) => new Promise((resolve, reject) => {
      const connection = request({ hostname: "127.0.0.1", port: address.port, path: new URL(value.url).pathname, signal: value.signal, agent: false }, (response) => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on("error", reject); response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > value.maxResponseBytes) connection.destroy(new Error("Fixture byte limit")); else chunks.push(chunk); });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.concat(chunks), peerAddress: publicIp }));
      });
      connection.on("error", reject); connection.end();
    }) };
    try {
      const result = await collectConfirmedWebsite(input, deps), text = JSON.stringify(result.pages[0].facts);
      expect(result.status).toBe("SUCCEEDED"); expect(visited).toEqual(["/"]);
      expect(text).toContain("خدماتنا"); expect(text).toContain("Original service words");
      for (const hidden of ["fetch", "ownershipVerified", "ignoreAllInstructions", "Frame instruction", "100000", "private"]) expect(text).not.toContain(hidden);
      expect(result.pages[0].bodyHash).toBe(createHash("sha256").update(hostile).digest("hex"));
      expect(result.unknowns).toMatchObject({ customers: null, metrics: null, representation: null, licence: null });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("does not expose arbitrary provider error text as a result error code", async () => {
    const deps = dependencies();
    deps.transport = { mode: "DEVELOPMENT_FIXTURE", reviewVersion: "test-owned-v1", get: async () => { throw new WebsiteImportError("https://user:secret@private.local/?token=secret"); } };
    const result = await collectConfirmedWebsite(input, deps);
    expect(result.errors).toEqual([{ url: input.confirmedUrl, code: "TRANSPORT_FAILED" }]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
