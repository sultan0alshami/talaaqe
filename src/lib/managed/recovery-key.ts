import type { PlanningScope } from "@/lib/brand-context/contracts";
export const MANAGED_REQUEST_RECOVERY_PREFIX = "infame-managed-request:";
export function managedRequestRecoveryKey(actorReference: string, scope: PlanningScope, campaignId: string): string {
  return MANAGED_REQUEST_RECOVERY_PREFIX + encodeURIComponent(actorReference) + ":"
    + encodeURIComponent(scope.kind === "OWN_BRAND" ? "own:" + scope.brandId : "client:" + scope.clientId)
    + ":" + encodeURIComponent(campaignId);
}
