ALTER TABLE "SocialAccount" ADD COLUMN "ownershipIdentityHash" TEXT CHECK ("ownershipIdentityHash" IS NULL OR "ownershipIdentityHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "SocialAccount" ADD COLUMN "fieldVisibility" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Deal" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'DIRECT' CHECK ("origin" IN ('MATCH','DIRECT','INVITE'));
ALTER TABLE "Deal" ADD COLUMN "matchRunId" TEXT REFERENCES "MatchRun"("id");
ALTER TABLE "Deal" ADD COLUMN "slotOrdinal" INTEGER CHECK ("slotOrdinal" BETWEEN 0 AND 11);
CREATE TABLE "DealCommand" (
  "id" TEXT PRIMARY KEY,
  "dealId" TEXT NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
  "actorUserId" TEXT NOT NULL REFERENCES "User"("id"),
  "operationKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DealCommand_actorUserId_operationKey_key" ON "DealCommand"("actorUserId", "operationKey");
CREATE UNIQUE INDEX "DealCommand_dealId_operationKey_key" ON "DealCommand"("dealId", "operationKey");
CREATE TABLE "PolicyVersion" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('MARKET','GOVERNING_TERMS','PHONE_FALLBACK')),
  "countryCodes" TEXT[] NOT NULL,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "content" JSONB NOT NULL,
  "evidenceAssetId" TEXT,
  "reviewedBy" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "reviewedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PolicyVersion_kind_status_idx" ON "PolicyVersion"("kind", "status");
CREATE OR REPLACE FUNCTION infame_approved_portfolio_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."approvedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'approved portfolio is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER infame_creator_portfolio_immutable BEFORE UPDATE ON "PortfolioVersion" FOR EACH ROW EXECUTE FUNCTION infame_approved_portfolio_immutable();
CREATE TRIGGER infame_brand_portfolio_immutable BEFORE UPDATE ON "BrandPortfolioVersion" FOR EACH ROW EXECUTE FUNCTION infame_approved_portfolio_immutable();
CREATE OR REPLACE FUNCTION infame_reviewed_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='VERIFIED' AND (NEW.id, NEW.kind, NEW."countryCodes", NEW.content, NEW."evidenceAssetId", NEW."reviewedBy", NEW."reviewedAt", NEW."expiresAt") IS DISTINCT FROM (OLD.id, OLD.kind, OLD."countryCodes", OLD.content, OLD."evidenceAssetId", OLD."reviewedBy", OLD."reviewedAt", OLD."expiresAt") THEN
    RAISE EXCEPTION 'reviewed policy content is immutable; create a new version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER infame_reviewed_policy_immutable BEFORE UPDATE ON "PolicyVersion" FOR EACH ROW EXECUTE FUNCTION infame_reviewed_policy_immutable();
