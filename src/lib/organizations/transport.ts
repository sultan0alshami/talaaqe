import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "./context";
import { ClientCapabilitySchema, OrganizationError, OrganizationIdSchema, parseOrganizationInput } from "./contracts";
import { getClientAuthority, getOrganization, getOrganizationClients } from "./loaders";
import { getOrganizationDirectory } from "./directory";
import { getClientGrants, getOrganizationAssociations, getOrganizationMembers, getOwnBrandAssociations, getOwnReferences } from "./management";
import { revokeClientAssociation, withdrawClientProposal, withdrawMembership } from "./lifecycle";
import { acceptMembership, associateOwnedBrand, authorizeClientAssociation, createOrganization, proposeClientAssociation,
  proposeMember, revokeClientGrant, revokeMembership, setClientGrant } from "./service";

function query(request: Request) {
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new OrganizationError("VALIDATION", 422);
  return Object.fromEntries(entries);
}
type ResourceContext = { params: Promise<{ id: string }> };
export const loadOrganizationDirectory = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND");
  await checkOrganizationActor(actor);
  return getOrganizationDirectory(actor, query(request));
});
export const loadOrganization = domainHandler(async (request: Request, context: ResourceContext) => {
  const actor = await requireRole("BRAND");
  await checkOrganizationActor(actor);
  if (new URL(request.url).search) throw new OrganizationError("VALIDATION", 422);
  return getOrganization(actor, parseOrganizationInput(OrganizationIdSchema, (await context.params).id));
});
export const loadOrganizationClients = domainHandler(async (request: Request, context: ResourceContext) => {
  const actor = await requireRole("BRAND");
  await checkOrganizationActor(actor);
  return getOrganizationClients(actor, parseOrganizationInput(OrganizationIdSchema, (await context.params).id), query(request));
});
export const loadClientAuthority = domainHandler(async (request: Request, context: ResourceContext) => {
  const actor = await requireRole("BRAND");
  await checkOrganizationActor(actor);
  const input = parseOrganizationInput(z.object({ capability: ClientCapabilitySchema }).strict(), query(request));
  return getClientAuthority(actor, parseOrganizationInput(OrganizationIdSchema, (await context.params).id), input.capability);
});
export const loadOwnReferences = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND"); await checkOrganizationActor(actor);
  if (new URL(request.url).search) throw new OrganizationError("VALIDATION", 422);
  return getOwnReferences(actor);
});
export const loadOrganizationMembers = domainHandler(async (request: Request, context: ResourceContext) => {
  const actor = await requireRole("BRAND"); await checkOrganizationActor(actor);
  return getOrganizationMembers(actor, parseOrganizationInput(OrganizationIdSchema, (await context.params).id), query(request));
});
export const loadOrganizationAssociations = domainHandler(async (request: Request, context: ResourceContext) => {
  const actor = await requireRole("BRAND"); await checkOrganizationActor(actor);
  return getOrganizationAssociations(actor, parseOrganizationInput(OrganizationIdSchema, (await context.params).id), query(request));
});
export const loadOwnBrandAssociations = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND"); await checkOrganizationActor(actor);
  return getOwnBrandAssociations(actor, query(request));
});
export const loadClientGrants = domainHandler(async (request: Request, context: ResourceContext) => {
  const actor = await requireRole("BRAND"); await checkOrganizationActor(actor);
  return getClientGrants(actor, parseOrganizationInput(OrganizationIdSchema, (await context.params).id), query(request));
});
const operations = {
  CREATE: (actor: Parameters<typeof createOrganization>[0], _id: string | undefined, command: unknown) => createOrganization(actor, command),
  ASSOCIATE_OWNED_BRAND: associateOwnedBrand,
  PROPOSE_CLIENT: proposeClientAssociation,
  AUTHORIZE_CLIENT: authorizeClientAssociation,
  PROPOSE_MEMBER: proposeMember,
  ACCEPT_MEMBERSHIP: acceptMembership,
  REVOKE_MEMBERSHIP: revokeMembership,
  SET_GRANT: setClientGrant,
  REVOKE_GRANT: revokeClientGrant,
  WITHDRAW_MEMBERSHIP: withdrawMembership,
  REVOKE_CLIENT: revokeClientAssociation,
  WITHDRAW_CLIENT_PROPOSAL: withdrawClientProposal,
};
export const OrganizationCommandRequestSchema = z.object({
  action: z.enum(Object.keys(operations) as [keyof typeof operations, ...(keyof typeof operations)[]]),
  resourceId: OrganizationIdSchema.optional(), command: z.unknown(),
}).strict().superRefine((input, ctx) => {
  if ((input.action === "CREATE") === (input.resourceId !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["resourceId"], message: "Invalid command resource" });
  }
});
export const commandOrganization = domainHandler(async (request: Request) => {
  const actor = await requireRole("BRAND");
  await checkOrganizationActor(actor);
  if (new URL(request.url).search) throw new OrganizationError("VALIDATION", 422);
  const input = parseOrganizationInput(OrganizationCommandRequestSchema, await parseBody(request, z.unknown()));
  if (input.action === "CREATE") return operations.CREATE(actor, undefined, input.command);
  return operations[input.action](actor, input.resourceId!, input.command);
});
