import { z } from "zod";
import { parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { applyDraftCommand } from "@/lib/onboarding/drafts";
import { profileCommand } from "@/lib/onboarding/profiles";
import { queueSourceJob } from "@/lib/onboarding/jobs";

const schema = z.object({ kind: z.enum(["DRAFT", "PROFILE", "IMPORT"]), command: z.unknown() }).strict();
export const POST = domainHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CREATOR", "BRAND"), { id } = await context.params;
  const body = await parseBody(request, schema);
  // This transport is an explicit interactive form. Voice tools use a different
  // authenticated adapter and cannot select or override this trusted channel.
  if (body.kind === "PROFILE") return profileCommand(session.userId, id, body.command);
  if (body.kind === "IMPORT") return queueSourceJob(session.userId, id, body.command);
  return applyDraftCommand(session.userId, id, body.command);
});
