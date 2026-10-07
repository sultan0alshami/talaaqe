-- Additive private planning. Existing campaign JSON, receipts and parties stand.
CREATE TYPE "PlanningWorkspaceScope" AS ENUM ('OWN_BRAND','CLIENT');
CREATE TYPE "PlanningReviewState" AS ENUM ('PENDING','APPROVED','DECLINED');
CREATE UNIQUE INDEX "Campaign_id_brandId_key" ON "Campaign"(id,"brandId");
CREATE UNIQUE INDEX "CampaignBrief_id_campaignId_key" ON "CampaignBrief"(id,"campaignId");

-- Count compact JSON bytes without rewriting original whitespace in strings.
-- This is a size bound, not a second canonical-hash implementation.
CREATE FUNCTION infame_planning_json_bytes(value JSONB) RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE total BIGINT:=2; count BIGINT:=0; item RECORD; element JSONB;
BEGIN
 IF jsonb_typeof(value)='object' THEN
  FOR item IN SELECT * FROM jsonb_each(value) LOOP
   total:=total+octet_length(to_jsonb(item.key)::text)+1+infame_planning_json_bytes(item.value); count:=count+1;
  END LOOP;
  RETURN total+GREATEST(count-1,0);
 ELSIF jsonb_typeof(value)='array' THEN
  FOR element IN SELECT * FROM jsonb_array_elements(value) LOOP
   total:=total+infame_planning_json_bytes(element); count:=count+1;
  END LOOP;
  RETURN total+GREATEST(count-1,0);
 END IF;
 RETURN octet_length(value::text);
END $$;

CREATE TABLE "PlanningWorkspace" (
 id TEXT PRIMARY KEY, scope "PlanningWorkspaceScope" NOT NULL, "brandId" TEXT NOT NULL,
 "organizationId" TEXT, "clientId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PlanningWorkspace_scope" CHECK ((scope='OWN_BRAND' AND "organizationId" IS NULL AND "clientId" IS NULL)
   OR (scope='CLIENT' AND "organizationId" IS NOT NULL AND "clientId" IS NOT NULL)),
 UNIQUE(id,"brandId"),
 FOREIGN KEY ("brandId") REFERENCES "Brand"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("clientId","organizationId","brandId") REFERENCES "OrganizationClient"(id,"organizationId","brandId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PlanningWorkspace_own_brand" ON "PlanningWorkspace"("brandId") WHERE scope='OWN_BRAND';
CREATE UNIQUE INDEX "PlanningWorkspace_client" ON "PlanningWorkspace"("clientId") WHERE scope='CLIENT';
CREATE INDEX "PlanningWorkspace_client_scope" ON "PlanningWorkspace"("clientId","organizationId","brandId");

CREATE TABLE "BrandContext" (
 id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, name TEXT NOT NULL, "nameLanguage" TEXT,
 content JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, "inputRevision" INTEGER NOT NULL DEFAULT 1,
 archived BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE(id,"workspaceId"),
 CONSTRAINT "BrandContext_bounds" CHECK (char_length(name) BETWEEN 1 AND 200 AND name ~ '[^[:space:]]'
  AND ("nameLanguage" IS NULL OR char_length("nameLanguage") BETWEEN 2 AND 100)
  AND jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=65536
  AND revision BETWEEN 1 AND 2147483646 AND "inputRevision" BETWEEN 1 AND revision),
 FOREIGN KEY ("workspaceId") REFERENCES "PlanningWorkspace"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "BrandContext_workspace_archived_id" ON "BrandContext"("workspaceId",archived,id);

CREATE TABLE "BrandContextSubmission" (
 id TEXT PRIMARY KEY, "contextId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "inputRevision" INTEGER NOT NULL,
 name TEXT NOT NULL, "nameLanguage" TEXT, content JSONB NOT NULL, "contentHash" TEXT NOT NULL,
 "submittedByUserId" TEXT NOT NULL, "targetOwnerUserId" TEXT NOT NULL, "targetOwnerSessionVersion" INTEGER NOT NULL,
 "clientRevision" INTEGER, state "PlanningReviewState" NOT NULL DEFAULT 'PENDING', revision INTEGER NOT NULL DEFAULT 1,
 "decidedByUserId" TEXT, "decidedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"contextId","workspaceId"), UNIQUE(id,"workspaceId"),
 CONSTRAINT "BrandContextSubmission_bounds" CHECK (char_length(name) BETWEEN 1 AND 200 AND name ~ '[^[:space:]]'
  AND ("nameLanguage" IS NULL OR char_length("nameLanguage") BETWEEN 2 AND 100)
  AND jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=65536 AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND "inputRevision" BETWEEN 1 AND 2147483646 AND revision BETWEEN 1 AND 2147483646
  AND "targetOwnerSessionVersion" BETWEEN 1 AND 2147483647 AND ("clientRevision" IS NULL OR "clientRevision" BETWEEN 1 AND 2147483646)
  AND ((state='PENDING' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL)
    OR (state<>'PENDING' AND "decidedByUserId" IS NOT NULL AND "decidedByUserId"="targetOwnerUserId" AND "decidedAt" IS NOT NULL))),
 FOREIGN KEY ("contextId","workspaceId") REFERENCES "BrandContext"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("submittedByUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("targetOwnerUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "BrandContextSubmission_context_id" ON "BrandContextSubmission"("contextId",id);
CREATE INDEX "BrandContextSubmission_target_state_id" ON "BrandContextSubmission"("targetOwnerUserId",state,id);
CREATE INDEX "BrandContextSubmission_workspace_id" ON "BrandContextSubmission"("workspaceId",id);
CREATE INDEX "BrandContextSubmission_submitter" ON "BrandContextSubmission"("submittedByUserId");

CREATE TABLE "BrandContextVersion" (
 id TEXT PRIMARY KEY, "contextId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "submissionId" TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL, "inputRevision" INTEGER NOT NULL, "contentHash" TEXT NOT NULL,
 "approvedByUserId" TEXT NOT NULL, "approvedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("contextId",version), UNIQUE(id,"workspaceId","contentHash"),
 CONSTRAINT "BrandContextVersion_bounds" CHECK (version BETWEEN 1 AND 2147483646 AND "inputRevision" BETWEEN 1 AND 2147483646 AND "contentHash" ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY ("submissionId","contextId","workspaceId") REFERENCES "BrandContextSubmission"(id,"contextId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("approvedByUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "BrandContextVersion_workspace_id" ON "BrandContextVersion"("workspaceId",id);
CREATE INDEX "BrandContextVersion_approver" ON "BrandContextVersion"("approvedByUserId");

CREATE TABLE "CampaignPlanningBinding" (
 "campaignId" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "brandId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("campaignId","workspaceId"),
 FOREIGN KEY ("campaignId","brandId") REFERENCES "Campaign"(id,"brandId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("workspaceId","brandId") REFERENCES "PlanningWorkspace"(id,"brandId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignPlanningBinding_workspace_campaign" ON "CampaignPlanningBinding"("workspaceId","campaignId");
CREATE INDEX "CampaignPlanningBinding_brand" ON "CampaignPlanningBinding"("brandId");

CREATE TABLE "CampaignContextSelection" (
 id TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, revision INTEGER NOT NULL,
 "contextVersionId" TEXT, "contentHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("campaignId",revision), UNIQUE(id,"campaignId","workspaceId",revision),
 CONSTRAINT "CampaignContextSelection_bounds" CHECK (revision BETWEEN 1 AND 2147483646
   AND (("contextVersionId" IS NULL AND "contentHash" IS NULL) OR ("contextVersionId" IS NOT NULL AND "contentHash" IS NOT NULL AND "contentHash" ~ '^[a-f0-9]{64}$'))),
 FOREIGN KEY ("campaignId","workspaceId") REFERENCES "CampaignPlanningBinding"("campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("contextVersionId","workspaceId","contentHash") REFERENCES "BrandContextVersion"(id,"workspaceId","contentHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignContextSelection_workspace" ON "CampaignContextSelection"("workspaceId");
CREATE INDEX "CampaignContextSelection_version_scope_hash" ON "CampaignContextSelection"("contextVersionId","workspaceId","contentHash");

CREATE TABLE "CampaignPlanningState" (
 "campaignId" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 "selectionId" TEXT NOT NULL, "selectionRevision" INTEGER NOT NULL, narrative JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CampaignPlanningState_bounds" CHECK (revision BETWEEN 1 AND 2147483646 AND "selectionRevision" BETWEEN 1 AND 2147483646
  AND (narrative IS NULL OR (jsonb_typeof(narrative)='object' AND infame_planning_json_bytes(narrative)<=65536))),
 FOREIGN KEY ("campaignId","workspaceId") REFERENCES "CampaignPlanningBinding"("campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("selectionId","campaignId","workspaceId","selectionRevision") REFERENCES "CampaignContextSelection"(id,"campaignId","workspaceId",revision) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignPlanningState_workspace" ON "CampaignPlanningState"("workspaceId");
CREATE INDEX "CampaignPlanningState_selection" ON "CampaignPlanningState"("selectionId");

CREATE TABLE "CampaignProposalDependency" (
 "campaignId" TEXT NOT NULL, "proposalId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "fieldsRevision" INTEGER NOT NULL,
 "selectionId" TEXT NOT NULL, "selectionRevision" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("campaignId","proposalId"),
 CONSTRAINT "CampaignProposalDependency_bounds" CHECK ("fieldsRevision" BETWEEN 1 AND 2147483646 AND "selectionRevision" BETWEEN 1 AND 2147483646),
 FOREIGN KEY ("campaignId","workspaceId") REFERENCES "CampaignPlanningBinding"("campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("selectionId","campaignId","workspaceId","selectionRevision") REFERENCES "CampaignContextSelection"(id,"campaignId","workspaceId",revision) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignProposalDependency_workspace" ON "CampaignProposalDependency"("workspaceId");
CREATE INDEX "CampaignProposalDependency_selection" ON "CampaignProposalDependency"("selectionId");

CREATE TABLE "CampaignBriefProvenance" (
 "briefId" TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL,
 "selectionId" TEXT NOT NULL, "selectionRevision" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("briefId","campaignId","workspaceId","selectionId","selectionRevision"),
 FOREIGN KEY ("briefId","campaignId") REFERENCES "CampaignBrief"(id,"campaignId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("selectionId","campaignId","workspaceId","selectionRevision") REFERENCES "CampaignContextSelection"(id,"campaignId","workspaceId",revision) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignBriefProvenance_campaign" ON "CampaignBriefProvenance"("campaignId");
CREATE INDEX "CampaignBriefProvenance_workspace" ON "CampaignBriefProvenance"("workspaceId");
CREATE INDEX "CampaignBriefProvenance_selection" ON "CampaignBriefProvenance"("selectionId");

CREATE TABLE "CampaignPlanningSubmission" (
 id TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "briefId" TEXT NOT NULL,
 "selectionId" TEXT NOT NULL, "selectionRevision" INTEGER NOT NULL, "inputRevision" INTEGER NOT NULL, "campaignRevision" INTEGER NOT NULL,
 content JSONB NOT NULL, "contentHash" TEXT NOT NULL, "submittedByUserId" TEXT NOT NULL, "targetOwnerUserId" TEXT NOT NULL,
 "targetOwnerSessionVersion" INTEGER NOT NULL, "clientRevision" INTEGER, state "PlanningReviewState" NOT NULL DEFAULT 'PENDING',
 revision INTEGER NOT NULL DEFAULT 1, "decidedByUserId" TEXT, "decidedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"workspaceId"),
 CONSTRAINT "CampaignPlanningSubmission_bounds" CHECK ("inputRevision" BETWEEN 1 AND 2147483646 AND "campaignRevision" BETWEEN 1 AND 2147483646
  AND revision BETWEEN 1 AND 2147483646 AND "targetOwnerSessionVersion" BETWEEN 1 AND 2147483647
  AND ("clientRevision" IS NULL OR "clientRevision" BETWEEN 1 AND 2147483646)
  AND jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=65536 AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND ((state='PENDING' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL)
    OR (state<>'PENDING' AND "decidedByUserId" IS NOT NULL AND "decidedByUserId"="targetOwnerUserId" AND "decidedAt" IS NOT NULL))),
 FOREIGN KEY ("briefId","campaignId","workspaceId","selectionId","selectionRevision") REFERENCES "CampaignBriefProvenance"("briefId","campaignId","workspaceId","selectionId","selectionRevision") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("submittedByUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("targetOwnerUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignPlanningSubmission_campaign" ON "CampaignPlanningSubmission"("campaignId");
CREATE INDEX "CampaignPlanningSubmission_workspace" ON "CampaignPlanningSubmission"("workspaceId");
CREATE INDEX "CampaignPlanningSubmission_target_state_id" ON "CampaignPlanningSubmission"("targetOwnerUserId",state,id);
CREATE INDEX "CampaignPlanningSubmission_submitter" ON "CampaignPlanningSubmission"("submittedByUserId");
CREATE INDEX "CampaignPlanningSubmission_provenance" ON "CampaignPlanningSubmission"("briefId","campaignId","workspaceId","selectionId","selectionRevision");

CREATE FUNCTION infame_planning_receipt_valid(value JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(value)='object' AND infame_planning_json_bytes(value)<=4096
 AND value - ARRAY['contextId','campaignId','submissionId','versionId','proposalId','briefId','revision','inputRevision','campaignRevision','planningRevision','selectionRevision','version','action','state','archived']::text[]='{}'::jsonb
 AND NOT EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(value)='object' THEN value ELSE '{}'::jsonb END) item WHERE jsonb_typeof(item.value) NOT IN ('string','number','boolean','null'))
$$;

CREATE TABLE "BrandContextCommand" (
 id TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
 "contextId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, action TEXT NOT NULL, result JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("actorUserId","operationKey"),
 CONSTRAINT "BrandContextCommand_bounds" CHECK (char_length("actorUserId") BETWEEN 1 AND 200 AND char_length("operationKey") BETWEEN 1 AND 200
  AND char_length(action) BETWEEN 1 AND 100 AND "payloadHash" ~ '^[a-f0-9]{64}$' AND infame_planning_receipt_valid(result)),
 FOREIGN KEY ("contextId","workspaceId") REFERENCES "BrandContext"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "BrandContextCommand_context" ON "BrandContextCommand"("contextId");
CREATE INDEX "BrandContextCommand_workspace" ON "BrandContextCommand"("workspaceId");
CREATE TABLE "CampaignPlanningCommand" (
 id TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
 "campaignId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, action TEXT NOT NULL, result JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("actorUserId","operationKey"),
 CONSTRAINT "CampaignPlanningCommand_bounds" CHECK (char_length("actorUserId") BETWEEN 1 AND 200 AND char_length("operationKey") BETWEEN 1 AND 200
  AND char_length(action) BETWEEN 1 AND 100 AND "payloadHash" ~ '^[a-f0-9]{64}$' AND infame_planning_receipt_valid(result)),
 FOREIGN KEY ("campaignId","workspaceId") REFERENCES "CampaignPlanningBinding"("campaignId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CampaignPlanningCommand_campaign" ON "CampaignPlanningCommand"("campaignId");
CREATE INDEX "CampaignPlanningCommand_workspace" ON "CampaignPlanningCommand"("workspaceId");
CREATE TABLE "PlanningReviewCommand" (
 id TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
 "workspaceId" TEXT NOT NULL, "contextSubmissionId" TEXT, "campaignSubmissionId" TEXT, action TEXT NOT NULL, result JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("actorUserId","operationKey"),
 CONSTRAINT "PlanningReviewCommand_bounds" CHECK (num_nonnulls("contextSubmissionId","campaignSubmissionId")=1
  AND char_length("actorUserId") BETWEEN 1 AND 200 AND char_length("operationKey") BETWEEN 1 AND 200
  AND char_length(action) BETWEEN 1 AND 100 AND "payloadHash" ~ '^[a-f0-9]{64}$' AND infame_planning_receipt_valid(result)),
 FOREIGN KEY ("contextSubmissionId","workspaceId") REFERENCES "BrandContextSubmission"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("campaignSubmissionId","workspaceId") REFERENCES "CampaignPlanningSubmission"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "PlanningReviewCommand_context" ON "PlanningReviewCommand"("contextSubmissionId");
CREATE INDEX "PlanningReviewCommand_campaign" ON "PlanningReviewCommand"("campaignSubmissionId");
CREATE INDEX "PlanningReviewCommand_workspace" ON "PlanningReviewCommand"("workspaceId");

CREATE FUNCTION infame_planning_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Planning history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "PlanningWorkspace_immutable" BEFORE UPDATE ON "PlanningWorkspace" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "BrandContextVersion_immutable" BEFORE UPDATE ON "BrandContextVersion" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "CampaignPlanningBinding_immutable" BEFORE UPDATE ON "CampaignPlanningBinding" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "CampaignContextSelection_immutable" BEFORE UPDATE ON "CampaignContextSelection" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "CampaignProposalDependency_immutable" BEFORE UPDATE ON "CampaignProposalDependency" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "CampaignBriefProvenance_immutable" BEFORE UPDATE ON "CampaignBriefProvenance" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "BrandContextCommand_immutable" BEFORE UPDATE ON "BrandContextCommand" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "CampaignPlanningCommand_immutable" BEFORE UPDATE ON "CampaignPlanningCommand" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "PlanningReviewCommand_immutable" BEFORE UPDATE ON "PlanningReviewCommand" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();

CREATE FUNCTION infame_brand_context_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  OR NEW.revision::bigint<>OLD.revision::bigint+1 THEN RAISE EXCEPTION 'Context identity/next revision invalid' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.name,NEW."nameLanguage",NEW.content) IS DISTINCT FROM ROW(OLD.name,OLD."nameLanguage",OLD.content) THEN
  IF NEW."inputRevision"<>NEW.revision THEN RAISE EXCEPTION 'Context edit requires next input revision' USING ERRCODE='23514'; END IF;
 ELSIF NEW."inputRevision"<>OLD."inputRevision" THEN RAISE EXCEPTION 'Context input revision changed without input' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BrandContext_revision" BEFORE UPDATE ON "BrandContext" FOR EACH ROW EXECUTE FUNCTION infame_brand_context_revision();

CREATE FUNCTION infame_planning_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "PlanningWorkspaceScope"; current_context RECORD;
BEGIN
 SELECT scope INTO kind FROM "PlanningWorkspace" WHERE id=NEW."workspaceId";
 IF (kind='OWN_BRAND' AND NEW."clientRevision" IS NOT NULL) OR (kind='CLIENT' AND NEW."clientRevision" IS NULL) THEN
  RAISE EXCEPTION 'Review scope revision mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING' OR NEW.revision<>1 OR NEW."decidedByUserId" IS NOT NULL OR NEW."decidedAt" IS NOT NULL THEN
   RAISE EXCEPTION 'Review begins pending' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.state<>'PENDING' OR NEW.state='PENDING' OR NEW.revision::bigint<>OLD.revision::bigint+1
   OR (to_jsonb(NEW)-ARRAY['state','revision','decidedByUserId','decidedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','decidedByUserId','decidedAt']) THEN
   RAISE EXCEPTION 'Review snapshot/decision immutable' USING ERRCODE='23514'; END IF;
  IF NEW."decidedByUserId" IS DISTINCT FROM NEW."targetOwnerUserId" OR NEW."decidedAt" IS NULL THEN
   RAISE EXCEPTION 'Review decision target mismatch' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='BrandContextSubmission' AND NEW.state='APPROVED' THEN
   SELECT archived,"inputRevision" INTO current_context FROM "BrandContext" WHERE id=NEW."contextId" AND "workspaceId"=NEW."workspaceId";
   IF NOT FOUND OR current_context.archived OR current_context."inputRevision"<>NEW."inputRevision" THEN
    RAISE EXCEPTION 'Context review source stale/archived' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BrandContextSubmission_guard" BEFORE INSERT OR UPDATE ON "BrandContextSubmission" FOR EACH ROW EXECUTE FUNCTION infame_planning_review_guard();
CREATE TRIGGER "CampaignPlanningSubmission_guard" BEFORE INSERT OR UPDATE ON "CampaignPlanningSubmission" FOR EACH ROW EXECUTE FUNCTION infame_planning_review_guard();

CREATE FUNCTION infame_brand_context_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD;
BEGIN
 SELECT * INTO source FROM "BrandContextSubmission" WHERE id=NEW."submissionId" AND "contextId"=NEW."contextId" AND "workspaceId"=NEW."workspaceId";
 IF NOT FOUND OR source.state<>'APPROVED' OR source."inputRevision"<>NEW."inputRevision" OR source."contentHash"<>NEW."contentHash"
  OR source."decidedByUserId"<>NEW."approvedByUserId" OR source."decidedAt"<>NEW."approvedAt" THEN
  RAISE EXCEPTION 'Approved version lineage mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BrandContextVersion_lineage" BEFORE INSERT ON "BrandContextVersion" FOR EACH ROW EXECUTE FUNCTION infame_brand_context_version_guard();

CREATE FUNCTION infame_planning_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "PlanningWorkspaceScope";
BEGIN
 -- Serialize with existing legacy campaign writes before observing history;
 -- an FK wait alone would not re-run the pre-wait history predicate.
 PERFORM 1 FROM "Campaign" WHERE id=NEW."campaignId" AND "brandId"=NEW."brandId" FOR UPDATE;
 SELECT scope INTO kind FROM "PlanningWorkspace" WHERE id=NEW."workspaceId";
 IF kind='CLIENT' AND (EXISTS(SELECT 1 FROM "CampaignCommand" WHERE "campaignId"=NEW."campaignId")
  OR EXISTS(SELECT 1 FROM "MatchCommand" WHERE "campaignId"=NEW."campaignId")
  OR EXISTS(SELECT 1 FROM "CampaignBrief" WHERE "campaignId"=NEW."campaignId")
  OR EXISTS(SELECT 1 FROM "MatchRun" WHERE "campaignId"=NEW."campaignId")
  OR EXISTS(SELECT 1 FROM "MatchDecisionRecord" WHERE "campaignId"=NEW."campaignId")
  OR EXISTS(SELECT 1 FROM "Deal" WHERE "campaignId"=NEW."campaignId")) THEN
  RAISE EXCEPTION 'CLIENT planning cannot reinterpret legacy history' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignPlanningBinding_fresh_client" BEFORE INSERT ON "CampaignPlanningBinding" FOR EACH ROW EXECUTE FUNCTION infame_planning_binding_guard();

CREATE FUNCTION infame_context_selection_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous INTEGER;
BEGIN
 PERFORM 1 FROM "CampaignPlanningBinding" WHERE "campaignId"=NEW."campaignId" AND "workspaceId"=NEW."workspaceId" FOR UPDATE;
 SELECT COALESCE(MAX(revision),0) INTO previous FROM "CampaignContextSelection" WHERE "campaignId"=NEW."campaignId";
 IF NEW.revision::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'Selection requires exact next revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignContextSelection_sequence" BEFORE INSERT ON "CampaignContextSelection" FOR EACH ROW EXECUTE FUNCTION infame_context_selection_sequence();

CREATE FUNCTION infame_planning_state_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."campaignId" IS DISTINCT FROM OLD."campaignId" OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
  OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW.revision::bigint<>OLD.revision::bigint+1 THEN
  RAISE EXCEPTION 'Planning state identity/next revision invalid' USING ERRCODE='23514'; END IF;
 IF NEW."selectionId" IS DISTINCT FROM OLD."selectionId" THEN
  IF NEW."selectionRevision"::bigint<>OLD."selectionRevision"::bigint+1 THEN RAISE EXCEPTION 'Planning selection ABA rejected' USING ERRCODE='23514'; END IF;
 ELSIF NEW."selectionRevision"<>OLD."selectionRevision" THEN RAISE EXCEPTION 'Planning selection revision mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignPlanningState_revision" BEFORE UPDATE ON "CampaignPlanningState" FOR EACH ROW EXECUTE FUNCTION infame_planning_state_revision();

CREATE FUNCTION infame_proposal_dependency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE input JSONB;
BEGIN
 SELECT c.input INTO input FROM "Campaign" c WHERE id=NEW."campaignId";
 IF input->>'fieldsRevision' IS DISTINCT FROM NEW."fieldsRevision"::text OR NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(input->'proposals')='array' THEN input->'proposals' ELSE '[]'::jsonb END) proposal
   WHERE proposal->>'id'=NEW."proposalId" AND proposal->>'basedOnFieldsRevision'=NEW."fieldsRevision"::text) THEN
  RAISE EXCEPTION 'Proposal dependency does not bind persisted original proposal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CampaignProposalDependency_source" BEFORE INSERT ON "CampaignProposalDependency" FOR EACH ROW EXECUTE FUNCTION infame_proposal_dependency_guard();
