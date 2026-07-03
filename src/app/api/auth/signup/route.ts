import { z } from "zod";
import bcrypt from "bcryptjs";
import { Role, VerifiedStatus, ProviderType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/auth";
import { handler, ok, fail, parseBody } from "@/lib/api";

const schema = z.object({
  role: z.enum(["client", "provider"]),
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(100),
  phone: z.string().max(30).optional(),
  company: z.string().max(120).optional(),
  city: z.string().max(80).optional(),
  categoryId: z.string().optional(), // provider main specialty
  language: z.enum(["ar", "en"]).optional(),
});

export const POST = handler(async (req: Request) => {
  const body = await parseBody(req, schema);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) return fail(409, "Email already registered");

  const passwordHash = await bcrypt.hash(body.password, 10);
  const role = body.role === "client" ? Role.CLIENT : Role.PROVIDER;

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      phone: body.phone,
      passwordHash,
      role,
      companyName: body.company,
      language: body.language ?? "ar",
      ...(role === Role.CLIENT
        ? { client: { create: { location: body.city } } }
        : {
            provider: {
              create: {
                providerType: ProviderType.FREELANCER,
                verifiedStatus: VerifiedStatus.PENDING,
                locationAr: body.city,
                locationEn: body.city,
                languages: ["ar"],
                avatarColor: "#1B3568",
                avatarInitial: body.name.trim().charAt(0),
                ...(body.categoryId
                  ? { categories: { create: [{ categoryId: body.categoryId }] } }
                  : {}),
              },
            },
          }),
    },
  });

  await setSessionCookie({ userId: user.id, role: user.role, name: user.name, email: user.email });
  return ok({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
