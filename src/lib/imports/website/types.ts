export type ImportMode = "LIVE" | "DEVELOPMENT_FIXTURE" | "UNAVAILABLE";
export type ImportCapability = { enabled: boolean; mode: ImportMode; reviewVersion: string };
export type WebsiteInput = {
  sourceId: string; sourceRevision: number; confirmedUrl: string;
  confirmedOrigin: string; consentVersion: string; selectedPageUrls?: string[];
};
export type ResolvedAddress = { address: string; family: 4 | 6 };
export type WebsiteLimits = {
  maxPages: number; maxDepth: number; maxRedirects: number;
  maxResponseBytes: number; maxTotalBytes: number; maxTimeMs: number;
};
export type WebsiteResponse = {
  status: number; headers: Record<string, string | undefined>;
  body: Buffer; peerAddress: string;
};
export type WebsiteRequest = {
  url: string; destination: ResolvedAddress; signal: AbortSignal;
  deadline: number; maxResponseBytes: number; consumeBytes?: (count: number) => void;
};
export type AccessRequest = {
  url: string; sourceId: string; sourceRevision: number; consentVersion: string;
  signal: AbortSignal; deadline: number;
  purpose?: "PAGE" | "ROBOTS";
  loadRobots?: () => Promise<WebsiteResponse>;
};
export type AccessDecision = {
  url: string; sourceId: string; sourceRevision: number; consentVersion: string;
  policyVersion: string; checkedAt: string;
  access: "ALLOW" | "DENY" | "UNAVAILABLE"; robots: "ALLOW" | "DENY" | "UNAVAILABLE";
};
export type WebsiteDependencies = {
  capability?: ImportCapability; clock?: () => Date; limits?: Partial<WebsiteLimits>;
  resolver?: { resolve(hostname: string, signal: AbortSignal): Promise<{ address: string; family: number }[]> };
  transport?: { mode: ImportMode; reviewVersion: string; get(request: WebsiteRequest): Promise<WebsiteResponse> };
  accessPolicy?: { reviewVersion: string; check(request: AccessRequest): Promise<AccessDecision> };
};
export const WEBSITE_TEXT_FIELDS = ["website.pageTitle", "website.pageDescription", "website.pageHeadings", "website.pageText"] as const;
export type WebsiteTextField = typeof WEBSITE_TEXT_FIELDS[number];
export type WebsiteFact = {
  fieldKey: WebsiteTextField; observedValue: string | string[]; approvedValue: null;
  source: "PUBLIC_IMPORT"; platform: null; unit: null; language: null;
  rawConfidence: 0.4; visibility: "PRIVATE"; reviewStatus: "PROPOSED";
  evidenceAt: null; retrievedAt: string; sourceReference: string; sourceHash: string;
};
export type WebsitePage = { url: string; bodyHash: string; retrievedAt: string; facts: WebsiteFact[] };
export type WebsiteResult = {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED"; sourceId: string; sourceRevision: number;
  consentVersion: string; confirmedOrigin: string; source: "PUBLIC_IMPORT";
  visibility: "PRIVATE"; reviewStatus: "PROPOSED"; completedItems: number; totalItems: number;
  pages: WebsitePage[]; errors: { url: string; code: string }[]; contentHash: string;
  unknowns: { companyName: null; products: null; services: null; customers: null; metrics: null; representation: null; licence: null };
};
const WEBSITE_ERROR_CODES = ["CAPABILITY_UNAVAILABLE", "VALIDATION", "INVALID_URL", "LIMIT_CONFIGURATION", "PAGE_LIMIT",
  "DEADLINE", "INVALID_DATE", "ACCESS_DENIED", "DESTINATION_BLOCKED", "TRANSPORT_FAILED", "PEER_MISMATCH",
  "RESPONSE_BYTE_LIMIT", "TOTAL_BYTE_LIMIT", "UNSUPPORTED_RESPONSE", "INVALID_ENCODING", "REDIRECT_LIMIT",
  "ROBOTS_UNAVAILABLE", "HTTP_UNAVAILABLE", "EXTRACTION_LIMIT", "EXTRACTION_EMPTY", "TLS_REJECTED", "WEBSITE_IMPORT_FAILED"] as const;
export type WebsiteErrorCode = typeof WEBSITE_ERROR_CODES[number];
function knownCode(value: unknown): value is WebsiteErrorCode { return WEBSITE_ERROR_CODES.some((code) => code === value); }
export class WebsiteImportError extends Error {
  readonly code: WebsiteErrorCode;
  constructor(code: string) {
    const sanitized = knownCode(code) ? code : "TRANSPORT_FAILED";
    super(sanitized); this.code = sanitized; this.name = "WebsiteImportError";
  }
}
export function websiteErrorCode(error: unknown, fallback: WebsiteErrorCode = "WEBSITE_IMPORT_FAILED"): WebsiteErrorCode {
  return error instanceof WebsiteImportError && knownCode(error.code) ? error.code : fallback;
}
