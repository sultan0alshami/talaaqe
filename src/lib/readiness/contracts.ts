import { z } from "zod";
import { UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { OrganizationIdSchema } from "@/lib/organizations/contracts";

export const PublicationReadinessQuerySchema = z.object({
  portfolioVersion: z.number().int().positive().optional(),
  visibleAccountIds: z.array(OrganizationIdSchema).max(100).refine(ids => new Set(ids).size === ids.length).optional(),
}).strict();
export type PublicationReadinessQuery = z.infer<typeof PublicationReadinessQuerySchema>;
export const PublicationBlockerSchema = z.enum(["DRAFT_REQUIRED", "PUBLICATION_CONSENT_REQUIRED", "EMAIL_VERIFICATION_REQUIRED",
  "PRIMARY_OWNERSHIP_REQUIRED", "PROFILE_ESSENTIALS_REQUIRED", "ACCOUNT_MAPPING_CHANGED", "REPRESENTATION_REQUIRED",
  "PORTFOLIO_APPROVAL_REQUIRED", "ACCOUNT_PUBLICATION_NOT_ALLOWED"]);
export const PublicationRemedySchema = z.object({
  kind: z.enum(["ONBOARDING", "EMAIL", "OWNERSHIP", "REPRESENTATION", "ESSENTIALS", "MAPPING", "PORTFOLIO", "ACCOUNT_SELECTION"]),
  href: z.enum(["/creator", "/brand", "/creator/onboarding", "/brand/onboarding",
    "/creator/evidence#evidence-ownership-title", "/brand/evidence#brand-representative-title"]),
  onboardingStep: z.number().int().min(0).max(4).nullable(),
}).strict();
export function publicationRemedies(role: "CREATOR" | "BRAND", code: z.infer<typeof PublicationBlockerSchema> | null): z.infer<typeof PublicationRemedySchema>[] {
  const home = role === "CREATOR" ? "/creator" : "/brand", onboarding = role === "CREATOR" ? "/creator/onboarding" : "/brand/onboarding";
  switch (code) {
    case "DRAFT_REQUIRED": case "PUBLICATION_CONSENT_REQUIRED": return [{ kind: "ONBOARDING", href: onboarding, onboardingStep: 0 }];
    case "EMAIL_VERIFICATION_REQUIRED": return [{ kind: "EMAIL", href: home, onboardingStep: null }];
    case "PRIMARY_OWNERSHIP_REQUIRED": return [{ kind: "OWNERSHIP", href: "/creator/evidence#evidence-ownership-title", onboardingStep: null }];
    case "REPRESENTATION_REQUIRED": return [{ kind: "REPRESENTATION", href: "/brand/evidence#brand-representative-title", onboardingStep: null }];
    case "PROFILE_ESSENTIALS_REQUIRED": return [{ kind: "ESSENTIALS", href: onboarding, onboardingStep: 3 }];
    case "ACCOUNT_MAPPING_CHANGED": return [{ kind: "MAPPING", href: onboarding, onboardingStep: 1 }];
    case "PORTFOLIO_APPROVAL_REQUIRED": return [{ kind: "PORTFOLIO", href: onboarding, onboardingStep: 4 }];
    case "ACCOUNT_PUBLICATION_NOT_ALLOWED": return [{ kind: "ACCOUNT_SELECTION", href: onboarding, onboardingStep: 1 }];
    default: return [];
  }
}
export const PublicationReadinessSchema = z.object({
  scope: z.literal("OWN_PROFILE"), role: z.enum(["CREATOR", "BRAND"]), profileId: OrganizationIdSchema,
  asOf: UtcDateTimeSchema, draftId: OrganizationIdSchema.nullable(), draftRevision: z.number().int().positive().nullable(),
  portfolioVersion: z.number().int().positive().nullable(), requiresExplicitPublicationConsent: z.literal(true),
  status: z.enum(["BLOCKED", "READY_FOR_REVIEW"]), blockerCode: PublicationBlockerSchema.nullable(),
  remedies: z.array(PublicationRemedySchema).max(2),
}).strict().refine(value => {
  if (value.status === "READY_FOR_REVIEW") return value.blockerCode === null && value.remedies.length === 0
    && value.draftId !== null && value.draftRevision !== null && value.portfolioVersion !== null;
  if (value.blockerCode === null || value.role === "CREATOR" && value.blockerCode === "REPRESENTATION_REQUIRED"
    || value.role === "BRAND" && ["PRIMARY_OWNERSHIP_REQUIRED", "ACCOUNT_MAPPING_CHANGED", "ACCOUNT_PUBLICATION_NOT_ALLOWED"].includes(value.blockerCode)) return false;
  const expected = publicationRemedies(value.role, value.blockerCode);
  return value.remedies.length === expected.length && value.remedies.every((row, index) => row.kind === expected[index]?.kind
    && row.href === expected[index]?.href && row.onboardingStep === expected[index]?.onboardingStep);
});
export type PublicationReadiness = z.infer<typeof PublicationReadinessSchema>;
export class ReadinessError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "ReadinessError"; }
}
