import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { createOrResumeDraft, getDraft, OnboardingError } from "@/lib/onboarding/drafts";
import { profileForOwner } from "@/lib/onboarding/profiles";

export const GET = domainHandler(async (request: Request) => {
  const session = await requireRole("CREATOR", "BRAND");
  if (new URL(request.url).search) throw new OnboardingError("VALIDATION", 422);
  const options = { serverAuth: session };
  return { draft: await getDraft(session.userId, null, options), owner: await profileForOwner(session.userId, options) };
});
export const POST = domainHandler(async (request: Request) => {
  const session = await requireRole("CREATOR", "BRAND");
  if (new URL(request.url).search) throw new OnboardingError("VALIDATION", 422);
  const options = { serverAuth: session };
  return { draft: await createOrResumeDraft(session.userId, options), owner: await profileForOwner(session.userId, options) };
});
