import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { handler, ok, fail, parseBody } from "@/lib/api";

const schema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const POST = handler(async (req: Request) => {
  const { email, password } = await parseBody(req, schema);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return fail(401, "Invalid email or password");
  }
  if (!user.active) return fail(403, "Account suspended");

  await setSessionCookie({ userId: user.id, role: user.role, name: user.name, email: user.email });
  return ok({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, language: user.language },
  });
});
