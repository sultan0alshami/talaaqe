ALTER TABLE "SocialAccount" ADD COLUMN "evidenceRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("evidenceRevision" > 0);
ALTER TABLE "MetricsSnapshot" ADD COLUMN "supersedesId" TEXT;
CREATE UNIQUE INDEX "MetricsSnapshot_accountId_id_key" ON "MetricsSnapshot"("accountId", id);
ALTER TABLE "MetricsSnapshot" ADD CONSTRAINT "MetricsSnapshot_supersedes_same_account_fkey"
  FOREIGN KEY ("accountId", "supersedesId") REFERENCES "MetricsSnapshot"("accountId", id) ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MetricsSnapshot" ADD CONSTRAINT "MetricsSnapshot_not_self_superseding" CHECK ("supersedesId" IS NULL OR "supersedesId" <> id);
ALTER TABLE "FactCorrection" ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE "AdvertisingLicence" ADD COLUMN type TEXT, ADD COLUMN scope TEXT, ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE "BusinessVerification" ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE "BusinessVerification" ADD CONSTRAINT "BusinessVerification_kind_check" CHECK (kind IN ('REPRESENTATIVE', 'BUSINESS_REGISTRATION'));
ALTER TABLE "PrivateAsset" ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE TABLE "EvidenceCommand" (
  id TEXT NOT NULL PRIMARY KEY,
  "actorUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "operationKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "resultJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "EvidenceCommand_actorUserId_operationKey_key" ON "EvidenceCommand"("actorUserId", "operationKey");
CREATE UNIQUE INDEX "EvidenceCommand_resourceType_resourceId_operationKey_key" ON "EvidenceCommand"("resourceType", "resourceId", "operationKey");
CREATE TABLE "OwnershipChallenge" (
  id TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES "SocialAccount"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "ownerUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  identity JSONB NOT NULL,
  "identityHash" TEXT NOT NULL CHECK ("identityHash" ~ '^[a-f0-9]{64}$'),
  "mappingRevision" INTEGER NOT NULL CHECK ("mappingRevision" > 0),
  "challengeCode" TEXT NOT NULL CHECK (char_length("challengeCode") BETWEEN 8 AND 100),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "proofAssetId" TEXT REFERENCES "PrivateAsset"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnershipChallenge_dates_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "OwnershipChallenge_accepted_review_check" CHECK (status <> 'VERIFIED' OR ("proofAssetId" IS NOT NULL AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "submittedAt" IS NOT NULL))
);
CREATE INDEX "OwnershipChallenge_ownerUserId_status_idx" ON "OwnershipChallenge"("ownerUserId", status);
CREATE UNIQUE INDEX "OwnershipChallenge_one_pending_account" ON "OwnershipChallenge"("accountId") WHERE status IN ('PENDING', 'NEEDS_RECHECK');
CREATE OR REPLACE FUNCTION infame_reviewed_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."reviewedAt" IS NOT NULL AND (NEW.id, NEW.kind, NEW."countryCodes", NEW.content, NEW."evidenceAssetId", NEW."reviewedBy", NEW."reviewedAt", NEW."expiresAt", NEW."createdAt") IS DISTINCT FROM (OLD.id, OLD.kind, OLD."countryCodes", OLD.content, OLD."evidenceAssetId", OLD."reviewedBy", OLD."reviewedAt", OLD."expiresAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'previously reviewed policy is immutable; create a new version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION infame_private_asset_metadata_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW."ownerUserId", NEW.purpose, NEW."contentType", NEW.size, NEW."storageKey", NEW.checksum, NEW."createdAt") IS DISTINCT FROM (OLD.id, OLD."ownerUserId", OLD.purpose, OLD."contentType", OLD.size, OLD."storageKey", OLD.checksum, OLD."createdAt") THEN
    RAISE EXCEPTION 'asset storage metadata is immutable; upload a new asset' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER infame_private_asset_metadata_immutable BEFORE UPDATE ON "PrivateAsset" FOR EACH ROW EXECUTE FUNCTION infame_private_asset_metadata_immutable();
