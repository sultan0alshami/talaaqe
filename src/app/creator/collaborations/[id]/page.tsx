import { requirePageSession } from "@/lib/auth";
import { getExternalCollaboration } from "@/lib/external-collaborations/service";
import { ExternalCollaborationEditor } from "@/components/infame/external-collaboration-editor";
export default async function CollaborationPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageSession("CREATOR"), { id } = await params;
  return <ExternalCollaborationEditor initial={await getExternalCollaboration(actor, { collaborationId: id })} />;
}
