import { requirePageSession } from "@/lib/auth";
import { getDraft, OnboardingError } from "@/lib/onboarding/drafts";
import { redirect } from "next/navigation";
import { profileForOwner } from "@/lib/onboarding/profiles";
import { OnboardingScreen } from "@/components/infame/onboarding-screen";
export default async function Page() {
  const session = await requirePageSession("CREATOR");
  const options = { serverAuth: session };
  let draft, owner;
  try {
    draft = await getDraft(session.userId, null, options);
    owner = await profileForOwner(session.userId, options);
  } catch (error) {
    if (error instanceof OnboardingError && [401, 403].includes(error.status)) redirect("/login");
    throw error;
  }
  if (!owner) return null;
  return <OnboardingScreen key={session.userId} actorReference={session.userId} initialDraft={draft} initialOwner={owner} />;
}
