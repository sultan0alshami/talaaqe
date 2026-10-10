/* Approved single-document public offline policy. Bump the immutable version
 * whenever offline.html changes. No application document or mutation is cached. */
const CACHE_PREFIX = "infame-public-offline-";
const OWNED_CACHE_NAME = /^infame-public-offline-v[0-9]+$/;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = new URL("/offline.html", self.location.origin).href;
const MAX_OFFLINE_BYTES = 65536;
const PUBLIC_DOCUMENT_PATHS = new Set([
  "/", "/about", "/contact", "/pricing", "/for-brands", "/for-creators",
]);

function htmlResponse(response, requireNetworkUrl) {
  if (response.status !== 200 || !response.ok || response.redirected ||
      response.type === "opaque" || response.type === "opaqueredirect" ||
      !/^text\/html(?:\s*;|\s*$)/i.test(response.headers.get("content-type") || "")) {
    throw new Error("Offline notice unavailable");
  }
  if (requireNetworkUrl && response.url !== OFFLINE_URL) {
    throw new Error("Offline notice unavailable");
  }
  if (!requireNetworkUrl && response.url && response.url !== OFFLINE_URL) {
    throw new Error("Offline notice unavailable");
  }
}

async function boundedHtml(response, requireNetworkUrl) {
  htmlResponse(response, requireNetworkUrl);
  if (!response.body) throw new Error("Offline notice unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_OFFLINE_BYTES) throw new Error("Offline notice unavailable");
      decoder.decode(value, { stream: true });
      chunks.push(value);
    }
    decoder.decode();
    if (length === 0) throw new Error("Offline notice unavailable");
  } catch {
    try { await reader.cancel(); } catch { /* Preserve the original failure. */ }
    throw new Error("Offline notice unavailable");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, noarchive",
      "Referrer-Policy": "no-referrer",
    },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch(OFFLINE_URL, {
      credentials: "omit", cache: "no-store", redirect: "error",
    });
    const notice = await boundedHtml(response, true);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(OFFLINE_URL, notice);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => OWNED_CACHE_NAME.test(name) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
  })());
});

function isPublicDocument(request) {
  if (request.method !== "GET" || request.mode !== "navigate" ||
      request.destination !== "document") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || url.hash ||
      !PUBLIC_DOCUMENT_PATHS.has(url.pathname)) return false;
  if (request.url !== `${url.origin}${url.pathname}`) return false;
  const headers = request.headers;
  if (["rsc", "next-router-prefetch", "next-router-segment-prefetch", "next-router-state-tree", "next-url"]
    .some((name) => headers.has(name))) return false;
  if (/prefetch/i.test(headers.get("purpose") || "") ||
      /prefetch/i.test(headers.get("sec-purpose") || "") ||
      /text\/x-component/i.test(headers.get("accept") || "")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  if (!isPublicDocument(event.request)) return;
  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch (networkFailure) {
      const names = await caches.keys();
      if (!names.includes(CACHE_NAME)) throw networkFailure;
      const cache = await caches.open(CACHE_NAME);
      const notice = await cache.match(OFFLINE_URL, { ignoreSearch: false });
      if (!notice) throw networkFailure;
      return boundedHtml(notice, false);
    }
  })());
});
