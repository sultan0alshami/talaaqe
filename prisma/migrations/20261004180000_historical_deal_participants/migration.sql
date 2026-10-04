-- Negotiation history binds its initial real participants. A later profile claim
-- cannot gain historical messages or prevent the original brand cancelling.
CREATE OR REPLACE FUNCTION infame_deal_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE brand_user text; creator_user text; original_brand text; original_creator text; actor text; actor_role text;
BEGIN
  SELECT b."userId",c."userId" INTO brand_user,creator_user FROM "Deal" d
    JOIN "Brand" b ON b.id=d."brandId" JOIN "Creator" c ON c.id=d."creatorId" WHERE d.id=NEW."dealId";
  SELECT "proposerUserId","recipientUserId" INTO original_brand,original_creator
    FROM "DealOffer" WHERE "dealId"=NEW."dealId" AND version=1;
  IF TG_TABLE_NAME='DealOffer' THEN
    IF TG_OP='UPDATE' THEN
      IF ROW(NEW.id,NEW."dealId",NEW.version,NEW."proposerUserId",NEW."recipientUserId",NEW.terms,NEW."createdAt")
        IS DISTINCT FROM ROW(OLD.id,OLD."dealId",OLD.version,OLD."proposerUserId",OLD."recipientUserId",OLD.terms,OLD."createdAt") THEN
        RAISE EXCEPTION 'Offer history is immutable; counter with a new version' USING ERRCODE='23514';
      END IF;
      IF NOT (NEW.status=OLD.status OR (OLD.status='PENDING' AND NEW.status IN ('SUPERSEDED','ACCEPTED','DECLINED','CANCELLED'))) THEN
        RAISE EXCEPTION 'Invalid historical offer transition' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.version=1 THEN
      IF ((NEW."proposerUserId"=brand_user AND NEW."recipientUserId"=creator_user AND creator_user IS NOT NULL) IS NOT TRUE) THEN
        RAISE EXCEPTION 'Initial offer must be from brand to current creator' USING ERRCODE='23514';
      END IF;
    ELSIF (original_brand IS DISTINCT FROM brand_user OR original_creator IS DISTINCT FROM creator_user)
      OR (((NEW."proposerUserId"=original_brand AND NEW."recipientUserId"=original_creator)
        OR (NEW."proposerUserId"=original_creator AND NEW."recipientUserId"=original_brand)) IS NOT TRUE) THEN
      RAISE EXCEPTION 'Counter must retain original current participants' USING ERRCODE='23514';
    END IF;
  ELSE
    IF TG_TABLE_NAME='DealMessage' THEN actor := NEW."senderUserId"; ELSE actor := NEW."userId"; END IF;
    IF original_brand IS NULL OR original_creator IS NULL THEN
      RAISE EXCEPTION 'Original deal participants are required' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME IN ('AgreementConfirmation','DealRating') THEN
      actor_role := NEW.role::text;
      IF original_brand IS DISTINCT FROM brand_user OR original_creator IS DISTINCT FROM creator_user
        OR (((actor_role='BRAND' AND actor=original_brand) OR (actor_role='CREATOR' AND actor=original_creator)) IS NOT TRUE) THEN
        RAISE EXCEPTION 'Commercial actor must retain original current ownership' USING ERRCODE='23514';
      END IF;
    ELSIF actor IS DISTINCT FROM original_brand AND actor IS DISTINCT FROM original_creator THEN
      RAISE EXCEPTION 'Message actor must be an original deal participant' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
