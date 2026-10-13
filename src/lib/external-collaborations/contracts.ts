export * from "./schemas";
import { ExternalCollaborationCommandSchema, ExternalCollaborationError } from "./schemas";
import { OrganizationIdSchema as id } from "@/lib/organizations/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";

export function externalCollaborationCommandHash(actorUserId: unknown, input: unknown): string {
  // Capture the actual native ID first. Sessions and transport flags are never
  // part of this domain hash; parsing clones all admitted plain command values.
  const actor = id.safeParse(actorUserId);
  if (!actor.success) throw new ExternalCollaborationError("VALIDATION", 422);
  const command = ExternalCollaborationCommandSchema.safeParse(input);
  if (!command.success) throw new ExternalCollaborationError("VALIDATION", 422);
  try { return canonicalHash({ domain: "infame-external-collaboration-command-v1", actorUserId: actor.data, command: command.data }); }
  catch { throw new ExternalCollaborationError("VALIDATION", 422); }
}
