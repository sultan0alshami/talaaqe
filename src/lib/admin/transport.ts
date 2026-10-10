import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { z } from "zod";
import { AdminReadError, AdminUsersQuerySchema } from "./contracts";
import { getAdminOverview } from "./overview";
import { changeAdminUserStatus, getAdminUsers } from "./users";
import { getAdminCampaigns } from "./campaigns";
import { getAdminCreators } from "./creators";
import { getAdminAnalytics } from "./analytics";

export const loadAdminAnalytics = domainHandler(async (request: Request) => {
  const actor = await requireRole("ADMIN");
  if (new URL(request.url).search) throw new AdminReadError("VALIDATION", 422);
  return getAdminAnalytics(actor);
});

export const loadAdminOverview = domainHandler(async (request: Request) => {
  const actor = await requireRole("ADMIN");
  if (new URL(request.url).search) throw new AdminReadError("VALIDATION", 422);
  return getAdminOverview(actor);
});

export const loadAdminUsers = domainHandler(async (request: Request) => {
  const actor = await requireRole("ADMIN");
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new AdminReadError("VALIDATION", 422);
  return getAdminUsers(actor, Object.fromEntries(entries));
});
export const loadAdminCampaigns = domainHandler(async (request: Request) => {
  const actor = await requireRole("ADMIN");
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new AdminReadError("VALIDATION", 422);
  return getAdminCampaigns(actor, Object.fromEntries(entries));
});
export const loadAdminCreators = domainHandler(async (request: Request) => {
  const actor = await requireRole("ADMIN");
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new AdminReadError("VALIDATION", 422);
  return getAdminCreators(actor, Object.fromEntries(entries));
});
export const mutateAdminUserStatus = domainHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const actor = await requireRole("ADMIN");
  if (new URL(request.url).search) throw new AdminReadError("VALIDATION", 422);
  const { id } = await context.params;
  const targetId = AdminUsersQuerySchema.shape.after.unwrap().parse(id);
  // Keep the shared bounded JSON reader; the domain owns command validation (422).
  return changeAdminUserStatus(actor, targetId, await parseBody(request, z.unknown()));
});
