import { z } from "zod";
import { consumeToken } from "@/lib/identity";
import { handler, ok, fail, parseBody } from "@/lib/api";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
const schema = z.object({ token: z.string().max(200) }).strict();
export const POST = handler(async (req: Request) => {
  const limit = await rateLimit(`verify-email:ip:${getClientIp(req)}`, 10);
  if (!limit.ok) return fail(429, "Too many attempts", { retryAfterSec: limit.retryAfterSec });
  const { token } = await parseBody(req, schema);
  return await consumeToken("VERIFY_EMAIL", token) ? ok({ verified: true }) : fail(400, "Invalid or expired link");
});
