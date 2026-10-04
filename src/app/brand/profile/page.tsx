import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { profileForOwner } from "@/lib/onboarding/profiles";
import { OnboardingError } from "@/lib/onboarding/drafts";
import { ProfileScreen } from "@/components/infame/profile-screen";

export default async function BrandProfilePage() {
  const actor = await requirePageSession("BRAND");
  let owner;
  try {
    owner = await profileForOwner(actor.userId);
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    return <ProfileScreen role="BRAND" owner={null} loadError />;
  }
  if (owner && owner.role !== "BRAND") notFound();
  return <ProfileScreen role="BRAND" owner={owner} />;
}
