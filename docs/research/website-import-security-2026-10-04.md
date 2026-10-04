# Permitted website acquisition review notes

Checked 2026-10-04 against official primary sources. This is a private draft-text importer, not a crawler or account-verification provider. No customer website was fetched and no live acceptance is claimed. Runtime capability remains unavailable until reviewed server configuration supplies all trusted dependencies; constructing the native transport does not enable it. Manual entry remains available and OpenAI remains disabled.

## Destination and connection

OWASP recommends validating all A/AAAA results and controlling redirects to prevent SSRF and DNS rebinding. The collector validates the exact confirmed HTTPS origin, denies credentials/query strings/IP literals and private DNS labels, checks every answer, selects one public literal IP and validates again for each same-origin redirect. It performs no link discovery, proxying, cookie/auth forwarding, script execution or access bypass. [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

The address filter conservatively denies all special-purpose registry ranges, including protocol-service exceptions marked globally reachable, plus IPv4 multicast/reserved and IPv6 space outside global unicast. IPv4-mapped/translated, 6to4, unique-local and link-local destinations remain blocked. Both registries reported updates on 2025-10-09 when read. This reviewed list requires maintenance as registry allocations change. [IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry), [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry)

Node's independent resolver provides A/AAAA queries and cancellation. Only `ENODATA` is treated as a genuinely empty family; NXDOMAIN, timeout, cancellation and other failures block the whole destination, even when the other family has addresses. A fresh resolver instance isolates cancellation to one acquisition. [Node 24 DNS](https://nodejs.org/docs/latest-v24.x/api/dns.html)

TLS connects directly to the selected literal IP on port 443 with the original hostname as SNI, normal CA verification and explicit hostname checking. The authorized certificate and actual public peer address must match before any HTTP request receives the socket. IP targets need explicit SNI because it is not automatically supplied. [Node 24 TLS](https://nodejs.org/download/release/latest-v24.x/docs/api/tls.html), [Node 24 HTTPS](https://nodejs.org/download/release/latest-v24.x/docs/api/https.html)

An explicit `createConnection` supplies that verified socket to HTTPS, with no global agent, fetch or proxy environment. Node 24.19.0's installed `_http_client` implementation was also inspected: explicit `createConnection` with no `agent` skips the default agent. Absolute cancellation destroys the TLS socket, request and response; socket inactivity timeouts alone would not abort a request. Header parsing and streamed body bytes are bounded. [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)

The consulted current Node 24 documentation identifies itself as 24.21.0. The task runtime is 24.19.0, so actual pinned-connection behavior is additionally exercised by test seams and an actual ephemeral TLS fixture. This is not evidence of successful public TLS acquisition.

## Permission and crawl rules

Robots rules do not grant access authorization. The server policy requires explicit reviewed access approval separately, then successful UTF-8 `text/plain` crawl rules for the same origin. Product groups are merged, wildcard fallback and path matching are supported. Literal URL `*`/`$` are distinguished from rule operators. Missing, empty, malformed, inaccessible and 404 rules never silently authorize an import. Compared with RFC 9309's optional 4xx allowance and cross-authority redirect guidance, this adapter deliberately uses stricter same-origin and unavailable behavior. It does not claim full general-purpose crawler conformance. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)

Budgets cover pages, redirect bodies and robots together: default one explicitly confirmed page, depth zero; hard maximum five explicit pages, depth one, three redirects, 1 MiB per response, 5 MiB total and 20 seconds overall. Compression is refused rather than decompressed. Only explicit selected paths are visited; sitemaps, anchors, scripts and assets do not initiate requests.

## Observation and job boundary

The extractor strips executable/embedded/form content and returns only bounded title, description, headings and visible-text proposals. Raw body SHA-256, exact source citation, source revision and actual UTC retrieval time accompany private `PUBLIC_IMPORT` proposals. Original evidence dates remain `null`; retrieval time never becomes a measurement/publication date. Customers, metrics, ownership, representation and licences remain unknown. Model instructions inside HTML are data and no model/provider is invoked.

The server job runner rechecks actor ownership, brand role, current exact mapping/consent hash and source revision under draft/job locks before execution and adoption. A completed draft or revoked mapping/consent stales late results. Unconfigured queued website jobs terminate truthfully as `CAPABILITY_UNAVAILABLE`, attempts zero. Website jobs accept only the four bounded text fields with unknown original date and separately validated retrieval/hash/citation; other provider observations still require known dates. No account badge, canonical profile, public page or approved field is written by acquisition.

## Test evidence and limits

The original 67-test witness was restored byte-for-byte from `docs/deferred-tests/website-import.test.ts.txt`; SHA-256 `EC18567FF0ECF85177AAE5A159D4D00423B73531EB0CBE96971BB15B6BD031A4`.

Guarded tests cover destination/redirect/rebinding failures, access binding, budgets/deadlines, private proposals, source/date restrictions, unavailable/replay behavior, completed drafts and revoked consent. Native transport seams check IP/Host/SNI/certificate verification, actual peer verification before HTTP, bytes, compression and absolute header deadlines. An actual ephemeral TLS fixture confirms loopback rejection. A separate test-only injected HTTP fixture serves hostile HTML and proves that scripts/links/assets/proof claims do not create execution or extra requests. Its reported public peer is synthetic; it is explicitly not native or live transport acceptance. The synthetic TLS key/cert under `tests/imports/fixtures/` are public test data and must never be deployed as credentials or trusted CAs.

Independent security review and the coordinator's four union gates remain required before commit. Production activation, deployment and real website access approval are separate prerequisites; this slice does not configure or claim them.
