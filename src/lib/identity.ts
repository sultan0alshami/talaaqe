import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./prisma";
import { signSession, verifySessionToken, SESSION_DAYS, type Session } from "./jwt";
import { CountryCodeSchema, TimeZoneSchema } from "./contracts/vocabulary";

export const PasswordSchema = z.string().min(12).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password exceeds bcrypt byte limit");
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const SignupSchema = z.object({
  role: z.enum(["CREATOR", "BRAND"]), name: z.string().trim().min(2).max(120),
  email: EmailSchema, password: PasswordSchema, language: z.enum(["ar", "en"]).default("ar"),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
  countryCode: CountryCodeSchema.optional(), timeZone: TimeZoneSchema.optional(),
}).strict();
export class AuthenticationInvalidated extends Error {
  constructor() { super("Authentication invalidated"); this.name = "AuthenticationInvalidated"; }
}

export async function signup(input: unknown) {
  const value = SignupSchema.parse(input);
  const passwordHash = await bcrypt.hash(value.password, 12);
  const suffix = randomBytes(10).toString("hex");
  const isTest = process.env.INFAME_ENV === "test" || process.env.DELIVERY_MODE === "fixture";
  return prisma.user.create({ data: {
    name: value.name, email: value.email, phone: value.phone, role: value.role, language: value.language,
    countryCode: value.countryCode, timeZone: value.timeZone, passwordHash, isTest,
    ...(value.role === "CREATOR"
      ? { creator: { create: { handle: `creator_${suffix}`, displayName: value.name, countryCode: value.countryCode, timeZone: value.timeZone, isTest } } }
      : { brand: { create: { slug: `brand-${suffix}`, name: value.name, countryCode: value.countryCode, timeZone: value.timeZone, isTest } } }),
  } });
}

// A dummy compare keeps unknown-account authentication on the same bcrypt path.
const dummyHash = bcrypt.hashSync("infame-dummy-password-never-valid", 12);
export async function authenticate(email: string, password: string) {
  const normalized = EmailSchema.safeParse(email);
  const user = normalized.success ? await prisma.user.findUnique({ where: { email: normalized.data } }) : null;
  const valid = await bcrypt.compare(password.slice(0, 200), user?.passwordHash ?? dummyHash);
  return user?.active && valid ? user : null;
}

export async function openSession(userId: string, expectedVersion: number, expectedPasswordHash: string): Promise<string> {
  const { user, record } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.active || user.sessionVersion !== expectedVersion || user.passwordHash !== expectedPasswordHash) throw new AuthenticationInvalidated();
    const record = await tx.authSession.create({ data: {
      id: randomBytes(32).toString("base64url"), userId, version: user.sessionVersion,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
    } });
    return { user, record };
  });
  return signSession({ userId, role: user.role, name: user.name, email: user.email, sessionId: record.id, sessionVersion: record.version });
}

export async function resolveSession(token: string): Promise<Session | null> {
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const record = await prisma.authSession.findUnique({ where: { id: claims.sessionId }, include: { user: true } });
  if (!record || record.revokedAt || record.expiresAt <= new Date() || record.userId !== claims.userId || !record.user.active ||
      record.version !== claims.sessionVersion || record.version !== record.user.sessionVersion || record.user.role !== claims.role) return null;
  return { ...claims, name: record.user.name, email: record.user.email };
}

export async function revokeSession(sessionId: string) {
  await prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export type TokenPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD";
function tokenHash(purpose: TokenPurpose, value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Missing authentication secret");
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
}
export async function issueToken(userId: string, purpose: TokenPurpose) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.active) throw new Error("Inactive account");
  const value = randomBytes(32).toString("base64url");
  const record = await prisma.authToken.create({ data: {
    userId, purpose, destination: user.email, tokenHash: tokenHash(purpose, value), expiresAt: new Date(Date.now() + 30 * 60000),
  } });
  return { id: record.id, value, expiresAt: record.expiresAt };
}

export async function consumeToken(purpose: TokenPurpose, value: string, newPassword?: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const passwordHash = purpose === "RESET_PASSWORD" ? await bcrypt.hash(PasswordSchema.parse(newPassword), 12) : null;
  return prisma.$transaction(async (tx) => {
    const record = await tx.authToken.findUnique({ where: { tokenHash: tokenHash(purpose, value) } });
    if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt <= new Date()) return null;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${record.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: record.userId } });
    if (!user?.active || user.email !== record.destination) throw new Error("Token destination changed or inactive");
    const claimed = await tx.authToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return null;
    await tx.user.update({ where: { id: record.userId }, data: purpose === "VERIFY_EMAIL"
      ? { emailVerifiedAt: new Date() }
      : { passwordHash: passwordHash!, sessionVersion: { increment: 1 } } });
    if (purpose === "RESET_PASSWORD") {
      await tx.authSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authToken.updateMany({ where: { userId: record.userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    }
    return record.userId;
  });
}
