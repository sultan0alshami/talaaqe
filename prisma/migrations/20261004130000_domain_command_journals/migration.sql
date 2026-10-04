-- Additive journals; no inherited or task data is removed.
ALTER TABLE "Brand" ADD COLUMN "profileFacts" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "CampaignBrief" ADD COLUMN "approvedByUserId" TEXT REFERENCES "User"("id");
ALTER TABLE "MatchDecisionRecord" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0);

CREATE TABLE "BrandPortfolioVersion" (
  "id" TEXT PRIMARY KEY,
  "brandId" TEXT NOT NULL REFERENCES "Brand"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "content" JSONB NOT NULL,
  "inputRevision" INTEGER NOT NULL CHECK ("inputRevision" > 0),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BrandPortfolioVersion_brandId_version_key" ON "BrandPortfolioVersion"("brandId", "version");

CREATE TABLE "CampaignCommand" (
  "id" TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "operationKey" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL REFERENCES "User"("id"),
  "payloadHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CampaignCommand_campaignId_operationKey_key" ON "CampaignCommand"("campaignId", "operationKey");
CREATE UNIQUE INDEX "CampaignCommand_actorUserId_operationKey_key" ON "CampaignCommand"("actorUserId", "operationKey");
CREATE TABLE "MatchCommand" (
  "id" TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "operationKey" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL REFERENCES "User"("id"),
  "payloadHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MatchCommand_campaignId_operationKey_key" ON "MatchCommand"("campaignId", "operationKey");
CREATE OR REPLACE FUNCTION infame_campaign_command_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Campaign" c JOIN "Brand" b ON b.id=c."brandId" WHERE c.id=NEW."campaignId" AND b."userId"=NEW."actorUserId") THEN
    RAISE EXCEPTION 'campaign command actor must own brand' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER infame_campaign_command_actor BEFORE INSERT OR UPDATE ON "CampaignCommand" FOR EACH ROW EXECUTE FUNCTION infame_campaign_command_owner();
CREATE TRIGGER infame_match_command_actor BEFORE INSERT OR UPDATE ON "MatchCommand" FOR EACH ROW EXECUTE FUNCTION infame_campaign_command_owner();
CREATE OR REPLACE FUNCTION infame_match_decision_run_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."runId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "MatchRun" WHERE id=NEW."runId" AND "campaignId"=NEW."campaignId") THEN
    RAISE EXCEPTION 'match decision run must belong to campaign' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER infame_match_decision_run_scope BEFORE INSERT OR UPDATE ON "MatchDecisionRecord" FOR EACH ROW EXECUTE FUNCTION infame_match_decision_run_scope();
