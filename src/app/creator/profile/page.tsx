import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { profileForOwner } from "@/lib/onboarding/profiles";
import { OnboardingError } from "@/lib/onboarding/drafts";
import { ProfileScreen } from "@/components/infame/profile-screen";

export default async function CreatorProfilePage() {
  const actor = await requirePageSession("CREATOR");
  let owner;
  try {
    owner = await profileForOwner(actor.userId, { serverAuth: actor });
  } catch (error) {
    if (error instanceof OnboardingError && [401, 403].includes(error.status)) redirect("/login");
    if (error instanceof OnboardingError) throw error;
    return <ProfileScreen role="CREATOR" owner={null} loadError />;
  }
  if (owner && owner.role !== "CREATOR") notFound();
  return <ProfileScreen role="CREATOR" owner={owner} />;
}
