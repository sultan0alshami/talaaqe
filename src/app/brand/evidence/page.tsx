import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBrandEvidence } from "@/lib/evidence/service";
import { evidenceOptionsForSession } from "@/lib/evidence/runtime";
import { EvidenceError } from "@/lib/evidence/storage";
import { BrandEvidenceScreen } from "@/components/infame/brand-evidence-screen";

export default async function BrandEvidencePage() {
  const actor = await requirePageSession("BRAND");
  const profile = await prisma.brand.findUnique({ where: { userId: actor.userId }, select: { id: true, countryCode: true } });
  if (!profile) return <BrandEvidenceScreen initial={null} countryCode={null} />;
  let initial;
  try { initial = await getBrandEvidence(actor.userId, profile.id, await evidenceOptionsForSession(actor)); }
  catch (error) {
    if (!(error instanceof EvidenceError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    return <BrandEvidenceScreen initial={null} countryCode={profile.countryCode} initialError={error.code} />;
  }
  return <BrandEvidenceScreen initial={initial} countryCode={profile.countryCode} />;
}
