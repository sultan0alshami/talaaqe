import type { ClientAuthorityDTO } from "@/lib/organizations/contracts";
import type { BrandContextList, ContextOwnerReviews, PlanningScope } from "./contracts";

export type BrandContextScreenProps = {
  scope: PlanningScope | null; initialPage: BrandContextList | null;
  planAuthority: ClientAuthorityDTO | null; initialError?: string | null;
};
export type ContextOwnerReviewsScreenProps = {
  initialPage: ContextOwnerReviews | null; initialError?: string | null;
};
