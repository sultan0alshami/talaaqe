import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
let stage = "fixture-origin";

// One standalone production HTTP group, deliberately outside Vitest: check
// gates run their tests BEFORE the supported Webpack build. Root builds, starts
// actual next start on the guarded local E2E origin and then runs this script.
// It never starts a server, creates a fake production DB/session/provider,
// weakens runtimeConfig, accepts mocked fetch, or silently skips/falls back to
// dev. Build/server command provenance remains root's separately recorded
// evidence; these HTTP/asset checks are not device installation proof.
function fixtureOrigin() {
  const raw = process.env.INFAME_PWA_HTTP_ORIGIN;
  assert.ok(raw, "A production HTTP fixture origin is mandatory");
  const url = new URL(raw);
  assert.equal(url.origin, "http://localhost:3100", "Refuse any non-owned HTTP fixture origin");
  assert.equal(url.pathname, "/"); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.search, ""); assert.equal(url.hash, "");
  return url.origin;
}
function localURL(value, origin) {
  assert.equal(typeof value, "string"); const url = new URL(value, origin);
  assert.equal(url.origin, origin, "Never fetch an external manifest or metadata URL"); assert.equal(url.username, ""); assert.equal(url.password, "");
  return url;
}
async function get(url) {
  const response = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  assert.equal(response.redirected, false); assert.equal(response.url, String(url)); return response;
}
async function bytes(response, limit) {
  assert.ok(response.body, "Expected an actual HTTP response body");
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("Bounded HTTP artifact exceeded its limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length);
}
const utf8 = data => new TextDecoder("utf-8", { fatal: true }).decode(data);
function contentType(response, expected) { assert.match(response.headers.get("content-type") ?? "", expected); }
function attrs(tag) {
  const values = new Map();
  for (const match of tag.matchAll(/\s([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) values.set(match[1].toLowerCase(), (match[2] ?? match[3]).replaceAll("&amp;", "&"));
  return values;
}
function metadataLink(html, rel, origin) {
  const matches = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attrs(match[0])).filter(value => value.get("rel")?.split(/\s+/).includes(rel));
  assert.equal(matches.length, 1, `Expected one actual ${rel} metadata link`);
  return localURL(matches[0].get("href"), origin);
}
function png(data, width, height) {
  assert.ok(data.byteLength >= 33, "PNG header is present");
  assert.ok(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Actual asset is PNG");
  assert.equal(data.toString("ascii", 12, 16), "IHDR"); assert.equal(data.readUInt32BE(16), width); assert.equal(data.readUInt32BE(20), height);
}
function absentPrivatePaths(value) {
  assert.equal(/(?:C:[\\/]Users[\\/]|\.infame[\\/]|\.research[\\/]|AUTH_SECRET|DATABASE_URL|storageKey|sessionId)/i.test(value), false, "Public artifacts contain no development/private identities");
}

async function productionPwaHTTP() {
  const origin = fixtureOrigin();
  stage = "build-artifact";
  const buildDir = process.env.NEXT_BUILD_DIR === ".next-e2e" ? ".next-e2e" : ".next";
  const buildId = (await readFile(path.resolve(buildDir, "BUILD_ID"), "utf8")).trim();
  assert.ok(buildId.length > 0 && buildId.length <= 256, "Supported production build artifact is required; do not test an unbuilt dev fallback");
  stage = "home-webpack";
  const home = await get(new URL("/", origin)); assert.equal(home.status, 200); contentType(home, /^text\/html(?:;|$)/i);
  const html = utf8(await bytes(home, 2 * 1024 * 1024));
  assert.equal(/(?:_next\/webpack-hmr|react-refresh|next-devtools)/i.test(html), false, "Development response is not production acceptance");
  assert.match(html, /\/_next\/static\/chunks\/(?:webpack|framework|main|main-app|polyfills)-[a-f0-9]+\.js/i, "Actual supported Webpack production chunks are served");
  stage = "manifest-link";
  const manifestLink = metadataLink(html, "manifest", origin); assert.equal(manifestLink.pathname, "/manifest.webmanifest"); assert.equal(manifestLink.search, "");
  const manifestResponse = await get(manifestLink); assert.equal(manifestResponse.status, 200); contentType(manifestResponse, /^application\/manifest\+json(?:;|$)/i);
  stage = "manifest-identity";
  const manifest = JSON.parse(utf8(await bytes(manifestResponse, 65536)));
  const allowedManifestKeys = new Set(["name", "short_name", "description", "id", "start_url", "scope", "display", "lang", "dir", "background_color", "theme_color", "icons"]);
  assert.ok(Object.keys(manifest).every(key => allowedManifestKeys.has(key)), "Manifest is limited to the install identity, with no private shortcut payloads");
  assert.equal(manifest.name, "Infame / إنفيم"); assert.ok(["Infame", "إنفيم", "Infame / إنفيم"].includes(manifest.short_name));
  assert.ok(typeof manifest.description === "string" && manifest.description.length > 0);
  for (const name of ["id", "start_url", "scope"]) { const url = localURL(manifest[name], origin); if (name !== "id") assert.equal(url.pathname, "/"); assert.equal(url.search, ""); assert.equal(url.hash, ""); }
  assert.equal(manifest.display, "standalone"); assert.equal(manifest.lang, "ar"); assert.equal(manifest.dir, "rtl");
  const palette = new Set(["#fffc00", "#121214", "#faf9f4"]);
  assert.ok(palette.has(String(manifest.theme_color).toLowerCase())); assert.ok(palette.has(String(manifest.background_color).toLowerCase()));
  const requiredIcons = [
    { src: "/icons/infame-icon-192.png", size: 192, purpose: "any" },
    { src: "/icons/infame-icon-512.png", size: 512, purpose: "any" },
    { src: "/icons/infame-maskable-512.png", size: 512, purpose: "maskable" },
  ];
  assert.ok(Array.isArray(manifest.icons)); assert.equal(manifest.icons.length, requiredIcons.length);
  for (const expected of requiredIcons) {
    stage = expected.purpose === "maskable" ? "maskable-512" : expected.size === 192 ? "icon-192" : "icon-512";
    const icon = manifest.icons.find(value => value.src === expected.src); assert.ok(icon, "Expected actual owned icon reference");
    assert.ok(Object.keys(icon).every(key => ["purpose", "sizes", "src", "type"].includes(key))); assert.equal(icon.sizes, `${expected.size}x${expected.size}`); assert.equal(icon.type, "image/png"); assert.equal(icon.purpose ?? "any", expected.purpose);
    const url = localURL(icon.src, origin); assert.equal(url.search, ""); assert.equal(url.hash, "");
    const response = await get(url); assert.equal(response.status, 200); contentType(response, /^image\/png(?:;|$)/i);
    const data = await bytes(response, 1024 * 1024); png(data, expected.size, expected.size);
    assert.ok(data.equals(await readFile(path.resolve("public", expected.src.slice(1)))), "HTTP icon matches the actual deterministic owned export");
  }
  stage = "touch-icon";
  const touch = metadataLink(html, "apple-touch-icon", origin); assert.match(touch.pathname, /^\/apple-icon(?:\.png)?$/);
  const touchResponse = await get(touch); assert.equal(touchResponse.status, 200); contentType(touchResponse, /^image\/png(?:;|$)/i);
  const touchBytes = await bytes(touchResponse, 1024 * 1024); png(touchBytes, 180, 180); assert.ok(touchBytes.equals(await readFile(path.resolve("src/app/apple-icon.png"))));
  stage = "worker-headers";
  const sw = await get(new URL("/sw.js", origin)); assert.equal(sw.status, 200); contentType(sw, /^application\/javascript(?:;|$)/i);
  const cache = sw.headers.get("cache-control")?.toLowerCase() ?? "";
  for (const required of ["no-cache", "no-store", "must-revalidate"]) assert.ok(cache.split(",").map(value => value.trim()).includes(required), "Worker HTTP caching is explicitly disabled");
  assert.equal(sw.headers.get("x-content-type-options"), "nosniff");
  const workerCsp = sw.headers.get("content-security-policy") ?? ""; assert.match(workerCsp, /default-src\s+'none'/); assert.match(workerCsp, /script-src\s+'self'/); assert.match(workerCsp, /connect-src\s+'self'/);
  stage = "worker-bytes";
  const workerSource = utf8(await bytes(sw, 65536)); assert.equal(workerSource, await readFile(path.resolve("public/sw.js"), "utf8")); absentPrivatePaths(workerSource);
  stage = "offline-headers";
  const offline = await get(new URL("/offline.html", origin)); assert.equal(offline.status, 200); contentType(offline, /^text\/html(?:;|$)/i);
  const robots = offline.headers.get("x-robots-tag")?.toLowerCase() ?? ""; assert.ok(robots.includes("noindex")); assert.ok(robots.includes("noarchive"));
  const offlineCsp = offline.headers.get("content-security-policy") ?? ""; assert.match(offlineCsp, /default-src\s+'none'/);
  assert.equal(offline.headers.get("set-cookie"), null);
  stage = "offline-content";
  const offlineBytes = await bytes(offline, 65536), offlineHTML = utf8(offlineBytes); assert.equal(offlineHTML, await readFile(path.resolve("public/offline.html"), "utf8"));
  assert.match(offlineHTML, /<html\b[^>]*lang=["']ar["']/i); assert.match(offlineHTML, /\bdir=["']rtl["']/i); assert.match(offlineHTML, /\blang=["']en["']/i);
  assert.match(offlineHTML, /(?:offline|connection|internet)/i); assert.match(offlineHTML, /(?:اتصال|متصل|إنترنت)/);
  assert.equal(/<(?:script|form|iframe|input)\b/i.test(offlineHTML), false); assert.equal(/<(?:link|img)\b[^>]*(?:href|src)=["'](?:https?:|\/\/)/i.test(offlineHTML), false);
  assert.equal(/(?:_next\/|navigator\.|localStorage|sessionStorage|fetch\(|@import|url\(\s*["']?https?:)/i.test(offlineHTML), false);
  const anchors = [...offlineHTML.matchAll(/<a\b[^>]*>/gi)].map(match => attrs(match[0])); assert.ok(anchors.some(value => value.get("href") === "/"), "Static notice has an explicit same-origin retry link");
  absentPrivatePaths(offlineHTML); absentPrivatePaths(JSON.stringify(manifest));
  // Do NOT weaken production configuration guards or synthesize a production
  // DB to demand a success. Anonymous auth can401 before runtimeConfig; a
  // configuration guard failure can500. Both must deny without shared caching.
  // Actual session/DB/private behavior is independently witnessed in native E2E.
  stage = "private-denial";
  const denied = await get(new URL("/api/admin/analytics", origin)); assert.ok(denied.status >= 400 && denied.status < 600, "Private API never succeeds through the PWA production-static fixture");
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  const envelope = JSON.parse(utf8(await bytes(denied, 8192))), requestId = denied.headers.get("x-request-id");
  assert.match(requestId ?? "", /^[a-f0-9-]{36}$/); assert.deepEqual(Object.keys(envelope).sort(), ["error", "requestId"]); assert.equal(envelope.requestId, requestId); assert.equal(envelope.error.requestId, requestId);
  assert.equal("data" in envelope, false);
  process.stdout.write("Infame PWA production HTTP: one bounded group passed; device installation and production private DB readiness were not tested.\n");
}
try { await productionPwaHTTP(); }
catch { process.stderr.write("Infame PWA production HTTP check failed at " + stage + ".\n"); process.exitCode = 1; }
