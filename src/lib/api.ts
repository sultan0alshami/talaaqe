import { NextResponse } from "next/server";
import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { getSession, type Session } from "./auth";
import { AuthenticationInvalidated } from "./identity";

export function ok<T>(data: T, init?: ResponseInit) { return NextResponse.json(data, init); }
export function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const retired = /^\/api\/(projects|provider|matches|admin|categories|skills|assistant)(?:\/|$)/;
export function assertMutationOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const expected = process.env.APP_ORIGIN;
  if (!expected || req.headers.get("origin") !== new URL(expected).origin) throw new ApiError(403, "Invalid request origin");
}
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      const req = args[0];
      if (req instanceof Request) {
        assertMutationOrigin(req);
        if (retired.test(new URL(req.url).pathname)) {
          await requireSession();
          throw new ApiError(410, "Legacy Talaqee endpoint retired");
        }
      }
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message);
      if (error instanceof AuthenticationInvalidated) return fail(401, "Authentication invalidated");
      if (error instanceof z.ZodError) return fail(400, "Validation failed");
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail(409, "Resource already exists");
      // ORM errors can contain private submitted values: never dump their objects.
      console.error("[infame-api] request failed", error instanceof Error ? error.name : "UnknownError");
      return fail(500, "Internal error");
    }
  };
}
// Compatibility export: current authorization is re-read on every call.
export function invalidateActiveCache(_userId: string) { void _userId; }
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Not authenticated");
  return session;
}
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) throw new ApiError(403, "Forbidden");
  return session;
}
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "Missing JSON body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new ApiError(413, "Body exceeds 64 KB"); }
      chunks.push(value);
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "Validation failed");
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON body");
  } finally { reader.releaseLock(); }
}
