-- Additive private reference lineage; historical JSON and hashes are untouched.
CREATE UNIQUE INDEX "PrivateAsset_id_purpose_ownerUserId_key" ON "PrivateAsset"(id,purpose,"ownerUserId");

CREATE TABLE "ContextAssetBinding" (
 id TEXT PRIMARY KEY, "contextId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "assetId" TEXT NOT NULL UNIQUE, "uploaderUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 purpose TEXT NOT NULL CHECK(purpose='MARKETING_REFERENCE'), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"contextId","workspaceId"),
 FOREIGN KEY("contextId","workspaceId") REFERENCES "BrandContext"(id,"workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT,
 FOREIGN KEY("assetId",purpose,"uploaderUserId") REFERENCES "PrivateAsset"(id,purpose,"ownerUserId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ContextAssetBinding_contextId_workspaceId_idx" ON "ContextAssetBinding"("contextId","workspaceId");
CREATE TABLE "ContextReferenceManifest" (
 id TEXT PRIMARY KEY, "contextId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "referenceRevision" INTEGER NOT NULL CHECK("referenceRevision" BETWEEN 1 AND 2147483646),
 hash TEXT NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'), "itemCount" INTEGER NOT NULL CHECK("itemCount" BETWEEN 0 AND 20),
 items JSONB NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)="itemCount" AND infame_planning_json_bytes(items)<=65536),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("contextId","referenceRevision"), UNIQUE(id,"contextId","workspaceId"), UNIQUE(id,"contextId","workspaceId","referenceRevision",hash),
 FOREIGN KEY("contextId","workspaceId") REFERENCES "BrandContext"(id,"workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "ContextReferenceManifest_contextId_workspaceId_idx" ON "ContextReferenceManifest"("contextId","workspaceId");
CREATE TABLE "ContextReferenceState" (
 "contextId" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL,
 "referenceRevision" INTEGER NOT NULL CHECK("referenceRevision" BETWEEN 1 AND 2147483646),
 "manifestId" TEXT NOT NULL, "manifestHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("contextId","workspaceId") REFERENCES "BrandContext"(id,"workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT,
 FOREIGN KEY("manifestId","contextId","workspaceId","referenceRevision","manifestHash")
  REFERENCES "ContextReferenceManifest"(id,"contextId","workspaceId","referenceRevision",hash) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "ContextReferenceState_workspaceId_idx" ON "ContextReferenceState"("workspaceId");
CREATE INDEX "ContextReferenceState_manifest"
 ON "ContextReferenceState"("manifestId","contextId","workspaceId","referenceRevision","manifestHash");
CREATE TABLE "ContextSubmissionReferences" (
 "submissionId" TEXT PRIMARY KEY, "contextId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "referenceRevision" INTEGER NOT NULL, "manifestId" TEXT NOT NULL, "manifestHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("submissionId","contextId","workspaceId") REFERENCES "BrandContextSubmission"(id,"contextId","workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT,
 FOREIGN KEY("contextId","workspaceId") REFERENCES "BrandContext"(id,"workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT,
 FOREIGN KEY("manifestId","contextId","workspaceId","referenceRevision","manifestHash")
  REFERENCES "ContextReferenceManifest"(id,"contextId","workspaceId","referenceRevision",hash) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "ContextSubmissionReferences_contextId_workspaceId_idx" ON "ContextSubmissionReferences"("contextId","workspaceId");
CREATE INDEX "ContextSubmissionReferences_manifest"
 ON "ContextSubmissionReferences"("manifestId","contextId","workspaceId","referenceRevision","manifestHash");
CREATE FUNCTION infame_reference_receipt_valid(value JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value)='object' AND infame_planning_json_bytes(value)<=4096
  AND value ?& ARRAY['contextId','revision','referenceRevision','manifestId','manifestHash','bindingId']
  AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(value) AS keys(key) WHERE key NOT IN ('contextId','revision','referenceRevision','manifestId','manifestHash','bindingId'))
  AND jsonb_typeof(value->'contextId')='string' AND length(value->>'contextId') BETWEEN 1 AND 200
  AND jsonb_typeof(value->'manifestId')='string' AND length(value->>'manifestId') BETWEEN 1 AND 200
  AND jsonb_typeof(value->'manifestHash')='string' AND value->>'manifestHash' ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(value->'bindingId') IN ('string','null')
  AND (value->'bindingId'='null'::jsonb OR length(value->>'bindingId') BETWEEN 1 AND 200)
  AND jsonb_typeof(value->'revision')='number' AND value->>'revision' ~ '^[1-9][0-9]{0,9}$'
  AND (value->>'revision')::bigint<=2147483646
  AND jsonb_typeof(value->'referenceRevision')='number' AND value->>'referenceRevision' ~ '^[1-9][0-9]{0,9}$'
  AND (value->>'referenceRevision')::bigint<=2147483646
$$;
CREATE TABLE "ContextReferenceCommand" (
 id TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "operationKey" TEXT NOT NULL CHECK("operationKey" ~ '^[a-f0-9-]{36}$'),
 "payloadHash" TEXT NOT NULL CHECK("payloadHash" ~ '^[a-f0-9]{64}$'), "contextId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('UPLOAD','REPLACE')), "manifestId" TEXT NOT NULL,
 result JSONB NOT NULL CHECK(infame_reference_receipt_valid(result)), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("actorUserId","operationKey"),
 FOREIGN KEY("contextId","workspaceId") REFERENCES "BrandContext"(id,"workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT,
 FOREIGN KEY("manifestId","contextId","workspaceId") REFERENCES "ContextReferenceManifest"(id,"contextId","workspaceId") ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "ContextReferenceCommand_contextId_workspaceId_idx" ON "ContextReferenceCommand"("contextId","workspaceId");
CREATE INDEX "ContextReferenceCommand_manifestId_idx" ON "ContextReferenceCommand"("manifestId");

-- Only fixed ASCII metadata keys are accepted below. Scalar JSON encoding and
-- recursive C-key ordering match the existing JS canonicalHash for this shape.
CREATE FUNCTION infame_reference_canonical(value JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE pair RECORD; element JSONB; parts TEXT[]:=ARRAY[]::TEXT[];
BEGIN
 IF jsonb_typeof(value)='object' THEN
  FOR pair IN SELECT key,val FROM jsonb_each(value) AS entries(key,val) ORDER BY key COLLATE "C" LOOP
   parts:=array_append(parts,to_jsonb(pair.key)::text||':'||infame_reference_canonical(pair.val));
  END LOOP;
  RETURN '{'||array_to_string(parts,',')||'}';
 ELSIF jsonb_typeof(value)='array' THEN
  FOR element IN SELECT * FROM jsonb_array_elements(value) LOOP parts:=array_append(parts,infame_reference_canonical(element)); END LOOP;
  RETURN '['||array_to_string(parts,',')||']';
 END IF;
 RETURN value::text;
END $$;
CREATE FUNCTION infame_reference_manifest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item JSONB; part JSONB; ids TEXT[]:=ARRAY[]::TEXT[]; binding TEXT;
BEGIN
 -- Key-share every referenced binding in sorted order before validation. This
 -- serializes JSON insertion with DELETE and its deferred retention check.
 PERFORM id FROM "ContextAssetBinding"
  WHERE id IN (SELECT item->>'bindingId' FROM jsonb_array_elements(NEW.items) AS entries(item)) ORDER BY id FOR KEY SHARE;
 IF NEW.hash<>encode(sha256(convert_to(infame_reference_canonical(NEW.items),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Reference manifest hash mismatch' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
  IF jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['bindingId','labelOriginal','notesOriginal'])
   OR (SELECT count(*) FROM jsonb_object_keys(item))<>3 OR jsonb_typeof(item->'bindingId')<>'string' THEN
   RAISE EXCEPTION 'Reference item shape invalid' USING ERRCODE='23514'; END IF;
  binding:=item->>'bindingId';
  IF binding=ANY(ids) OR NOT EXISTS(SELECT 1 FROM "ContextAssetBinding" WHERE id=binding AND "contextId"=NEW."contextId" AND "workspaceId"=NEW."workspaceId") THEN
   RAISE EXCEPTION 'Reference item binding invalid' USING ERRCODE='23514'; END IF;
  ids:=array_append(ids,binding);
  FOREACH part IN ARRAY ARRAY[item->'labelOriginal',item->'notesOriginal'] LOOP
   IF jsonb_typeof(part)<>'object' OR NOT(part ?& ARRAY['text','language']) OR (SELECT count(*) FROM jsonb_object_keys(part))<>2
    OR jsonb_typeof(part->'text') NOT IN ('string','null') OR jsonb_typeof(part->'language') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Reference original metadata invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF jsonb_typeof(item->'labelOriginal'->'text')<>'string' OR length(item->'labelOriginal'->>'text')>200
   OR length(btrim(item->'labelOriginal'->>'text'))=0 OR length(item->'notesOriginal'->>'text')>2000 THEN
   RAISE EXCEPTION 'Reference original metadata bounds invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContextReferenceManifest_validate" BEFORE INSERT ON "ContextReferenceManifest" FOR EACH ROW EXECUTE FUNCTION infame_reference_manifest_guard();
CREATE TRIGGER "ContextReferenceManifest_immutable" BEFORE UPDATE ON "ContextReferenceManifest" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "ContextAssetBinding_immutable" BEFORE UPDATE ON "ContextAssetBinding" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "ContextSubmissionReferences_immutable" BEFORE UPDATE ON "ContextSubmissionReferences" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "ContextReferenceCommand_immutable" BEFORE UPDATE ON "ContextReferenceCommand" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();

CREATE FUNCTION infame_reference_binding_retained() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "ContextReferenceManifest" m WHERE m."contextId"=OLD."contextId" AND m.items @> jsonb_build_array(jsonb_build_object('bindingId',OLD.id))) THEN
  RAISE EXCEPTION 'Retained manifest still references binding' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ContextAssetBinding_retained" AFTER DELETE ON "ContextAssetBinding" DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION infame_reference_binding_retained();
CREATE FUNCTION infame_reference_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."referenceRevision"<>1 THEN RAISE EXCEPTION 'Initial reference revision invalid' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW."contextId",NEW."workspaceId",NEW."createdAt") IS DISTINCT FROM ROW(OLD."contextId",OLD."workspaceId",OLD."createdAt")
   OR NEW."referenceRevision"::bigint<>OLD."referenceRevision"::bigint+1 OR NEW."manifestId"=OLD."manifestId" THEN
   RAISE EXCEPTION 'Reference next revision/identity invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContextReferenceState_guard" BEFORE INSERT OR UPDATE ON "ContextReferenceState" FOR EACH ROW EXECUTE FUNCTION infame_reference_state_guard();

CREATE FUNCTION infame_reference_capture_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD; current_state RECORD;
BEGIN
 SELECT state,xmin::text::bigint AS born INTO source FROM "BrandContextSubmission"
  WHERE id=NEW."submissionId" AND "contextId"=NEW."contextId" AND "workspaceId"=NEW."workspaceId";
 SELECT * INTO current_state FROM "ContextReferenceState" WHERE "contextId"=NEW."contextId" AND "workspaceId"=NEW."workspaceId";
 IF source.state IS DISTINCT FROM 'PENDING'::"PlanningReviewState" OR source.born IS DISTINCT FROM (txid_current()%4294967296)
  OR current_state."manifestId" IS DISTINCT FROM NEW."manifestId" OR current_state."referenceRevision" IS DISTINCT FROM NEW."referenceRevision"
  OR current_state."manifestHash" IS DISTINCT FROM NEW."manifestHash" THEN
  RAISE EXCEPTION 'Reference capture must belong to fresh exact submission' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContextSubmissionReferences_guard" BEFORE INSERT ON "ContextSubmissionReferences" FOR EACH ROW EXECUTE FUNCTION infame_reference_capture_guard();
-- Capture only rows born after this migration. No historical backfill. A fresh
-- submission without draft attachments explicitly captures an empty manifest.
CREATE FUNCTION infame_reference_capture_new_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state RECORD; manifest TEXT;
BEGIN
 SELECT * INTO current_state FROM "ContextReferenceState" WHERE "contextId"=NEW."contextId" AND "workspaceId"=NEW."workspaceId";
 IF NOT FOUND THEN
  manifest:=encode(sha256(convert_to('infame-empty-references:v1:'||NEW.id,'UTF8')),'hex');
  INSERT INTO "ContextReferenceManifest"(id,"contextId","workspaceId","referenceRevision",hash,"itemCount",items,"createdAt")
   VALUES(manifest,NEW."contextId",NEW."workspaceId",1,encode(sha256(convert_to('[]','UTF8')),'hex'),0,'[]',NEW."createdAt");
  INSERT INTO "ContextReferenceState"("contextId","workspaceId","referenceRevision","manifestId","manifestHash","createdAt","updatedAt")
   VALUES(NEW."contextId",NEW."workspaceId",1,manifest,encode(sha256(convert_to('[]','UTF8')),'hex'),NEW."createdAt",NEW."createdAt");
  SELECT * INTO current_state FROM "ContextReferenceState" WHERE "contextId"=NEW."contextId";
 END IF;
 INSERT INTO "ContextSubmissionReferences"("submissionId","contextId","workspaceId","referenceRevision","manifestId","manifestHash","createdAt")
  VALUES(NEW.id,NEW."contextId",NEW."workspaceId",current_state."referenceRevision",current_state."manifestId",current_state."manifestHash",NEW."createdAt");
 RETURN NULL;
END $$;
CREATE TRIGGER "BrandContextSubmission_capture_references" AFTER INSERT ON "BrandContextSubmission" FOR EACH ROW EXECUTE FUNCTION infame_reference_capture_new_submission();
CREATE FUNCTION infame_reference_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured RECORD; current_state RECORD;
BEGIN
 IF NEW.state='APPROVED' AND OLD.state='PENDING' THEN
  SELECT * INTO captured FROM "ContextSubmissionReferences" WHERE "submissionId"=NEW.id;
  SELECT * INTO current_state FROM "ContextReferenceState" WHERE "contextId"=NEW."contextId" AND "workspaceId"=NEW."workspaceId";
  IF ROW(captured."manifestId",captured."referenceRevision",captured."manifestHash") IS DISTINCT FROM
   ROW(current_state."manifestId",current_state."referenceRevision",current_state."manifestHash") THEN
   RAISE EXCEPTION 'Reference review source stale' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BrandContextSubmission_reference_approval" BEFORE UPDATE ON "BrandContextSubmission" FOR EACH ROW EXECUTE FUNCTION infame_reference_approval_guard();
