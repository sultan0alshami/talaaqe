import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { createOrResumeDraft, getDraft } from "@/lib/onboarding/drafts";
import { profileForOwner } from "@/lib/onboarding/profiles";
import { prisma } from "@/lib/prisma";

export const GET = domainHandler(async (_request: Request) => {
  void _request;
  const session = await requireRole("CREATOR", "BRAND");
  const draft = await prisma.onboardingDraft.findUnique({ where: { userId_kind: { userId: session.userId, kind: session.role } }, select: { id: true } });
  return { draft: draft ? await getDraft(session.userId, draft.id) : null, owner: await profileForOwner(session.userId) };
});
export const POST = domainHandler(async (_request: Request) => {
  void _request;
  const session = await requireRole("CREATOR", "BRAND");
  return { draft: await createOrResumeDraft(session.userId), owner: await profileForOwner(session.userId) };
});
