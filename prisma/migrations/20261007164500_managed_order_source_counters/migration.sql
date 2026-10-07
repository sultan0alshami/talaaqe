-- Additive correction after native captured-counter failure; migration19 remains unchanged.
CREATE OR REPLACE FUNCTION infame_managed_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CampaignBrief"%ROWTYPE; sel "CampaignContextSelection"%ROWTYPE; v "BrandContextVersion"%ROWTYPE;
 campaign_source "Campaign"%ROWTYPE; planning_source "CampaignPlanningState"%ROWTYPE;
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
 SELECT * INTO campaign_source FROM "Campaign" WHERE id=NEW."campaignId";
 SELECT * INTO planning_source FROM "CampaignPlanningState" WHERE "campaignId"=NEW."campaignId";
 IF campaign_source.id IS NULL OR campaign_source.revision<>NEW."campaignRevision"
  OR campaign_source."currentBriefVersion" IS DISTINCT FROM NEW."briefVersion"
  OR planning_source."campaignId" IS NULL OR planning_source."workspaceId"<>NEW."workspaceId"
  OR planning_source.revision<>NEW."planningRevision" OR planning_source."selectionId"<>NEW."selectionId"
  OR planning_source."selectionRevision"<>NEW."selectionRevision"
  THEN RAISE EXCEPTION 'Managed captured current source' USING ERRCODE='23514'; END IF;
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
