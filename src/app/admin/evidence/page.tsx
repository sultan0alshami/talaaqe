import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { listEvidenceReviewQueue } from "@/lib/evidence/service";
import { evidenceOptionsForSession } from "@/lib/evidence/runtime";
import { EvidenceError } from "@/lib/evidence/storage";
import { AdminEvidenceScreen } from "@/components/infame/admin-evidence-screen";

export default async function AdminEvidencePage() {
  const actor = await requirePageSession("ADMIN");
  let initial;
  try { initial = await listEvidenceReviewQueue(actor.userId, { kind: "OWNERSHIP", status: "PENDING" }, await evidenceOptionsForSession(actor)); }
  catch (error) {
    if (!(error instanceof EvidenceError)) throw error;
    if (error.code === "UNAUTHENTICATED") redirect("/login");
    return <AdminEvidenceScreen initial={null} initialError={error.code} />;
  }
  return <AdminEvidenceScreen initial={initial} />;
}
