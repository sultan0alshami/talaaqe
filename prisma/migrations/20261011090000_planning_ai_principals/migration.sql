-- Additive retained planning principals. No grants, seeds, existing-row rewrites,
-- merchant purchase or provider activation are performed by this migration.
CREATE FUNCTION infame_planning_ai_id(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT value COLLATE "C" ~ '^[!-~]{1,200}$' $$;
CREATE FUNCTION infame_planning_ai_reference(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT infame_planning_ai_id(value) AND position('://' in value) = 0 $$;
CREATE FUNCTION infame_planning_ai_terms(plan text, policy text, price text, net bigint, currency text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT (
  policy = 'infame-commercial-v1-2026-10-05' AND
  ((plan = 'TRIAL' AND price IS NULL AND net IS NULL AND currency IS NULL)
   OR (infame_planning_ai_reference(price) AND currency = 'SAR' AND
       ((plan = 'STARTER' AND net = 9900) OR (plan = 'GROWTH' AND net = 29900) OR (plan = 'PRO' AND net = 99900))))
) IS TRUE $$;

CREATE TABLE "PlanningAiPool" (
  id text PRIMARY KEY, scope text NOT NULL, "brandId" text, "organizationId" text,
  state text NOT NULL DEFAULT 'ACTIVE', revision integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "PlanningAiPool_shape" CHECK ((infame_planning_ai_id(id)
    AND ("brandId" IS NULL OR infame_planning_ai_id("brandId")) AND ("organizationId" IS NULL OR infame_planning_ai_id("organizationId"))
    AND state IN ('ACTIVE','CLOSED') AND revision BETWEEN 1 AND 2147483646
    AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt" >= "createdAt"
    AND ((scope = 'OWN_BRAND' AND "brandId" IS NOT NULL AND "organizationId" IS NULL)
      OR (scope = 'CLIENT' AND "brandId" IS NULL AND "organizationId" IS NOT NULL))) IS TRUE),
  CONSTRAINT "PlanningAiPool_brand" FOREIGN KEY ("brandId") REFERENCES "Brand"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiPool_organization" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiPool_id_organizationId_key" UNIQUE (id,"organizationId")
);
CREATE UNIQUE INDEX "PlanningAiPool_own_subject" ON "PlanningAiPool"("brandId") WHERE scope = 'OWN_BRAND';
CREATE UNIQUE INDEX "PlanningAiPool_client_subject" ON "PlanningAiPool"("organizationId") WHERE scope = 'CLIENT';

CREATE TABLE "PlanningAiEnrollment" (
  id text PRIMARY KEY, "poolId" text NOT NULL, "acceptingOwnerUserId" text NOT NULL, "subscriberUserId" text NOT NULL,
  kind text NOT NULL, "planId" text NOT NULL, "policyVersion" text NOT NULL,
  "priceVersion" text, "netAmountMinor" bigint, currency text,
  state text NOT NULL DEFAULT 'ACTIVE', revision integer NOT NULL DEFAULT 1,
  "acceptanceReference" text NOT NULL, "acceptanceHash" text NOT NULL, "acceptedAt" timestamp(3) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "PlanningAiEnrollment_shape" CHECK ((infame_planning_ai_id(id)
    AND infame_planning_ai_id("poolId") AND infame_planning_ai_id("acceptingOwnerUserId") AND infame_planning_ai_id("subscriberUserId")
    AND infame_planning_ai_reference("acceptanceReference") AND "acceptanceHash" ~ '^[a-f0-9]{64}$'
    AND state IN ('ACTIVE','CLOSED') AND revision BETWEEN 1 AND 2147483646
    AND isfinite("acceptedAt") AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt" >= "createdAt"
    AND infame_planning_ai_terms("planId","policyVersion","priceVersion","netAmountMinor",currency)
    AND ((kind = 'TRIAL' AND "planId" = 'TRIAL') OR (kind = 'PAID' AND "planId" IN ('STARTER','GROWTH','PRO')))) IS TRUE),
  CONSTRAINT "PlanningAiEnrollment_pool" FOREIGN KEY ("poolId") REFERENCES "PlanningAiPool"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiEnrollment_accepting_owner" FOREIGN KEY ("acceptingOwnerUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiEnrollment_subscriber" FOREIGN KEY ("subscriberUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiEnrollment_id_poolId_key" UNIQUE (id,"poolId"),
  CONSTRAINT "PlanningAiEnrollment_id_poolId_subscriberUserId_key" UNIQUE (id,"poolId","subscriberUserId")
);
CREATE UNIQUE INDEX "PlanningAiEnrollment_one_active" ON "PlanningAiEnrollment"("poolId") WHERE state = 'ACTIVE';
CREATE INDEX "PlanningAiEnrollment_acceptingOwnerUserId_idx" ON "PlanningAiEnrollment"("acceptingOwnerUserId");
CREATE INDEX "PlanningAiEnrollment_subscriberUserId_idx" ON "PlanningAiEnrollment"("subscriberUserId");
CREATE INDEX "PlanningAiEnrollment_poolId_id_idx" ON "PlanningAiEnrollment"("poolId",id);

ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_planning_seat_identity" UNIQUE (id,"organizationId","userId");
CREATE TABLE "PlanningAiSeat" (
  id text PRIMARY KEY, "poolId" text NOT NULL, "userId" text NOT NULL, "organizationId" text, "membershipId" text,
  state text NOT NULL DEFAULT 'ACTIVE', revision integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "PlanningAiSeat_shape" CHECK ((infame_planning_ai_id(id)
    AND infame_planning_ai_id("poolId") AND infame_planning_ai_id("userId")
    AND ("organizationId" IS NULL OR infame_planning_ai_id("organizationId")) AND ("membershipId" IS NULL OR infame_planning_ai_id("membershipId"))
    AND state IN ('ACTIVE','REVOKED') AND revision BETWEEN 1 AND 2147483646
    AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt" >= "createdAt"
    AND (("organizationId" IS NULL AND "membershipId" IS NULL) OR ("organizationId" IS NOT NULL AND "membershipId" IS NOT NULL))) IS TRUE),
  CONSTRAINT "PlanningAiSeat_pool" FOREIGN KEY ("poolId") REFERENCES "PlanningAiPool"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSeat_user" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSeat_pool_subject" FOREIGN KEY ("poolId","organizationId") REFERENCES "PlanningAiPool"(id,"organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSeat_membership" FOREIGN KEY ("membershipId","organizationId","userId") REFERENCES "OrganizationMembership"(id,"organizationId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiSeat_poolId_userId_key" UNIQUE ("poolId","userId")
);
CREATE INDEX "PlanningAiSeat_userId_state_idx" ON "PlanningAiSeat"("userId",state);
CREATE INDEX "PlanningAiSeat_membershipId_organizationId_userId_idx" ON "PlanningAiSeat"("membershipId","organizationId","userId");
CREATE INDEX "PlanningAiSeat_poolId_organizationId_idx" ON "PlanningAiSeat"("poolId","organizationId");

CREATE TABLE "PlanningAiTrialClaim" (
  id text PRIMARY KEY, "poolId" text NOT NULL UNIQUE, "enrollmentId" text NOT NULL UNIQUE, "ownerUserId" text NOT NULL UNIQUE,
  "readinessReference" text NOT NULL, "consentHash" text NOT NULL, "claimedAt" timestamp(3) NOT NULL,
  CONSTRAINT "PlanningAiTrialClaim_shape" CHECK ((infame_planning_ai_id(id)
    AND infame_planning_ai_id("poolId") AND infame_planning_ai_id("enrollmentId") AND infame_planning_ai_id("ownerUserId")
    AND infame_planning_ai_reference("readinessReference") AND "consentHash" ~ '^[a-f0-9]{64}$' AND isfinite("claimedAt")) IS TRUE),
  CONSTRAINT "PlanningAiTrialClaim_enrollment" FOREIGN KEY ("enrollmentId","poolId","ownerUserId") REFERENCES "PlanningAiEnrollment"(id,"poolId","subscriberUserId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiTrialClaim_owner" FOREIGN KEY ("ownerUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiTrialClaim_id_enrollmentId_poolId_key" UNIQUE (id,"enrollmentId","poolId")
);

CREATE TABLE "PlanningAiCycle" (
  id text PRIMARY KEY, "poolId" text NOT NULL, "enrollmentId" text NOT NULL, "trialClaimId" text UNIQUE,
  source text NOT NULL, "sourceEventId" text NOT NULL, "subscriptionId" text,
  "planId" text NOT NULL, "policyVersion" text NOT NULL, "priceVersion" text, "netAmountMinor" bigint, currency text,
  allowance integer NOT NULL, held integer NOT NULL DEFAULT 0, consumed integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'ACTIVE', revision integer NOT NULL DEFAULT 1,
  "startsAt" timestamp(3) NOT NULL, "endsAt" timestamp(3) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "PlanningAiCycle_shape" CHECK ((infame_planning_ai_id(id)
    AND infame_planning_ai_id("poolId") AND infame_planning_ai_id("enrollmentId") AND ("trialClaimId" IS NULL OR infame_planning_ai_id("trialClaimId"))
    AND infame_planning_ai_reference("sourceEventId") AND state IN ('ACTIVE','VOIDED') AND revision BETWEEN 1 AND 2147483646
    AND isfinite("startsAt") AND isfinite("endsAt") AND "startsAt" < "endsAt"
    AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt" >= "createdAt"
    AND held >= 0 AND consumed >= 0 AND held::bigint + consumed::bigint <= allowance
    AND (state <> 'VOIDED' OR (held = 0 AND consumed = 0))
    AND infame_planning_ai_terms("planId","policyVersion","priceVersion","netAmountMinor",currency)
    AND ((source = 'TRIAL' AND "planId" = 'TRIAL' AND allowance = 1 AND "trialClaimId" IS NOT NULL AND "subscriptionId" IS NULL)
      OR (source = 'MERCHANT' AND "trialClaimId" IS NULL AND infame_planning_ai_reference("subscriptionId")
        AND (("planId" = 'STARTER' AND allowance = 3) OR ("planId" = 'GROWTH' AND allowance = 15) OR ("planId" = 'PRO' AND allowance = 75))))) IS TRUE),
  CONSTRAINT "PlanningAiCycle_enrollment" FOREIGN KEY ("enrollmentId","poolId") REFERENCES "PlanningAiEnrollment"(id,"poolId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiCycle_trial_claim" FOREIGN KEY ("trialClaimId","enrollmentId","poolId") REFERENCES "PlanningAiTrialClaim"(id,"enrollmentId","poolId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PlanningAiCycle_source_sourceEventId_key" UNIQUE (source,"sourceEventId"),
  CONSTRAINT "PlanningAiCycle_id_poolId_key" UNIQUE (id,"poolId")
);
CREATE UNIQUE INDEX "PlanningAiCycle_merchant_period" ON "PlanningAiCycle"("subscriptionId","startsAt","endsAt") WHERE source = 'MERCHANT';
CREATE INDEX "PlanningAiCycle_enrollmentId_poolId_idx" ON "PlanningAiCycle"("enrollmentId","poolId");
CREATE INDEX "PlanningAiCycle_poolId_state_startsAt_endsAt_idx" ON "PlanningAiCycle"("poolId",state,"startsAt","endsAt");

CREATE FUNCTION infame_planning_ai_pool_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Planning pool history is retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' OR NEW.revision <> 1 THEN RAISE EXCEPTION 'Invalid initial planning pool' USING ERRCODE = '23514'; END IF;
  ELSE
    IF ROW(NEW.id,NEW.scope,NEW."brandId",NEW."organizationId",NEW."createdAt") IS DISTINCT FROM
       ROW(OLD.id,OLD.scope,OLD."brandId",OLD."organizationId",OLD."createdAt")
       OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW."updatedAt" < OLD."updatedAt"
       OR (OLD.state = 'CLOSED' AND NEW.state <> 'CLOSED') THEN
      RAISE EXCEPTION 'Planning pool identity or transition is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiPool_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiPool" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_pool_guard();

CREATE FUNCTION infame_planning_ai_enrollment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pool "PlanningAiPool"; actual_owner text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Planning enrollment history is retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO pool FROM "PlanningAiPool" WHERE id = NEW."poolId" FOR UPDATE;
    IF pool.scope = 'OWN_BRAND' THEN SELECT "userId" INTO actual_owner FROM "Brand" WHERE id = pool."brandId";
    ELSE SELECT "ownerUserId" INTO actual_owner FROM "Organization" WHERE id = pool."organizationId"; END IF;
    IF pool.id IS NULL OR pool.state <> 'ACTIVE' OR actual_owner IS DISTINCT FROM NEW."acceptingOwnerUserId"
       OR NEW."subscriberUserId" IS DISTINCT FROM NEW."acceptingOwnerUserId" OR NEW.state <> 'ACTIVE' OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Planning enrollment requires the native owner and active pool' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['state','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','revision','updatedAt'])
       OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW."updatedAt" < OLD."updatedAt"
       OR (OLD.state = 'CLOSED' AND NEW.state <> 'CLOSED') THEN
      RAISE EXCEPTION 'Planning enrollment identity or transition is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiEnrollment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiEnrollment" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_enrollment_guard();

CREATE FUNCTION infame_planning_ai_seat_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pool "PlanningAiPool";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Planning seat history is retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO pool FROM "PlanningAiPool" WHERE id = NEW."poolId" FOR SHARE;
    IF pool.id IS NULL OR pool.state <> 'ACTIVE' OR NEW.state <> 'ACTIVE' OR NEW.revision <> 1
       OR (pool.scope = 'OWN_BRAND' AND (NEW."organizationId" IS NOT NULL OR NEW."membershipId" IS NOT NULL))
       OR (pool.scope = 'CLIENT' AND (NEW."organizationId" IS DISTINCT FROM pool."organizationId" OR NEW."membershipId" IS NULL)) THEN
      RAISE EXCEPTION 'Planning seat must bind the exact native pool subject' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['state','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','revision','updatedAt'])
       OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW."updatedAt" < OLD."updatedAt" THEN
      RAISE EXCEPTION 'Planning seat identity or revision is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiSeat_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiSeat" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_seat_guard();

CREATE FUNCTION infame_planning_ai_trial_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enrollment "PlanningAiEnrollment"; pool "PlanningAiPool"; verified_at timestamp(3); actual_owner text; owner_ok boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Lifetime trial fences are immutable' USING ERRCODE = '23514'; END IF;
  SELECT * INTO pool FROM "PlanningAiPool" WHERE id = NEW."poolId" FOR UPDATE;
  SELECT * INTO enrollment FROM "PlanningAiEnrollment" WHERE id = NEW."enrollmentId" AND "poolId" = NEW."poolId" FOR SHARE;
  SELECT "emailVerifiedAt", active AND role = 'BRAND' INTO verified_at,owner_ok FROM "User" WHERE id = NEW."ownerUserId";
  IF pool.scope = 'OWN_BRAND' THEN SELECT "userId" INTO actual_owner FROM "Brand" WHERE id = pool."brandId";
  ELSE SELECT "ownerUserId" INTO actual_owner FROM "Organization" WHERE id = pool."organizationId"; END IF;
  IF pool.id IS NULL OR pool.state <> 'ACTIVE' OR enrollment.id IS NULL OR enrollment.state <> 'ACTIVE' OR enrollment.kind <> 'TRIAL'
     OR enrollment."subscriberUserId" IS DISTINCT FROM NEW."ownerUserId" OR actual_owner IS DISTINCT FROM NEW."ownerUserId"
     OR owner_ok IS DISTINCT FROM TRUE OR verified_at IS NULL OR verified_at > NEW."claimedAt" OR enrollment."acceptedAt" > NEW."claimedAt" THEN
    RAISE EXCEPTION 'Trial fence requires verified native owner and exact accepted enrollment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiTrialClaim_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiTrialClaim" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_trial_guard();

CREATE FUNCTION infame_planning_ai_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pool "PlanningAiPool"; enrollment "PlanningAiEnrollment";
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Planning cycle history is retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    -- Advancing the parent revision serializes writers AND creates a version
    -- conflict for an old RepeatableRead/Serializable snapshot. A plain row lock
    -- would not refresh such a snapshot and could permit overlapping inserts.
    UPDATE "PlanningAiPool" SET revision = revision + 1,
      "updatedAt" = GREATEST("updatedAt", (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3))
      WHERE id = NEW."poolId" RETURNING * INTO pool;
    SELECT * INTO enrollment FROM "PlanningAiEnrollment" WHERE id = NEW."enrollmentId" AND "poolId" = NEW."poolId" FOR SHARE;
    IF pool.id IS NULL OR pool.state <> 'ACTIVE' OR enrollment.id IS NULL OR enrollment.state <> 'ACTIVE'
       OR NEW.state <> 'ACTIVE' OR NEW.revision <> 1 OR NEW.held <> 0 OR NEW.consumed <> 0
       OR ROW(NEW."planId",NEW."policyVersion",NEW."priceVersion",NEW."netAmountMinor",NEW.currency)
          IS DISTINCT FROM ROW(enrollment."planId",enrollment."policyVersion",enrollment."priceVersion",enrollment."netAmountMinor",enrollment.currency)
       OR ((NEW.source = 'TRIAL') IS DISTINCT FROM (enrollment.kind = 'TRIAL')) THEN
      RAISE EXCEPTION 'Planning cycle requires exact accepted active enrollment' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "PlanningAiCycle" WHERE "poolId" = NEW."poolId" AND state = 'ACTIVE'
               AND "startsAt" < NEW."endsAt" AND "endsAt" > NEW."startsAt") THEN
      RAISE EXCEPTION 'Effective planning cycles cannot overlap' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['state','revision','updatedAt','held','consumed']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['state','revision','updatedAt','held','consumed'])
       OR NEW.revision::bigint <> OLD.revision::bigint + 1 OR NEW."updatedAt" < OLD."updatedAt"
       OR NEW.consumed < OLD.consumed OR (OLD.state = 'VOIDED' AND NEW.state <> 'VOIDED')
       OR (NEW.state = 'VOIDED' AND OLD.state <> 'VOIDED' AND (OLD.held <> 0 OR OLD.consumed <> 0)) THEN
      RAISE EXCEPTION 'Planning cycle identity or irreversible counter is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiCycle_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiCycle" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_cycle_guard();
