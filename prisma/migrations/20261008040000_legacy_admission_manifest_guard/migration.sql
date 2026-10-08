CREATE FUNCTION infame_legacy_manifest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item JSONB;
BEGIN
 IF jsonb_typeof(NEW.content) IS DISTINCT FROM 'object'
  OR NEW.content->>'schemaVersion' IS DISTINCT FROM '1'
  OR NEW.content->>'manifestId' IS DISTINCT FROM NEW.id
  OR NEW.content->>'provenance' IS DISTINCT FROM NEW.provenance
  OR jsonb_typeof(NEW.content->'entries') IS DISTINCT FROM 'array'
  OR jsonb_array_length(NEW.content->'entries') NOT BETWEEN 1 AND 50
  THEN RAISE EXCEPTION 'Manifest declaration binding' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'entries') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'entryId' IS NULL OR item->>'admissionId' IS NULL
   OR item->>'version' IS NULL OR item->>'sourceHash' IS NULL OR item->>'sourceHash' !~ '^[a-f0-9]{64}$'
   THEN RAISE EXCEPTION 'Manifest declaration entry' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER "LegacyAdmissionManifest_guard" BEFORE INSERT OR UPDATE ON "LegacyAdmissionManifest" FOR EACH ROW EXECUTE FUNCTION infame_legacy_manifest_guard();
