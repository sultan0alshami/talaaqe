import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError, assertMutationOrigin } from "@/lib/api";
import { AuthenticationInvalidated } from "@/lib/identity";

export function domainHandler<A extends [Request, ...unknown[]]>(action: (...args: A) => Promise<unknown>): (...args: A) => Promise<Response> {
  return async (...args) => {
    const requestId = randomUUID();
    const headers = { "Cache-Control": "private, no-store", "X-Request-Id": requestId };
    try {
      assertMutationOrigin(args[0]);
      return NextResponse.json({ data: await action(...args), requestId }, { headers });
    } catch (error) {
      let status = 500, code = "INTERNAL_ERROR";
      if (error instanceof ApiError) { status = error.status; code = status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION"; }
      else if (error instanceof AuthenticationInvalidated) { status = 401; code = "UNAUTHENTICATED"; }
      else if (error instanceof z.ZodError) { status = 422; code = "VALIDATION"; }
      else if (error instanceof Error && "code" in error && "status" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) && typeof error.status === "number" && error.status >= 400 && error.status <= 503) { status = error.status; code = error.code; }
      else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { status = 409; code = "CONFLICT"; }
      if (status === 500) console.error("[infame-domain]", requestId, error instanceof Error ? error.name : "UnknownError");
      return NextResponse.json({ error: { code, message: code, requestId, retryable: status === 503 || status === 429 }, requestId }, { status, headers });
    }
  };
}
