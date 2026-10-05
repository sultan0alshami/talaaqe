import { expect, it } from "vitest";
import { PublicationReadinessSchema } from "@/lib/readiness/contracts";

it("binds blocker remedies to the actual role and requires real metadata for a review-ready assessment", () => {
  const ready = { scope: "OWN_PROFILE", role: "CREATOR", profileId: "synthetic-profile", asOf: "2026-10-05T00:00:00.000Z",
    draftId: "synthetic-draft", draftRevision: 1, portfolioVersion: 1, requiresExplicitPublicationConsent: true,
    status: "READY_FOR_REVIEW", blockerCode: null, remedies: [] };
  expect(PublicationReadinessSchema.parse(ready)).toEqual(ready);
  const blocked = { ...ready, status: "BLOCKED", blockerCode: "EMAIL_VERIFICATION_REQUIRED",
    remedies: [{ kind: "EMAIL", href: "/creator", onboardingStep: null }] };
  expect(PublicationReadinessSchema.parse(blocked)).toEqual(blocked);
  for (const wrong of [
    { ...blocked, remedies: [{ kind: "EMAIL", href: "/brand", onboardingStep: null }] },
    { ...blocked, remedies: [{ kind: "EMAIL", href: "/creator", onboardingStep: 3 }] },
    { ...blocked, blockerCode: "REPRESENTATION_REQUIRED", remedies: [{ kind: "REPRESENTATION", href: "/brand/evidence#brand-representative-title", onboardingStep: null }] },
    { ...blocked, blockerCode: "PROFILE_ESSENTIALS_REQUIRED", remedies: [{ kind: "ESSENTIALS", href: "/creator/onboarding", onboardingStep: 1 }] },
    { ...ready, role: "BRAND", status: "BLOCKED", blockerCode: "PRIMARY_OWNERSHIP_REQUIRED", remedies: [{ kind: "OWNERSHIP", href: "/creator/evidence#evidence-ownership-title", onboardingStep: null }] },
    { ...ready, draftId: null, draftRevision: null }, { ...ready, portfolioVersion: null },
  ]) expect(PublicationReadinessSchema.safeParse(wrong).success).toBe(false);
});
