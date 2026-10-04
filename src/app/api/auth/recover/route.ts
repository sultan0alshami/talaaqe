import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { EmailSchema, issueToken } from "@/lib/identity";
import { runtimeConfig } from "@/lib/env";
import { deliverAuthLink } from "@/lib/delivery";
import { handler, ok, fail, parseBody } from "@/lib/api";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
const schema = z.object({ email: EmailSchema }).strict();
export const POST = handler(async (req: Request) => {
  const ip = await rateLimit(`recover:ip:${getClientIp(req)}`, 5);
  if (!ip.ok) return fail(429, "Too many attempts", { retryAfterSec: ip.retryAfterSec });
  const { email } = await parseBody(req, schema);
  const limit = await rateLimit(`recover:email:${email}`, 3, 15 * 60000);
  const capability = runtimeConfig().DELIVERY_MODE;
  const user = await prisma.user.findUnique({ where: { email } });
  if (limit.ok && user?.active && capability !== "unavailable") {
    try {
      const token = await issueToken(user.id, "RESET_PASSWORD", { sessionVersion: user.sessionVersion, email });
      await deliverAuthLink({ id: token.id, email, purpose: "RESET_PASSWORD", token: token.value });
    } catch { /* Preserve the same response after identity races or delivery failures. Provider health is monitored separately. */ }
  }
  return ok({ accepted: true, delivery: capability === "resend" ? "available" : capability });
});
