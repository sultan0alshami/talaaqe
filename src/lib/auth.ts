// Session cookie helpers for Server Components and route handlers.
// JWT primitives live in ./jwt (framework-free, shared with proxy.ts).
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySessionToken, type Session } from "./jwt";

export { SESSION_COOKIE, signSession, verifySessionToken };
export type { Session };

/** Read the current session in a Server Component / route handler. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Set the session cookie (route handlers / server actions only). */
export async function setSessionCookie(session: Session) {
  const token = await signSession(session);
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
  (await cookies()).delete(SESSION_COOKIE);
}
