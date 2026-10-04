import { createHash } from "node:crypto";
import { z } from "zod";
import { resolvePublicDestination, sameAddress, isPublicAddress, validateWebsiteUrl } from "./destination";
import { extractWebsitePage, WEBSITE_EXTRACTION_VERSION } from "./extract";
import { WebsiteImportError, websiteErrorCode, type AccessDecision, type WebsiteDependencies, type WebsiteInput, type WebsiteLimits, type WebsitePage, type WebsiteResponse, type WebsiteResult } from "./types";

const version = /^[A-Za-z0-9_.:-]{1,100}$/;
const InputSchema = z.object({ sourceId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/), sourceRevision: z.number().int().positive().max(2_147_483_647),
  confirmedUrl: z.string().max(500), confirmedOrigin: z.string().max(500), consentVersion: z.string().regex(version), selectedPageUrls: z.array(z.string().max(500)).max(4).optional() }).strict();
export const WEBSITE_HARD_LIMITS: WebsiteLimits = { maxPages: 5, maxDepth: 1, maxRedirects: 3, maxResponseBytes: 1_048_576, maxTotalBytes: 5_242_880, maxTimeMs: 20_000 };
const DEFAULT_LIMITS: WebsiteLimits = { ...WEBSITE_HARD_LIMITS, maxPages: 1, maxDepth: 0 };
type ReadyDependencies = Required<Omit<WebsiteDependencies, "limits" | "clock">> & Pick<WebsiteDependencies, "limits" | "clock">;
export function assertWebsiteCapability(dependencies: WebsiteDependencies): asserts dependencies is ReadyDependencies {
  const { capability, resolver, transport, accessPolicy } = dependencies;
  if (!capability?.enabled || !["LIVE", "DEVELOPMENT_FIXTURE"].includes(capability.mode) || !version.test(capability.reviewVersion)
    || !resolver || typeof resolver.resolve !== "function" || !transport || typeof transport.get !== "function" || !version.test(transport.reviewVersion)
    || transport.mode !== capability.mode || !accessPolicy || typeof accessPolicy.check !== "function" || !version.test(accessPolicy.reviewVersion)
    || (process.env.NODE_ENV === "production" && capability.mode !== "LIVE")) throw new WebsiteImportError("CAPABILITY_UNAVAILABLE");
}

export function getImportCapabilities(dependencies: WebsiteDependencies = {}) {
  const unavailable = { enabled: false, mode: "UNAVAILABLE" as const, reviewVersion: "unconfigured" };
  let website = { ...unavailable } as { enabled: boolean; mode: "LIVE" | "DEVELOPMENT_FIXTURE" | "UNAVAILABLE"; reviewVersion: string };
  try { assertWebsiteCapability(dependencies); website = { ...dependencies.capability }; } catch { /* Unconfigured remains explicitly unavailable. */ }
  return { MANUAL: { enabled: true, mode: "LIVE" as const, reviewVersion: "manual-v1" },
    WEBSITE: website, INSTAGRAM: { ...unavailable }, TIKTOK: { ...unavailable },
    YOUTUBE: { ...unavailable }, SNAPCHAT: { ...unavailable }, X: { ...unavailable } };
}
function checkedLimits(overrides: WebsiteDependencies["limits"]): WebsiteLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  if (overrides && Object.keys(overrides).some((key) => !Object.hasOwn(DEFAULT_LIMITS, key))) throw new WebsiteImportError("LIMIT_CONFIGURATION");
  for (const key of Object.keys(limits) as (keyof WebsiteLimits)[]) {
    const minimum = key === "maxDepth" || key === "maxRedirects" ? 0 : 1;
    if (!Number.isSafeInteger(limits[key]) || limits[key] < minimum || limits[key] > WEBSITE_HARD_LIMITS[key]) throw new WebsiteImportError("LIMIT_CONFIGURATION");
  }
  return limits;
}
function checkedInstant(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() > Date.now()) throw new WebsiteImportError("INVALID_DATE");
  return value.toISOString();
}
function policyAllows(decision: AccessDecision, url: string, input: WebsiteInput, reviewVersion: string, instant: string): boolean {
  if (!decision || decision.url !== url || decision.sourceId !== input.sourceId || decision.sourceRevision !== input.sourceRevision
    || decision.consentVersion !== input.consentVersion || decision.policyVersion !== reviewVersion || decision.access !== "ALLOW" || decision.robots !== "ALLOW") return false;
  const time = Date.parse(decision.checkedAt), now = Date.parse(instant);
  return Number.isFinite(time) && new Date(time).toISOString() === decision.checkedAt && time <= now && now - time <= 60_000;
}
async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new WebsiteImportError("DEADLINE");
  let abort: () => void = () => {};
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_resolve, reject) => {
      abort = () => reject(new WebsiteImportError("DEADLINE")); signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
export function decodePublicText(response: WebsiteResponse, kind: "PAGE" | "ROBOTS"): string {
  const type = response.headers["content-type"]?.trim().toLowerCase() ?? "";
  const accepted = kind === "PAGE" ? /^text\/html(?:\s*;|$)/ : /^text\/plain(?:\s*;|$)/;
  const charset = /charset\s*=\s*["']?([^;\s"']+)/.exec(type)?.[1];
  if (!accepted.test(type) || (charset && charset !== "utf-8" && charset !== "utf8") || (response.headers["content-encoding"] && response.headers["content-encoding"]?.trim().toLowerCase() !== "identity")) throw new WebsiteImportError("UNSUPPORTED_RESPONSE");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(response.body); } catch { throw new WebsiteImportError("INVALID_ENCODING"); }
}
/** Caller has already authorized the actor/draft and exact source consent. This
 * pure acquisition service returns untrusted private proposals, never DB writes. */
export async function collectConfirmedWebsite(value: WebsiteInput, dependencies: WebsiteDependencies = {}): Promise<WebsiteResult> {
  assertWebsiteCapability(dependencies);
  const { accessPolicy, resolver, transport } = dependencies;
  const parsed = InputSchema.safeParse(value);
  if (!parsed.success) throw new WebsiteImportError("VALIDATION");
  const input = parsed.data, limits = checkedLimits(dependencies.limits), clock = dependencies.clock ?? (() => new Date());
  const urls = [input.confirmedUrl, ...(input.selectedPageUrls ?? [])].map((url) => validateWebsiteUrl(url, input.confirmedOrigin).href);
  if (new Set(urls).size !== urls.length) throw new WebsiteImportError("VALIDATION");
  if (urls.length > limits.maxPages || (urls.length > 1 && limits.maxDepth === 0)) throw new WebsiteImportError("PAGE_LIMIT");
  const controller = new AbortController(), deadline = performance.now() + limits.maxTimeMs;
  const timer = setTimeout(() => controller.abort(), limits.maxTimeMs);
  let redirects = 0, consumedBytes = 0, robots: Promise<WebsiteResponse> | undefined;
  const pages: WebsitePage[] = [], errors: WebsiteResult["errors"] = [];
  const loadRobots = () => robots ??= retrieve(`${input.confirmedOrigin}/robots.txt`, "ROBOTS");
  async function retrieve(initialUrl: string, purpose: "PAGE" | "ROBOTS"): Promise<WebsiteResponse & { finalUrl: string }> {
    let url = initialUrl;
    for (;;) {
      const target = validateWebsiteUrl(url, input.confirmedOrigin);
      let decision: AccessDecision;
      try { decision = await bounded(() => accessPolicy.check({ url, sourceId: input.sourceId, sourceRevision: input.sourceRevision, consentVersion: input.consentVersion,
        signal: controller.signal, deadline, purpose, ...(purpose === "PAGE" ? { loadRobots } : {}) }), controller.signal); }
      catch (error) { if (controller.signal.aborted) throw new WebsiteImportError("DEADLINE"); if (error instanceof WebsiteImportError) throw error; throw new WebsiteImportError("ACCESS_DENIED"); }
      if (!policyAllows(decision, url, input, accessPolicy.reviewVersion, checkedInstant(clock))) throw new WebsiteImportError("ACCESS_DENIED");
      let destination;
      try { destination = await bounded(() => resolvePublicDestination(target.hostname, resolver, controller.signal), controller.signal); }
      catch (error) { if (controller.signal.aborted) throw new WebsiteImportError("DEADLINE"); if (error instanceof WebsiteImportError) throw error; throw new WebsiteImportError("DESTINATION_BLOCKED"); }
      const remaining = limits.maxTotalBytes - consumedBytes;
      if (remaining <= 0) throw new WebsiteImportError("TOTAL_BYTE_LIMIT");
      const maximum = Math.min(limits.maxResponseBytes, remaining);
      let reportedBytes = 0;
      const consumeBytes = (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0 || consumedBytes + count > limits.maxTotalBytes) throw new WebsiteImportError("TOTAL_BYTE_LIMIT");
        consumedBytes += count; reportedBytes += count;
      };
      let response: WebsiteResponse;
      try { response = await bounded(() => transport.get({ url, destination, signal: controller.signal, deadline, maxResponseBytes: maximum, consumeBytes }), controller.signal); }
      catch (error) { if (controller.signal.aborted) throw new WebsiteImportError("DEADLINE"); if (error instanceof WebsiteImportError) throw error; throw new WebsiteImportError("TRANSPORT_FAILED"); }
      if (!response || !Buffer.isBuffer(response.body) || !Number.isInteger(response.status) || !response.headers) throw new WebsiteImportError("UNSUPPORTED_RESPONSE");
      if (!isPublicAddress(response.peerAddress) || !sameAddress(response.peerAddress, destination.address)) throw new WebsiteImportError("PEER_MISMATCH");
      const declared = response.headers["content-length"];
      if (response.body.length > maximum || (declared !== undefined && (!/^(0|[1-9][0-9]*)$/.test(declared) || BigInt(declared) > BigInt(maximum)))) throw new WebsiteImportError("RESPONSE_BYTE_LIMIT");
      if (reportedBytes && reportedBytes !== response.body.length) throw new WebsiteImportError("TRANSPORT_FAILED");
      if (!reportedBytes) consumeBytes(response.body.length);
      if (response.headers["content-encoding"] && response.headers["content-encoding"]?.trim().toLowerCase() !== "identity") throw new WebsiteImportError("UNSUPPORTED_RESPONSE");
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= limits.maxRedirects) throw new WebsiteImportError("REDIRECT_LIMIT");
        redirects += 1;
        const location = response.headers.location;
        if (!location || location.length > 500 || /[\\\s\u0000-\u001f\u007f]/u.test(location)) throw new WebsiteImportError("INVALID_URL");
        let next: string;
        try { next = new URL(location, url).href; } catch { throw new WebsiteImportError("INVALID_URL"); }
        url = validateWebsiteUrl(next, input.confirmedOrigin).href;
        continue;
      }
      if (response.status !== 200) throw new WebsiteImportError(purpose === "ROBOTS" ? "ROBOTS_UNAVAILABLE" : "HTTP_UNAVAILABLE");
      return { ...response, finalUrl: url };
    }
  }
  try {
    for (const url of urls) {
      try {
        const response = await retrieve(url, "PAGE"), html = decodePublicText(response, "PAGE");
        pages.push(extractWebsitePage(html, response.finalUrl, response.body, checkedInstant(clock), deadline));
      } catch (error) {
        const code = controller.signal.aborted ? "DEADLINE" : websiteErrorCode(error, "TRANSPORT_FAILED");
        errors.push({ url, code });
        if (controller.signal.aborted || code === "TOTAL_BYTE_LIMIT") break;
      }
    }
  } finally { clearTimeout(timer); controller.abort(); }
  const contentHash = createHash("sha256").update(JSON.stringify({ extractionVersion: WEBSITE_EXTRACTION_VERSION, sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, consentVersion: input.consentVersion, confirmedOrigin: input.confirmedOrigin, pages: pages.map((page) => ({ url: page.url, bodyHash: page.bodyHash })) })).digest("hex");
  return { status: pages.length === urls.length ? "SUCCEEDED" : pages.length ? "PARTIAL" : "FAILED", sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, consentVersion: input.consentVersion, confirmedOrigin: input.confirmedOrigin,
    source: "PUBLIC_IMPORT", visibility: "PRIVATE", reviewStatus: "PROPOSED", completedItems: pages.length, totalItems: urls.length,
    pages, errors, contentHash, unknowns: { companyName: null, products: null, services: null, customers: null, metrics: null, representation: null, licence: null } };
}
