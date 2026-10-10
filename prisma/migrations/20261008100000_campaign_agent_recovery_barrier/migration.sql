-- Dedicated metadata-only recovery journal action. No new table or authority.
ALTER TABLE "CampaignAgentCommand" DROP CONSTRAINT "CampaignAgentCommand_action_check";
ALTER TABLE "CampaignAgentCommand" ADD CONSTRAINT "CampaignAgentCommand_action_check"
 CHECK(action IN ('INITIALIZE','SET_PREFERENCES','APPEND_TEXT','CONFIRM_FIELDS','GENERATE_PROFILE','RECOVERY_BARRIER'));
DROP TRIGGER "CampaignAgentCommand_guard" ON "CampaignAgentCommand";
CREATE TRIGGER "CampaignAgentCommand_guard" BEFORE INSERT ON "CampaignAgentCommand"
 FOR EACH ROW WHEN (NEW.action<>'RECOVERY_BARRIER') EXECUTE FUNCTION infame_campaign_agent_command_guard();

CREATE FUNCTION infame_campaign_agent_barrier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item TEXT; original JSONB;
BEGIN
 IF NEW.result-ARRAY['action','agentId','campaignId','workspaceId','agentRevision','campaignRevision','planningRevision','targetOperationKey','targetCommandHash','targetOutcome','originalReceipt']<>'{}'::jsonb
  OR NOT(NEW.result ?& ARRAY['action','agentId','campaignId','workspaceId','agentRevision','campaignRevision','planningRevision','targetOperationKey','targetCommandHash','targetOutcome','originalReceipt'])
  OR NEW.result->'action' IS DISTINCT FROM '"RECOVERY_BARRIER"'::jsonb
  OR NEW.result->'agentId' IS DISTINCT FROM to_jsonb(NEW."agentId")
  OR NEW.result->'campaignId' IS DISTINCT FROM to_jsonb(NEW."campaignId")
  OR NEW.result->'workspaceId' IS DISTINCT FROM to_jsonb(NEW."workspaceId") THEN
  RAISE EXCEPTION 'Campaign recovery barrier receipt identity' USING ERRCODE='23514'; END IF;
 FOREACH item IN ARRAY ARRAY['agentRevision','campaignRevision','planningRevision'] LOOP
  IF jsonb_typeof(NEW.result->item) IS DISTINCT FROM 'number' OR (NEW.result->>item) !~ '^[1-9][0-9]*$'
   OR (NEW.result->>item)::numeric NOT BETWEEN 1 AND 2147483646 THEN
   RAISE EXCEPTION 'Campaign recovery barrier revision' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF jsonb_typeof(NEW.result->'targetOperationKey') IS DISTINCT FROM 'string'
  OR (NEW.result->>'targetOperationKey')::uuid=NEW."operationKey"
  OR jsonb_typeof(NEW.result->'targetCommandHash') IS DISTINCT FROM 'string'
  OR (NEW.result->>'targetCommandHash') !~ '^[a-f0-9]{64}$'
  OR NEW.result->'targetOutcome' NOT IN ('"COMMITTED"'::jsonb,'"FENCED"'::jsonb) THEN
  RAISE EXCEPTION 'Campaign recovery barrier target' USING ERRCODE='23514'; END IF;
 original:=NEW.result->'originalReceipt';
 IF NEW.result->>'targetOutcome'='FENCED' THEN
  IF original IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Fenced recovery has no receipt' USING ERRCODE='23514'; END IF;
 ELSE
  IF jsonb_typeof(original) IS DISTINCT FROM 'object'
   OR original-ARRAY['agentId','campaignId','workspaceId','action','agentRevision','campaignRevision','planningRevision','sourceId','confirmationBatchId','briefId','briefVersion','replayed']<>'{}'::jsonb
   OR NOT(original ?& ARRAY['agentId','campaignId','workspaceId','action','agentRevision','campaignRevision','planningRevision','sourceId','confirmationBatchId','briefId','briefVersion','replayed'])
   OR original->'agentId' IS DISTINCT FROM to_jsonb(NEW."agentId") OR original->'campaignId' IS DISTINCT FROM to_jsonb(NEW."campaignId")
   OR original->'workspaceId' IS DISTINCT FROM to_jsonb(NEW."workspaceId") OR original->'replayed' IS DISTINCT FROM 'true'::jsonb
   OR original->>'action' NOT IN ('INITIALIZE','SET_PREFERENCES','APPEND_TEXT','CONFIRM_FIELDS','GENERATE_PROFILE') THEN
   RAISE EXCEPTION 'Campaign recovery original receipt scope' USING ERRCODE='23514'; END IF;
  FOREACH item IN ARRAY ARRAY['agentRevision','campaignRevision','planningRevision'] LOOP
   IF jsonb_typeof(original->item) IS DISTINCT FROM 'number' OR (original->>item) !~ '^[1-9][0-9]*$'
    OR (original->>item)::numeric NOT BETWEEN 1 AND 2147483646
    OR (original->>item)::numeric>(NEW.result->>item)::numeric
    OR (item='agentRevision' AND (original->>item)::numeric>=(NEW.result->>item)::numeric) THEN
    RAISE EXCEPTION 'Campaign recovery original receipt horizon' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOREACH item IN ARRAY ARRAY['sourceId','confirmationBatchId','briefId'] LOOP
   IF jsonb_typeof(original->item) NOT IN ('string','null')
    OR (jsonb_typeof(original->item)='string' AND (original->>item) COLLATE "C" !~ '^[!-~]{1,200}$') THEN
    RAISE EXCEPTION 'Campaign recovery original receipt references' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (original->>'action'='APPEND_TEXT') IS DISTINCT FROM (jsonb_typeof(original->'sourceId')='string')
   OR (original->>'action' IN ('CONFIRM_FIELDS','GENERATE_PROFILE')) IS DISTINCT FROM (jsonb_typeof(original->'confirmationBatchId')='string')
   OR (original->>'action'='GENERATE_PROFILE') IS DISTINCT FROM (jsonb_typeof(original->'briefId')='string')
   OR (original->>'action'<>'GENERATE_PROFILE' AND original->'briefVersion' IS DISTINCT FROM 'null'::jsonb)
   OR (original->>'action'='GENERATE_PROFILE' AND (jsonb_typeof(original->'briefVersion') IS DISTINCT FROM 'number'
    OR (original->>'briefVersion') !~ '^[1-9][0-9]*$' OR (original->>'briefVersion')::numeric NOT BETWEEN 1 AND 2147483646)) THEN
   RAISE EXCEPTION 'Campaign recovery original receipt pairs' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Campaign recovery barrier receipt value' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "CampaignAgentCommand_barrier_guard" BEFORE INSERT ON "CampaignAgentCommand"
 FOR EACH ROW WHEN (NEW.action='RECOVERY_BARRIER') EXECUTE FUNCTION infame_campaign_agent_barrier_guard();
