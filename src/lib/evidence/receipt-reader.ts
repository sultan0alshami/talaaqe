import { performance } from "node:perf_hooks";
import { Prisma, type EvidenceCommand } from "@prisma/client";

export type ReceiptScope = Readonly<{
  resourceType: string; resourceId: string; actorUserId: string; createdAt?: Date;
}>;
export interface EvidenceReceiptReader {
  readonly bounded: true;
  scan(tx: Prisma.TransactionClient, scope: ReceiptScope): AsyncIterable<EvidenceCommand>;
  checkpoint(): void;
}
export class EvidenceReceiptReadError extends Error {
  readonly code = "RETRY_REQUIRED";
  readonly status = 503;
  constructor() { super("RETRY_REQUIRED"); this.name = "EvidenceReceiptReadError"; }
}
export type ReceiptReaderOptions = { maxRows?: number; maxElapsedMs?: number; clock?: () => number };
const MAX_ROWS = 16_384;
const MAX_ELAPSED_MS = 10_000;
const PAGE_ROWS = 32;

export function createEvidenceReceiptReader(options: ReceiptReaderOptions = {}): EvidenceReceiptReader {
  let maxRows: number, maxElapsedMs: number, clock: () => number, startedAt: number;
  try {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error();
    maxRows = options.maxRows === undefined ? MAX_ROWS : options.maxRows;
    maxElapsedMs = options.maxElapsedMs === undefined ? MAX_ELAPSED_MS : options.maxElapsedMs;
    if (!Number.isSafeInteger(maxRows) || maxRows <= 0 || maxRows > MAX_ROWS
      || typeof maxElapsedMs !== "number" || !Number.isFinite(maxElapsedMs) || maxElapsedMs <= 0 || maxElapsedMs > MAX_ELAPSED_MS
      || options.clock !== undefined && typeof options.clock !== "function") throw new Error();
    clock = options.clock ?? (() => performance.now());
    startedAt = clock();
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) throw new Error();
  } catch { throw new RangeError("INVALID_RECEIPT_READ_CONFIG"); }

  let sampledAt = startedAt, hydratedRows = 0;
  let queue: Promise<void> = Promise.resolve();
  function checkpoint() {
    let now: number;
    try { now = clock(); } catch { throw new EvidenceReceiptReadError(); }
    if (typeof now !== "number" || !Number.isFinite(now) || now < sampledAt || now - startedAt >= maxElapsedMs) {
      throw new EvidenceReceiptReadError();
    }
    sampledAt = now;
  }
  function serialized<T>(read: () => Promise<T>): Promise<T> {
    const operation = queue.then(read);
    // One scope's overflow does not poison another scope's exact completion.
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async function* scan(tx: Prisma.TransactionClient, scope: ReceiptScope): AsyncIterable<EvidenceCommand> {
    let cursor: string | undefined;
    try {
      checkpoint();
      for (;;) {
        const page = await serialized(async () => {
          checkpoint();
          const remaining = maxRows - hydratedRows;
          if (remaining === 0) {
            const after = cursor === undefined ? Prisma.empty : Prisma.sql`AND "id" > ${cursor}`;
            // Prisma stores DateTime here as UTC civil TIMESTAMP(3). A raw Date
            // binds timestamptz, so compare ISO text as timestamp independently
            // of the database session's TimeZone, matching the ORM page scope.
            const timestamp = scope.createdAt === undefined ? Prisma.empty
              : Prisma.sql`AND "createdAt" = ${scope.createdAt.toISOString()}::timestamp(3)`;
            const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`SELECT EXISTS (
              SELECT 1 FROM "EvidenceCommand"
              WHERE "resourceType" = ${scope.resourceType} AND "resourceId" = ${scope.resourceId}
                AND "actorUserId" = ${scope.actorUserId} ${timestamp} ${after}
            ) AS "exists"`);
            checkpoint();
            if (rows.length !== 1 || typeof rows[0]?.exists !== "boolean" || rows[0].exists) throw new EvidenceReceiptReadError();
            return { rows: [], complete: true };
          }
          const take = Math.min(PAGE_ROWS, remaining);
          const rows = await tx.evidenceCommand.findMany({
            where: { resourceType: scope.resourceType, resourceId: scope.resourceId, actorUserId: scope.actorUserId,
              ...(scope.createdAt === undefined ? {} : { createdAt: scope.createdAt }),
              ...(cursor === undefined ? {} : { id: { gt: cursor } }) },
            orderBy: { id: "asc" }, take,
          });
          // Charge full hydration even if the deadline expires or the consumer
          // stops before every row in this page has been yielded.
          hydratedRows += rows.length;
          checkpoint();
          return { rows, complete: rows.length < take };
        });
        if (page.rows.length) cursor = page.rows[page.rows.length - 1]!.id;
        for (const row of page.rows) {
          checkpoint();
          yield row;
          checkpoint();
        }
        if (page.complete) return;
      }
    } finally {
      // Iterator cleanup also bounds predicate work before an early break.
      checkpoint();
    }
  }
  return {
    bounded: true,
    scan(tx, scope) {
      const captured = { resourceType: scope.resourceType, resourceId: scope.resourceId, actorUserId: scope.actorUserId,
        ...(scope.createdAt === undefined ? {} : { createdAt: new Date(scope.createdAt.getTime()) }) };
      return scan(tx, captured);
    },
    checkpoint,
  };
}
