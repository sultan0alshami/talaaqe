-- M04B2 declaration storage only. No route, authority or live readiness.
CREATE TABLE "InfamePrincipal" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 provenance TEXT NOT NULL CHECK(provenance IN ('LIVE','DEVELOPMENT_FIXTURE')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,provenance), CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01')
);
CREATE TABLE "InfamePrincipalVersion" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 "principalId" TEXT NOT NULL, provenance TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=131072),
 "sourceHash" TEXT NOT NULL CHECK("sourceHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 UNIQUE("principalId",version), UNIQUE(id,"principalId",version,"sourceHash"),
 UNIQUE(id,"principalId",provenance,version,"sourceHash"),
 FOREIGN KEY("principalId",provenance) REFERENCES "InfamePrincipal"(id,provenance) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "InfamePrincipalState" (
 "principalId" TEXT PRIMARY KEY REFERENCES "InfamePrincipal"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483646),
 state TEXT NOT NULL CHECK(state IN ('DRAFT','ACTIVE','PAUSED','REVOKED')),
 "currentVersionId" TEXT, "currentVersionNumber" INTEGER, "currentSourceHash" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "updatedAt"<TIMESTAMP '10000-01-01' AND "updatedAt">="createdAt"),
 CHECK(("currentVersionId" IS NULL AND "currentVersionNumber" IS NULL AND "currentSourceHash" IS NULL)
   OR ("currentVersionId" IS NOT NULL AND "currentVersionNumber" IS NOT NULL AND "currentSourceHash" IS NOT NULL
    AND "currentVersionNumber" BETWEEN 1 AND 2147483646 AND "currentSourceHash" ~ '^[a-f0-9]{64}$')),
 CHECK((state='DRAFT' AND "currentVersionId" IS NULL) OR (state IN ('ACTIVE','PAUSED') AND "currentVersionId" IS NOT NULL) OR state='REVOKED'),
 FOREIGN KEY("currentVersionId","principalId","currentVersionNumber","currentSourceHash")
  REFERENCES "InfamePrincipalVersion"(id,"principalId",version,"sourceHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "InfamePrincipalState_current_version" ON "InfamePrincipalState"("currentVersionId","principalId","currentVersionNumber","currentSourceHash");
CREATE INDEX "InfamePrincipalState_available" ON "InfamePrincipalState"(state,"principalId");
CREATE TRIGGER "InfamePrincipal_immutable" BEFORE UPDATE ON "InfamePrincipal" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "InfamePrincipalVersion_immutable" BEFORE UPDATE ON "InfamePrincipalVersion" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();

CREATE FUNCTION infame_principal_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "InfamePrincipal"%ROWTYPE; s "InfamePrincipalState"%ROWTYPE; previous INTEGER; item JSONB;
BEGIN
 SELECT * INTO p FROM "InfamePrincipal" WHERE id=NEW."principalId" FOR UPDATE;
 SELECT * INTO s FROM "InfamePrincipalState" WHERE "principalId"=NEW."principalId";
 IF p.id IS NULL OR s."principalId" IS NULL OR s.state='REVOKED' OR p.provenance<>NEW.provenance OR NEW."createdAt"<p."createdAt"
  THEN RAISE EXCEPTION 'Principal declaration subject' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(MAX(version),0) INTO previous FROM "InfamePrincipalVersion" WHERE "principalId"=NEW."principalId";
 IF NEW.version::bigint<>previous::bigint+1 THEN RAISE EXCEPTION 'Principal declaration sequence' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.content) IS DISTINCT FROM 'object'
  OR NEW.content - ARRAY['schemaVersion','principalId','provenance','version','party','declaredActivityKeys','marketCountryCodes'] <> '{}'::jsonb
  OR NEW.content->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR NEW.content->'principalId' IS DISTINCT FROM to_jsonb(NEW."principalId")
  OR NEW.content->'provenance' IS DISTINCT FROM to_jsonb(NEW.provenance)
  OR NEW.content->'version' IS DISTINCT FROM to_jsonb(NEW.version)
  OR jsonb_typeof(NEW.content->'party') IS DISTINCT FROM 'object'
  OR jsonb_typeof(NEW.content->'declaredActivityKeys') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.content->'marketCountryCodes') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Principal declaration shape' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(NEW.content->'declaredActivityKeys') NOT BETWEEN 1 AND 50
  OR jsonb_array_length(NEW.content->'marketCountryCodes') NOT BETWEEN 1 AND 50
  OR (SELECT COUNT(DISTINCT value) FROM jsonb_array_elements(NEW.content->'declaredActivityKeys'))<>jsonb_array_length(NEW.content->'declaredActivityKeys')
  OR (SELECT COUNT(DISTINCT value) FROM jsonb_array_elements(NEW.content->'marketCountryCodes'))<>jsonb_array_length(NEW.content->'marketCountryCodes')
  THEN RAISE EXCEPTION 'Principal declaration coverage' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'declaredActivityKeys') LOOP
  IF jsonb_typeof(item)<>'string' OR length(item#>>'{}') NOT BETWEEN 1 AND 100 OR (item#>>'{}') COLLATE "C" !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
   THEN RAISE EXCEPTION 'Principal declared activity' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'marketCountryCodes') LOOP
  IF jsonb_typeof(item)<>'string' OR (item#>>'{}') COLLATE "C" !~ '^[A-Z]{2}$'
   THEN RAISE EXCEPTION 'Principal declared market' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER "InfamePrincipalVersion_guard" BEFORE INSERT ON "InfamePrincipalVersion" FOR EACH ROW EXECUTE FUNCTION infame_principal_version_guard();

CREATE FUNCTION infame_principal_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "InfamePrincipal"%ROWTYPE; latest INTEGER; v "InfamePrincipalVersion"%ROWTYPE;
BEGIN
 SELECT * INTO p FROM "InfamePrincipal" WHERE id=NEW."principalId" FOR UPDATE;
 IF p.id IS NULL OR NEW."createdAt"<p."createdAt" THEN RAISE EXCEPTION 'Principal state subject' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.state<>'DRAFT' OR NEW."currentVersionId" IS NOT NULL
   OR EXISTS(SELECT 1 FROM "InfamePrincipalVersion" WHERE "principalId"=NEW."principalId")
   THEN RAISE EXCEPTION 'Principal initial state' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."principalId"<>OLD."principalId" OR NEW."createdAt"<>OLD."createdAt" OR NEW.revision::bigint<>OLD.revision::bigint+1
   OR NEW."updatedAt"<OLD."updatedAt" OR OLD.state='REVOKED'
   OR (OLD.state<>'DRAFT' AND NEW.state='DRAFT')
   OR (NEW.state IN ('PAUSED','REVOKED') AND ROW(NEW."currentVersionId",NEW."currentVersionNumber",NEW."currentSourceHash") IS DISTINCT FROM ROW(OLD."currentVersionId",OLD."currentVersionNumber",OLD."currentSourceHash"))
   OR (OLD."currentVersionNumber" IS NOT NULL AND NEW."currentVersionNumber"<OLD."currentVersionNumber")
   OR (OLD.state='DRAFT' AND NEW.state='PAUSED')
   THEN RAISE EXCEPTION 'Principal sequential state' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."currentVersionId" IS NOT NULL THEN
  SELECT * INTO v FROM "InfamePrincipalVersion" WHERE id=NEW."currentVersionId";
  IF v.id IS NULL OR v."principalId"<>NEW."principalId" OR v.version IS DISTINCT FROM NEW."currentVersionNumber" OR v."sourceHash" IS DISTINCT FROM NEW."currentSourceHash"
   OR v."createdAt">NEW."updatedAt" THEN RAISE EXCEPTION 'Principal exact current version' USING ERRCODE='23514'; END IF;
  IF NEW.state='ACTIVE' THEN
   SELECT MAX(version) INTO latest FROM "InfamePrincipalVersion" WHERE "principalId"=NEW."principalId";
   IF v.version<>latest THEN RAISE EXCEPTION 'Principal latest current version' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "InfamePrincipalState_guard" BEFORE INSERT OR UPDATE ON "InfamePrincipalState" FOR EACH ROW EXECUTE FUNCTION infame_principal_state_guard();

CREATE FUNCTION infame_principal_version_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "InfamePrincipal" WHERE id=OLD."principalId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "InfamePrincipalState" WHERE "principalId"=OLD."principalId")
  THEN RAISE EXCEPTION 'Retained principal declaration' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "InfamePrincipalVersion_retention" BEFORE DELETE ON "InfamePrincipalVersion" FOR EACH ROW EXECUTE FUNCTION infame_principal_version_retention();
