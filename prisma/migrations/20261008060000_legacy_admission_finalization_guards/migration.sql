CREATE OR REPLACE FUNCTION infame_legacy_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m "LegacyAdmissionManifest"%ROWTYPE; count_entries integer; count_expected integer;
BEGIN
 SELECT * INTO m FROM "LegacyAdmissionManifest" WHERE id=NEW."manifestId" AND provenance=NEW.provenance AND digest=NEW.digest FOR UPDATE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Receipt manifest binding' USING ERRCODE='23514'; END IF;
 PERFORM "entryId" FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=NEW."manifestId" ORDER BY "entryId" FOR SHARE;
 SELECT count(*) INTO count_entries FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=NEW."manifestId";
 count_expected := jsonb_array_length(m.content->'entries');
 IF NEW."entryCount"<>count_expected OR count_entries<>count_expected THEN RAISE EXCEPTION 'Receipt manifest completeness' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM "LegacyAdmissionManifestEntry" e WHERE e."manifestId"=NEW."manifestId" AND NOT EXISTS
   (SELECT 1 FROM "LegacyDirectAdmissionVersion" v WHERE v.id=e."versionId" AND v."admissionId"=e."admissionId" AND v.provenance=e.provenance AND v.capability=e.capability AND v.version=e.version AND v."sourceHash"=e."sourceHash"))
   THEN RAISE EXCEPTION 'Receipt entry version completeness' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION infame_legacy_fresh_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "LegacyAdmissionManifestEntry"%ROWTYPE; r "LegacyAdmissionImportReceipt"%ROWTYPE; v "LegacyDirectAdmissionVersion"%ROWTYPE;
 d "Deal"%ROWTYPE; o "DealOffer"%ROWTYPE; c "DealCommand"%ROWTYPE; b "CampaignBrief"%ROWTYPE;
BEGIN
 SELECT * INTO e FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=NEW."manifestId" AND "entryId"=NEW."manifestEntryId" FOR SHARE;
 SELECT * INTO r FROM "LegacyAdmissionImportReceipt" WHERE id=NEW."importReceiptId" FOR SHARE;
 SELECT * INTO v FROM "LegacyDirectAdmissionVersion" WHERE id=NEW."versionId" FOR SHARE;
 SELECT * INTO d FROM "Deal" WHERE id=NEW."dealId" FOR SHARE;
 SELECT * INTO o FROM "DealOffer" WHERE id=NEW."firstOfferId" FOR SHARE;
 SELECT * INTO c FROM "DealCommand" WHERE id=NEW."createCommandId" FOR SHARE;
 SELECT * INTO b FROM "CampaignBrief" WHERE id=NEW."approvedBriefId" FOR SHARE;
 IF e."versionId" IS NULL OR r.id IS NULL OR v.id IS NULL OR d.id IS NULL OR o.id IS NULL OR c.id IS NULL OR b.id IS NULL
  OR r."manifestId" IS DISTINCT FROM NEW."manifestId" OR r.provenance IS DISTINCT FROM NEW.provenance OR r.digest IS DISTINCT FROM NEW.digest
  OR e."versionId" IS DISTINCT FROM NEW."versionId" OR e."admissionId" IS DISTINCT FROM NEW."admissionId" OR e.provenance IS DISTINCT FROM NEW.provenance OR e.version IS DISTINCT FROM NEW.version OR e."sourceHash" IS DISTINCT FROM NEW."sourceHash"
  OR v.capability IS DISTINCT FROM 'FRESH_PINNED_SCOPE' OR NEW.capability IS DISTINCT FROM 'FRESH_PINNED_SCOPE'
  OR d.id IS DISTINCT FROM NEW."dealId" OR o."dealId" IS DISTINCT FROM d.id OR o.version IS DISTINCT FROM 1
  OR o."proposerUserId" IS DISTINCT FROM NEW."brandUserId" OR o."recipientUserId" IS DISTINCT FROM NEW."creatorUserId"
  OR c."dealId" IS DISTINCT FROM d.id OR c."actorUserId" IS DISTINCT FROM NEW."brandUserId" OR c.operationKey IS DISTINCT FROM NEW."createOperationKey" OR c."payloadHash" IS DISTINCT FROM NEW."createPayloadHash"
  OR b.id IS DISTINCT FROM NEW."approvedBriefId" OR b.version IS DISTINCT FROM NEW."approvedBriefVersion"
  THEN RAISE EXCEPTION 'Fresh admission native binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
