import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { createServer, type TLSSocket } from "node:tls";
import type { IncomingMessage, RequestOptions } from "node:http";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), request: vi.fn() }));
vi.mock("node:tls", async (original) => ({ ...await original<typeof import("node:tls")>(), connect: mocks.connect }));
vi.mock("node:https", async (original) => ({ ...await original<typeof import("node:https")>(), request: mocks.request }));
import { createPinnedHttpsTransport } from "@/lib/imports/website/transport";
const publicIp = "93.184.216.34";
function input(time = 500, bytes = 1_048_576) { return { url: "https://brand.example.com/about", destination: { address: publicIp, family: 4 as const }, signal: new AbortController().signal, deadline: performance.now() + time, maxResponseBytes: bytes }; }
function socket(peer = publicIp, authorized = true, name = "brand.example.com") {
  return Object.assign(new EventEmitter(), { remoteAddress: peer, authorized, getPeerCertificate: () => ({ subjectaltname: `DNS:${name}` }), destroy: vi.fn() }) as unknown as TLSSocket;
}
function reply(body: Buffer, headers: Record<string, string> = {}) {
  return Object.assign(Readable.from([body]), { socket: { remoteAddress: publicIp }, statusCode: 200, complete: true, headers: { "content-type": "text/html", ...headers } }) as unknown as IncomingMessage;
}
beforeEach(() => {
  mocks.connect.mockReset(); mocks.request.mockReset();
  mocks.connect.mockImplementation(() => { const stream = socket(); queueMicrotask(() => stream.emit("secureConnect")); return stream; });
  mocks.request.mockImplementation((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const outgoing = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: () => callback(reply(Buffer.from("<p>Original</p>"))) });
    return outgoing;
  });
});
describe("native pinned HTTPS transport with test-owned TLS/HTTP seams", () => {
  it("pins a literal IP, preserves SNI/Host and CA verification, and gives HTTP only the verified socket", async () => {
    const consume = vi.fn(), output = await createPinnedHttpsTransport("reviewed-test-v1").get({ ...input(), consumeBytes: consume });
    const options = mocks.connect.mock.calls[0][0];
    expect(options).toMatchObject({ host: publicIp, port: 443, servername: "brand.example.com", rejectUnauthorized: true, minVersion: "TLSv1.2" });
    expect(options.checkServerIdentity("other", { subjectaltname: "DNS:other.example.com" })).toBeInstanceOf(Error);
    const requestOptions = mocks.request.mock.calls[0][0];
    expect(requestOptions).toMatchObject({ method: "GET", path: "/about", headers: { Host: "brand.example.com", "Accept-Encoding": "identity", Connection: "close" }, maxHeaderSize: 16_384, insecureHTTPParser: false });
    expect(requestOptions.agent).toBeUndefined(); expect(requestOptions.createConnection()).toBe(mocks.connect.mock.results[0].value);
    for (const key of ["Authorization", "Cookie", "Referer", "Origin"]) expect(requestOptions.headers[key]).toBeUndefined();
    expect(output.peerAddress).toBe(publicIp); expect(consume).toHaveBeenCalledWith(output.body.length);
  });
  it("rejects TLS/certificate/peer mismatch before any HTTP request", async () => {
    for (const stream of [socket("127.0.0.1"), socket(publicIp, false), socket(publicIp, true, "other.example.com")]) {
      mocks.connect.mockImplementation(() => { queueMicrotask(() => stream.emit("secureConnect")); return stream; });
      await expect(createPinnedHttpsTransport("test-v1").get(input())).rejects.toThrow();
      expect(mocks.request).not.toHaveBeenCalled(); expect(stream.destroy).toHaveBeenCalled();
    }
  });
  it("rejects a private destination and aborted operation before creating TLS", async () => {
    await expect(createPinnedHttpsTransport("test-v1").get({ ...input(), destination: { address: "127.0.0.1", family: 4 } })).rejects.toMatchObject({ code: "DESTINATION_BLOCKED" });
    const controller = new AbortController(); controller.abort();
    await expect(createPinnedHttpsTransport("test-v1").get({ ...input(), signal: controller.signal })).rejects.toMatchObject({ code: "DEADLINE" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("bounds body/declared length/compression and an absolute silent-header deadline", async () => {
    for (const response of [reply(Buffer.alloc(101)), reply(Buffer.alloc(0), { "content-length": "101" }), reply(Buffer.alloc(0), { "content-encoding": "gzip" })]) {
      mocks.request.mockImplementation((_options, callback) => Object.assign(new EventEmitter(), { destroy: vi.fn(), end: () => callback(response) }));
      await expect(createPinnedHttpsTransport("test-v1").get(input(500, 100))).rejects.toThrow();
    }
    mocks.request.mockImplementation(() => Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() }));
    const started = performance.now();
    await expect(createPinnedHttpsTransport("test-v1").get(input(25))).rejects.toMatchObject({ code: "DEADLINE" });
    expect(performance.now() - started).toBeLessThan(500);
  });
  it("connects a real test-owned TLS fixture yet rejects its real loopback peer before HTTP", async () => {
    const fixtureDirectory = new URL("./fixtures/", import.meta.url);
    const certificate = readFileSync(new URL("synthetic-brand-cert.pem.txt", fixtureDirectory));
    const key = readFileSync(new URL("synthetic-brand-key.pem.txt", fixtureDirectory));
    const server = createServer({ cert: certificate, key }, (stream) => { stream.on("error", () => {}); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const actualTls = await vi.importActual<typeof import("node:tls")>("node:tls");
    // This rewrite exists only in the test-owned mocked connector. Product
    // validation still observes 127.0.0.1 and must refuse to hand it to HTTP.
    mocks.connect.mockImplementation((options) => actualTls.connect({ ...options, host: "127.0.0.1", port: address.port, ca: certificate }));
    try {
      await expect(createPinnedHttpsTransport("synthetic-real-tls-v1").get(input(2_000))).rejects.toMatchObject({ code: "PEER_MISMATCH" });
      expect(mocks.request).not.toHaveBeenCalled();
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("aborts silent TLS and a body that trickles forever at the absolute deadline", async () => {
    const stream = socket(); mocks.connect.mockImplementation(() => stream);
    await expect(createPinnedHttpsTransport("test-v1").get(input(25))).rejects.toMatchObject({ code: "DEADLINE" });
    expect(stream.destroy).toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
    mocks.connect.mockImplementation(() => { const ready = socket(); queueMicrotask(() => ready.emit("secureConnect")); return ready; });
    const response = Object.assign(new Readable({ read() {} }), { socket: { remoteAddress: publicIp }, statusCode: 200, complete: false, headers: { "content-type": "text/html" } }) as unknown as IncomingMessage;
    mocks.request.mockImplementation((_options, callback) => Object.assign(new EventEmitter(), { destroy: vi.fn(), end: () => callback(response) }));
    const trickle = setInterval(() => response.push(Buffer.from("x")), 5), started = performance.now();
    try {
      await expect(createPinnedHttpsTransport("test-v1").get(input(35))).rejects.toMatchObject({ code: "DEADLINE" });
      expect(response.destroyed).toBe(true); expect(performance.now() - started).toBeLessThan(500);
    } finally { clearInterval(trickle); response.destroy(); }
  });
});
