import { prisma } from "@/lib/prisma";
import { issueToken } from "@/lib/identity";
import { deliverAuthLink } from "@/lib/delivery";
import { runtimeConfig } from "@/lib/env";
import { handler, ok, fail, requireSession } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
export const POST = handler(async () => {
  const actor = await requireSession();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.emailVerifiedAt) return ok({ verified: true });
  const limit = await rateLimit(`verification:user:${user.id}`, 1, 60000);
  if (!limit.ok) return fail(429, "Wait before resending", { retryAfterSec: limit.retryAfterSec });
  if (runtimeConfig().DELIVERY_MODE === "unavailable") return ok({ accepted: false, delivery: "unavailable" });
  const token = await issueToken(user.id, "VERIFY_EMAIL", { sessionVersion: actor.sessionVersion, email: user.email });
  const delivery = await deliverAuthLink({ id: token.id, email: user.email, purpose: "VERIFY_EMAIL", token: token.value });
  return ok({ accepted: true, delivery });
});
