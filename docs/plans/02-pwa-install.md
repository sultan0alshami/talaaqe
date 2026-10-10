# Infame install support and public offline notice

Coordinator-approved freeze, 2026-10-10. Prerequisite admin analytics checkpoint
e0596da passed native/browser review and all four gates. Root activates only the
bounded local implementation below; external deployment/device proof remains
separate. The full managed-platform/MVP goal remains active after this phase.

## Prerequisites and current evidence

Read AGENTS.md, docs/CONTRACTS.md and docs/BRAND_IDENTITY.md before activation.
Preserve the selected `/` design, retained `/classic` reference and Talaqee
platform composition. The Infame circles, overlap, ink dot, spark and established
yellow/coral/rose/purple/ink/paper colors are the artwork source.

Current inspected source has no app manifest, service worker, registration or
offline notice. No PWA/cache dependency is installed or needed. Root and public
layouts read language/theme cookies, so public marketing HTML is personalized.
Never cache those documents or their RSC/Next navigation responses.

The six actual canonical marketing routes are `/`, `/about`, `/contact`,
`/pricing`, `/for-brands` and `/for-creators`. `/for-clients` and `/for-providers`
are redirects, and `/classic` remains reference content. None of those three
belongs in the offline navigation allowlist. Public creator/brand profiles also
remain ordinary online reads because their current visibility can change.

Relevant installed Next guides, which root reads before framework changes:

- node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md

Use App Router MetadataRoute.Manifest and verified worker response headers.
Do not transplant the guide's push subscriptions, module-local delivery state,
new keys or experimental automatic navigation/Server Action retries.

## Exact scope and ownership

Coordinator owns:

- new src/app/manifest.ts;
- existing next.config.ts, preserving distDir, tracing exclusions and root;
- existing src/components/infame/public-shell.tsx, for one unobtrusive mount;
- deterministic icon exports under public/icons/ and src/app/apple-icon.png;
- new src/app/apple-icon.png, a technical touch-icon export using Next's convention;
- shared copy/contracts, exact documentation, all execution and commit.

Future UI/worker implementer owns only:

- new public/sw.js;
- new public/offline.html;
- new src/components/infame/pwa-install.tsx.

The worker is not alone: preserve every other owner's changes and request root
ownership before modifying a shared path. No schema, migration, environment,
dependency, dashboard shell or primitive change is needed.

An independent test author owns at most three policy/native-HTTP groups across
tests/pwa/policy.test.ts and tests/pwa/http.test.ts, and at most two browser
journeys in e2e/pwa-install.spec.mts. Draft authors do not execute. A separate
reviewer checks the actual worker/cache policy, UI lifecycle, headers, identity
and staged paths. Root observes meaningful failures before activation, runs the
guarded targets/browser checks and all four gates, and records actual evidence.

## Manifest and technical icon exports

Manifest identity is `Infame / إنفيم`, with a stable same-origin `id`, `start_url`
`/`, scope `/`, standalone display, default Arabic `lang` and RTL direction.
Use existing brand name/description and ink/yellow/paper colors. UI language,
campaign currency, campaign market and residence remain independent.

Coordinator exports these actual PNGs from the existing approved vector master,
public/brand/infame-pattern.svg, without changing its artwork or installing a new
dependency:

- /icons/infame-icon-192.png — 192×192, ordinary icon;
- /icons/infame-icon-512.png — 512×512, ordinary icon;
- /icons/infame-maskable-512.png — 512×512, maskable icon;
- src/app/apple-icon.png — 180×180, touch icon; Next adds its actual metadata link.

Technical scaling/padding/raster export is permitted; generated new art is out of
scope. Preserve the complete motif and brand palette, with the maskable design
contained inside the central safe area. Verify actual PNG dimensions, rendering
and manifest purpose/type values. Existing src/app/icon.svg remains preserved.
Use the installed apple-icon file convention rather than leave an unused touch
PNG under public/brand or broaden the existing root layout's metadata.
Manifest icons and all other assets are deliberately outside this worker cache.
Icons use the public /icons/ namespace because /brand/ is guarded navigation.
No dashboard authorization exception is introduced.

## Installation control and registration

Mount one quiet installation control within the existing public shell, keeping
current geometry and semantic Button/Radix-compatible composition. Use clear
Arabic/English labels, visible keyboard focus and a 44px target. Do not add an
installation banner to private dashboards or reshape the public header.

Register /sw.js idempotently only in a secure context with actual service-worker
support, using scope `/` and updateViaCache `none`. Handle asynchronous failure
truthfully and preserve the ordinary website. Remove event listeners on unmount,
ignore stale callbacks and prevent duplicate registration/prompt dispatch.

A deferred beforeinstallprompt event may be used only after an explicit user
action. Preserve the website after dismissal or an unsupported prompt. Explain
ordinary Share→Add to Home Screen instructions where appropriate; hide the
affordance in standalone mode. An emulated event can verify interaction handling,
but cannot establish a device installation or successful native prompt.

Service-worker readiness and installation are separate states. Do not display a
successful install merely because registration, a manifest fetch or offline
precache succeeded. Local loopback browser evidence does not prove production
HTTPS, device installation or any push/provider readiness.

## Single cached document and bounded installation

The sole cacheable URL is the exact same-origin `/offline.html`. The document is
standalone bilingual public HTML with inline styles and the approved decorative
motif. Include a retry link to `/`, explicit lack-of-connectivity text and no
promise that account/campaign data is saved or available offline.

No Next hydration, external fonts, JS, API call, form, analytics, cookies,
onboarding/interview words, private evidence or dynamic properties occur in the
offline document. It needs no supplementary cached asset. All icons, SVG/PNG
assets, `/`, other marketing pages and application resources remain uncached.

Use a dedicated immutable version name under `infame-public-offline-`; a changed
offline artifact requires a new version. Fetch its exact URL with credentials
omitted, cache bypass and redirects rejected. No query/hash, alternate origin,
redirected/login response, opaque response or arbitrary runtime resource is
accepted. Validate successful HTTP 200, exact response URL, expected HTML content
type and at most 65,536 body bytes as emitted by the Fetch reader before storing
a reconstructed static Response. Count actual streamed bytes, not a trusted
Content-Length alone; reject
invalid UTF-8 and cancel an oversized/failing reader.

Install waits for validation and the one cache write. A failed install must not
claim offline readiness or remove an active previous version. Never expose a
partial artifact as the notice. No runtime cache.put exists outside this exact
precache operation; no CacheStorage entry contains application/session data.

Activation deletes only obsolete cache names in this exact owned namespace.
Retain unrelated caches and the current version. Use ordinary lifecycle
activation; do not call skipWaiting or force a client reload during dirty forms.
No background sync, queued mutation, broadcast business replay, push handler or
notification permission is added.

## Exact fetch boundary

Worker handling requires all of the following:

- method GET;
- same origin;
- document navigation, with no RSC, prefetch or non-document request;
- one of the six exact canonical paths above;
- no query or fragment/variant in the worker-observed URL.

Compare the browser-observed Request URL without decoding arbitrary paths into
an allowed route. Observable encoded, duplicate/slashed or noncanonical variants
are denied. Browser-normalized URLs are tested as the actual canonical URL the
worker receives; do not claim recovery of an unobservable original encoding.

For an eligible public navigation, return the normal network response unchanged
and do not cache it. Only a rejected network fetch may return the validated
generic offline notice. Actual 3xx redirects and 401/403/404/500 responses remain
the server response; do not mask them as successful offline HTML. A missing or
invalid cached notice fails ordinarily without inventing a document success.

All other requests bypass worker handling entirely, including:

- every non-GET and all /api routes;
- /brand, /creator, /admin, legacy /client and /provider;
- login/signup/reset/verification/onboarding/settings/invite/claim;
- campaign/context/reference/private-file/download requests;
- /classic, redirected aliases, /@handle and /brands/slug;
- cross-origin assets, _next/RSC/prefetch/data, icons and arbitrary visited GETs.

Do not use a broad network-failure fallback for every navigation. Native sessions,
roles, ownership and current private API no-store behavior remain authoritative.
Existing campaign exact-key recovery stays online-authorized; the worker never
replays a business command or substitutes an offline account view.

## Narrow HTTP headers

Coordinator adds explicit /sw.js JavaScript content type, no-cache/no-store/
must-revalidate, nosniff and a worker-appropriate self-origin CSP. Apply a static
document CSP suitable for the self-contained offline HTML and noindex/noarchive
to that notice only. Preserve unrelated global/page metadata and Next headers.
Check the actual production-build responses because framework/static defaults
can override expected caching. Do not introduce global CSP or metadata changes
that affect existing auth, framework scripts, campaign inputs or future voice.

## Meaningful bounded verification

Policy/native-HTTP group 1 exercises the actual worker code and event dispatch:
exact six allowed document paths, denied methods/origins/query/observable encoded
variants/private/auth/API/profile/RSC/prefetch/asset requests; no respondWith for
denied requests, no runtime writes and server errors/redirects preserved. A
network rejection yields only the known static notice.

Group 2 exercises bounded actual Response streams and cache operations: exact
URL/status/type/credentials/redirect/UTF-8/65,536-byte acceptance and size+1
rejection; failed install keeps active old cache; missing-cache failure; owned
activation cleanup retains an unrelated sentinel and never forces a reload.
These response/event seams test mechanics, not live outages or device install.

Group 3 verifies actual production HTTP manifest/worker/offline/icon responses,
real PNG dimensions and maskable-purpose assets, minimized standalone HTML,
specified worker/offline headers and unchanged private no-store behavior. Root
owns the server fixture and execution; an unavailable server is failure, not a
mocked native response. No database fixture is needed just to inspect assets.

Browser journey 1, Arabic360 and English desktop/360: actual manifest link and
response, registration/ready/controller, inspected single-document cache,
allowed public offline navigation, no horizontal overflow, keyboard/focus,
reduced motion and restoration of the approved `/` after network recovery.
Supported prompt/dismissal and unsupported behavior are reported separately
from genuine installation observation.

Journey 2 uses genuine owned authenticated native campaign/interview/reference
visits online, then offline/logout/change-user/current permission denial. Inspect
all owned CacheStorage URLs/bodies for private canaries and prove private
navigation/API fail normally with no queued/dispatched mutation. Restore network
and require existing actual authorization/recovery. Exercise two actual worker
versions using ordinary activation: retain unrelated cache, clean only obsolete
owned versions and preserve a dirty form without forced reload. Prepopulating an
obsolete cache alone is cleanup evidence, not proof of a second worker update.

Collect browser/console/hydration errors and artifact evidence. Root runs npm run
check before committing exact owned paths and records bounded observations in
docs/PROGRESS.md. Current services/databases/data are preserved without reset.

## Explicit later phases

This install/offline mission excludes ALL robots, sitemap, profile indexing,
search-engine submission, private route metadata overhaul, push subscriptions,
VAPID keys, notification delivery, private offline editing and automatic retry.
The larger tmp/pwa-carryover-freeze.draft.md remains research for those separate
phases; its paths and publication predicates are not activated by this freeze.
No new legal/provider account, purchase, registration, remote deployment or
external publication is authorized or needed. OpenAI remains disabled.
