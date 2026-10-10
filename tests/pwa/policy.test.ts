import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Exactly two groups execute the ACTUAL public/sw.js bytes in NodeVM.
// Real Fetch Request/Response/UTF8/readable streams are used. Event delivery,
// fetch-response identity metadata and in-memory CacheStorage are explicit
// policy/mechanics seams, not actual browser installation/outage acceptance.
// Root alone adopts/runs. No imports from registered tests or product helpers.
const origin = "https://pwa-mechanics.example.invalid";
const offlineURL = origin + "/offline.html", currentCache = "infame-public-offline-v1";
const oldCache = "infame-public-offline-v0", foreignCache = "unrelated-existing-application";
const nearPrefixCache = "infame-public-offline-vendor-sentinel";
const notice = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><h1>لا يوجد اتصال</h1><p lang="en" dir="ltr">You are offline.</p><a href="/">Retry</a></body></html>';
type Input = RequestInfo | URL;
function urlOf(input: Input): string { return input instanceof Request ? input.url : new URL(String(input), origin).href; }
class MemoryCache {
  readonly values = new Map<string, Response>();
  constructor(readonly name: string, readonly writes: Array<{ cache: string; url: string }>) {}
  async put(input: Input, response: Response) { const url = urlOf(input); this.writes.push({ cache: this.name, url }); this.values.set(url, response.clone()); }
  async match(input: Input) { return this.values.get(urlOf(input))?.clone(); }
  async keys() { return [...this.values.keys()].map(url => new Request(url)); }
  async delete(input: Input) { return this.values.delete(urlOf(input)); }
}
class MemoryCaches {
  readonly entries = new Map<string, MemoryCache>();
  readonly writes: Array<{ cache: string; url: string }> = [];
  readonly removed: string[] = [];
  failPut = false;
  async open(name: string) {
    if (!this.entries.has(name)) this.entries.set(name, new MemoryCache(name, this.writes));
    const cache = this.entries.get(name)!;
    if (!this.failPut) return cache;
    return { ...cache, put: async () => { throw new Error("Synthetic CacheStorage write failure"); }, match: cache.match.bind(cache), keys: cache.keys.bind(cache) };
  }
  async keys() { return [...this.entries.keys()]; }
  async delete(name: string) { this.removed.push(name); return this.entries.delete(name); }
  async match(input: Input, options?: { cacheName?: string }) {
    for (const [name, cache] of this.entries) {
      if (options?.cacheName && options.cacheName !== name) continue;
      const match = await cache.match(input); if (match) return match;
    }
    return undefined;
  }
}
function asset(body: BodyInit | null = notice, init: ResponseInit = {}, identity: { url?: string; type?: ResponseType; redirected?: boolean } = {}) {
  const response = new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, ...init });
  // Constructor-created Responses have no transport URL. These read-only
  // identity properties are the declared fetch seam; their bodies/readers are
  // actual Fetch objects and are not JSON/provider/query mocks.
  Object.defineProperties(response, { url: { value: identity.url ?? offlineURL }, type: { value: identity.type ?? "basic" }, redirected: { value: identity.redirected ?? false } });
  return response;
}
type WorkerEvent = { request?: Request; waitUntil(task: Promise<unknown>): void; respondWith?(task: Promise<Response> | Response): void };
type Listener = (event: WorkerEvent) => unknown;
function worker(store = new MemoryCaches()) {
  const callbacks = new Map<string, Listener[]>(), calls: Array<{ input: Input; init?: RequestInit; effective: Request }> = [];
  let implementation: (request: Request) => Promise<Response> = async () => asset();
  const fetcher = async (input: Input, init?: RequestInit) => { const effective = new Request(input, init); calls.push({ input, init, effective }); return implementation(effective); };
  const register = (name: string, fn: Listener) => { callbacks.set(name, [...callbacks.get(name) ?? [], fn]); };
  const skipWaiting = vi.fn(async () => undefined), claim = vi.fn(async () => undefined);
  const self = { location: new URL(origin + "/sw.js"), registration: { scope: origin + "/" }, addEventListener: register,
    caches: store, fetch: fetcher, skipWaiting, clients: { claim, matchAll: vi.fn(async () => []) } };
  const output = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
  runInNewContext(readFileSync(resolve("public/sw.js"), "utf8"), { self, addEventListener: register, location: self.location,
    caches: store, fetch: fetcher, URL, Request, Response, Headers, TextDecoder, TextEncoder, ReadableStream, AbortController,
    setTimeout, clearTimeout, console: output }, { filename: "actual-public-sw.js", timeout: 1000 });
  return { store, calls, callbacks, skipWaiting, claim, output,
    network(fn: (request: Request) => Promise<Response>) { implementation = fn; },
    async lifecycle(name: "install" | "activate") {
      const listeners = callbacks.get(name) ?? []; expect(listeners.length, `Actual ${name} handler is required`).toBe(1);
      const waits: Promise<unknown>[] = [], event = { waitUntil: (task: Promise<unknown>) => { waits.push(Promise.resolve(task)); } };
      for (const listener of listeners) listener(event);
      expect(waits.length, `${name} must retain its asynchronous work`).toBeGreaterThan(0);
      await Promise.all(waits);
    },
    dispatch(request: Request) {
      const listeners = callbacks.get("fetch") ?? []; expect(listeners.length, "Actual fetch policy is required").toBe(1);
      const replies: Promise<Response>[] = [], waits: Promise<unknown>[] = [];
      const event: WorkerEvent = { request, waitUntil: task => { waits.push(Promise.resolve(task)); }, respondWith: task => { replies.push(Promise.resolve(task)); } };
      for (const listener of listeners) listener(event);
      expect(replies.length).toBeLessThanOrEqual(1); return { replies, waits };
    } };
}
function navigation(path: string, init: RequestInit = {}, context: { mode?: RequestMode; destination?: RequestDestination } = {}) {
  const request = new Request(path.startsWith("https://") ? path : origin + path, init);
  // Node cannot construct mode=navigate. Browser event metadata is an explicit
  // seam on a real Request; no synthetic install/controller claim follows.
  Object.defineProperties(request, { mode: { value: context.mode ?? "navigate" }, destination: { value: context.destination ?? "document" } });
  return request;
}
async function seeded() { const store = new MemoryCaches(); await (await store.open(currentCache)).put(offlineURL, asset()); store.writes.length = 0; return store; }
async function staleSeed() { const store = new MemoryCaches(); await (await store.open(oldCache)).put(offlineURL, asset("old static artifact")); await (await store.open(foreignCache)).put(origin + "/foreign", new Response("unrelated sentinel")); await (await store.open(nearPrefixCache)).put(origin + "/near-prefix", new Response("unrelated close-prefix sentinel")); store.writes.length = 0; return store; }
function unchangedLifecycle(w: ReturnType<typeof worker>) { expect(w.skipWaiting).not.toHaveBeenCalled(); expect(w.claim).not.toHaveBeenCalled(); expect(w.callbacks.has("sync")).toBe(false); expect(w.callbacks.has("periodicsync")).toBe(false); expect(w.callbacks.has("push")).toBe(false); expect(w.callbacks.has("notificationclick")).toBe(false); }

describe("actual PWA worker policy and single-document cache", () => {
  it("handles only the six exact public documents, preserving network/server responses and bypassing private/RSC/mutations without caching", async () => {
    const w = worker(await seeded());
    const paths = ["/", "/about", "/contact", "/pricing", "/for-brands", "/for-creators"];
    const marker = "SYNTHETIC_PRIVATE_RESPONSE_NOT_CACHEABLE";
    for (const path of paths) {
      const served = new Response(marker, { headers: { "Content-Type": "text/html", "X-Native-Response": "kept" } }); w.network(async () => served);
      const request = navigation(path, { headers: { Cookie: "infame_language=en" } }), dispatched = w.dispatch(request);
      expect(dispatched.replies).toHaveLength(1); const returned = await dispatched.replies[0]!;
      expect(returned).toBe(served); expect(returned.headers.get("x-native-response")).toBe("kept");
      expect(w.calls.at(-1)?.input).toBe(request); expect(w.store.writes).toEqual([]);
      w.network(async () => { throw new TypeError("Synthetic network rejection"); });
      const offline = w.dispatch(navigation(path)); expect(offline.replies).toHaveLength(1);
      const fallback = await offline.replies[0]!; expect(fallback.status).toBe(200); expect(await fallback.text()).toBe(notice); expect(w.store.writes).toEqual([]);
    }
    for (const status of [301, 302, 307, 308, 401, 403, 404, 500]) {
      const served = new Response(status < 400 ? null : "actual server error fixture", { status, headers: status < 400 ? { Location: "/login" } : {} });
      w.network(async () => served); const reply = w.dispatch(navigation("/about")); expect(await reply.replies[0]!).toBe(served);
      expect(served.status).toBe(status); expect(w.store.writes).toEqual([]);
    }
    const denied = [
      ...["/brand", "/brand/campaigns/owned", "/creator", "/admin", "/client", "/provider", "/login", "/signup", "/reset-password", "/verify-email", "/onboarding", "/settings", "/invite", "/claim", "/api/admin/analytics", "/api/campaign-agent/commands", "/classic", "/for-clients", "/for-providers", "/@creator", "/brands/company", "/offline.html", "/brand/infame-icon-192.png", "/_next/static/private.js", "/context/reference/download", "/unknown", "/about/", "//about", "/ABOUT", "/%61bout", "/about?language=en", "/about?x=1&x=1", "/about?", "/about#section"].map(path => navigation(path)),
      ...["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map(method => navigation("/", { method })),
      navigation("https://other.example.invalid/"), navigation("/", {}, { mode: "cors", destination: "document" }), navigation("/", {}, { mode: "navigate", destination: "" }),
      navigation("/", { headers: { RSC: "1" } }), navigation("/", { headers: { "Next-Router-Prefetch": "1" } }),
      navigation("/", { headers: { Purpose: "prefetch" } }), navigation("/", { headers: { "Sec-Purpose": "prefetch" } }), navigation("/?_rsc=next-data"),
    ];
    w.calls.length = 0;
    for (const request of denied) { const dispatched = w.dispatch(request); expect(dispatched.replies.length, "Denied request must bypass respondWith: " + request.method + " " + request.url).toBe(0); expect(dispatched.waits).toEqual([]); }
    expect(w.calls).toEqual([]); expect(w.store.writes).toEqual([]); unchangedLifecycle(w);
    // Do not accidentally retrieve an unrelated/old cache's same-URL content.
    const foreign = await staleSeed(); await (await foreign.open(foreignCache)).put(offlineURL, asset(marker)); foreign.writes.length = 0;
    const missing = worker(foreign); missing.network(async () => { throw new TypeError("Synthetic network rejection"); });
    const absent = missing.dispatch(navigation("/")); expect(absent.replies).toHaveLength(1); await expect(absent.replies[0]!).rejects.toBeDefined();
    expect(foreign.writes).toEqual([]); expect(foreign.removed).toEqual([]);
    // A malformed cache record cannot be returned as an offline success.
    const corrupt = await seeded(); const cache = corrupt.entries.get(currentCache)!; cache.values.set(offlineURL, new Response("not an HTML notice", { headers: { "Content-Type": "application/json" } }));
    const bad = worker(corrupt); bad.network(async () => { throw new TypeError("Synthetic network rejection"); });
    await expect(bad.dispatch(navigation("/pricing")).replies[0]!).rejects.toBeDefined(); expect(corrupt.writes).toEqual([]);
  });

  it("precache validates actual streamed bytes/UTF8/transport identity, fails truthfully, and activates only its versioned cache without forcing clients", async () => {
    const store = await staleSeed(), w = worker(store); await w.lifecycle("install");
    expect(w.calls).toHaveLength(1); const request = w.calls[0]!.effective;
    expect(request.url).toBe(offlineURL); expect(request.method).toBe("GET"); expect(request.credentials).toBe("omit"); expect(request.cache).toBe("no-store"); expect(request.redirect).toBe("error");
    expect(store.writes).toEqual([{ cache: currentCache, url: offlineURL }]); expect(await (await store.open(currentCache)).match(offlineURL).then(async response => response?.text())).toBe(notice);
    expect(store.removed).toEqual([]); unchangedLifecycle(w);
    await w.lifecycle("activate"); expect(store.removed).toEqual([oldCache]); expect(await store.keys()).toEqual(expect.arrayContaining([currentCache, foreignCache, nearPrefixCache])); unchangedLifecycle(w);
    expect(await (await store.open(foreignCache)).match(origin + "/foreign").then(async response => response?.text())).toBe("unrelated sentinel");
    const encoded = new TextEncoder().encode(notice), exact = new Uint8Array(65536); exact.fill(0x20); exact.set(encoded);
    const max = worker(); max.network(async () => asset(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(exact.subarray(0, 12345)); controller.enqueue(exact.subarray(12345)); controller.close(); } }), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Length": "1" } }));
    await max.lifecycle("install"); expect(max.store.writes).toEqual([{ cache: currentCache, url: offlineURL }]);
    expect(new TextEncoder().encode(await (await max.store.open(currentCache)).match(offlineURL).then(async response => response!.text())).byteLength).toBe(65536);
    for (const make of [
      () => asset(null, { status: 204 }), () => asset(notice, { status: 201 }), () => asset(notice, { status: 401 }), () => asset(notice, { status: 500 }),
      () => asset(notice, {}, { url: origin + "/login" }), () => asset(notice, {}, { url: origin + "/offline.html?private=1" }),
      () => asset(notice, {}, { url: "https://other.example.invalid/offline.html" }), () => asset(notice, {}, { redirected: true }),
      () => asset(notice, {}, { type: "opaque" }), () => asset(notice, {}, { type: "opaqueredirect" }),
      () => asset(notice, { headers: { "Content-Type": "application/json" } }), () => asset(notice, { headers: {} }),
      () => asset(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      () => asset(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("Synthetic body stream failure")); } })),
    ]) {
      const saved = await staleSeed(), failure = worker(saved); failure.network(async () => make());
      await expect(failure.lifecycle("install")).rejects.toBeDefined(); expect(saved.writes).toEqual([]);
      expect(saved.entries.has(oldCache)).toBe(true); expect(saved.entries.has(foreignCache)).toBe(true); expect(saved.removed).toEqual([]); unchangedLifecycle(failure);
    }
    let cancelled = false; const overflow = worker(await staleSeed());
    overflow.network(async () => asset(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/html", "Content-Length": "1" } }));
    await expect(overflow.lifecycle("install")).rejects.toBeDefined(); expect(cancelled).toBe(true); expect(overflow.store.writes).toEqual([]); expect(overflow.store.removed).toEqual([]);
    const unreachable = worker(await staleSeed()); unreachable.network(async () => { throw new TypeError("Synthetic unavailable precache transport"); });
    await expect(unreachable.lifecycle("install")).rejects.toBeDefined(); expect(unreachable.store.writes).toEqual([]); expect(unreachable.store.removed).toEqual([]);
    const failedStore = await staleSeed(); failedStore.failPut = true; const writeFailure = worker(failedStore);
    await expect(writeFailure.lifecycle("install")).rejects.toBeDefined(); expect(failedStore.entries.has(oldCache)).toBe(true); expect(failedStore.entries.has(foreignCache)).toBe(true); unchangedLifecycle(writeFailure);
  });
});
