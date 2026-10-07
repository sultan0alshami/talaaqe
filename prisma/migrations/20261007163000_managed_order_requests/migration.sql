-- Immutable customer disclosure. No quote/principal/billing/operator activation.
CREATE TABLE "ManagedOrder" (
 id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 "workspaceId" TEXT NOT NULL, "campaignId" TEXT NOT NULL UNIQUE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"workspaceId","campaignId"), UNIQUE(id,"workspaceId"),
 FOREIGN KEY("campaignId","workspaceId") REFERENCES "CampaignPlanningBinding"("campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ManagedOrder_workspace_id" ON "ManagedOrder"("workspaceId",id);
CREATE TABLE "ManagedOrderSubmission" (
 id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 "orderId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "campaignId" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 "briefId" TEXT NOT NULL, "briefVersion" INTEGER NOT NULL CHECK("briefVersion" BETWEEN 1 AND 2147483646),
 "inputRevision" INTEGER NOT NULL CHECK("inputRevision" BETWEEN 1 AND 2147483646),
 "campaignRevision" INTEGER NOT NULL CHECK("campaignRevision" BETWEEN 1 AND 2147483646 AND "inputRevision"<="campaignRevision"),
 "planningRevision" INTEGER NOT NULL CHECK("planningRevision" BETWEEN 1 AND 2147483646),
 "selectionId" TEXT NOT NULL, "selectionRevision" INTEGER NOT NULL CHECK("selectionRevision" BETWEEN 1 AND 2147483646),
 "approvedByUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "approvedAt" TIMESTAMP(3) NOT NULL, "contextReferenceSubmissionId" TEXT REFERENCES "ContextSubmissionReferences"("submissionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND infame_planning_json_bytes(snapshot)<=262144),
 "snapshotHash" TEXT NOT NULL CHECK("snapshotHash" ~ '^[a-f0-9]{64}$'),
 "submittedByUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "disclosureVersion" TEXT NOT NULL CHECK("disclosureVersion"='infame-order-disclosure-v1'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("orderId",version), UNIQUE(id,"orderId","workspaceId","campaignId",version), UNIQUE(id,"orderId","workspaceId",version),
 FOREIGN KEY("orderId","workspaceId","campaignId") REFERENCES "ManagedOrder"(id,"workspaceId","campaignId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("briefId","campaignId","workspaceId","selectionId","selectionRevision")
  REFERENCES "CampaignBriefProvenance"("briefId","campaignId","workspaceId","selectionId","selectionRevision") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ManagedOrderSubmission_workspace_order" ON "ManagedOrderSubmission"("workspaceId","orderId");
CREATE INDEX "ManagedOrderSubmission_provenance" ON "ManagedOrderSubmission"("briefId","campaignId","workspaceId","selectionId","selectionRevision");
CREATE INDEX "ManagedOrderSubmission_reference" ON "ManagedOrderSubmission"("contextReferenceSubmissionId");
CREATE INDEX "ManagedOrderSubmission_approver" ON "ManagedOrderSubmission"("approvedByUserId");
CREATE INDEX "ManagedOrderSubmission_submitter" ON "ManagedOrderSubmission"("submittedByUserId");
CREATE TABLE "ManagedOrderState" (
 "orderId" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483646),
 "submissionId" TEXT NOT NULL, "submissionVersion" INTEGER NOT NULL CHECK("submissionVersion" BETWEEN 1 AND 2147483646),
 status TEXT NOT NULL CHECK(status='REQUESTED'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("orderId","workspaceId") REFERENCES "ManagedOrder"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("submissionId","orderId","workspaceId","submissionVersion") REFERENCES "ManagedOrderSubmission"(id,"orderId","workspaceId",version) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ManagedOrderState_workspace_order" ON "ManagedOrderState"("workspaceId","orderId");
CREATE INDEX "ManagedOrderState_submission" ON "ManagedOrderState"("submissionId","orderId","workspaceId","submissionVersion");
CREATE TABLE "ManagedOrderCommand" (
 id TEXT PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_.:-]{1,200}$'), "actorUserId" TEXT NOT NULL CHECK("actorUserId" ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 "operationKey" TEXT NOT NULL CHECK("operationKey" ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
 "payloadHash" TEXT NOT NULL CHECK("payloadHash" ~ '^[a-f0-9]{64}$'), "orderId" TEXT NOT NULL,
 "workspaceId" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "submissionId" TEXT NOT NULL,
 "submissionVersion" INTEGER NOT NULL CHECK("submissionVersion"=1), action TEXT NOT NULL CHECK(action='SUBMIT'),
 result JSONB NOT NULL CHECK(jsonb_typeof(result)='object' AND infame_planning_json_bytes(result)<=4096),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("actorUserId","operationKey"),
 FOREIGN KEY("submissionId","orderId","workspaceId","campaignId","submissionVersion")
  REFERENCES "ManagedOrderSubmission"(id,"orderId","workspaceId","campaignId",version) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ManagedOrderCommand_workspace_order" ON "ManagedOrderCommand"("workspaceId","orderId");
CREATE INDEX "ManagedOrderCommand_submission" ON "ManagedOrderCommand"("submissionId","orderId","workspaceId","campaignId","submissionVersion");
CREATE TRIGGER "ManagedOrder_immutable" BEFORE UPDATE ON "ManagedOrder" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "ManagedOrderSubmission_immutable" BEFORE UPDATE ON "ManagedOrderSubmission" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "ManagedOrderCommand_immutable" BEFORE UPDATE ON "ManagedOrderCommand" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();

CREATE FUNCTION infame_managed_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CampaignBrief"%ROWTYPE; sel "CampaignContextSelection"%ROWTYPE; v "BrandContextVersion"%ROWTYPE;
 src "BrandContextSubmission"%ROWTYPE; capture "ContextSubmissionReferences"%ROWTYPE; manifest "ContextReferenceManifest"%ROWTYPE;
 projected JSONB; entry JSONB; binding "ContextAssetBinding"%ROWTYPE; asset "PrivateAsset"%ROWTYPE; previous INTEGER;
BEGIN
 -- The application already holds the Campaign/source locks. This parent lock
 -- serializes append versions for direct trusted storage writers as well.
 PERFORM id FROM "ManagedOrder" WHERE id=NEW."orderId" FOR UPDATE;
 SELECT COALESCE(max(version),0) INTO previous FROM "ManagedOrderSubmission" WHERE "orderId"=NEW."orderId";
 IF NEW.version::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'Managed submission version' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM "CampaignBrief" WHERE id=NEW."briefId";
 SELECT * INTO sel FROM "CampaignContextSelection" WHERE id=NEW."selectionId";
 IF b.id IS NULL OR b."campaignId"<>NEW."campaignId" OR b.version<>NEW."briefVersion" OR b."inputRevision"<>NEW."inputRevision"
  OR b."approvedAt" IS NULL OR b."approvedAt"<>NEW."approvedAt" OR b."approvedByUserId" IS DISTINCT FROM NEW."approvedByUserId"
  OR sel.id IS NULL OR sel."campaignId"<>NEW."campaignId" OR sel."workspaceId"<>NEW."workspaceId" OR sel.revision<>NEW."selectionRevision"
  OR b."createdAt">b."approvedAt" OR NEW."createdAt"<NEW."approvedAt" THEN RAISE EXCEPTION 'Managed approved source' USING ERRCODE='23514'; END IF;
 projected:=jsonb_build_object('schemaVersion',1,'brief',jsonb_build_object('id',b.id,'campaignId',b."campaignId",'version',b.version,
  'inputRevision',b."inputRevision",'content',b.content,'approvedAt',to_char(b."approvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'approvedByUserId',b."approvedByUserId",'createdAt',to_char(b."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  'provenance',jsonb_build_object('selectionId',sel.id,'selectionRevision',sel.revision,'versionId',sel."contextVersionId",'contentHash',sel."contentHash"));
 IF sel."contextVersionId" IS NULL THEN
  IF NEW."contextReferenceSubmissionId" IS NOT NULL THEN RAISE EXCEPTION 'Managed absent reference' USING ERRCODE='23514'; END IF;
  projected:=projected||jsonb_build_object('selectedContext',NULL,'references',jsonb_build_object('kind','NO_CONTEXT'));
 ELSE
  SELECT * INTO v FROM "BrandContextVersion" WHERE id=sel."contextVersionId";
  SELECT * INTO src FROM "BrandContextSubmission" WHERE id=v."submissionId";
  IF v.id IS NULL OR v."workspaceId"<>NEW."workspaceId" OR v."contentHash"<>sel."contentHash" OR src.state<>'APPROVED'
   OR src."contextId"<>v."contextId" OR src."workspaceId"<>v."workspaceId" OR src."contentHash"<>v."contentHash"
   OR src."inputRevision"<>v."inputRevision" OR src."decidedByUserId" IS DISTINCT FROM v."approvedByUserId"
   OR src."decidedAt" IS DISTINCT FROM v."approvedAt" OR v."approvedAt">b."approvedAt"
   THEN RAISE EXCEPTION 'Managed context lineage' USING ERRCODE='23514'; END IF;
  projected:=projected||jsonb_build_object('selectedContext',jsonb_build_object('id',v.id,'contextId',v."contextId",'version',v.version,
   'inputRevision',v."inputRevision",'nameOriginal',jsonb_build_object('text',src.name,'language',src."nameLanguage"),
   'content',src.content,'contentHash',v."contentHash",'approvedAt',to_char(v."approvedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  SELECT * INTO capture FROM "ContextSubmissionReferences" WHERE "submissionId"=v."submissionId";
  IF capture."submissionId" IS NULL THEN
   IF NEW."contextReferenceSubmissionId" IS NOT NULL THEN RAISE EXCEPTION 'Managed legacy absent reference' USING ERRCODE='23514'; END IF;
   projected:=projected||jsonb_build_object('references',jsonb_build_object('kind','LEGACY_ABSENT'));
  ELSE
   IF NEW."contextReferenceSubmissionId" IS DISTINCT FROM v."submissionId" THEN RAISE EXCEPTION 'Managed retained reference' USING ERRCODE='23514'; END IF;
   SELECT * INTO manifest FROM "ContextReferenceManifest" WHERE id=capture."manifestId";
   IF capture."contextId"<>v."contextId" OR capture."workspaceId"<>v."workspaceId" OR manifest.id IS NULL
    OR manifest."contextId"<>v."contextId" OR manifest."workspaceId"<>v."workspaceId"
    OR manifest."referenceRevision"<>capture."referenceRevision" OR manifest.hash<>capture."manifestHash"
    THEN RAISE EXCEPTION 'Managed reference lineage' USING ERRCODE='23514'; END IF;
   projected:=projected||jsonb_build_object('references',jsonb_build_object('kind','MANIFEST','id',manifest.id,
    'revision',manifest."referenceRevision",'hash',manifest.hash,'items','[]'::jsonb));
   FOR entry IN SELECT * FROM jsonb_array_elements(manifest.items) LOOP
    SELECT * INTO binding FROM "ContextAssetBinding" WHERE id=entry->>'bindingId';
    SELECT * INTO asset FROM "PrivateAsset" WHERE id=binding."assetId";
    IF binding.id IS NULL OR binding."contextId"<>v."contextId" OR binding."workspaceId"<>v."workspaceId"
     OR asset.id IS NULL OR asset.purpose<>'MARKETING_REFERENCE' OR asset."ownerUserId"<>binding."uploaderUserId"
     THEN RAISE EXCEPTION 'Managed reference asset' USING ERRCODE='23514'; END IF;
    projected:=jsonb_set(projected,'{references,items}',(projected#>'{references,items}')||jsonb_build_array(entry||jsonb_build_object(
     'assetId',asset.id,'contentType',asset."contentType",'size',asset.size)));
   END LOOP;
  END IF;
 END IF;
 IF NEW.snapshot IS DISTINCT FROM projected OR NEW."snapshotHash"<>encode(sha256(convert_to(infame_reference_canonical(projected),'UTF8')),'hex')
  THEN RAISE EXCEPTION 'Managed immutable disclosure' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ManagedOrderSubmission_source" BEFORE INSERT ON "ManagedOrderSubmission" FOR EACH ROW EXECUTE FUNCTION infame_managed_submission_guard();
CREATE FUNCTION infame_managed_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW."submissionVersion"<>1 THEN RAISE EXCEPTION 'Managed initial state' USING ERRCODE='23514'; END IF;
 ELSIF NEW."orderId"<>OLD."orderId" OR NEW."workspaceId"<>OLD."workspaceId" OR NEW."createdAt"<>OLD."createdAt"
  OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW."submissionVersion"::bigint<>OLD."submissionVersion"::bigint+1
  OR NEW."submissionId"=OLD."submissionId" THEN RAISE EXCEPTION 'Managed sequential state' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ManagedOrderState_guard" BEFORE INSERT OR UPDATE ON "ManagedOrderState" FOR EACH ROW EXECUTE FUNCTION infame_managed_state_guard();
CREATE FUNCTION infame_managed_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "ManagedOrderSubmission"%ROWTYPE;
BEGIN
 SELECT * INTO s FROM "ManagedOrderSubmission" WHERE id=NEW."submissionId";
 IF s.id IS NULL OR NEW."actorUserId"<>s."submittedByUserId" OR NEW.result IS DISTINCT FROM jsonb_build_object('action','SUBMIT','orderId',NEW."orderId",'submissionId',s.id,
  'campaignId',NEW."campaignId",'revision',1,'submissionVersion',1,'briefId',s."briefId",'briefVersion',s."briefVersion",
  'selectionId',s."selectionId",'selectionRevision',s."selectionRevision")
  THEN RAISE EXCEPTION 'Managed scalar receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ManagedOrderCommand_receipt" BEFORE INSERT ON "ManagedOrderCommand" FOR EACH ROW EXECUTE FUNCTION infame_managed_command_guard();
