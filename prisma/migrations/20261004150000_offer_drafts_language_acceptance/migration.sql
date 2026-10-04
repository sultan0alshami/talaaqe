ALTER TABLE "DealOffer" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "DealMessage" ADD COLUMN "language" TEXT;
ALTER TABLE "DealRating" ADD COLUMN "language" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "proposedTerms" JSONB;
ALTER TABLE "DealOffer" ADD CONSTRAINT "DealOffer_acceptance_date_check"
  CHECK ("acceptedAt" IS NULL OR (status = 'ACCEPTED' AND "acceptedAt" >= "createdAt"));
ALTER TABLE "DealMessage" ADD CONSTRAINT "DealMessage_language_check"
  CHECK (language IS NULL OR language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
ALTER TABLE "DealRating" ADD CONSTRAINT "DealRating_language_check"
  CHECK (language IS NULL OR language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

CREATE TABLE "OfferDraft" (
  id TEXT NOT NULL PRIMARY KEY,
  "actorUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "campaignId" TEXT NOT NULL REFERENCES "Campaign"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "creatorId" TEXT NOT NULL REFERENCES "Creator"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  terms JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "OfferDraft_actorUserId_campaignId_creatorId_key"
  ON "OfferDraft"("actorUserId", "campaignId", "creatorId");
CREATE UNIQUE INDEX "OfferDraft_id_actorUserId_key" ON "OfferDraft"(id, "actorUserId");
CREATE TABLE "OfferDraftCommand" (
  id TEXT NOT NULL PRIMARY KEY,
  "draftId" TEXT NOT NULL REFERENCES "OfferDraft"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "actorUserId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfferDraftCommand_owned_draft_fkey" FOREIGN KEY ("draftId", "actorUserId")
    REFERENCES "OfferDraft"(id, "actorUserId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OfferDraftCommand_actorUserId_operationKey_key"
  ON "OfferDraftCommand"("actorUserId", "operationKey");
CREATE UNIQUE INDEX "OfferDraftCommand_draftId_operationKey_key"
  ON "OfferDraftCommand"("draftId", "operationKey");

CREATE FUNCTION infame_offer_draft_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Campaign" c JOIN "Brand" b ON b.id = c."brandId"
    JOIN "Creator" cr ON cr.id = NEW."creatorId"
    WHERE c.id = NEW."campaignId"
      AND (b."userId" = NEW."actorUserId" OR cr."userId" = NEW."actorUserId")
  ) THEN
    RAISE EXCEPTION 'Offer draft actor must own a campaign brand or its proposed creator' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER infame_offer_draft_owner_guard BEFORE INSERT OR UPDATE ON "OfferDraft"
  FOR EACH ROW EXECUTE FUNCTION infame_offer_draft_owner();
