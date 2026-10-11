-- Native holds and inclusion slots only. No provider, provisioning, result or
-- successful consumption exists in v1. Preserve rather than rewrite history.
BEGIN;
-- Close the migration32 counter-write race until all new constraints commit.
LOCK TABLE "PlanningAiCycle" IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "PlanningAiCycle" WHERE held <> 0 OR consumed <> 0) THEN
    RAISE EXCEPTION 'Occupied planning history requires reviewed session reconciliation' USING ERRCODE = '23514';
  END IF;
END $$;
ALTER TABLE "PlanningWorkspace" ADD CONSTRAINT "PlanningWorkspace_ai_scope_identity"
  UNIQUE (id,scope,"brandId","organizationId","clientId");
ALTER TABLE "PlanningAiSeat" ADD CONSTRAINT "PlanningAiSeat_creator_identity" UNIQUE (id,"poolId","userId");

CREATE TABLE "PlanningAiSession" (
  id text PRIMARY KEY, "poolId" text NOT NULL, "cycleId" text NOT NULL,
  scope "PlanningWorkspaceScope" NOT NULL, "brandId" text NOT NULL, "organizationId" text, "clientId" text,
  "workspaceId" text NOT NULL, "campaignId" text NOT NULL, "agentId" text NOT NULL,
  "createdByUserId" text NOT NULL, "creationSeatId" text NOT NULL, "creationKey" uuid NOT NULL,
  "allowanceState" text NOT NULL, "firstAttachedResultId" text,
  revision integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "PlanningAiSession_shape" CHECK ((infame_planning_ai_id(id)
    AND infame_planning_ai_id("poolId") AND infame_planning_ai_id("cycleId") AND infame_planning_ai_id("brandId")
    AND ("organizationId" IS NULL OR infame_planning_ai_id("organizationId")) AND ("clientId" IS NULL OR infame_planning_ai_id("clientId"))
    AND infame_planning_ai_id("workspaceId") AND infame_planning_ai_id("campaignId") AND infame_planning_ai_id("agentId")
    AND infame_planning_ai_id("createdByUserId") AND infame_planning_ai_id("creationSeatId")
    AND ((scope = 'OWN_BRAND' AND "organizationId" IS NULL AND "clientId" IS NULL)
      OR (scope = 'CLIENT' AND "organizationId" IS NOT NULL AND "clientId" IS NOT NULL))
    AND revision BETWEEN 1 AND 2147483646 AND "allowanceState" IN ('HELD','RELEASED') AND "firstAttachedResultId" IS NULL
    AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt" >= "createdAt") IS TRUE),
  CONSTRAINT "PlanningAiSession_cycle" FOREIGN KEY ("cycleId","poolId") REFERENCES "PlanningAiCycle"(id,"poolId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSession_workspace_brand" FOREIGN KEY ("workspaceId","brandId") REFERENCES "PlanningWorkspace"(id,"brandId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSession_workspace_scope" FOREIGN KEY ("workspaceId",scope,"brandId","organizationId","clientId") REFERENCES "PlanningWorkspace"(id,scope,"brandId","organizationId","clientId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSession_binding" FOREIGN KEY ("campaignId","workspaceId") REFERENCES "CampaignPlanningBinding"("campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSession_agent" FOREIGN KEY ("agentId","campaignId","workspaceId") REFERENCES "CampaignAgent"(id,"campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSession_creator_seat" FOREIGN KEY ("creationSeatId","poolId","createdByUserId") REFERENCES "PlanningAiSeat"(id,"poolId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSession_createdByUserId_creationKey_key" UNIQUE ("createdByUserId","creationKey"),
  CONSTRAINT "PlanningAiSession_id_poolId_key" UNIQUE (id,"poolId")
);
CREATE INDEX "PlanningAiSession_cycleId_allowanceState_idx" ON "PlanningAiSession"("cycleId","allowanceState");
CREATE INDEX "PlanningAiSession_poolId_id_idx" ON "PlanningAiSession"("poolId",id);
CREATE INDEX "PlanningAiSession_workspace_scope" ON "PlanningAiSession"("workspaceId",scope,"brandId","organizationId","clientId");
CREATE INDEX "PlanningAiSession_campaignId_workspaceId_idx" ON "PlanningAiSession"("campaignId","workspaceId");
CREATE INDEX "PlanningAiSession_agentId_campaignId_workspaceId_idx" ON "PlanningAiSession"("agentId","campaignId","workspaceId");
CREATE INDEX "PlanningAiSession_creator_seat" ON "PlanningAiSession"("creationSeatId","poolId","createdByUserId");

CREATE TABLE "PlanningAiOperation" (
  id text PRIMARY KEY, "sessionId" text NOT NULL, kind text NOT NULL, ordinal integer NOT NULL,
  state text NOT NULL, "successfulResultId" text, revision integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "PlanningAiOperation_shape" CHECK ((infame_planning_ai_id(id) AND infame_planning_ai_id("sessionId")
    AND ((kind = 'REPLY' AND ordinal BETWEEN 1 AND 10) OR (kind IN ('BRIEF','STRATEGY','IDEAS_PACK','COMBINED_REFINEMENT') AND ordinal = 1))
    AND state = 'OPEN' AND "successfulResultId" IS NULL AND revision BETWEEN 1 AND 2147483646
    AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt" >= "createdAt") IS TRUE),
  CONSTRAINT "PlanningAiOperation_session" FOREIGN KEY ("sessionId") REFERENCES "PlanningAiSession"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiOperation_sessionId_kind_ordinal_key" UNIQUE ("sessionId",kind,ordinal)
);
CREATE INDEX "PlanningAiOperation_sessionId_id_idx" ON "PlanningAiOperation"("sessionId",id);

CREATE FUNCTION infame_planning_ai_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pool "PlanningAiPool"; cycle "PlanningAiCycle"; enrollment "PlanningAiEnrollment";
  seat "PlanningAiSeat"; workspace "PlanningWorkspace"; enrollment_id text; admit boolean; current_utc timestamp(3);
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Planning session history is retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."allowanceState" <> 'HELD' OR NEW.revision <> 1 OR NEW."firstAttachedResultId" IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid initial planning session' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['allowanceState','revision','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['allowanceState','revision','updatedAt'])
       OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW."updatedAt" < OLD."updatedAt" THEN
      RAISE EXCEPTION 'Planning session identity or revision is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Cover implicit domain FK waits before the post-lock eligibility clock.
  -- Current application scope locks these domain parents before entitlements.
  IF TG_OP = 'INSERT' THEN
    PERFORM id FROM "PlanningWorkspace" WHERE id = NEW."workspaceId" AND "brandId" = NEW."brandId" FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning workspace' USING ERRCODE = '23514'; END IF;
    PERFORM "campaignId" FROM "CampaignPlanningBinding" WHERE "campaignId" = NEW."campaignId" AND "workspaceId" = NEW."workspaceId" FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning campaign binding' USING ERRCODE = '23514'; END IF;
    PERFORM id FROM "CampaignAgent" WHERE id = NEW."agentId" AND "campaignId" = NEW."campaignId" AND "workspaceId" = NEW."workspaceId" FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning agent' USING ERRCODE = '23514'; END IF;
  ELSE
    PERFORM id FROM "PlanningWorkspace" WHERE id = NEW."workspaceId" AND "brandId" = NEW."brandId" FOR KEY SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning workspace' USING ERRCODE = '23514'; END IF;
    PERFORM "campaignId" FROM "CampaignPlanningBinding" WHERE "campaignId" = NEW."campaignId" AND "workspaceId" = NEW."workspaceId" FOR KEY SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning campaign binding' USING ERRCODE = '23514'; END IF;
    PERFORM id FROM "CampaignAgent" WHERE id = NEW."agentId" AND "campaignId" = NEW."campaignId" AND "workspaceId" = NEW."workspaceId" FOR KEY SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning agent' USING ERRCODE = '23514'; END IF;
  END IF;
  -- Only immutable parent identity is read before the ordered parent locks.
  SELECT "enrollmentId" INTO enrollment_id FROM "PlanningAiCycle" WHERE id = NEW."cycleId" AND "poolId" = NEW."poolId";
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO pool FROM "PlanningAiPool" WHERE id = NEW."poolId" FOR SHARE;
    SELECT * INTO enrollment FROM "PlanningAiEnrollment" WHERE id = enrollment_id AND "poolId" = NEW."poolId" FOR SHARE;
    SELECT * INTO seat FROM "PlanningAiSeat" WHERE id = NEW."creationSeatId" AND "poolId" = NEW."poolId" AND "userId" = NEW."createdByUserId" FOR SHARE;
    SELECT * INTO cycle FROM "PlanningAiCycle" WHERE id = NEW."cycleId" AND "poolId" = NEW."poolId" FOR UPDATE;
  ELSE
    -- A native UPDATE already owns the child. Never wait on an ancestor: the
    -- future application must prelock these parents before updating the child.
    SELECT * INTO pool FROM "PlanningAiPool" WHERE id = NEW."poolId" FOR SHARE NOWAIT;
    SELECT * INTO enrollment FROM "PlanningAiEnrollment" WHERE id = enrollment_id AND "poolId" = NEW."poolId" FOR SHARE NOWAIT;
    SELECT * INTO seat FROM "PlanningAiSeat" WHERE id = NEW."creationSeatId" AND "poolId" = NEW."poolId" AND "userId" = NEW."createdByUserId" FOR SHARE NOWAIT;
    SELECT * INTO cycle FROM "PlanningAiCycle" WHERE id = NEW."cycleId" AND "poolId" = NEW."poolId" FOR UPDATE NOWAIT;
  END IF;
  IF pool.id IS NULL OR cycle.id IS NULL OR enrollment.id IS NULL OR seat.id IS NULL THEN
    RAISE EXCEPTION 'Missing exact planning parent' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO workspace FROM "PlanningWorkspace" WHERE id = NEW."workspaceId" AND "brandId" = NEW."brandId";
  IF workspace.id IS NULL OR ROW(workspace.scope,workspace."brandId",workspace."organizationId",workspace."clientId")
      IS DISTINCT FROM ROW(NEW.scope,NEW."brandId",NEW."organizationId",NEW."clientId")
     OR pool.scope IS DISTINCT FROM NEW.scope::text
     OR (NEW.scope = 'OWN_BRAND' AND pool."brandId" IS DISTINCT FROM NEW."brandId")
     OR (NEW.scope = 'CLIENT' AND pool."organizationId" IS DISTINCT FROM NEW."organizationId") THEN
    RAISE EXCEPTION 'Planning session must preserve exact native scope' USING ERRCODE = '23514';
  END IF;
  admit := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN admit := OLD."allowanceState" = 'RELEASED' AND NEW."allowanceState" = 'HELD'; END IF;
  IF admit THEN
    current_utc := (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
    IF pool.state <> 'ACTIVE' OR enrollment.state <> 'ACTIVE' OR seat.state <> 'ACTIVE' OR cycle.state <> 'ACTIVE'
       OR current_utc < cycle."startsAt" OR current_utc >= cycle."endsAt" THEN
      RAISE EXCEPTION 'Planning hold requires current eligible exact parents' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiSession_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiSession" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_session_guard();

CREATE FUNCTION infame_planning_ai_session_counters() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_held bigint; admit boolean; current_utc timestamp(3); cycle "PlanningAiCycle";
BEGIN
  admit := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN admit := OLD."allowanceState" = 'RELEASED' AND NEW."allowanceState" = 'HELD'; END IF;
  IF admit THEN
    -- Recheck after INSERT's unique/FK checks too; a failed competing insertion
    -- may release an index wait after this cycle's admission period has ended.
    SELECT * INTO cycle FROM "PlanningAiCycle" WHERE id = NEW."cycleId";
    current_utc := (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
    IF current_utc < cycle."startsAt" OR current_utc >= cycle."endsAt" THEN
      RAISE EXCEPTION 'Planning admission expired during insertion waits' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Guard already owns Cycle. All rows of this statement are visible in AFTER:
  -- derive their complete count so immediate constraints also accept a valid
  -- multi-row INSERT/UPDATE; subsequent row events do not increment it again.
  SELECT count(*) INTO actual_held FROM "PlanningAiSession"
    WHERE "cycleId" = NEW."cycleId" AND "allowanceState" = 'HELD';
  UPDATE "PlanningAiCycle" SET held = actual_held::integer, revision = revision + 1,
      "updatedAt" = GREATEST("updatedAt", (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3))
      WHERE id = NEW."cycleId" AND "poolId" = NEW."poolId" AND held::bigint <> actual_held;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiSession_00_counters" AFTER INSERT OR UPDATE ON "PlanningAiSession" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_session_counters();

CREATE FUNCTION infame_planning_ai_assert_cycle_counts(cycle_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cycle "PlanningAiCycle"; held_count bigint; consumed_count bigint;
BEGIN
  SELECT * INTO cycle FROM "PlanningAiCycle" WHERE id = cycle_id;
  IF cycle.id IS NULL THEN RAISE EXCEPTION 'Missing planning cycle count parent' USING ERRCODE = '23514'; END IF;
  SELECT count(*) FILTER (WHERE "allowanceState" = 'HELD'), count(*) FILTER (WHERE "allowanceState" = 'CONSUMED')
    INTO held_count,consumed_count FROM "PlanningAiSession" WHERE "cycleId" = cycle_id AND "allowanceState" IN ('HELD','CONSUMED');
  IF cycle.held::bigint <> held_count OR cycle.consumed::bigint <> consumed_count THEN
    RAISE EXCEPTION 'Planning counters must equal native session states' USING ERRCODE = '23514';
  END IF;
END $$;
CREATE FUNCTION infame_planning_ai_session_count_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM infame_planning_ai_assert_cycle_counts(NEW."cycleId"); RETURN NEW; END $$;
CREATE FUNCTION infame_planning_ai_cycle_count_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM infame_planning_ai_assert_cycle_counts(NEW.id); RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER "PlanningAiSession_90_counts" AFTER INSERT OR UPDATE ON "PlanningAiSession"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_session_count_check();
CREATE CONSTRAINT TRIGGER "PlanningAiCycle_session_counts" AFTER INSERT OR UPDATE ON "PlanningAiCycle"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_cycle_count_check();

CREATE FUNCTION infame_planning_ai_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session "PlanningAiSession";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Planning inclusion history is retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'OPEN' OR NEW.revision <> 1 OR NEW."successfulResultId" IS NOT NULL THEN
      RAISE EXCEPTION 'Planning success requires result storage' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO session FROM "PlanningAiSession" WHERE id = NEW."sessionId" FOR SHARE;
    IF session.id IS NULL OR session."allowanceState" <> 'HELD' THEN
      RAISE EXCEPTION 'Planning inclusion requires a held exact session' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['revision','updatedAt'])
       OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW."updatedAt" < OLD."updatedAt" THEN
      RAISE EXCEPTION 'Planning inclusion identity or revision is immutable' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO session FROM "PlanningAiSession" WHERE id = NEW."sessionId" FOR SHARE NOWAIT;
    IF session.id IS NULL THEN RAISE EXCEPTION 'Missing planning inclusion parent' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiOperation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiOperation" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_operation_guard();
COMMIT;
