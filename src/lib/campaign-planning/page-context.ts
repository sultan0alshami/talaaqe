import { z } from "zod";
import { captureOrganizationActor, checkOrganizationActor, organizationAwait, organizationDb, withOrganizationTransaction,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { OrganizationError, OrganizationIdSchema, type ClientAuthorityDTO } from "@/lib/organizations/contracts";
import { getOwnReferences } from "@/lib/organizations/management";
import { getClientAuthority } from "@/lib/organizations/loaders";
import { lockOrganizationRows } from "@/lib/organizations/service";
import { createEvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import { CampaignError, listCampaigns } from "@/lib/campaigns/service";
import { projectCampaignCore } from "@/lib/campaigns/core";
import { selectLegacyOwnerCampaign } from "./legacy";
import { listPlanningCampaigns, getPlanningCampaign, listCampaignOwnerReviews } from "./service";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import { CampaignPlanningError } from "./contracts";
import type { CampaignPlanningScreenProps, CampaignPlanningOwnerReviewsScreenProps,
  CampaignListPageContext, CampaignDetailPageContext, CampaignBriefPageContext } from "./ui-contract";

export type CampaignPageSearch = Record<string, string | string[] | undefined>;
const PageQuery = z.object({ clientId: OrganizationIdSchema.optional() }).strict();
const BriefQuery = PageQuery.extend({ campaign: OrganizationIdSchema.optional() }).strict();
type Call = { actor: Readonly<OrganizationActor>; options: OrganizationOptions; checkpoint: () => void };
async function begin(actorInput: OrganizationActor, options: OrganizationOptions): Promise<Call> {
  const actor = captureOrganizationActor(actorInput), captured = { client: organizationDb(options) }, reader = createEvidenceReceiptReader();
  const checkpoint = () => reader.checkpoint();
  await checkOrganizationActor(actor, captured, checkpoint);
  return { actor, options: captured, checkpoint };
}
function packet<T>(parsed: z.ZodSafeParseResult<T>, call: Call): T {
  call.checkpoint();
  if (!parsed.success) throw new CampaignPlanningError("VALIDATION", 422);
  return parsed.data;
}
function missing(): never { throw new CampaignPlanningError("NOT_FOUND", 404); }
async function read<T>(call: Call, action: () => Promise<T>): Promise<T> {
  // A repeatable read that waited behind a changed native row can abort before
  // its permission predicate runs. Retry only that native transaction conflict,
  // under the same captured request/deadline, after current authentication.
  for (let attempt = 0; attempt < 3; attempt++) {
    call.checkpoint();
    try { return await organizationAwait(call.checkpoint, action); }
    catch (error) {
      if (!(error instanceof OrganizationError && error.code === "RETRY_REQUIRED")) throw error;
      await checkOrganizationActor(call.actor, call.options, call.checkpoint);
      if (attempt === 2) throw error;
    }
  }
  throw new CampaignPlanningError("RETRY_REQUIRED", 503);
}
const authorityFields = ["organizationId", "clientId", "brandId", "membershipId", "grantId", "organizationRevision",
  "membershipRevision", "clientRevision", "grantRevision"] as const;
function matchingPlan(plan: ClientAuthorityDTO | null, view: ClientAuthorityDTO | null) {
  return plan && view && authorityFields.every(field => plan[field] === view[field]) ? plan : null;
}
async function planAuthority(call: Call, scope: PlanningScope): Promise<ClientAuthorityDTO | null> {
  if (scope.kind !== "CLIENT") return null;
  try { return await read(call, () => getClientAuthority(call.actor, scope.clientId, "plan", call.options)); }
  catch (error) { if (error instanceof Error && "status" in error && error.status === 404) return null; throw error; }
}
async function scopeFor(call: Call, clientId?: string): Promise<PlanningScope | null> {
  if (clientId !== undefined) return { kind: "CLIENT", clientId };
  const own = await read(call, () => getOwnReferences(call.actor, call.options));
  return own.brandId ? { kind: "OWN_BRAND", brandId: own.brandId } : null;
}
async function planningDetail(call: Call, scope: PlanningScope, campaignId: string): Promise<CampaignDetailPageContext> {
  const plan = await planAuthority(call, scope);
  const initialCampaign = await read(call, () => getPlanningCampaign(call.actor, { scope, campaignId }, call.options));
  return { kind: "PLANNING", props: { scope, campaignId, initialCampaign,
    planAuthority: matchingPlan(plan, initialCampaign.currentAuthority) } };
}
async function planningList(call: Call, scope: PlanningScope): Promise<CampaignListPageContext> {
  const plan = await planAuthority(call, scope);
  const initialPage = await read(call, () => listPlanningCampaigns(call.actor, { scope }, call.options));
  return { kind: "PLANNING_LIST", props: { scope, initialPage, planAuthority: matchingPlan(plan, initialPage.currentAuthority) } };
}
async function ownDetail(call: Call, campaignId: string): Promise<CampaignDetailPageContext> {
  const classified = await read(call, () => withOrganizationTransaction(call.actor, call.options, { write: false, checkpoint: call.checkpoint }, async tx => {
    const first = await organizationAwait(call.checkpoint, () => tx.brand.findUnique({ where: { userId: call.actor.userId }, select: { id: true } }));
    if (!first) return missing();
    await lockOrganizationRows(tx, "Brand", [first.id], false, call.checkpoint);
    const brand = await organizationAwait(call.checkpoint, () => tx.brand.findUnique({ where: { id: first.id }, select: { userId: true } }));
    if (brand?.userId !== call.actor.userId) return missing();
    if (!await organizationAwait(call.checkpoint, () => tx.campaign.findFirst({ where: { id: campaignId, brandId: first.id }, select: { id: true } }))) return missing();
    await organizationAwait(call.checkpoint, () => tx.$queryRaw`SELECT id FROM "Campaign" WHERE id=${campaignId} FOR SHARE`);
    const identity = await organizationAwait(call.checkpoint, () => tx.campaign.findUnique({ where: { id: campaignId }, select: { brandId: true } }));
    if (identity?.brandId !== first.id) return missing();
    const binding = await organizationAwait(call.checkpoint, () => tx.campaignPlanningBinding.findUnique({ where: { campaignId },
      select: { brandId: true, workspace: { select: { scope: true, brandId: true, organizationId: true, clientId: true } } } }));
    if (binding) {
      if (binding.brandId !== first.id || binding.workspace.brandId !== first.id || binding.workspace.scope !== "OWN_BRAND"
        || binding.workspace.organizationId !== null || binding.workspace.clientId !== null) return missing();
      return { kind: "PLANNING_ID" as const, scope: { kind: "OWN_BRAND" as const, brandId: first.id } };
    }
    // This is the same current frame as classification. No nested legacy
    // transaction or eager input/brief projection can race BIND_OWN.
    const campaign = await organizationAwait(call.checkpoint, () => tx.campaign.findUniqueOrThrow({ where: { id: campaignId } }));
    const initialCampaign = await organizationAwait(call.checkpoint, () => projectCampaignCore(tx, campaign));
    return { kind: "LEGACY" as const, initialCampaign };
  }));
  return classified.kind === "LEGACY" ? classified : planningDetail(call, classified.scope, campaignId);
}
export async function getCampaignListPageContext(actor: OrganizationActor, search: CampaignPageSearch = {}, options: OrganizationOptions = {}): Promise<CampaignListPageContext> {
  const captured = PageQuery.safeParse(search), call = await begin(actor, options), query = packet(captured, call);
  if (query.clientId !== undefined) return planningList(call, { kind: "CLIENT", clientId: query.clientId });
  try {
    const initialList = await read(call, () => listCampaigns(call.actor.userId, {}, organizationDb(call.options), call.actor));
    return { kind: "LEGACY_LIST", initialList, profileRequired: false };
  } catch (error) {
    if (error instanceof CampaignError && error.code === "BRAND_PROFILE_REQUIRED") return { kind: "LEGACY_LIST", initialList: null, profileRequired: true };
    throw error;
  }
}
export async function getNewCampaignPageContext(actor: OrganizationActor, search: CampaignPageSearch = {}, options: OrganizationOptions = {}): Promise<CampaignPlanningScreenProps> {
  const captured = PageQuery.safeParse(search), call = await begin(actor, options), query = packet(captured, call);
  const scope = await scopeFor(call, query.clientId);
  if (!scope) return { scope: null, campaignId: null, initialCampaign: null, initialList: null, planAuthority: null };
  const plan = await planAuthority(call, scope);
  const initialList = await read(call, () => listPlanningCampaigns(call.actor, { scope, limit: 1 }, call.options));
  return { scope, campaignId: null, initialCampaign: null, initialList, planAuthority: matchingPlan(plan, initialList.currentAuthority) };
}
export async function getCampaignDetailPageContext(actor: OrganizationActor, campaignId: string, search: CampaignPageSearch = {}, options: OrganizationOptions = {}): Promise<CampaignDetailPageContext> {
  const captured = PageQuery.safeParse(search), capturedId = OrganizationIdSchema.safeParse(campaignId), call = await begin(actor, options);
  const query = packet(captured, call), id = packet(capturedId, call);
  return query.clientId === undefined ? ownDetail(call, id) : planningDetail(call, { kind: "CLIENT", clientId: query.clientId }, id);
}
export async function getCampaignBriefPageContext(actor: OrganizationActor, search: CampaignPageSearch = {}, options: OrganizationOptions = {}): Promise<CampaignBriefPageContext> {
  const captured = BriefQuery.safeParse(search), call = await begin(actor, options), query = packet(captured, call);
  if (query.clientId !== undefined) {
    const scope: PlanningScope = { kind: "CLIENT", clientId: query.clientId };
    return query.campaign === undefined ? planningList(call, scope) : planningDetail(call, scope, query.campaign);
  }
  const selected = await read(call, () => selectLegacyOwnerCampaign(call.actor, { campaignId: query.campaign }, call.options));
  return selected ? ownDetail(call, selected.id) : { kind: "EMPTY" };
}
export async function getCampaignOwnerReviewsPageContext(actor: OrganizationActor, search: CampaignPageSearch = {}, options: OrganizationOptions = {}): Promise<CampaignPlanningOwnerReviewsScreenProps> {
  const captured = z.object({}).strict().safeParse(search), call = await begin(actor, options); packet(captured, call);
  const initialPage = await read(call, () => listCampaignOwnerReviews(call.actor, {}, call.options));
  return { initialPage };
}
export function campaignPlanningPageError(error: unknown): string {
  if (error instanceof Error && "status" in error) {
    if (error.status === 401) return "UNAUTHENTICATED";
    if (error.status === 403) return "FORBIDDEN";
    if (error.status === 404) return "NOT_FOUND";
  }
  return error instanceof CampaignPlanningError && error.code === "VALIDATION" ? "VALIDATION" : "RETRY_REQUIRED";
}
