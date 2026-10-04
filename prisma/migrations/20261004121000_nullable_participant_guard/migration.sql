CREATE OR REPLACE FUNCTION infame_deal_participant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE brand_user text; creator_user text; actor text; actor_role text;
BEGIN
  SELECT b."userId",c."userId" INTO brand_user,creator_user FROM "Deal" d
    JOIN "Brand" b ON b.id=d."brandId" JOIN "Creator" c ON c.id=d."creatorId" WHERE d.id=NEW."dealId";
  IF TG_TABLE_NAME='DealOffer' THEN
    IF creator_user IS NULL OR (((NEW."proposerUserId"=brand_user AND NEW."recipientUserId"=creator_user)
      OR (NEW."proposerUserId"=creator_user AND NEW."recipientUserId"=brand_user)) IS NOT TRUE) THEN
      RAISE EXCEPTION 'Offer actors must be opposite deal participants' USING ERRCODE='23514';
    END IF;
  ELSE
    IF TG_TABLE_NAME='DealMessage' THEN actor := NEW."senderUserId"; ELSE actor := NEW."userId"; END IF;
    IF TG_TABLE_NAME IN ('AgreementConfirmation','DealRating') THEN
      actor_role := NEW.role::text;
      IF (((actor_role='BRAND' AND actor=brand_user) OR (actor_role='CREATOR' AND actor=creator_user)) IS NOT TRUE) THEN
        RAISE EXCEPTION 'Actor role must belong to deal participant' USING ERRCODE='23514';
      END IF;
    ELSIF actor IS DISTINCT FROM brand_user AND actor IS DISTINCT FROM creator_user THEN
      RAISE EXCEPTION 'Message actor must belong to deal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
