-- All billed purposes share one reservation journal. Preserve exact monetary
-- amounts and execution identity even if a future adapter omits an app guard.
ALTER TABLE "AiReservation" ADD CONSTRAINT "AiReservation_state_coherent" CHECK ((
  "reservedMicros" > 0 AND "payloadHash" ~ '^[a-f0-9]{64}$'
  AND purpose IN ('ONBOARDING_VOICE','TRANSCRIPTION','SPEECH','FACT_EXTRACTION','PORTFOLIO','CAMPAIGN_CHAT','CAMPAIGN_EXTRACTION','BRIEF','MATCH_EXPLANATION','CONTENT_THEME','SCREENSHOT_EXTRACTION')
  AND jsonb_typeof(result) = 'object' AND result->>'schemaVersion' = '1'
  AND octet_length(result::text) <= 8192
  AND (result->>'requestHash') ~ '^[a-f0-9]{64}$'
  AND (
    (status = 'RESERVED' AND "actualMicros" IS NULL AND "settledAt" IS NULL AND result->>'executionTokenHash' IS NULL)
    OR (status IN ('RUNNING','UNKNOWN') AND "actualMicros" IS NULL AND "settledAt" IS NULL
      AND (result->>'executionTokenHash') ~ '^[a-f0-9]{64}$' AND result->>'claimedAt' IS NOT NULL AND result->>'deadlineAt' IS NOT NULL)
    OR (status = 'SETTLED' AND "actualMicros" >= 0 AND "settledAt" IS NOT NULL
      AND (result->>'settlementHash') ~ '^[a-f0-9]{64}$' AND jsonb_typeof(result->'usage') = 'array' AND jsonb_typeof(result->'settlementPricing') = 'object')
    OR (status = 'RELEASED' AND "actualMicros" = 0 AND "settledAt" IS NOT NULL AND result->>'noCallReason' IS NOT NULL)
  )
) IS TRUE);

CREATE UNIQUE INDEX "AiReservation_one_live_payload" ON "AiReservation" ("userId",purpose,"payloadHash")
  WHERE status IN ('RESERVED','RUNNING','UNKNOWN');
CREATE INDEX "AiReservation_pending_purpose" ON "AiReservation" ("userId",purpose,status)
  WHERE status IN ('RESERVED','RUNNING','UNKNOWN');
CREATE INDEX "AiReservation_settled_day" ON "AiReservation" ("settledAt","userId") WHERE status = 'SETTLED';

CREATE FUNCTION infame_ai_reservation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW."userId", NEW."operationKey", NEW."payloadHash", NEW.purpose, NEW."reservedMicros", NEW."createdAt")
    IS DISTINCT FROM ROW(OLD.id, OLD."userId", OLD."operationKey", OLD."payloadHash", OLD.purpose, OLD."reservedMicros", OLD."createdAt")
    OR (NEW.result - ARRAY['executionTokenHash','claimedAt','deadlineAt','quarantineReason','settlementHash','usage','settlementPricing','estimatedActualMicros','noCallReason','overrun','overrunResolved','reconciliation'])
      IS DISTINCT FROM (OLD.result - ARRAY['executionTokenHash','claimedAt','deadlineAt','quarantineReason','settlementHash','usage','settlementPricing','estimatedActualMicros','noCallReason','overrun','overrunResolved','reconciliation']) THEN
    RAISE EXCEPTION 'AI reservation identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.result->>'executionTokenHash' IS NOT NULL AND
    ROW(NEW.result->'executionTokenHash',NEW.result->'claimedAt',NEW.result->'deadlineAt')
      IS DISTINCT FROM ROW(OLD.result->'executionTokenHash',OLD.result->'claimedAt',OLD.result->'deadlineAt') THEN
    RAISE EXCEPTION 'AI execution claim is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('SETTLED','RELEASED') AND
    (ROW(NEW.status,NEW."actualMicros",NEW."settledAt") IS DISTINCT FROM ROW(OLD.status,OLD."actualMicros",OLD."settledAt")
      OR ROW(NEW.result->'settlementHash',NEW.result->'usage',NEW.result->'settlementPricing',NEW.result->'estimatedActualMicros',NEW.result->'noCallReason',NEW.result->'overrun')
        IS DISTINCT FROM ROW(OLD.result->'settlementHash',OLD.result->'usage',OLD.result->'settlementPricing',OLD.result->'estimatedActualMicros',OLD.result->'noCallReason',OLD.result->'overrun')) THEN
    RAISE EXCEPTION 'Recorded AI costs are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.status = OLD.status OR (OLD.status = 'RESERVED' AND NEW.status IN ('RUNNING','RELEASED'))
    OR (OLD.status = 'RUNNING' AND NEW.status IN ('UNKNOWN','SETTLED','RELEASED'))
    OR (OLD.status = 'UNKNOWN' AND NEW.status IN ('SETTLED','RELEASED'))) THEN
    RAISE EXCEPTION 'Invalid AI billing transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AiReservation_immutable" BEFORE UPDATE ON "AiReservation" FOR EACH ROW EXECUTE FUNCTION infame_ai_reservation_immutable();
