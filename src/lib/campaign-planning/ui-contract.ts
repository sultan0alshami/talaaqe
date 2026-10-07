import type { ClientAuthorityDTO } from "@/lib/organizations/contracts";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import type { CampaignDTO, listCampaigns } from "@/lib/campaigns/service";
import type { PlanningCampaign, PlanningCampaignList, CampaignOwnerReviews } from "./contracts";

export type CampaignPlanningScreenProps = { scope: PlanningScope | null; campaignId: string | null;
  initialCampaign: PlanningCampaign | null; initialList?: PlanningCampaignList | null;
  planAuthority: ClientAuthorityDTO | null; initialError?: string | null };
export type PlanningCampaignListScreenProps = { scope: PlanningScope | null; initialPage: PlanningCampaignList | null;
  planAuthority: ClientAuthorityDTO | null; initialError?: string | null };
export type CampaignPlanningOwnerReviewsScreenProps = { initialPage: CampaignOwnerReviews | null; initialError?: string | null };
export type CampaignListPageContext = { kind: "LEGACY_LIST"; initialList: Awaited<ReturnType<typeof listCampaigns>> | null; profileRequired: boolean }
  | { kind: "PLANNING_LIST"; props: PlanningCampaignListScreenProps };
export type CampaignDetailPageContext = { kind: "LEGACY"; initialCampaign: CampaignDTO }
  | { kind: "PLANNING"; props: CampaignPlanningScreenProps };
export type CampaignBriefPageContext = CampaignDetailPageContext | CampaignListPageContext | { kind: "EMPTY" };
