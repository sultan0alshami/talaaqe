-- M12 P1 candidate: new owner-private storage only. No runtime/native access grant.
-- Reuses applied compact-JSON, scalar/catalog, UTF16/original-text and UTC helpers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION infame_external_collaboration_next_revision(current_revision integer)
RETURNS integer LANGUAGE plpgsql IMMUTABLE CALLED ON NULL INPUT AS $$
BEGIN
  IF current_revision IS NULL OR current_revision < 1 OR current_revision > 2147483645 THEN
    RAISE EXCEPTION 'External collaboration revision exhausted or invalid' USING ERRCODE='23514';
  END IF;
  RETURN current_revision + 1;
END $$;
CREATE FUNCTION infame_external_collaboration_timestamp(value timestamp)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (isfinite(value) AND value >= timestamp '0001-01-01 00:00:00'
    AND value < timestamp '10000-01-01 00:00:00') IS TRUE $$;
CREATE FUNCTION infame_external_collaboration_uuid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (jsonb_typeof(value)='string' AND (value#>>'{}') COLLATE "C" ~
    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$') IS TRUE $$;
CREATE FUNCTION infame_external_collaboration_status(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (value IN ('DRAFT','PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')) IS TRUE $$;
CREATE FUNCTION infame_external_collaboration_transition(previous text, next_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE previous
    WHEN 'DRAFT' THEN next_status IN ('PLANNED','IN_PROGRESS','CANCELLED')
    WHEN 'PLANNED' THEN next_status IN ('DRAFT','IN_PROGRESS','CANCELLED')
    WHEN 'IN_PROGRESS' THEN next_status IN ('PLANNED','COMPLETED','CANCELLED')
    WHEN 'COMPLETED' THEN next_status='IN_PROGRESS'
    WHEN 'CANCELLED' THEN next_status='DRAFT'
    ELSE false END) IS TRUE $$;
CREATE FUNCTION infame_external_collaboration_checklist(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; reached text[]:=ARRAY[]::text[]; item_id text;
BEGIN
  IF NOT infame_planning_ai_array(value,0,30) THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF NOT infame_planning_ai_closed(item,ARRAY['id','label','done'])
      OR NOT infame_external_collaboration_uuid(item->'id')
      OR NOT infame_planning_ai_text(item->'label',500)
      OR jsonb_typeof(item->'done') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    item_id:=lower(item->>'id');
    IF item_id=ANY(reached) THEN RETURN false; END IF;
    reached:=array_append(reached,item_id);
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION infame_external_collaboration_period(value jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE zone text;
BEGIN
  IF NOT infame_planning_ai_closed(value,ARRAY['startsAt','endsAt','timeZone'])
    OR NOT infame_planning_ai_utc(value->'startsAt') OR NOT infame_planning_ai_utc(value->'endsAt')
    OR NOT infame_planning_ai_string(value->'timeZone',100) THEN RETURN false; END IF;
  zone:=value->>'timeZone';
  RETURN ((value->>'startsAt')::timestamp(3)<(value->>'endsAt')::timestamp(3)
    AND (zone='UTC' OR zone COLLATE "C" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)+$')
    AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE lower(name COLLATE "C")=lower(zone COLLATE "C"))) IS TRUE;
END $$;
CREATE FUNCTION infame_external_collaboration_details(value jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT infame_planning_ai_closed(value,ARRAY['schemaVersion','clientDisplay','campaignDisplay','declaredValue','period','notes','brief','checklist'])
    OR infame_planning_json_bytes(value)>262144 OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR NOT infame_planning_ai_text(value->'clientDisplay',200) OR NOT infame_planning_ai_text(value->'campaignDisplay',200)
    OR NOT infame_external_collaboration_checklist(value->'checklist') THEN RETURN false; END IF;
  IF value->'declaredValue' IS DISTINCT FROM 'null'::jsonb
    AND infame_planning_ai_field_value('budget',value->'declaredValue') IS NOT TRUE THEN RETURN false; END IF;
  IF value->'period' IS DISTINCT FROM 'null'::jsonb
    AND infame_external_collaboration_period(value->'period') IS NOT TRUE THEN RETURN false; END IF;
  IF value->'notes' IS DISTINCT FROM 'null'::jsonb AND NOT infame_planning_ai_text(value->'notes',10000) THEN RETURN false; END IF;
  IF value->'brief' IS DISTINCT FROM 'null'::jsonb AND NOT infame_planning_ai_text(value->'brief',20000) THEN RETURN false; END IF;
  RETURN true;
END $$;
CREATE FUNCTION infame_external_collaboration_receipt(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE action text;
BEGIN
  IF NOT infame_planning_ai_closed(value,ARRAY['operationKey','collaborationId','action','revision','status','archived','attachmentId'])
    OR infame_planning_json_bytes(value)>4096 OR NOT infame_external_collaboration_uuid(value->'operationKey')
    OR NOT infame_planning_ai_jid(value->'collaborationId') OR NOT infame_planning_ai_jint(value->'revision',1,2147483646)
    OR jsonb_typeof(value->'action') IS DISTINCT FROM 'string' OR jsonb_typeof(value->'status') IS DISTINCT FROM 'string'
    OR NOT infame_external_collaboration_status(value->>'status') OR jsonb_typeof(value->'archived') IS DISTINCT FROM 'boolean'
    OR NOT infame_planning_ai_jid(value->'attachmentId',true) THEN RETURN false; END IF;
  action:=value->>'action';
  IF action NOT IN ('CREATE','SAVE_DETAILS','SET_STATUS','SET_CHECKLIST','SET_CHECKLIST_DONE','ATTACH_FILE','REMOVE_ATTACHMENT','ARCHIVE','RESTORE') THEN RETURN false; END IF;
  IF (action IN ('ATTACH_FILE','REMOVE_ATTACHMENT')) IS DISTINCT FROM (value->'attachmentId'<>'null'::jsonb) THEN RETURN false; END IF;
  IF action='CREATE' THEN
    IF value->'revision' IS DISTINCT FROM '1'::jsonb OR value->>'status'<>'DRAFT' OR value->'archived' IS DISTINCT FROM 'false'::jsonb THEN RETURN false; END IF;
  ELSIF (value->>'revision')::integer<2 THEN RETURN false; END IF;
  RETURN value->'archived'=to_jsonb(action='ARCHIVE');
END $$;

CREATE TABLE "ExternalCollaboration" (
  id text PRIMARY KEY, "ownerUserId" text NOT NULL, revision integer NOT NULL,
  status text NOT NULL, archived boolean NOT NULL, "detailsJson" jsonb NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "ExternalCollaboration_shape" CHECK ((infame_planning_ai_id(id) AND infame_planning_ai_id("ownerUserId")
    AND revision BETWEEN 1 AND 2147483646 AND infame_external_collaboration_status(status)
    AND infame_external_collaboration_details("detailsJson") AND infame_external_collaboration_timestamp("createdAt")
    AND infame_external_collaboration_timestamp("updatedAt") AND "updatedAt">="createdAt") IS TRUE),
  CONSTRAINT "ExternalCollaboration_owner" FOREIGN KEY ("ownerUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExternalCollaboration_id_ownerUserId_key" UNIQUE(id,"ownerUserId")
);
CREATE INDEX "ExternalCollaboration_ownerUserId_id_idx" ON "ExternalCollaboration"("ownerUserId",id);
CREATE FUNCTION infame_external_collaboration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision IS DISTINCT FROM 1 OR NEW.status IS DISTINCT FROM 'DRAFT' OR NEW.archived IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Invalid initial external collaboration' USING ERRCODE='23514'; END IF;
  ELSE
    IF ROW(NEW.id,NEW."ownerUserId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."ownerUserId",OLD."createdAt")
      OR NEW.revision IS DISTINCT FROM infame_external_collaboration_next_revision(OLD.revision)
      OR NEW."updatedAt"<OLD."updatedAt" THEN
      RAISE EXCEPTION 'External collaboration identity/revision is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.archived THEN
      IF NEW.archived IS DISTINCT FROM false OR NEW.status IS DISTINCT FROM OLD.status OR NEW."detailsJson" IS DISTINCT FROM OLD."detailsJson" THEN
        RAISE EXCEPTION 'Archived collaboration can only restore' USING ERRCODE='23514'; END IF;
    ELSIF NEW.archived IS DISTINCT FROM OLD.archived THEN
      IF NEW.status IS DISTINCT FROM OLD.status OR NEW."detailsJson" IS DISTINCT FROM OLD."detailsJson" THEN
        RAISE EXCEPTION 'Archive preserves status and original details' USING ERRCODE='23514'; END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT infame_external_collaboration_transition(OLD.status,NEW.status) THEN
      RAISE EXCEPTION 'Invalid self-reported status transition' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ExternalCollaboration_guard" BEFORE INSERT OR UPDATE ON "ExternalCollaboration"
  FOR EACH ROW EXECUTE FUNCTION infame_external_collaboration_guard();

CREATE TABLE "ExternalCollaborationAttachment" (
  id text PRIMARY KEY, "collaborationId" text NOT NULL, "ownerUserId" text NOT NULL, "assetId" text NOT NULL UNIQUE,
  "assetPurpose" text NOT NULL DEFAULT 'EXTERNAL_COLLABORATION_ATTACHMENT', label jsonb NOT NULL,
  "attachedAt" timestamp(3) NOT NULL, "removedAt" timestamp(3),
  CONSTRAINT "ExternalCollaborationAttachment_shape" CHECK ((infame_planning_ai_id(id) AND infame_planning_ai_id("collaborationId")
    AND infame_planning_ai_id("ownerUserId") AND infame_planning_ai_id("assetId")
    AND "assetPurpose"='EXTERNAL_COLLABORATION_ATTACHMENT' AND infame_planning_ai_text(label,200)
    AND infame_external_collaboration_timestamp("attachedAt") AND ("removedAt" IS NULL
      OR infame_external_collaboration_timestamp("removedAt") AND "removedAt">="attachedAt")) IS TRUE),
  CONSTRAINT "ExternalCollaborationAttachment_owner_parent" FOREIGN KEY ("collaborationId","ownerUserId")
    REFERENCES "ExternalCollaboration"(id,"ownerUserId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Reuse the applied PrivateAsset_id_purpose_ownerUserId_key; no duplicate index.
  CONSTRAINT "ExternalCollaborationAttachment_owned_purpose" FOREIGN KEY ("assetId","assetPurpose","ownerUserId")
    REFERENCES "PrivateAsset"(id,purpose,"ownerUserId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ExternalCollaborationAttachment_parent_id_idx" ON "ExternalCollaborationAttachment"("collaborationId",id);
CREATE INDEX "ExternalCollaborationAttachment_active_parent_idx" ON "ExternalCollaborationAttachment"("collaborationId") WHERE "removedAt" IS NULL;
CREATE FUNCTION infame_external_collaboration_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "ExternalCollaboration"; asset "PrivateAsset"; active_count bigint;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'removedAt') IS DISTINCT FROM (to_jsonb(OLD)-'removedAt')
      OR OLD."removedAt" IS NOT NULL OR NEW."removedAt" IS NULL OR NEW."removedAt"<OLD."attachedAt" THEN
      RAISE EXCEPTION 'Attachment permits only its first tombstone' USING ERRCODE='23514'; END IF;
    -- UPDATE already owns the child: the service prelocks this parent first.
    SELECT * INTO parent FROM "ExternalCollaboration" WHERE id=OLD."collaborationId" AND "ownerUserId"=OLD."ownerUserId" FOR UPDATE NOWAIT;
  ELSE
    IF NEW."removedAt" IS NOT NULL THEN RAISE EXCEPTION 'New attachment must be active' USING ERRCODE='23514'; END IF;
    SELECT * INTO parent FROM "ExternalCollaboration" WHERE id=NEW."collaborationId" AND "ownerUserId"=NEW."ownerUserId" FOR UPDATE;
  END IF;
  IF parent.id IS NULL OR parent.archived THEN RAISE EXCEPTION 'Current unarchived exact parent required' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT count(*) INTO active_count FROM "ExternalCollaborationAttachment" WHERE "collaborationId"=parent.id AND "removedAt" IS NULL;
    IF active_count>=20 THEN RAISE EXCEPTION 'External collaboration attachment limit reached' USING ERRCODE='23514'; END IF;
    SELECT * INTO asset FROM "PrivateAsset" WHERE id=NEW."assetId" AND "ownerUserId"=NEW."ownerUserId" AND purpose=NEW."assetPurpose" FOR SHARE;
    IF asset.id IS NULL OR asset."deletedAt" IS NOT NULL OR asset."contentType" NOT IN ('image/png','image/jpeg','image/webp','application/pdf')
      OR asset.size NOT BETWEEN 1 AND 10485760 THEN
      RAISE EXCEPTION 'Exact owned usable-purpose asset metadata required' USING ERRCODE='23514'; END IF;
  END IF;
  -- Tombstoning does not require bytes or an undeleted asset.
  RETURN NEW;
END $$;
CREATE TRIGGER "ExternalCollaborationAttachment_guard" BEFORE INSERT OR UPDATE ON "ExternalCollaborationAttachment"
  FOR EACH ROW EXECUTE FUNCTION infame_external_collaboration_attachment_guard();
CREATE FUNCTION infame_external_collaboration_attachment_touch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE child_time timestamp(3);
BEGIN
  child_time:=CASE WHEN TG_OP='INSERT' THEN NEW."attachedAt" ELSE NEW."removedAt" END;
  UPDATE "ExternalCollaboration" SET revision=infame_external_collaboration_next_revision(revision),
    "updatedAt"=GREATEST("updatedAt",child_time) WHERE id=NEW."collaborationId" AND "ownerUserId"=NEW."ownerUserId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact external collaboration parent touch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ExternalCollaborationAttachment_touch" AFTER INSERT OR UPDATE ON "ExternalCollaborationAttachment"
  FOR EACH ROW EXECUTE FUNCTION infame_external_collaboration_attachment_touch();

CREATE TABLE "ExternalCollaborationCommand" (
  id text PRIMARY KEY, "actorUserId" text NOT NULL, "operationKey" uuid NOT NULL, "collaborationId" text NOT NULL,
  action text NOT NULL, "payloadHash" text NOT NULL, "resultJson" jsonb NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  CONSTRAINT "ExternalCollaborationCommand_shape" CHECK ((infame_planning_ai_id(id) AND infame_planning_ai_id("actorUserId")
    AND infame_planning_ai_id("collaborationId") AND "payloadHash" COLLATE "C" ~ '^[a-f0-9]{64}$'
    AND infame_external_collaboration_receipt("resultJson") AND infame_external_collaboration_timestamp("createdAt")) IS TRUE),
  CONSTRAINT "ExternalCollaborationCommand_actor" FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExternalCollaborationCommand_owner_parent" FOREIGN KEY ("collaborationId","actorUserId")
    REFERENCES "ExternalCollaboration"(id,"ownerUserId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExternalCollaborationCommand_actorUserId_operationKey_key" UNIQUE("actorUserId","operationKey")
);
CREATE INDEX "ExternalCollaborationCommand_parent_id_idx" ON "ExternalCollaborationCommand"("collaborationId",id);
CREATE FUNCTION infame_external_collaboration_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "ExternalCollaboration"; binding "ExternalCollaborationAttachment";
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'External collaboration command receipt is immutable' USING ERRCODE='23514'; END IF;
  IF NOT infame_external_collaboration_receipt(NEW."resultJson") THEN RAISE EXCEPTION 'Invalid scalar external receipt' USING ERRCODE='23514'; END IF;
  SELECT * INTO parent FROM "ExternalCollaboration" WHERE id=NEW."collaborationId" AND "ownerUserId"=NEW."actorUserId" FOR SHARE;
  IF parent.id IS NULL OR NEW."resultJson"->>'collaborationId' IS DISTINCT FROM parent.id
    OR (NEW."resultJson"->>'operationKey')::uuid IS DISTINCT FROM NEW."operationKey"
    OR NEW."resultJson"->>'action' IS DISTINCT FROM NEW.action OR (NEW."resultJson"->>'revision')::integer IS DISTINCT FROM parent.revision
    OR NEW."resultJson"->>'status' IS DISTINCT FROM parent.status OR (NEW."resultJson"->>'archived')::boolean IS DISTINCT FROM parent.archived
    OR NEW."createdAt"<parent."createdAt" OR NEW."createdAt"<parent."updatedAt" THEN
    RAISE EXCEPTION 'External receipt must bind current exact owner/resource/state' USING ERRCODE='23514'; END IF;
  IF NEW.action IN ('ATTACH_FILE','REMOVE_ATTACHMENT') THEN
    SELECT * INTO binding FROM "ExternalCollaborationAttachment" WHERE id=NEW."resultJson"->>'attachmentId'
      AND "collaborationId"=parent.id AND "ownerUserId"=parent."ownerUserId" FOR SHARE;
    IF binding.id IS NULL OR binding."attachedAt">NEW."createdAt"
      OR (NEW.action='ATTACH_FILE' AND binding."removedAt" IS NOT NULL)
      OR (NEW.action='REMOVE_ATTACHMENT' AND (binding."removedAt" IS NULL OR binding."removedAt">NEW."createdAt")) THEN
      RAISE EXCEPTION 'External receipt requires its exact active/tombstoned attachment' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ExternalCollaborationCommand_guard" BEFORE INSERT OR UPDATE ON "ExternalCollaborationCommand"
  FOR EACH ROW EXECUTE FUNCTION infame_external_collaboration_command_guard();
COMMIT;
