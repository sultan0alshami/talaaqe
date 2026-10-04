import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";
describe("PostgreSQL rate budget", () => {
  it("allows exactly the bounded number of concurrent requests", async () => {
    const key = `rate-test-${randomBytes(12).toString("hex")}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => rateLimit(key, 3, 60000)));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(results.filter((result) => !result.ok).every((result) => result.retryAfterSec > 0)).toBe(true);
    const bucket = await prisma.rateBucket.findUnique({ where: { key: createHash("sha256").update(key).digest("hex") } });
    expect(bucket?.count).toBe(4);
    await prisma.rateBucket.deleteMany({ where: { key: createHash("sha256").update(key).digest("hex") } });
  });
});
