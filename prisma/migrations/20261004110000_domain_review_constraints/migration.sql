-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "brandVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "profileFacts" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "MetricsSnapshot" ADD COLUMN     "engagementContext" JSONB,
ADD COLUMN     "formatMetrics" JSONB;

-- AlterTable
ALTER TABLE "FactCorrection" ADD COLUMN     "brandVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AdvertisingLicence" ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "reviewMethod" TEXT;

-- CreateTable
CREATE TABLE "MatchDecisionRecord" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'NONE',
    "runId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchDecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchDecisionRecord_campaignId_creatorId_key" ON "MatchDecisionRecord"("campaignId", "creatorId");

-- Independent review: one accepted owner per real external identity.
CREATE UNIQUE INDEX "SocialAccount_verified_provider_identity" ON "SocialAccount" (platform,"providerAccountId")
  WHERE "ownershipStatus"='VERIFIED' AND "providerAccountId" IS NOT NULL;
CREATE UNIQUE INDEX "SocialAccount_verified_handle_identity" ON "SocialAccount" (platform,lower(handle))
  WHERE "ownershipStatus"='VERIFIED';
ALTER TABLE "Creator" DROP CONSTRAINT "Creator_handle_normalized";
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_handle_normalized" CHECK (handle ~ '^[a-z0-9][a-z0-9_]{2,29}$');
ALTER TABLE "Brand" DROP CONSTRAINT "Brand_slug_normalized";
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_slug_normalized" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 50);
ALTER TABLE "DealOffer" ADD CONSTRAINT "DealOffer_status_valid" CHECK (status IN ('PENDING','SUPERSEDED','ACCEPTED','DECLINED','CANCELLED'));
ALTER TABLE "AgreementSnapshot" ADD CONSTRAINT "AgreementSnapshot_offer_version" FOREIGN KEY ("dealId","offerVersion") REFERENCES "DealOffer" ("dealId",version);
CREATE UNIQUE INDEX "AgreementSnapshot_one_per_offer" ON "AgreementSnapshot" ("dealId","offerVersion");
ALTER TABLE "AgreementConfirmation" ADD CONSTRAINT "AgreementConfirmation_actor" FOREIGN KEY ("userId") REFERENCES "User" (id);
ALTER TABLE "DealRating" ADD CONSTRAINT "DealRating_actor" FOREIGN KEY ("userId") REFERENCES "User" (id);
ALTER TABLE "DealOffer" ADD CONSTRAINT "DealOffer_proposer" FOREIGN KEY ("proposerUserId") REFERENCES "User" (id);
ALTER TABLE "DealOffer" ADD CONSTRAINT "DealOffer_recipient" FOREIGN KEY ("recipientUserId") REFERENCES "User" (id);
ALTER TABLE "DealMessage" ADD CONSTRAINT "DealMessage_actor" FOREIGN KEY ("senderUserId") REFERENCES "User" (id);
ALTER TABLE "MatchDecisionRecord" ADD CONSTRAINT "MatchDecisionRecord_campaign" FOREIGN KEY ("campaignId") REFERENCES "Campaign" (id) ON DELETE CASCADE;
ALTER TABLE "MatchDecisionRecord" ADD CONSTRAINT "MatchDecisionRecord_creator" FOREIGN KEY ("creatorId") REFERENCES "Creator" (id) ON DELETE CASCADE;
ALTER TABLE "MatchDecisionRecord" ADD CONSTRAINT "MatchDecisionRecord_actor" FOREIGN KEY ("actorUserId") REFERENCES "User" (id);
ALTER TABLE "MatchDecisionRecord" ADD CONSTRAINT "MatchDecisionRecord_decision" CHECK (decision IN ('NONE','SAVED','DISMISSED','OFFER_SENT'));

CREATE FUNCTION infame_deal_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE brand_user text; creator_user text; actor text; actor_role text;
BEGIN
  SELECT b."userId",c."userId" INTO brand_user,creator_user FROM "Deal" d
    JOIN "Brand" b ON b.id=d."brandId" JOIN "Creator" c ON c.id=d."creatorId" WHERE d.id=NEW."dealId";
  IF TG_TABLE_NAME='DealOffer' THEN
    IF creator_user IS NULL OR NOT ((NEW."proposerUserId"=brand_user AND NEW."recipientUserId"=creator_user)
      OR (NEW."proposerUserId"=creator_user AND NEW."recipientUserId"=brand_user)) THEN
      RAISE EXCEPTION 'Offer actors must be opposite deal participants' USING ERRCODE='23514';
    END IF;
  ELSE
    actor := CASE WHEN TG_TABLE_NAME='DealMessage' THEN NEW."senderUserId" ELSE NEW."userId" END;
    IF TG_TABLE_NAME IN ('AgreementConfirmation','DealRating') THEN
      actor_role := NEW.role::text;
      IF NOT ((actor_role='BRAND' AND actor=brand_user) OR (actor_role='CREATOR' AND actor=creator_user)) THEN
        RAISE EXCEPTION 'Actor role must belong to deal participant' USING ERRCODE='23514';
      END IF;
    ELSIF actor IS DISTINCT FROM brand_user AND actor IS DISTINCT FROM creator_user THEN
      RAISE EXCEPTION 'Message actor must belong to deal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DealOffer_participants" BEFORE INSERT OR UPDATE ON "DealOffer" FOR EACH ROW EXECUTE FUNCTION infame_deal_participant();
CREATE TRIGGER "DealMessage_participant" BEFORE INSERT OR UPDATE ON "DealMessage" FOR EACH ROW EXECUTE FUNCTION infame_deal_participant();
CREATE TRIGGER "DealRating_participant" BEFORE INSERT OR UPDATE ON "DealRating" FOR EACH ROW EXECUTE FUNCTION infame_deal_participant();
CREATE TRIGGER "AgreementConfirmation_participant" BEFORE INSERT OR UPDATE ON "AgreementConfirmation" FOR EACH ROW EXECUTE FUNCTION infame_deal_participant();

