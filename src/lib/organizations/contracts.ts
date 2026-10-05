import { z } from "zod";

export const OrganizationIdSchema = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);
export const OrganizationRevisionSchema = z.number().int().positive().max(2147483646);
export const ClientCapabilitiesSchema = z.object({ view: z.boolean(), plan: z.boolean(), approveShortlist: z.boolean(),
  reviewContent: z.boolean(), signCustomer: z.boolean(), financial: z.boolean(), manageGrants: z.boolean() }).strict();
export const ClientCapabilitySchema = z.enum(["view", "plan", "approveShortlist", "reviewContent", "signCustomer", "financial", "manageGrants"]);
export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;
export type ClientCapability = z.infer<typeof ClientCapabilitySchema>;
export const OrganizationSchema = z.object({ id: OrganizationIdSchema, name: z.string().max(120).refine(value => value.trim().length > 0),
  kind: z.enum(["BUSINESS", "AGENCY"]), active: z.boolean(), revision: OrganizationRevisionSchema }).strict();
export const MembershipSchema = z.object({ id: OrganizationIdSchema, organizationId: OrganizationIdSchema, userId: OrganizationIdSchema,
  state: z.enum(["PENDING", "ACTIVE", "REVOKED"]), revision: OrganizationRevisionSchema }).strict();
export const OrganizationClientSchema = z.object({ id: OrganizationIdSchema, organizationId: OrganizationIdSchema, brandId: OrganizationIdSchema,
  state: z.enum(["PENDING", "ACTIVE", "REVOKED"]), revision: OrganizationRevisionSchema }).strict();
export const ClientGrantSchema = z.object({ id: OrganizationIdSchema, organizationId: OrganizationIdSchema, membershipId: OrganizationIdSchema, clientId: OrganizationIdSchema,
  active: z.boolean(), revision: OrganizationRevisionSchema, capabilities: ClientCapabilitiesSchema }).strict();
export type OrganizationDTO = z.infer<typeof OrganizationSchema>;
export type MembershipDTO = z.infer<typeof MembershipSchema>;
export type OrganizationClientDTO = z.infer<typeof OrganizationClientSchema>;
export type ClientGrantDTO = z.infer<typeof ClientGrantSchema>;
const operationKey = z.uuid();
export const CreateOrganizationSchema = z.object({ operationKey, nameOriginal: OrganizationSchema.shape.name, kind: OrganizationSchema.shape.kind }).strict();
export const ClientAssociationProposalSchema = z.object({ operationKey, expectedOrganizationRevision: OrganizationRevisionSchema, brandId: OrganizationIdSchema }).strict();
export const AuthorizeClientAssociationSchema = z.object({ operationKey, expectedRevision: OrganizationRevisionSchema, capabilities: ClientCapabilitiesSchema }).strict();
export const ProposeMemberSchema = z.object({ operationKey, expectedOrganizationRevision: OrganizationRevisionSchema, targetUserId: OrganizationIdSchema }).strict();
export const MembershipCommandSchema = z.object({ operationKey, expectedRevision: OrganizationRevisionSchema }).strict();
export const SetClientGrantSchema = z.object({ operationKey, expectedClientRevision: OrganizationRevisionSchema,
  membershipId: OrganizationIdSchema, expectedGrantRevision: OrganizationRevisionSchema.nullable(), capabilities: ClientCapabilitiesSchema }).strict();
export const RevokeClientGrantSchema = MembershipCommandSchema;
export const OrganizationClientsQuerySchema = z.object({ after: OrganizationIdSchema.optional() }).strict();
export const ClientAuthoritySchema = z.object({ organizationId: OrganizationIdSchema, clientId: OrganizationIdSchema, brandId: OrganizationIdSchema,
  membershipId: OrganizationIdSchema, grantId: OrganizationIdSchema, capability: ClientCapabilitySchema,
  organizationRevision: OrganizationRevisionSchema, membershipRevision: OrganizationRevisionSchema, clientRevision: OrganizationRevisionSchema, grantRevision: OrganizationRevisionSchema }).strict();
export type ClientAuthorityDTO = z.infer<typeof ClientAuthoritySchema>;
export const OrganizationClientsSchema = z.object({ organizationId: OrganizationIdSchema, asOf: z.iso.datetime(),
  clients: z.array(OrganizationClientSchema.extend({ state: z.literal("ACTIVE"), brandName: z.string().max(10000) }).strict()).max(30),
  nextCursor: OrganizationIdSchema.nullable() }).strict();
export type OrganizationClientsDTO = z.infer<typeof OrganizationClientsSchema>;
export const OrganizationDirectorySchema = z.object({ asOf: z.iso.datetime(),
  organizations: z.array(z.object({ organization: OrganizationSchema,
    membership: MembershipSchema.extend({ state: z.enum(["PENDING", "ACTIVE"]) }).strict() }).strict()).max(30),
  nextCursor: OrganizationIdSchema.nullable() }).strict();
export type OrganizationDirectoryDTO = z.infer<typeof OrganizationDirectorySchema>;
export class OrganizationError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "OrganizationError"; }
}
export function parseOrganizationInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new OrganizationError("VALIDATION", 422);
  return parsed.data;
}
