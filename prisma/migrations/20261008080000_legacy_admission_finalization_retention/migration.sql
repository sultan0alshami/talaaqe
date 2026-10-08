-- Retained storage only; canonical producer/trust verification remains a runtime prerequisite.
CREATE OR REPLACE FUNCTION infame_legacy_manifest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item JSONB; reference JSONB; instant TIMESTAMP(3); raw_instant TEXT;
BEGIN
 IF jsonb_typeof(NEW.content) IS DISTINCT FROM 'object'
  OR NEW.content-ARRAY['schemaVersion','manifestId','provenance','createdAt','reviewReferenceOriginal','entries']<>'{}'::jsonb
  OR NEW.content->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR NEW.content->'manifestId' IS DISTINCT FROM to_jsonb(NEW.id)
  OR NEW.content->'provenance' IS DISTINCT FROM to_jsonb(NEW.provenance)
  OR jsonb_typeof(NEW.content->'createdAt') IS DISTINCT FROM 'string'
  OR jsonb_typeof(NEW.content->'reviewReferenceOriginal') IS DISTINCT FROM 'object'
  OR jsonb_typeof(NEW.content->'entries') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Manifest declaration binding' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(NEW.content->'entries') NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Manifest declaration entry count' USING ERRCODE='23514'; END IF;
 raw_instant:=NEW.content->>'createdAt';
 IF raw_instant !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' THEN
  RAISE EXCEPTION 'Manifest UTC instant shape' USING ERRCODE='23514'; END IF;
 BEGIN instant:=raw_instant::timestamp(3);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Manifest UTC instant' USING ERRCODE='23514'; END;
 IF instant<TIMESTAMP '0001-01-01' OR instant>=TIMESTAMP '10000-01-01'
  OR (to_char(instant,'YYYY-MM-DD"T"HH24:MI:SS.MS')||'Z') IS DISTINCT FROM
   (CASE WHEN position('.' in raw_instant)>0 THEN raw_instant ELSE replace(raw_instant,'Z','.000Z') END)
  OR instant IS DISTINCT FROM NEW."createdAt" THEN
  RAISE EXCEPTION 'Manifest canonical UTC binding' USING ERRCODE='23514'; END IF;
 reference:=NEW.content->'reviewReferenceOriginal';
 IF reference-ARRAY['text','language']<>'{}'::jsonb OR jsonb_typeof(reference->'text') IS DISTINCT FROM 'string'
  OR char_length(reference->>'text') NOT BETWEEN 1 AND 2000 OR (reference->>'text') !~ '[^[:space:]]'
  OR (reference->>'text') ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  OR NOT(reference ? 'language') OR jsonb_typeof(reference->'language') NOT IN ('string','null')
  OR (jsonb_typeof(reference->'language')='string' AND (char_length(reference->>'language') NOT BETWEEN 2 AND 100
   OR (reference->>'language') !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$')) THEN
  RAISE EXCEPTION 'Manifest original reference shape' USING ERRCODE='23514'; END IF;
 -- Full Intl BCP47 validity and canonical producer digests remain runtime checks.
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'entries') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['entryId','admissionId','version','sourceHash']<>'{}'::jsonb
   OR jsonb_typeof(item->'entryId') IS DISTINCT FROM 'string' OR (item->>'entryId') COLLATE "C" !~ '^[!-~]{1,200}$'
   OR jsonb_typeof(item->'admissionId') IS DISTINCT FROM 'string' OR (item->>'admissionId') COLLATE "C" !~ '^[!-~]{1,200}$'
   OR jsonb_typeof(item->'version') IS DISTINCT FROM 'number' OR (item->>'version') !~ '^[1-9][0-9]*$'
   OR (item->>'version')::numeric NOT BETWEEN 1 AND 2147483646
   OR jsonb_typeof(item->'sourceHash') IS DISTINCT FROM 'string' OR (item->>'sourceHash') !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Manifest declaration entry' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'entryId') FROM jsonb_array_elements(NEW.content->'entries'))<>jsonb_array_length(NEW.content->'entries')
  OR (SELECT count(DISTINCT jsonb_build_array(value->'admissionId',value->'version')) FROM jsonb_array_elements(NEW.content->'entries'))<>jsonb_array_length(NEW.content->'entries') THEN
  RAISE EXCEPTION 'Manifest duplicate declaration' USING ERRCODE='23514'; END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Manifest declaration value' USING ERRCODE='23514';
END $$;

CREATE FUNCTION infame_legacy_finalization_isolation() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') THEN
  RAISE EXCEPTION 'Unsupported finalization transaction isolation' USING ERRCODE='23514'; END IF;
END $$;

-- Metadata discovery takes no row locks. Native sources precede retained parents.
CREATE FUNCTION infame_legacy_finalization_sources(version_ids TEXT[], new_deal TEXT DEFAULT NULL,
 new_offer TEXT DEFAULT NULL,new_brief TEXT DEFAULT NULL,new_command TEXT DEFAULT NULL,
 new_brand_user TEXT DEFAULT NULL,new_creator_user TEXT DEFAULT NULL,no_wait BOOLEAN DEFAULT FALSE) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source RECORD; ids TEXT[];
BEGIN
 IF no_wait THEN
  -- DELETE has already locked its tuple. Never wait on any earlier lock in
  -- the global order; the controlled complete cleanup prelocks these rows.
  FOR source IN SELECT * FROM (VALUES
   ('User',ARRAY(SELECT p."brandUserId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids)
     UNION SELECT p."creatorUserId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids))),
   ('Brand',ARRAY(SELECT p."brandId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids))),
   ('Creator',ARRAY(SELECT p."creatorId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids))),
   ('Campaign',ARRAY(SELECT p."campaignId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids))),
   ('Deal',ARRAY(SELECT "existingDealId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids))),
   ('DealOffer',ARRAY(SELECT "firstOfferId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids))),
   ('CampaignBrief',ARRAY(SELECT "approvedBriefId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids))),
   ('CampaignCommand',ARRAY(SELECT "campaignCommandId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids))),
   ('DealCommand',ARRAY(SELECT "dealCommandId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids)))
  ) AS inventory(table_name,row_ids) LOOP
   ids:=source.row_ids;
   EXECUTE format('SELECT id FROM %I WHERE id=ANY($1) ORDER BY id FOR SHARE NOWAIT',source.table_name) USING ids;
  END LOOP;
  RETURN;
 END IF;
 PERFORM id FROM "User" WHERE id IN (new_brand_user,new_creator_user) OR id IN (
  SELECT p."brandUserId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids)
  UNION SELECT p."creatorUserId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids)
 ) ORDER BY id FOR SHARE;
 PERFORM id FROM "Brand" WHERE id IN (SELECT p."brandId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids)) ORDER BY id FOR SHARE;
 PERFORM id FROM "Creator" WHERE id IN (SELECT p."creatorId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids)) ORDER BY id FOR SHARE;
 PERFORM id FROM "Campaign" WHERE id IN (SELECT p."campaignId" FROM "LegacyDirectAdmission" p JOIN "LegacyDirectAdmissionVersion" v ON v."admissionId"=p.id WHERE v.id=ANY(version_ids)) ORDER BY id FOR SHARE;
 PERFORM id FROM "Deal" WHERE id=new_deal OR id IN (SELECT "existingDealId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids)) ORDER BY id FOR SHARE;
 PERFORM id FROM "DealOffer" WHERE id=new_offer OR id IN (SELECT "firstOfferId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids)) ORDER BY id FOR SHARE;
 PERFORM id FROM "CampaignBrief" WHERE id=new_brief OR id IN (SELECT "approvedBriefId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids)) ORDER BY id FOR SHARE;
 PERFORM id FROM "CampaignCommand" WHERE id IN (SELECT "campaignCommandId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids)) ORDER BY id FOR SHARE;
 PERFORM id FROM "DealCommand" WHERE id=new_command OR id IN (SELECT "dealCommandId" FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids)) ORDER BY id FOR SHARE;
END $$;

CREATE FUNCTION infame_legacy_finalization_manifest(manifest_id TEXT,extra_version TEXT DEFAULT NULL,
 new_deal TEXT DEFAULT NULL,new_offer TEXT DEFAULT NULL,new_brief TEXT DEFAULT NULL,new_command TEXT DEFAULT NULL,
 new_brand_user TEXT DEFAULT NULL,new_creator_user TEXT DEFAULT NULL,no_wait BOOLEAN DEFAULT FALSE)
 RETURNS "LegacyAdmissionManifest" LANGUAGE plpgsql AS $$
DECLARE captured "LegacyAdmissionManifest"%ROWTYPE; locked "LegacyAdmissionManifest"%ROWTYPE;
 version_ids TEXT[]; current_ids TEXT[]; parent_ids TEXT[];
BEGIN
 PERFORM infame_legacy_finalization_isolation();
 SELECT * INTO captured FROM "LegacyAdmissionManifest" WHERE id=manifest_id;
 IF captured.id IS NULL THEN RAISE EXCEPTION 'Manifest parent missing' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::TEXT[]) INTO version_ids FROM "LegacyDirectAdmissionVersion"
  WHERE ("manifestId"=manifest_id AND "admissionId" IN (SELECT value->>'admissionId' FROM jsonb_array_elements(captured.content->'entries'))) OR id=extra_version;
 SELECT COALESCE(array_agg(DISTINCT "admissionId" ORDER BY "admissionId"),ARRAY[]::TEXT[]) INTO parent_ids FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids);
 PERFORM infame_legacy_finalization_sources(version_ids,new_deal,new_offer,new_brief,new_command,new_brand_user,new_creator_user,no_wait);
 IF no_wait THEN
  PERFORM id FROM "LegacyDirectAdmission" WHERE id=ANY(parent_ids) ORDER BY id FOR UPDATE NOWAIT;
  PERFORM id FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids) ORDER BY id FOR SHARE NOWAIT;
  SELECT * INTO locked FROM "LegacyAdmissionManifest" WHERE id=manifest_id FOR UPDATE NOWAIT;
 ELSE
  PERFORM id FROM "LegacyDirectAdmission" WHERE id=ANY(parent_ids) ORDER BY id FOR UPDATE;
  PERFORM id FROM "LegacyDirectAdmissionVersion" WHERE id=ANY(version_ids) ORDER BY id FOR SHARE;
  SELECT * INTO locked FROM "LegacyAdmissionManifest" WHERE id=manifest_id FOR UPDATE;
 END IF;
 SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::TEXT[]) INTO current_ids FROM "LegacyDirectAdmissionVersion"
  WHERE ("manifestId"=manifest_id AND "admissionId" IN (SELECT value->>'admissionId' FROM jsonb_array_elements(locked.content->'entries'))) OR id=extra_version;
 IF locked.id IS NULL OR to_jsonb(locked) IS DISTINCT FROM to_jsonb(captured) OR current_ids IS DISTINCT FROM version_ids
  OR EXISTS(SELECT 1 FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=manifest_id AND NOT("versionId"=ANY(version_ids))) THEN
  RAISE EXCEPTION 'Manifest captured inventory changed' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "LegacyDirectAdmissionVersion" v JOIN "LegacyDirectAdmission" p ON p.id=v."admissionId"
  LEFT JOIN "CampaignBrief" b ON b.id=v."approvedBriefId" LEFT JOIN "CampaignCommand" c ON c.id=v."campaignCommandId"
  LEFT JOIN "DealCommand" dc ON dc.id=v."dealCommandId" LEFT JOIN "Deal" d ON d.id=v."existingDealId" LEFT JOIN "DealOffer" o ON o.id=v."firstOfferId"
  WHERE v.id=ANY(version_ids) AND (
   b.id IS NULL OR b."campaignId" IS DISTINCT FROM p."campaignId" OR b.version IS DISTINCT FROM v."approvedBriefVersion"
   OR b."inputRevision" IS DISTINCT FROM v."approvedInputRevision" OR b."approvedByUserId" IS DISTINCT FROM p."brandUserId"
   OR b."approvedByUserId" IS DISTINCT FROM v."approvedByUserId" OR b."approvedAt" IS NULL OR v."sourceActorUserId" IS DISTINCT FROM p."brandUserId"
   OR (v.capability='FRESH_PINNED_SCOPE' AND (c.id IS NULL OR c."campaignId" IS DISTINCT FROM p."campaignId" OR c."actorUserId" IS DISTINCT FROM v."sourceActorUserId" OR c."operationKey" IS DISTINCT FROM v."sourceOperationKey" OR c."payloadHash" IS DISTINCT FROM v."sourcePayloadHash"))
   OR (v.capability='CONTINUE_PINNED_DEAL' AND (dc.id IS NULL OR dc."dealId" IS DISTINCT FROM d.id OR dc."actorUserId" IS DISTINCT FROM v."sourceActorUserId" OR dc."operationKey" IS DISTINCT FROM v."sourceOperationKey" OR dc."payloadHash" IS DISTINCT FROM v."sourcePayloadHash"
    OR d.id IS NULL OR d."campaignId" IS DISTINCT FROM p."campaignId" OR d."brandId" IS DISTINCT FROM p."brandId" OR d."creatorId" IS DISTINCT FROM p."creatorId" OR d."briefVersion" IS DISTINCT FROM v."approvedBriefVersion"
    OR o.id IS NULL OR o."dealId" IS DISTINCT FROM d.id OR o.version IS DISTINCT FROM 1 OR o."proposerUserId" IS DISTINCT FROM p."brandUserId" OR o."recipientUserId" IS DISTINCT FROM p."creatorUserId")))) THEN
  RAISE EXCEPTION 'Finalization native source changed' USING ERRCODE='23514'; END IF;
 RETURN locked;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Finalization deletion requires ordered prelocked inventory' USING ERRCODE='23514';
END $$;

CREATE OR REPLACE FUNCTION infame_legacy_manifest_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "LegacyDirectAdmissionVersion"%ROWTYPE; m "LegacyAdmissionManifest"%ROWTYPE; item JSONB;
BEGIN
 m:=infame_legacy_finalization_manifest(NEW."manifestId",NEW."versionId");
 IF EXISTS(SELECT 1 FROM "LegacyAdmissionImportReceipt" WHERE "manifestId"=NEW."manifestId") THEN
  RAISE EXCEPTION 'Finalized manifest membership retained' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM "LegacyDirectAdmissionVersion" WHERE id=NEW."versionId";
 IF v.id IS NULL OR v."admissionId" IS DISTINCT FROM NEW."admissionId" OR v.provenance IS DISTINCT FROM NEW.provenance
  OR m.provenance IS DISTINCT FROM NEW.provenance OR v.capability IS DISTINCT FROM NEW.capability OR v.version IS DISTINCT FROM NEW.version OR v."sourceHash" IS DISTINCT FROM NEW."sourceHash"
  OR v."manifestId" IS DISTINCT FROM NEW."manifestId" OR v."manifestEntryId" IS DISTINCT FROM NEW."entryId" THEN
  RAISE EXCEPTION 'Manifest entry version binding' USING ERRCODE='23514'; END IF;
 item:=m.content->'entries'->(NEW.ordinal-1);
 IF item IS DISTINCT FROM jsonb_build_object('entryId',NEW."entryId",'admissionId',NEW."admissionId",'version',NEW.version,'sourceHash',NEW."sourceHash") THEN
  RAISE EXCEPTION 'Manifest entry order binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION infame_legacy_manifest_entry_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM infame_legacy_finalization_isolation();
 -- Reject finalized members before waiting; their DELETE row lock must never
 -- wait on a Link writer holding parent and requesting the member FK lock.
 IF EXISTS(SELECT 1 FROM "LegacyAdmissionImportReceipt" WHERE "manifestId"=OLD."manifestId") THEN
  RAISE EXCEPTION 'Finalized manifest entry retained' USING ERRCODE='23514'; END IF;
 PERFORM infame_legacy_finalization_manifest(OLD."manifestId",OLD."versionId",NULL,NULL,NULL,NULL,NULL,NULL,TRUE);
 IF EXISTS(SELECT 1 FROM "LegacyAdmissionImportReceipt" WHERE "manifestId"=OLD."manifestId") THEN
  RAISE EXCEPTION 'Finalized manifest entry retained' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "LegacyAdmissionManifestEntry_delete_guard" BEFORE DELETE ON "LegacyAdmissionManifestEntry" FOR EACH ROW EXECUTE FUNCTION infame_legacy_manifest_entry_delete_guard();

CREATE OR REPLACE FUNCTION infame_legacy_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m "LegacyAdmissionManifest"%ROWTYPE; expected INTEGER;
BEGIN
 m:=infame_legacy_finalization_manifest(NEW."manifestId");
 expected:=jsonb_array_length(m.content->'entries');
 IF m.provenance IS DISTINCT FROM NEW.provenance OR m.digest IS DISTINCT FROM NEW.digest OR NEW."entryCount"<>expected
  OR (SELECT count(*) FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=m.id)<>expected
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(m.content->'entries') WITH ORDINALITY item(content,ordinal)
   WHERE NOT EXISTS(SELECT 1 FROM "LegacyAdmissionManifestEntry" e JOIN "LegacyDirectAdmissionVersion" v ON v.id=e."versionId"
    WHERE e."manifestId"=m.id AND e.ordinal=item.ordinal AND item.content=jsonb_build_object('entryId',e."entryId",'admissionId',e."admissionId",'version',e.version,'sourceHash',e."sourceHash")
     AND v."admissionId"=e."admissionId" AND v.provenance=e.provenance AND v.capability=e.capability AND v.version=e.version AND v."sourceHash"=e."sourceHash"
     AND v."manifestId"=m.id AND v."manifestEntryId"=e."entryId")) THEN
  RAISE EXCEPTION 'Receipt manifest completeness' USING ERRCODE='23514'; END IF;
 -- No Entry row lock: DELETE already owns its tuple before its BEFORE trigger.
 RETURN NEW;
END $$;

CREATE FUNCTION infame_legacy_receipt_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM infame_legacy_finalization_manifest(OLD."manifestId",NULL,NULL,NULL,NULL,NULL,NULL,NULL,TRUE);
 RETURN OLD;
END $$;
CREATE TRIGGER "LegacyAdmissionImportReceipt_delete_guard" BEFORE DELETE ON "LegacyAdmissionImportReceipt" FOR EACH ROW EXECUTE FUNCTION infame_legacy_receipt_delete_guard();

CREATE OR REPLACE FUNCTION infame_legacy_fresh_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "LegacyAdmissionManifestEntry"%ROWTYPE; r "LegacyAdmissionImportReceipt"%ROWTYPE; v "LegacyDirectAdmissionVersion"%ROWTYPE;
 p "LegacyDirectAdmission"%ROWTYPE; d "Deal"%ROWTYPE; o "DealOffer"%ROWTYPE; c "DealCommand"%ROWTYPE; b "CampaignBrief"%ROWTYPE;
 m "LegacyAdmissionManifest"%ROWTYPE; actual_result JSONB;
BEGIN
 m:=infame_legacy_finalization_manifest(NEW."manifestId",NEW."versionId",NEW."dealId",NEW."firstOfferId",NEW."approvedBriefId",NEW."createCommandId",NEW."brandUserId",NEW."creatorUserId");
 SELECT * INTO p FROM "LegacyDirectAdmission" WHERE id=NEW."admissionId";
 SELECT * INTO v FROM "LegacyDirectAdmissionVersion" WHERE id=NEW."versionId";
 SELECT * INTO e FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=NEW."manifestId" AND "entryId"=NEW."manifestEntryId";
 SELECT * INTO r FROM "LegacyAdmissionImportReceipt" WHERE id=NEW."importReceiptId";
 SELECT * INTO d FROM "Deal" WHERE id=NEW."dealId";
 SELECT * INTO o FROM "DealOffer" WHERE id=NEW."firstOfferId";
 SELECT * INTO c FROM "DealCommand" WHERE id=NEW."createCommandId";
 SELECT * INTO b FROM "CampaignBrief" WHERE id=NEW."approvedBriefId";
 actual_result:=jsonb_build_object('dealId',d.id,'version',1);
 IF p.id IS NULL OR e."versionId" IS NULL OR r.id IS NULL OR v.id IS NULL OR d.id IS NULL OR o.id IS NULL OR c.id IS NULL OR b.id IS NULL
  OR r."manifestId" IS DISTINCT FROM NEW."manifestId" OR r.provenance IS DISTINCT FROM NEW.provenance OR r.digest IS DISTINCT FROM NEW.digest
  OR e."versionId" IS DISTINCT FROM NEW."versionId" OR e."admissionId" IS DISTINCT FROM NEW."admissionId" OR e.provenance IS DISTINCT FROM NEW.provenance OR e.capability IS DISTINCT FROM NEW.capability OR e.version IS DISTINCT FROM NEW.version OR e."sourceHash" IS DISTINCT FROM NEW."sourceHash"
  OR v.capability IS DISTINCT FROM 'FRESH_PINNED_SCOPE' OR NEW.capability IS DISTINCT FROM 'FRESH_PINNED_SCOPE'
  OR NEW."brandUserId" IS DISTINCT FROM p."brandUserId" OR NEW."creatorUserId" IS DISTINCT FROM p."creatorUserId"
  OR d."campaignId" IS DISTINCT FROM p."campaignId" OR d."brandId" IS DISTINCT FROM p."brandId" OR d."creatorId" IS DISTINCT FROM p."creatorId" OR d."briefVersion" IS DISTINCT FROM v."approvedBriefVersion"
  OR o."dealId" IS DISTINCT FROM d.id OR o.version IS DISTINCT FROM 1 OR o."proposerUserId" IS DISTINCT FROM NEW."brandUserId" OR o."recipientUserId" IS DISTINCT FROM NEW."creatorUserId"
  OR c."dealId" IS DISTINCT FROM d.id OR c."actorUserId" IS DISTINCT FROM NEW."brandUserId" OR c."operationKey" IS DISTINCT FROM NEW."createOperationKey" OR c."payloadHash" IS DISTINCT FROM NEW."createPayloadHash" OR c.result IS DISTINCT FROM actual_result
  OR NEW."createResultHash" IS DISTINCT FROM encode(sha256(convert_to(infame_reference_canonical(actual_result),'UTF8')),'hex')
  OR b.id IS DISTINCT FROM v."approvedBriefId" OR b."campaignId" IS DISTINCT FROM p."campaignId" OR b.version IS DISTINCT FROM NEW."approvedBriefVersion" OR b.version IS DISTINCT FROM v."approvedBriefVersion" THEN
  RAISE EXCEPTION 'Fresh admission native binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION infame_legacy_fresh_link_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM infame_legacy_finalization_isolation();
 PERFORM id FROM "LegacyDirectAdmission" WHERE id=OLD."admissionId" FOR UPDATE NOWAIT;
 RETURN OLD;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Finalization deletion requires ordered prelocked inventory' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "FreshDealAdmissionLink_delete_guard" BEFORE DELETE ON "FreshDealAdmissionLink" FOR EACH ROW EXECUTE FUNCTION infame_legacy_fresh_link_delete_guard();
CREATE FUNCTION infame_legacy_fresh_link_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "LegacyDirectAdmission" WHERE id=OLD."admissionId") THEN
  RAISE EXCEPTION 'Consumed admission lifetime retained' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE CONSTRAINT TRIGGER "FreshDealAdmissionLink_retention" AFTER DELETE ON "FreshDealAdmissionLink"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_legacy_fresh_link_retention();

-- UPDATE already owns the target tuple. Reject via the immutable trigger
-- without running INSERT's waiting inventory acquisition in reverse order.
DROP TRIGGER "LegacyAdmissionManifestEntry_guard" ON "LegacyAdmissionManifestEntry";
CREATE TRIGGER "LegacyAdmissionManifestEntry_guard" BEFORE INSERT ON "LegacyAdmissionManifestEntry" FOR EACH ROW EXECUTE FUNCTION infame_legacy_manifest_entry_guard();
DROP TRIGGER "LegacyAdmissionImportReceipt_guard" ON "LegacyAdmissionImportReceipt";
CREATE TRIGGER "LegacyAdmissionImportReceipt_guard" BEFORE INSERT ON "LegacyAdmissionImportReceipt" FOR EACH ROW EXECUTE FUNCTION infame_legacy_receipt_guard();
DROP TRIGGER "FreshDealAdmissionLink_guard" ON "FreshDealAdmissionLink";
CREATE TRIGGER "FreshDealAdmissionLink_guard" BEFORE INSERT ON "FreshDealAdmissionLink" FOR EACH ROW EXECUTE FUNCTION infame_legacy_fresh_link_guard();
