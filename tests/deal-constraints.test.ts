import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
describe("deal participant database constraints", () => {
  it("accepts each real table shape and rejects outsider actors or reversed role claims", async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    await db.connect();
    try {
      await db.query("BEGIN");
      const brand = randomUUID(), creator = randomUUID(), outsider = randomUUID(), campaign = randomUUID(), deal = randomUUID();
      for (const [id, role] of [[brand, "BRAND"], [creator, "CREATOR"], [outsider, "CREATOR"]]) {
        await db.query('INSERT INTO "User" (id,name,email,"passwordHash",role,"isTest") VALUES ($1,$2,$3,$4,$5,true)', [id, "Synthetic deal actor", `${id}@example.invalid`, "not-a-login-hash", role]);
      }
      await db.query('INSERT INTO "Brand" (id,"userId",slug,name,"updatedAt") VALUES ($1,$1,$2,$3,NOW())', [brand, `brand-${brand.slice(0, 8)}`, "Synthetic brand"]);
      await db.query('INSERT INTO "Creator" (id,"userId",handle,"displayName","updatedAt") VALUES ($1,$1,$2,$3,NOW())', [creator, `creator_${creator.slice(0, 8)}`, "Synthetic creator"]);
      await db.query('INSERT INTO "Campaign" (id,"brandId",title,input,"updatedAt") VALUES ($1,$2,$3,$4,NOW())', [campaign, brand, "Synthetic campaign", {}]);
      await db.query('INSERT INTO "Deal" (id,"campaignId","creatorId","brandId","briefVersion","updatedAt") VALUES ($1,$2,$3,$4,1,NOW())', [deal, campaign, creator, brand]);
      await db.query('INSERT INTO "DealOffer" (id,"dealId",version,"proposerUserId","recipientUserId",terms) VALUES ($1,$2,1,$3,$4,$5)', [randomUUID(), deal, brand, creator, {}]);
      await db.query('INSERT INTO "AgreementSnapshot" (id,"dealId",version,"offerVersion","briefVersion",content) VALUES ($1,$2,1,1,1,$3)', [randomUUID(), deal, {}]);
      await db.query('INSERT INTO "AgreementConfirmation" (id,"dealId",version,"userId",role) VALUES ($1,$2,1,$3,\'BRAND\')', [randomUUID(), deal, brand]);
      await db.query('INSERT INTO "DealRating" (id,"dealId","userId",role,score) VALUES ($1,$2,$3,\'CREATOR\',5)', [randomUUID(), deal, creator]);
      await db.query('INSERT INTO "DealMessage" (id,"dealId","senderUserId",text) VALUES ($1,$2,$3,$4)', [randomUUID(), deal, creator, "Synthetic original message"]);
      for (const [statement, parameters] of [
        ['INSERT INTO "AgreementConfirmation" (id,"dealId",version,"userId",role) VALUES ($1,$2,1,$3,\'BRAND\')', [randomUUID(), deal, outsider]],
        ['INSERT INTO "DealRating" (id,"dealId","userId",role,score) VALUES ($1,$2,$3,\'BRAND\',5)', [randomUUID(), deal, creator]],
        ['INSERT INTO "DealMessage" (id,"dealId","senderUserId",text) VALUES ($1,$2,$3,$4)', [randomUUID(), deal, outsider, "Denied"]],
      ] as const) {
        await db.query("SAVEPOINT denial");
        await expect(db.query(statement, [...parameters])).rejects.toMatchObject({ code: "23514" });
        await db.query("ROLLBACK TO SAVEPOINT denial");
      }
      await db.query('UPDATE "Creator" SET "userId"=NULL WHERE id=$1', [creator]);
      for (const statement of [
        'INSERT INTO "AgreementConfirmation" (id,"dealId",version,"userId",role) VALUES ($1,$2,1,$3,\'CREATOR\')',
        'INSERT INTO "DealRating" (id,"dealId","userId",role,score) VALUES ($1,$2,$3,\'CREATOR\',5)',
      ]) {
        await db.query("SAVEPOINT unclaimed");
        await expect(db.query(statement, [randomUUID(), deal, outsider])).rejects.toMatchObject({ code: "23514" });
        await db.query("ROLLBACK TO SAVEPOINT unclaimed");
      }
    } finally { await db.query("ROLLBACK"); await db.end(); }
  });
});
