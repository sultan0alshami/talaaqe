import { z } from "zod";
import { consumeToken, PasswordSchema } from "@/lib/identity";
import { handler, ok, fail, parseBody } from "@/lib/api";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
const schema = z.object({ token: z.string().max(200), password: PasswordSchema }).strict();
export const POST = handler(async (req: Request) => {
  const limit = await rateLimit(`reset:ip:${getClientIp(req)}`, 5);
  if (!limit.ok) return fail(429, "Too many attempts", { retryAfterSec: limit.retryAfterSec });
  const { token, password } = await parseBody(req, schema);
  return await consumeToken("RESET_PASSWORD", token, password) ? ok({ changed: true }) : fail(400, "Invalid or expired link");
});
