-- Durable manual interview storage. Native application scope and hashes remain
-- required; no provider, confirmation or approval follows from SQL labels.
CREATE TABLE "CampaignAgent" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 "campaignId" TEXT NOT NULL UNIQUE CHECK("campaignId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "workspaceId" TEXT NOT NULL CHECK("workspaceId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483646),
 state JSONB NOT NULL CHECK(jsonb_typeof(state)='object' AND infame_planning_json_bytes(state)<=131072),
 "stateHash" TEXT NOT NULL CHECK("stateHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "updatedAt"<TIMESTAMP '10000-01-01' AND "updatedAt">="createdAt"),
 UNIQUE(id,"campaignId","workspaceId"),
 FOREIGN KEY("campaignId","workspaceId") REFERENCES "CampaignPlanningBinding"("campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignAgent_workspaceId_campaignId_idx" ON "CampaignAgent"("workspaceId","campaignId");
CREATE TABLE "CampaignAgentTextSource" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 "agentId" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "authorUserId" TEXT NOT NULL CHECK("authorUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=65536),
 "sourceHash" TEXT NOT NULL CHECK("sourceHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 FOREIGN KEY("agentId","campaignId","workspaceId") REFERENCES "CampaignAgent"(id,"campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("authorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignAgentTextSource_agentId_id_idx" ON "CampaignAgentTextSource"("agentId",id);
CREATE INDEX "CampaignAgentTextSource_authorUserId_idx" ON "CampaignAgentTextSource"("authorUserId");
CREATE TABLE "CampaignAgentConfirmationBatch" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 "agentId" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "confirmedByUserId" TEXT NOT NULL CHECK("confirmedByUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=262144),
 "contentHash" TEXT NOT NULL CHECK("contentHash" ~ '^[a-f0-9]{64}$'),
 "confirmedAt" TIMESTAMP(3) NOT NULL CHECK("confirmedAt">=TIMESTAMP '0001-01-01' AND "confirmedAt"<TIMESTAMP '10000-01-01'),
 FOREIGN KEY("agentId","campaignId","workspaceId") REFERENCES "CampaignAgent"(id,"campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("confirmedByUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignAgentConfirmationBatch_agentId_id_idx" ON "CampaignAgentConfirmationBatch"("agentId",id);
CREATE INDEX "CampaignAgentConfirmationBatch_confirmedByUserId_idx" ON "CampaignAgentConfirmationBatch"("confirmedByUserId");
CREATE TABLE "CampaignAgentCommand" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 "actorUserId" TEXT NOT NULL CHECK("actorUserId" COLLATE "C" ~ '^[!-~]{1,200}$'), "operationKey" UUID NOT NULL,
 "agentId" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('INITIALIZE','SET_PREFERENCES','APPEND_TEXT','CONFIRM_FIELDS','GENERATE_PROFILE')),
 "payloadHash" TEXT NOT NULL CHECK("payloadHash" ~ '^[a-f0-9]{64}$'),
 result JSONB NOT NULL CHECK(jsonb_typeof(result)='object' AND infame_planning_json_bytes(result)<=4096),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 UNIQUE("actorUserId","operationKey"),
 FOREIGN KEY("agentId","campaignId","workspaceId") REFERENCES "CampaignAgent"(id,"campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("actorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignAgentCommand_agentId_id_idx" ON "CampaignAgentCommand"("agentId",id);

CREATE FUNCTION infame_campaign_agent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace "PlanningWorkspace"%ROWTYPE;
BEGIN
 SELECT * INTO workspace FROM "PlanningWorkspace" WHERE id=NEW."workspaceId";
 IF workspace.id IS NULL OR NEW.state->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR NEW.state->'id' IS DISTINCT FROM to_jsonb(NEW.id) OR NEW.state->'revision' IS DISTINCT FROM to_jsonb(NEW.revision)
  OR NEW.state->'binding'->'workspaceId' IS DISTINCT FROM to_jsonb(NEW."workspaceId")
  OR NEW.state->'binding'->'campaignId' IS DISTINCT FROM to_jsonb(NEW."campaignId")
  OR NEW.state->'binding'->'scope' IS DISTINCT FROM
   (CASE WHEN workspace.scope='OWN_BRAND' THEN jsonb_build_object('kind','OWN_BRAND','brandId',workspace."brandId") ELSE jsonb_build_object('kind','CLIENT','clientId',workspace."clientId") END)
  OR NEW.state->'stateHash' IS DISTINCT FROM to_jsonb(NEW."stateHash")
  OR (NEW.state->>'updatedAt')::timestamp(3) IS DISTINCT FROM NEW."updatedAt" THEN
  RAISE EXCEPTION 'Campaign agent scalar binding' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 THEN RAISE EXCEPTION 'Campaign agent initial revision' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW."campaignId",NEW."workspaceId",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."campaignId",OLD."workspaceId",OLD."createdAt")
   OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW."updatedAt"<OLD."updatedAt" THEN
   RAISE EXCEPTION 'Campaign agent sequential revision' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Campaign agent timestamp binding' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "CampaignAgent_guard" BEFORE INSERT OR UPDATE ON "CampaignAgent" FOR EACH ROW EXECUTE FUNCTION infame_campaign_agent_guard();

CREATE FUNCTION infame_campaign_agent_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "CampaignAgent"%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') THEN
  RAISE EXCEPTION 'Unsupported campaign source isolation' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM "CampaignAgent" WHERE id=NEW."agentId" FOR UPDATE;
 IF parent.id IS NULL OR parent."campaignId" IS DISTINCT FROM NEW."campaignId" OR parent."workspaceId" IS DISTINCT FROM NEW."workspaceId"
  OR NEW.content->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NEW.content->'id' IS DISTINCT FROM to_jsonb(NEW.id)
  OR NEW.content->'binding' IS DISTINCT FROM parent.state->'binding' OR NEW.content->>'kind' IS DISTINCT FROM 'CUSTOMER_TEXT'
  OR NEW.content->'authorUserId' IS DISTINCT FROM to_jsonb(NEW."authorUserId") OR NEW.content->'sourceHash' IS DISTINCT FROM to_jsonb(NEW."sourceHash")
  OR (NEW.content->>'createdAt')::timestamp(3) IS DISTINCT FROM NEW."createdAt"
  OR (SELECT count(*) FROM "CampaignAgentTextSource" WHERE "agentId"=NEW."agentId")>=64 THEN
  RAISE EXCEPTION 'Campaign agent text source binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Campaign agent text timestamp binding' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "CampaignAgentTextSource_guard" BEFORE INSERT ON "CampaignAgentTextSource" FOR EACH ROW EXECUTE FUNCTION infame_campaign_agent_source_guard();

CREATE FUNCTION infame_campaign_agent_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent "CampaignAgent"%ROWTYPE; item JSONB; item_id TEXT; ids TEXT[]:=ARRAY[]::TEXT[];
BEGIN
 SELECT * INTO parent FROM "CampaignAgent" WHERE id=NEW."agentId" FOR UPDATE;
 IF parent.id IS NULL OR parent."campaignId" IS DISTINCT FROM NEW."campaignId" OR parent."workspaceId" IS DISTINCT FROM NEW."workspaceId"
  OR NEW.content->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NEW.content->'id' IS DISTINCT FROM to_jsonb(NEW.id)
  OR NEW.content->'agentId' IS DISTINCT FROM to_jsonb(NEW."agentId") OR NEW.content->'binding' IS DISTINCT FROM parent.state->'binding'
  OR NEW.content->'confirmedByUserId' IS DISTINCT FROM to_jsonb(NEW."confirmedByUserId")
  OR NEW.content->'contentHash' IS DISTINCT FROM to_jsonb(NEW."contentHash")
  OR (NEW.content->>'confirmedAt')::timestamp(3) IS DISTINCT FROM NEW."confirmedAt"
  OR jsonb_typeof(NEW.content->'confirmations') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Campaign agent confirmation batch binding' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(NEW.content->'confirmations')<>30 THEN RAISE EXCEPTION 'Campaign agent confirmation count' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'confirmations') LOOP
  item_id:=item->>'id';
  IF item_id IS NULL OR item_id=ANY(ids) OR item->'confirmationBatchId' IS DISTINCT FROM to_jsonb(NEW.id)
   OR item->'binding' IS DISTINCT FROM NEW.content->'binding' OR item->'reviewedSnapshot' IS DISTINCT FROM NEW.content->'reviewedSnapshot'
   OR item->'confirmedByUserId' IS DISTINCT FROM to_jsonb(NEW."confirmedByUserId") OR item->'confirmedAt' IS DISTINCT FROM NEW.content->'confirmedAt' THEN
   RAISE EXCEPTION 'Campaign agent confirmation member' USING ERRCODE='23514'; END IF;
  ids:=array_append(ids,item_id);
 END LOOP;
 RETURN NEW;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION 'Campaign agent confirmation timestamp binding' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "CampaignAgentConfirmationBatch_guard" BEFORE INSERT ON "CampaignAgentConfirmationBatch" FOR EACH ROW EXECUTE FUNCTION infame_campaign_agent_batch_guard();

CREATE FUNCTION infame_campaign_agent_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item TEXT;
BEGIN
 IF NEW.result-ARRAY['agentId','campaignId','workspaceId','action','agentRevision','campaignRevision','planningRevision','sourceId','confirmationBatchId','briefId','briefVersion']<>'{}'::jsonb
  OR NOT(NEW.result ?& ARRAY['agentId','campaignId','workspaceId','action','agentRevision','campaignRevision','planningRevision','sourceId','confirmationBatchId','briefId','briefVersion'])
  OR NEW.result->'agentId' IS DISTINCT FROM to_jsonb(NEW."agentId") OR NEW.result->'campaignId' IS DISTINCT FROM to_jsonb(NEW."campaignId")
  OR NEW.result->'workspaceId' IS DISTINCT FROM to_jsonb(NEW."workspaceId") OR NEW.result->'action' IS DISTINCT FROM to_jsonb(NEW.action) THEN
  RAISE EXCEPTION 'Campaign agent command receipt identity' USING ERRCODE='23514'; END IF;
 FOREACH item IN ARRAY ARRAY['agentRevision','campaignRevision','planningRevision'] LOOP
  IF jsonb_typeof(NEW.result->item) IS DISTINCT FROM 'number' OR (NEW.result->>item) !~ '^[1-9][0-9]*$'
   OR (NEW.result->>item)::numeric NOT BETWEEN 1 AND 2147483646 THEN
   RAISE EXCEPTION 'Campaign agent command receipt revision' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOREACH item IN ARRAY ARRAY['sourceId','confirmationBatchId','briefId'] LOOP
  IF jsonb_typeof(NEW.result->item) NOT IN ('string','null')
   OR (jsonb_typeof(NEW.result->item)='string' AND (NEW.result->>item) COLLATE "C" !~ '^[!-~]{1,200}$') THEN
   RAISE EXCEPTION 'Campaign agent command receipt reference' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (NEW.action='APPEND_TEXT') IS DISTINCT FROM (jsonb_typeof(NEW.result->'sourceId')='string')
  OR (NEW.action IN ('CONFIRM_FIELDS','GENERATE_PROFILE')) IS DISTINCT FROM (jsonb_typeof(NEW.result->'confirmationBatchId')='string')
  OR (NEW.action='GENERATE_PROFILE') IS DISTINCT FROM (jsonb_typeof(NEW.result->'briefId')='string')
  OR (NEW.action<>'GENERATE_PROFILE' AND NEW.result->'briefVersion' IS DISTINCT FROM 'null'::jsonb)
  OR (NEW.action='GENERATE_PROFILE' AND (jsonb_typeof(NEW.result->'briefVersion') IS DISTINCT FROM 'number'
   OR (NEW.result->>'briefVersion') !~ '^[1-9][0-9]*$' OR (NEW.result->>'briefVersion')::numeric NOT BETWEEN 1 AND 2147483646)) THEN
  RAISE EXCEPTION 'Campaign agent command receipt pairs' USING ERRCODE='23514'; END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Campaign agent command receipt value' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "CampaignAgentCommand_guard" BEFORE INSERT ON "CampaignAgentCommand" FOR EACH ROW EXECUTE FUNCTION infame_campaign_agent_command_guard();
CREATE TRIGGER "CampaignAgentTextSource_immutable" BEFORE UPDATE ON "CampaignAgentTextSource" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "CampaignAgentConfirmationBatch_immutable" BEFORE UPDATE ON "CampaignAgentConfirmationBatch" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "CampaignAgentCommand_immutable" BEFORE UPDATE ON "CampaignAgentCommand" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
