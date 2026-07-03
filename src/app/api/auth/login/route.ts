import { z } from "zod";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { LANG_COOKIE } from "@/lib/lang";
import { handler, ok, fail, parseBody } from "@/lib/api";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const POST = handler(async (req: Request) => {
  const { email, password } = await parseBody(req, schema);

  // Throttle before any DB/bcrypt work — failed attempts consume the budget.
  const ip = getClientIp(req);
  const ipRl = rateLimit(`login:ip:${ip}`, 10);
  const emailRl = rateLimit(`login:email:${email}`, 10);
  if (!ipRl.ok || !emailRl.ok) {
    const retry = Math.max(ipRl.retryAfterSec, emailRl.retryAfterSec);
    return fail(429, "Too many attempts", { retryAfterSec: retry });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return fail(401, "Invalid email or password");
  }
  if (!user.active) return fail(403, "Account suspended");

  await setSessionCookie({ userId: user.id, role: user.role, name: user.name, email: user.email });
  // Apply the user's persisted language preference (README §11).
  if (user.language === "ar" || user.language === "en") {
    (await cookies()).set({
      name: LANG_COOKIE,
      value: user.language,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  return ok({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, language: user.language },
  });
});
