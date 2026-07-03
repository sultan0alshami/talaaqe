import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";

const schema = z.object({ language: z.enum(["ar", "en"]) });

// Persist UI language per user (README §11). No-op for guests — their
// preference lives in the talaqi_lang cookie set client-side.
export const PATCH = handler(async (req: Request) => {
  const { language } = await parseBody(req, schema);
  const session = await getSession();
  if (session) {
    await prisma.user.update({ where: { id: session.userId }, data: { language } });
  }
  return ok({ ok: true });
});
