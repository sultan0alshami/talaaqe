import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCreatorEvidence } from "@/lib/evidence/service";
import { evidenceOptionsForSession } from "@/lib/evidence/runtime";
import { EvidenceError } from "@/lib/evidence/storage";
import { CreatorEvidenceScreen } from "@/components/infame/creator-evidence-screen";

export default async function CreatorEvidencePage() {
  const actor = await requirePageSession("CREATOR");
  const profile = await prisma.creator.findUnique({ where: { userId: actor.userId }, select: { id: true, countryCode: true } });
  if (!profile) return <CreatorEvidenceScreen initial={null} countryCode={null} />;
  let initial;
  try { initial = await getCreatorEvidence(actor.userId, profile.id, await evidenceOptionsForSession(actor)); }
  catch (error) {
    if (!(error instanceof EvidenceError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    return <CreatorEvidenceScreen initial={null} countryCode={profile.countryCode} initialError={error.code} />;
  }
  return <CreatorEvidenceScreen initial={initial} countryCode={profile.countryCode} />;
}
