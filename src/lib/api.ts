// Shared route-handler helpers: JSON responses, zod parsing, role guards.
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { getSession, type Session } from "./auth";
import { prisma } from "./prisma";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as unknown as Record<string, unknown>, init);
}

export function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wrap a handler: uncaught ApiError → status json; anything else → 500. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.status, e.message);
      console.error("[api]", e);
      return fail(500, "Internal error");
    }
  };
}

// Suspension must take effect before the 7-day JWT expires, so re-check
// user.active on every authenticated call (memoized briefly per user).
const activeCache = new Map<string, { active: boolean; at: number }>();
const ACTIVE_TTL_MS = 60_000;

async function assertActive(userId: string) {
  const cached = activeCache.get(userId);
  if (cached && Date.now() - cached.at < ACTIVE_TTL_MS) {
    if (!cached.active) throw new ApiError(403, "Account suspended");
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { active: true } });
  activeCache.set(userId, { active: !!user?.active, at: Date.now() });
  if (!user?.active) throw new ApiError(403, "Account suspended");
}

/** Drop the memoized active flag (call when an admin toggles a user). */
export function invalidateActiveCache(userId: string) {
  activeCache.delete(userId);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Not authenticated");
  await assertActive(session.userId);
  return session;
}

export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) throw new ApiError(403, "Forbidden");
  return session;
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "Validation failed: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
