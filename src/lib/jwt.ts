// Minimal, signed navigation claims. Current authorization comes from PostgreSQL.
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
export const SESSION_COOKIE = "infame_session";
export const SESSION_DAYS = 7;
export type Session = { userId: string; role: Role; name: string; email: string; sessionId: string; sessionVersion: number };
function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}
export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ role: session.role, sid: session.sessionId, version: session.sessionVersion })
    .setProtectedHeader({ alg: "HS256" }).setSubject(session.userId).setIssuer("infame.sa").setAudience("infame")
    .setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(secret());
}
export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: "infame.sa", audience: "infame" });
    if (!payload.sub || typeof payload.sid !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.sid) ||
      !["CREATOR", "BRAND", "ADMIN"].includes(String(payload.role)) || !Number.isSafeInteger(payload.version) || Number(payload.version) < 1) return null;
    return { userId: payload.sub, role: payload.role as Role, sessionId: payload.sid, sessionVersion: Number(payload.version), name: "", email: "" };
  } catch { return null; }
}
