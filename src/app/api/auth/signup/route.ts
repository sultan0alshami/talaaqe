import { signup, SignupSchema } from "@/lib/identity";
import { setSessionCookie } from "@/lib/auth";
import { handler, ok, fail, parseBody } from "@/lib/api";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
export const POST = handler(async (req: Request) => {
  const limit = await rateLimit(`signup:${getClientIp(req)}`, 5);
  if (!limit.ok) return fail(429, "Too many attempts", { retryAfterSec: limit.retryAfterSec });
  const input = await parseBody(req, SignupSchema);
  const user = await signup(input);
  await setSessionCookie({ userId: user.id, role: user.role, name: user.name, email: user.email, sessionVersion: user.sessionVersion, passwordHash: user.passwordHash });
  return ok({ user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: false } }, { status: 201 });
});
