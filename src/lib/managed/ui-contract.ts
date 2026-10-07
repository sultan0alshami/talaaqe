import type { ManagedOrderDetail, ManagedOrderList } from "./contracts";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import type { PlanningCampaign } from "@/lib/campaign-planning/contracts";
export type ManagedRequestPageContext = { actorReference: string; scope: PlanningScope | null;
  initialList: ManagedOrderList | null; initialDetail: ManagedOrderDetail | null; profileRequired: boolean };
export type ManagedRequestRecoveryState = { pending: boolean; busy: boolean; dirty: boolean; denied: boolean };
export type ManagedRequestActionProps = { source: PlanningCampaign; actorReference: string; blocked: boolean;
  onRecoveryState?: (state: ManagedRequestRecoveryState) => void };
