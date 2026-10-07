import type { Prisma } from "@prisma/client";
import { organizationAwait } from "@/lib/organizations/context";
import { BrandContextError } from "./contracts";

// The caller already holds the exact Context and submitted-review locks. All
// reference writers acquire Context first, so no late owner/tenant lock is needed.
export async function contextReferenceSourceStale(tx: Prisma.TransactionClient, contextId: string,
  workspaceId: string, submissionId: string, checkpoint: () => void): Promise<boolean> {
  const captured = await organizationAwait(checkpoint, () => tx.contextSubmissionReferences.findUnique({ where: { submissionId } }));
  const current = await organizationAwait(checkpoint, () => tx.contextReferenceState.findUnique({ where: { contextId } }));
  if (captured && (captured.contextId !== contextId || captured.workspaceId !== workspaceId)
    || current && current.workspaceId !== workspaceId) throw new BrandContextError("RETRY_REQUIRED", 503);
  checkpoint();
  if (!captured || !current) return captured !== null || current !== null;
  return captured.manifestId !== current.manifestId || captured.referenceRevision !== current.referenceRevision
    || captured.manifestHash !== current.manifestHash;
}
