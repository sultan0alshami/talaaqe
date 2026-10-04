import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

async function transaction(run: (client: Client, suffix: string) => Promise<void>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await run(client, randomUUID());
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

describe("canonical Infame database foundation", () => {
  it("stores Arabic and Unicode business text unchanged", async () => {
    await transaction(async (db, id) => {
      const original = "إنفيم — محتوى عربي 🌍";
      await db.query('INSERT INTO "User" (id,name,email,"passwordHash",role,"isTest") VALUES ($1,$2,$3,$4,\'CREATOR\',true)', [id, original, `${id}@example.invalid`, "not-a-login-hash"]);
      const stored = await db.query('SELECT name FROM "User" WHERE id=$1', [id]);
      expect(stored.rows[0].name).toBe(original);
      const encoding = await db.query("SHOW server_encoding");
      expect(encoding.rows[0].server_encoding).toBe("UTF8");
    });
  });
  it("maps roles and keeps inherited migration history", async () => {
    await transaction(async (db) => {
      const roles = await db.query("SELECT enumlabel FROM pg_enum WHERE enumtypid = '\"Role\"'::regtype ORDER BY enumsortorder");
      expect(roles.rows.map((row) => row.enumlabel)).toEqual(["BRAND", "CREATOR", "ADMIN"]);
      const migrations = await db.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
      expect(migrations.rows[0].count).toBeGreaterThanOrEqual(3);
    });
  });

  it("persists revocable sessions with default private, synthetic profiles", async () => {
    await transaction(async (db, id) => {
      await db.query('INSERT INTO "User" (id,name,email,"passwordHash",role,"isTest") VALUES ($1,$2,$3,$4,\'CREATOR\',true)', [id, "Synthetic creator", `${id}@example.invalid`, "not-a-login-hash"]);
      await db.query('INSERT INTO "Creator" (id,"userId",handle,"displayName","updatedAt") VALUES ($1,$1,$2,$3,NOW())', [id, `test_${id.replaceAll("-", "").slice(0, 24)}`, "Synthetic creator"]);
      const profile = await db.query('SELECT state,"isTest" FROM "Creator" WHERE id=$1', [id]);
      expect(profile.rows[0]).toEqual({ state: "DRAFT", isTest: true });
      const user = await db.query('SELECT "sessionVersion","emailVerifiedAt" FROM "User" WHERE id=$1', [id]);
      expect(user.rows[0]).toEqual({ sessionVersion: 1, emailVerifiedAt: null });
      await db.query('INSERT INTO "AuthSession" (id,"userId",version,"expiresAt") VALUES ($1,$1,1,NOW()+INTERVAL \'1 day\')', [id]);
      await db.query('UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id=$1', [id]);
      const current = await db.query('SELECT s.version=u."sessionVersion" AS valid FROM "AuthSession" s JOIN "User" u ON u.id=s."userId" WHERE s.id=$1', [id]);
      expect(current.rows[0].valid).toBe(false);
    });
  });

  it("enforces positive exact minor-unit rate amounts in PostgreSQL", async () => {
    await transaction(async (db, id) => {
      await db.query('INSERT INTO "Creator" (id,handle,"displayName","updatedAt") VALUES ($1,$2,$3,NOW())', [id, `test_${id.replaceAll("-", "").slice(0, 24)}`, "Unclaimed synthetic"]);
      await db.query('INSERT INTO "CreatorRate" (id,"creatorId",platform,format,currency,"amountMinor","updatedAt") VALUES ($1,$2,\'YOUTUBE\',\'VIDEO\',\'JPY\',9007199254740993,NOW())', [randomUUID(), id]);
      const amount = await db.query('SELECT "amountMinor"::text FROM "CreatorRate" WHERE "creatorId"=$1', [id]);
      expect(amount.rows[0].amountMinor).toBe("9007199254740993");
      await expect(db.query('INSERT INTO "CreatorRate" (id,"creatorId",platform,format,currency,"amountMinor","updatedAt") VALUES ($1,$2,\'YOUTUBE\',\'SHORT\',\'JPY\',-1,NOW())', [randomUUID(), id])).rejects.toMatchObject({ code: "23514" });
    });
  });
});
