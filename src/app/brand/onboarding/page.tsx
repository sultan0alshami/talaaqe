import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDraft } from "@/lib/onboarding/drafts";
import { profileForOwner } from "@/lib/onboarding/profiles";
import { OnboardingScreen } from "@/components/infame/onboarding-screen";
export default async function Page() {
  const session = await requirePageSession("BRAND");
  const draft = await prisma.onboardingDraft.findUnique({ where: { userId_kind: { userId: session.userId, kind: "BRAND" } }, select: { id: true } });
  const owner = await profileForOwner(session.userId);
  if (!owner) return null;
  return <OnboardingScreen initialDraft={draft ? await getDraft(session.userId, draft.id) : null} initialOwner={owner} />;
}
