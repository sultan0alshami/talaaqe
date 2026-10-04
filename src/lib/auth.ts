// Session cookie helpers for Server Components and route handlers.
// JWT primitives live in ./jwt (framework-free, shared with proxy.ts).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { openSession, resolveSession, revokeSession } from "./identity";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySessionToken, type Session } from "./jwt";

export { SESSION_COOKIE, signSession, verifySessionToken };
export type { Session };

/** Read the current session in a Server Component / route handler. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(token);
}

/** Server loaders enforce authorization independently of optimistic proxy checks. */
export async function requirePageSession(role: Role): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== role) redirect(({ BRAND: "/brand", CREATOR: "/creator", ADMIN: "/admin" })[session.role]);
  return session;
}

/** Set the session cookie (route handlers / server actions only). */
export async function setSessionCookie(session: Pick<Session, "userId" | "role" | "name" | "email" | "sessionVersion"> & { passwordHash: string }) {
  const token = await openSession(session.userId, session.sessionVersion, session.passwordHash);
  (await cookies()).set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

export async function clearSessionCookie() {
  const session = await getSession();
  if (session) await revokeSession(session.sessionId);
  (await cookies()).delete(SESSION_COOKIE);
}
