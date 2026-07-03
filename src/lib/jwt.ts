// JWT primitives — framework-free so proxy.ts can import them safely.
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";

export const SESSION_COOKIE = "talaqi_session";
export const SESSION_DAYS = 7;

export type Session = {
  userId: string;
  role: Role;
  name: string;
  email: string;
};

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ role: session.role, name: session.name, email: session.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !payload.role) return null;
    return {
      userId: payload.sub,
      role: payload.role as Role,
      name: (payload.name as string) ?? "",
      email: (payload.email as string) ?? "",
    };
  } catch {
    return null;
  }
}
