// Type-only private client contracts. Runtime storage/auth/domain code stays on
// the server; these reads never expose raw journals, object keys or tokens.
import type { getCreatorEvidence, getBrandEvidence, listEvidenceReviewQueue, listLicencePolicyOptions } from "./service";
export type CreatorEvidence = Awaited<ReturnType<typeof getCreatorEvidence>>;
export type BrandEvidence = Awaited<ReturnType<typeof getBrandEvidence>>;
export type EvidenceQueue = Awaited<ReturnType<typeof listEvidenceReviewQueue>>;
export type LicencePolicyOptions = Awaited<ReturnType<typeof listLicencePolicyOptions>>;
export type EvidenceKind = EvidenceQueue["kind"];
