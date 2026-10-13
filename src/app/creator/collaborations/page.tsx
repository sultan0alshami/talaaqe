import { requirePageSession } from "@/lib/auth";
import { listExternalCollaborations } from "@/lib/external-collaborations/service";
import { ExternalCollaborationListScreen } from "@/components/infame/external-collaboration-list";
export default async function CollaborationsPage() {
  const actor = await requirePageSession("CREATOR");
  return <ExternalCollaborationListScreen initial={await listExternalCollaborations(actor, { archived: false })} />;
}
