-- Schema23A: retained declarations only. No importer, manifest authority or
-- direct-service admission. Runtime must verify full canonical source material.
CREATE TABLE "LegacyDirectAdmission" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 provenance TEXT NOT NULL CHECK(provenance IN ('LIVE','DEVELOPMENT_FIXTURE')),
 capability TEXT NOT NULL CHECK(capability IN ('FRESH_PINNED_SCOPE','CONTINUE_PINNED_DEAL')),
 "campaignId" TEXT NOT NULL, "brandId" TEXT NOT NULL, "brandUserId" TEXT NOT NULL,
 "creatorId" TEXT NOT NULL, "creatorUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("campaignId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("brandId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("brandUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("creatorId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("creatorUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("brandUserId"<>"creatorUserId"),
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 UNIQUE(id,provenance,capability),
 FOREIGN KEY("campaignId","brandId") REFERENCES "Campaign"(id,"brandId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("brandId") REFERENCES "Brand"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("creatorId") REFERENCES "Creator"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("brandUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("creatorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "LegacyDirectAdmission_campaignId_creatorId_idx" ON "LegacyDirectAdmission"("campaignId","creatorId");
CREATE TABLE "LegacyDirectAdmissionVersion" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 "admissionId" TEXT NOT NULL, provenance TEXT NOT NULL, capability TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=131072),
 "sourceHash" TEXT NOT NULL CHECK("sourceHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "approvedBriefId" TEXT NOT NULL, "approvedBriefVersion" INTEGER NOT NULL CHECK("approvedBriefVersion" BETWEEN 1 AND 2147483646),
 "approvedInputRevision" INTEGER NOT NULL CHECK("approvedInputRevision" BETWEEN 1 AND 2147483646),
 "approvedByUserId" TEXT NOT NULL, "approvedContentHash" TEXT NOT NULL CHECK("approvedContentHash" ~ '^[a-f0-9]{64}$'),
 "manifestId" TEXT NOT NULL CHECK("manifestId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "manifestEntryId" TEXT NOT NULL CHECK("manifestEntryId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "sourceActorUserId" TEXT NOT NULL, "sourceOperationKey" TEXT NOT NULL,
 "sourcePayloadHash" TEXT NOT NULL CHECK("sourcePayloadHash" ~ '^[a-f0-9]{64}$'),
 "sourceResultHash" TEXT NOT NULL CHECK("sourceResultHash" ~ '^[a-f0-9]{64}$'),
 "campaignCommandId" TEXT, "dealCommandId" TEXT,
 "existingDealId" TEXT, "existingDealHash" TEXT, "firstOfferId" TEXT, "firstOfferVersion" INTEGER,
 "firstProposerUserId" TEXT, "firstRecipientUserId" TEXT, "firstOfferContentHash" TEXT,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 CHECK((capability='FRESH_PINNED_SCOPE' AND "campaignCommandId" IS NOT NULL AND "dealCommandId" IS NULL
  AND "existingDealId" IS NULL AND "existingDealHash" IS NULL AND "firstOfferId" IS NULL AND "firstOfferVersion" IS NULL
  AND "firstProposerUserId" IS NULL AND "firstRecipientUserId" IS NULL AND "firstOfferContentHash" IS NULL
  AND "sourceOperationKey" COLLATE "C" ~ '^create:[A-Za-z0-9_:-]{1,120}$')
 OR (capability='CONTINUE_PINNED_DEAL' AND "campaignCommandId" IS NULL AND "dealCommandId" IS NOT NULL
  AND "existingDealId" IS NOT NULL AND "existingDealHash" IS NOT NULL AND "existingDealHash" ~ '^[a-f0-9]{64}$'
  AND "firstOfferId" IS NOT NULL AND "firstOfferVersion" IS NOT NULL AND "firstOfferVersion"=1
  AND "firstProposerUserId" IS NOT NULL AND "firstRecipientUserId" IS NOT NULL
  AND "firstOfferContentHash" IS NOT NULL AND "firstOfferContentHash" ~ '^[a-f0-9]{64}$'
  AND "sourceOperationKey" COLLATE "C" ~ '^[A-Za-z0-9_:-]{1,120}$')),
 CHECK("admissionId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("approvedBriefId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("approvedByUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("sourceActorUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("campaignCommandId" IS NULL OR "campaignCommandId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("dealCommandId" IS NULL OR "dealCommandId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("existingDealId" IS NULL OR "existingDealId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("firstOfferId" IS NULL OR "firstOfferId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("firstProposerUserId" IS NULL OR "firstProposerUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 CHECK("firstRecipientUserId" IS NULL OR "firstRecipientUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 UNIQUE("admissionId",version), UNIQUE(id,"admissionId",version,"sourceHash"),
 UNIQUE(id,"admissionId",provenance,capability,version,"sourceHash"),
 FOREIGN KEY("admissionId",provenance,capability) REFERENCES "LegacyDirectAdmission"(id,provenance,capability) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("approvedBriefId") REFERENCES "CampaignBrief"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("campaignCommandId") REFERENCES "CampaignCommand"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("dealCommandId") REFERENCES "DealCommand"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("existingDealId") REFERENCES "Deal"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("firstOfferId") REFERENCES "DealOffer"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("approvedByUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("sourceActorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("firstProposerUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("firstRecipientUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "LegacyDirectAdmissionVersion_approvedBriefId_idx" ON "LegacyDirectAdmissionVersion"("approvedBriefId");
CREATE INDEX "LegacyDirectAdmissionVersion_campaignCommandId_idx" ON "LegacyDirectAdmissionVersion"("campaignCommandId");
CREATE INDEX "LegacyDirectAdmissionVersion_dealCommandId_idx" ON "LegacyDirectAdmissionVersion"("dealCommandId");
CREATE INDEX "LegacyDirectAdmissionVersion_existingDealId_idx" ON "LegacyDirectAdmissionVersion"("existingDealId");
CREATE INDEX "LegacyDirectAdmissionVersion_firstOfferId_idx" ON "LegacyDirectAdmissionVersion"("firstOfferId");
CREATE TABLE "LegacyDirectAdmissionState" (
 "admissionId" TEXT PRIMARY KEY REFERENCES "LegacyDirectAdmission"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483646),
 state TEXT NOT NULL CHECK(state IN ('DRAFT','ACTIVE','PAUSED','REVOKED')),
 "currentVersionId" TEXT, "currentVersionNumber" INTEGER, "currentSourceHash" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "updatedAt"<TIMESTAMP '10000-01-01' AND "updatedAt">="createdAt"),
 CHECK(("currentVersionId" IS NULL AND "currentVersionNumber" IS NULL AND "currentSourceHash" IS NULL)
  OR ("currentVersionId" IS NOT NULL AND "currentVersionNumber" IS NOT NULL AND "currentSourceHash" IS NOT NULL
   AND "currentVersionNumber" BETWEEN 1 AND 2147483646 AND "currentSourceHash" ~ '^[a-f0-9]{64}$')),
 CHECK((state='DRAFT' AND "currentVersionId" IS NULL) OR (state IN ('ACTIVE','PAUSED') AND "currentVersionId" IS NOT NULL) OR state='REVOKED'),
 FOREIGN KEY("currentVersionId","admissionId","currentVersionNumber","currentSourceHash")
  REFERENCES "LegacyDirectAdmissionVersion"(id,"admissionId",version,"sourceHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "LegacyDirectAdmissionState_current_version" ON "LegacyDirectAdmissionState"("currentVersionId","admissionId","currentVersionNumber","currentSourceHash");
CREATE INDEX "LegacyDirectAdmissionState_available" ON "LegacyDirectAdmissionState"(state,"admissionId");
CREATE TRIGGER "LegacyDirectAdmission_immutable" BEFORE UPDATE ON "LegacyDirectAdmission" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "LegacyDirectAdmissionVersion_immutable" BEFORE UPDATE ON "LegacyDirectAdmissionVersion" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();


CREATE FUNCTION infame_legacy_admission_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured "LegacyDirectAdmission"%ROWTYPE; parent "LegacyDirectAdmission"%ROWTYPE;
 current_state "LegacyDirectAdmissionState"%ROWTYPE; brief "CampaignBrief"%ROWTYPE;
 campaign_source "CampaignCommand"%ROWTYPE; deal_source "DealCommand"%ROWTYPE;
 retained_deal "Deal"%ROWTYPE; first_offer "DealOffer"%ROWTYPE; previous INTEGER;
 expected_subject JSONB; expected_brief JSONB; expected_source JSONB; expected_existing JSONB;
 validity JSONB; valid_from TIMESTAMP(3); recheck_at TIMESTAMP(3); expires_at TIMESTAMP(3);
BEGIN
 -- Parent pre-read discovers locks only. Native sources precede retained parent.
 SELECT * INTO captured FROM "LegacyDirectAdmission" WHERE id=NEW."admissionId";
 IF captured.id IS NULL THEN RAISE EXCEPTION 'Admission declaration parent' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "User" WHERE id IN (captured."brandUserId",captured."creatorUserId") ORDER BY id FOR SHARE;
 PERFORM id FROM "Brand" WHERE id=captured."brandId" FOR SHARE;
 PERFORM id FROM "Creator" WHERE id=captured."creatorId" FOR SHARE;
 PERFORM id FROM "Campaign" WHERE id=captured."campaignId" FOR SHARE;
 IF NEW.capability='CONTINUE_PINNED_DEAL' THEN
  SELECT * INTO retained_deal FROM "Deal" WHERE id=NEW."existingDealId" FOR SHARE;
  SELECT * INTO first_offer FROM "DealOffer" WHERE id=NEW."firstOfferId" FOR SHARE;
 END IF;
 SELECT * INTO brief FROM "CampaignBrief" WHERE id=NEW."approvedBriefId" FOR SHARE;
 IF NEW.capability='FRESH_PINNED_SCOPE' THEN
  SELECT * INTO campaign_source FROM "CampaignCommand" WHERE id=NEW."campaignCommandId" FOR SHARE;
 ELSE
  SELECT * INTO deal_source FROM "DealCommand" WHERE id=NEW."dealCommandId" FOR SHARE;
 END IF;
 SELECT * INTO parent FROM "LegacyDirectAdmission" WHERE id=NEW."admissionId" FOR UPDATE;
 IF parent.id IS NULL OR ROW(parent.id,parent.provenance,parent.capability,parent."campaignId",parent."brandId",parent."brandUserId",parent."creatorId",parent."creatorUserId",parent."createdAt")
  IS DISTINCT FROM ROW(captured.id,captured.provenance,captured.capability,captured."campaignId",captured."brandId",captured."brandUserId",captured."creatorId",captured."creatorUserId",captured."createdAt")
  THEN RAISE EXCEPTION 'Admission capture changed' USING ERRCODE='23514'; END IF;
 SELECT * INTO current_state FROM "LegacyDirectAdmissionState" WHERE "admissionId"=parent.id;
 IF current_state."admissionId" IS NULL OR current_state.state='REVOKED'
  OR parent.provenance IS DISTINCT FROM NEW.provenance OR parent.capability IS DISTINCT FROM NEW.capability
  OR NEW."createdAt"<parent."createdAt" THEN RAISE EXCEPTION 'Admission version subject' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(MAX(version),0) INTO previous FROM "LegacyDirectAdmissionVersion" WHERE "admissionId"=parent.id;
 IF NEW.version::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'Admission version sequence' USING ERRCODE='23514'; END IF;
 IF brief.id IS NULL OR brief."campaignId" IS DISTINCT FROM parent."campaignId"
  OR brief.version IS DISTINCT FROM NEW."approvedBriefVersion" OR brief."inputRevision" IS DISTINCT FROM NEW."approvedInputRevision"
  OR brief."approvedByUserId" IS DISTINCT FROM parent."brandUserId" OR brief."approvedByUserId" IS DISTINCT FROM NEW."approvedByUserId"
  OR brief."approvedAt" IS NULL OR brief."approvedAt">NEW."createdAt"
  OR NEW."sourceActorUserId" IS DISTINCT FROM parent."brandUserId"
  THEN RAISE EXCEPTION 'Admission approved native pins' USING ERRCODE='23514'; END IF;
 IF NEW.capability='FRESH_PINNED_SCOPE' THEN
  IF campaign_source.id IS NULL OR campaign_source."campaignId" IS DISTINCT FROM parent."campaignId"
   OR campaign_source."actorUserId" IS DISTINCT FROM NEW."sourceActorUserId"
   OR campaign_source."operationKey" IS DISTINCT FROM NEW."sourceOperationKey"
   OR campaign_source."payloadHash" IS DISTINCT FROM NEW."sourcePayloadHash"
   THEN RAISE EXCEPTION 'Admission campaign receipt pins' USING ERRCODE='23514'; END IF;
  expected_source:=jsonb_build_object('kind','CAMPAIGN_COMMAND','id',NEW."campaignCommandId",'actorUserId',NEW."sourceActorUserId",'operationKey',NEW."sourceOperationKey",'payloadHash',NEW."sourcePayloadHash",'resultHash',NEW."sourceResultHash");
 ELSE
  IF retained_deal.id IS NULL OR retained_deal."campaignId" IS DISTINCT FROM parent."campaignId" OR retained_deal."brandId" IS DISTINCT FROM parent."brandId"
   OR retained_deal."creatorId" IS DISTINCT FROM parent."creatorId" OR retained_deal."briefVersion" IS DISTINCT FROM NEW."approvedBriefVersion"
   OR first_offer.id IS NULL OR first_offer."dealId" IS DISTINCT FROM retained_deal.id OR first_offer.version IS DISTINCT FROM 1
   OR first_offer."proposerUserId" IS DISTINCT FROM parent."brandUserId" OR first_offer."recipientUserId" IS DISTINCT FROM parent."creatorUserId"
   OR NEW."firstProposerUserId" IS DISTINCT FROM first_offer."proposerUserId" OR NEW."firstRecipientUserId" IS DISTINCT FROM first_offer."recipientUserId"
   OR deal_source.id IS NULL OR deal_source."dealId" IS DISTINCT FROM retained_deal.id
   OR deal_source."actorUserId" IS DISTINCT FROM NEW."sourceActorUserId" OR deal_source."operationKey" IS DISTINCT FROM NEW."sourceOperationKey"
   OR deal_source."payloadHash" IS DISTINCT FROM NEW."sourcePayloadHash"
   THEN RAISE EXCEPTION 'Admission retained deal receipt pins' USING ERRCODE='23514'; END IF;
  expected_source:=jsonb_build_object('kind','DEAL_COMMAND','id',NEW."dealCommandId",'actorUserId',NEW."sourceActorUserId",'operationKey',NEW."sourceOperationKey",'payloadHash',NEW."sourcePayloadHash",'resultHash',NEW."sourceResultHash");
  expected_existing:=jsonb_build_object('id',NEW."existingDealId",'sourceHash',NEW."existingDealHash",'firstOffer',jsonb_build_object('id',NEW."firstOfferId",'version',1,'proposerUserId',NEW."firstProposerUserId",'recipientUserId',NEW."firstRecipientUserId",'contentHash',NEW."firstOfferContentHash"));
 END IF;
 expected_subject:=jsonb_build_object('campaignId',parent."campaignId",'brandId',parent."brandId",'brandUserId',parent."brandUserId",'creatorId',parent."creatorId",'creatorUserId',parent."creatorUserId");
 expected_brief:=jsonb_build_object('id',NEW."approvedBriefId",'version',NEW."approvedBriefVersion",'inputRevision',NEW."approvedInputRevision",'approvedByUserId',NEW."approvedByUserId",'contentHash',NEW."approvedContentHash");
 IF jsonb_typeof(NEW.content) IS DISTINCT FROM 'object'
  OR NEW.content - ARRAY['schemaVersion','admissionId','provenance','version','capability','subject','approvedBrief','validity','manifest','source','existingDeal'] <> '{}'::jsonb
  OR NEW.content->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NEW.content->'admissionId' IS DISTINCT FROM to_jsonb(parent.id)
  OR NEW.content->'provenance' IS DISTINCT FROM to_jsonb(NEW.provenance) OR NEW.content->'capability' IS DISTINCT FROM to_jsonb(NEW.capability)
  OR NEW.content->'version' IS DISTINCT FROM to_jsonb(NEW.version) OR NEW.content->'subject' IS DISTINCT FROM expected_subject
  OR NEW.content->'approvedBrief' IS DISTINCT FROM expected_brief OR NEW.content->'source' IS DISTINCT FROM expected_source
  OR NEW.content->'manifest' IS DISTINCT FROM jsonb_build_object('id',NEW."manifestId",'entryId',NEW."manifestEntryId")
  OR (NEW.capability='FRESH_PINNED_SCOPE' AND NEW.content ? 'existingDeal')
  OR (NEW.capability='CONTINUE_PINNED_DEAL' AND NEW.content->'existingDeal' IS DISTINCT FROM expected_existing)
  THEN RAISE EXCEPTION 'Admission exact declaration binding' USING ERRCODE='23514'; END IF;
 validity:=NEW.content->'validity';
 IF jsonb_typeof(validity) IS DISTINCT FROM 'object' OR validity-ARRAY['validFrom','expiresAt','recheckAt']<>'{}'::jsonb
  OR jsonb_typeof(validity->'validFrom') IS DISTINCT FROM 'string' OR jsonb_typeof(validity->'recheckAt') IS DISTINCT FROM 'string'
  OR NOT(validity ? 'expiresAt') OR jsonb_typeof(validity->'expiresAt') NOT IN ('string','null')
  OR NOT((validity->>'validFrom') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$')
  OR NOT((validity->>'recheckAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$')
  OR (jsonb_typeof(validity->'expiresAt')='string' AND NOT((validity->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$'))
  THEN RAISE EXCEPTION 'Admission validity shape' USING ERRCODE='23514'; END IF;
 BEGIN
  valid_from:=(validity->>'validFrom')::timestamp(3); recheck_at:=(validity->>'recheckAt')::timestamp(3);
  expires_at:=CASE WHEN jsonb_typeof(validity->'expiresAt')='null' THEN NULL ELSE (validity->>'expiresAt')::timestamp(3) END;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Admission validity instant' USING ERRCODE='23514';
 END;
 IF (to_char(valid_from,'YYYY-MM-DD"T"HH24:MI:SS.MS')||'Z') IS DISTINCT FROM
    (CASE WHEN position('.' in validity->>'validFrom')>0 THEN validity->>'validFrom' ELSE replace(validity->>'validFrom','Z','.000Z') END)
  OR (to_char(recheck_at,'YYYY-MM-DD"T"HH24:MI:SS.MS')||'Z') IS DISTINCT FROM
    (CASE WHEN position('.' in validity->>'recheckAt')>0 THEN validity->>'recheckAt' ELSE replace(validity->>'recheckAt','Z','.000Z') END)
  OR (expires_at IS NOT NULL AND (to_char(expires_at,'YYYY-MM-DD"T"HH24:MI:SS.MS')||'Z') IS DISTINCT FROM
    (CASE WHEN position('.' in validity->>'expiresAt')>0 THEN validity->>'expiresAt' ELSE replace(validity->>'expiresAt','Z','.000Z') END))
  THEN RAISE EXCEPTION 'Admission canonical validity instant' USING ERRCODE='23514'; END IF;
 IF valid_from<TIMESTAMP '0001-01-01' OR recheck_at>=TIMESTAMP '10000-01-01' OR valid_from>=recheck_at
  OR (expires_at IS NOT NULL AND (expires_at>=TIMESTAMP '10000-01-01' OR valid_from>=expires_at OR recheck_at>expires_at))
  THEN RAISE EXCEPTION 'Admission validity range' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LegacyDirectAdmissionVersion_guard" BEFORE INSERT ON "LegacyDirectAdmissionVersion" FOR EACH ROW EXECUTE FUNCTION infame_legacy_admission_version_guard();


CREATE FUNCTION infame_legacy_admission_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "LegacyDirectAdmission"%ROWTYPE; selected "LegacyDirectAdmissionVersion"%ROWTYPE; latest INTEGER;
BEGIN
 SELECT * INTO parent FROM "LegacyDirectAdmission" WHERE id=NEW."admissionId" FOR UPDATE;
 IF parent.id IS NULL OR NEW."createdAt"<parent."createdAt" THEN RAISE EXCEPTION 'Admission state parent' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.state<>'DRAFT' OR NEW."currentVersionId" IS NOT NULL
   OR EXISTS(SELECT 1 FROM "LegacyDirectAdmissionVersion" WHERE "admissionId"=NEW."admissionId")
   THEN RAISE EXCEPTION 'Admission initial state' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."admissionId"<>OLD."admissionId" OR NEW."createdAt"<>OLD."createdAt"
   OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW."updatedAt"<OLD."updatedAt" OR OLD.state='REVOKED'
   OR (OLD.state<>'DRAFT' AND NEW.state='DRAFT') OR (OLD.state='DRAFT' AND NEW.state='PAUSED')
   OR (NEW.state IN ('PAUSED','REVOKED') AND ROW(NEW."currentVersionId",NEW."currentVersionNumber",NEW."currentSourceHash")
      IS DISTINCT FROM ROW(OLD."currentVersionId",OLD."currentVersionNumber",OLD."currentSourceHash"))
   OR (OLD."currentVersionNumber" IS NOT NULL AND NEW."currentVersionNumber"<OLD."currentVersionNumber")
   THEN RAISE EXCEPTION 'Admission sequential state' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."currentVersionId" IS NOT NULL THEN
  SELECT * INTO selected FROM "LegacyDirectAdmissionVersion" WHERE id=NEW."currentVersionId";
  IF selected.id IS NULL OR selected."admissionId"<>NEW."admissionId" OR selected.version IS DISTINCT FROM NEW."currentVersionNumber"
   OR selected."sourceHash" IS DISTINCT FROM NEW."currentSourceHash" OR selected.provenance IS DISTINCT FROM parent.provenance
   OR selected.capability IS DISTINCT FROM parent.capability OR selected."createdAt">NEW."updatedAt"
   THEN RAISE EXCEPTION 'Admission exact state pointer' USING ERRCODE='23514'; END IF;
  IF NEW.state='ACTIVE' THEN
   SELECT MAX(version) INTO latest FROM "LegacyDirectAdmissionVersion" WHERE "admissionId"=NEW."admissionId";
   IF selected.version<>latest THEN RAISE EXCEPTION 'Admission latest state pointer' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LegacyDirectAdmissionState_guard" BEFORE INSERT OR UPDATE ON "LegacyDirectAdmissionState" FOR EACH ROW EXECUTE FUNCTION infame_legacy_admission_state_guard();

CREATE FUNCTION infame_legacy_admission_version_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "LegacyDirectAdmission" WHERE id=OLD."admissionId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "LegacyDirectAdmissionState" WHERE "admissionId"=OLD."admissionId")
  THEN RAISE EXCEPTION 'Retained admission version' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "LegacyDirectAdmissionVersion_retention" BEFORE DELETE ON "LegacyDirectAdmissionVersion" FOR EACH ROW EXECUTE FUNCTION infame_legacy_admission_version_retention();

CREATE FUNCTION infame_legacy_admission_state_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Commit-time check permits only complete atomic aggregate teardown. Deleting
 -- and recreating State cannot reset a surviving identity, even without Versions.
 IF EXISTS(SELECT 1 FROM "LegacyDirectAdmission" WHERE id=OLD."admissionId")
  THEN RAISE EXCEPTION 'Retained admission aggregate' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE CONSTRAINT TRIGGER "LegacyDirectAdmissionState_retention" AFTER DELETE ON "LegacyDirectAdmissionState"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_legacy_admission_state_retention();
