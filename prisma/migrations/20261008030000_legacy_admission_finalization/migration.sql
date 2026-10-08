-- Schema24A storage only. Old unlinked Version declarations stay inert.
-- No runtime trusted importer or executable direct admission is introduced.
CREATE TABLE "LegacyAdmissionManifest" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 provenance TEXT NOT NULL CHECK(provenance IN ('LIVE','DEVELOPMENT_FIXTURE')),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object' AND infame_planning_json_bytes(content)<=131072),
 digest TEXT NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 UNIQUE(id,provenance), UNIQUE(id,provenance,digest)
);
CREATE TABLE "LegacyAdmissionManifestEntry" (
 "manifestId" TEXT NOT NULL CHECK("manifestId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "entryId" TEXT NOT NULL CHECK("entryId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 50),
 "versionId" TEXT NOT NULL UNIQUE CHECK("versionId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "admissionId" TEXT NOT NULL CHECK("admissionId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 provenance TEXT NOT NULL, capability TEXT NOT NULL, version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483646),
 "sourceHash" TEXT NOT NULL CHECK("sourceHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 PRIMARY KEY("manifestId","entryId"), UNIQUE("manifestId",ordinal), UNIQUE("manifestId","admissionId",version),
 CONSTRAINT "LegacyAdmissionManifestEntry_exact_member" UNIQUE("manifestId","entryId","versionId","admissionId",provenance,capability,version,"sourceHash"),
 FOREIGN KEY("manifestId",provenance) REFERENCES "LegacyAdmissionManifest"(id,provenance) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("versionId","admissionId",provenance,capability,version,"sourceHash")
  REFERENCES "LegacyDirectAdmissionVersion"(id,"admissionId",provenance,capability,version,"sourceHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "LegacyAdmissionManifestEntry_admissionId_idx" ON "LegacyAdmissionManifestEntry"("admissionId");
CREATE TABLE "LegacyAdmissionImportReceipt" (
 id TEXT PRIMARY KEY CHECK(id COLLATE "C" ~ '^[!-~]{1,200}$'),
 "importKey" UUID NOT NULL UNIQUE, "manifestId" TEXT NOT NULL UNIQUE CHECK("manifestId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 provenance TEXT NOT NULL, digest TEXT NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 "bundleHash" TEXT NOT NULL CHECK("bundleHash" ~ '^[a-f0-9]{64}$'),
 "verifierVersion" TEXT NOT NULL CHECK("verifierVersion" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "entryCount" INTEGER NOT NULL CHECK("entryCount" BETWEEN 1 AND 50),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'),
 UNIQUE(id,"manifestId",provenance,digest),
 FOREIGN KEY("manifestId",provenance,digest) REFERENCES "LegacyAdmissionManifest"(id,provenance,digest) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "FreshDealAdmissionLink" (
 "admissionId" TEXT PRIMARY KEY CHECK("admissionId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "dealId" TEXT NOT NULL UNIQUE CHECK("dealId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "versionId" TEXT NOT NULL CHECK("versionId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 2147483646), "sourceHash" TEXT NOT NULL CHECK("sourceHash" ~ '^[a-f0-9]{64}$'),
 provenance TEXT NOT NULL, capability TEXT NOT NULL CHECK(capability='FRESH_PINNED_SCOPE'),
 "manifestId" TEXT NOT NULL CHECK("manifestId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "manifestEntryId" TEXT NOT NULL CHECK("manifestEntryId" COLLATE "C" ~ '^[!-~]{1,200}$'), digest TEXT NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 "importReceiptId" TEXT NOT NULL CHECK("importReceiptId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "firstOfferId" TEXT NOT NULL CHECK("firstOfferId" COLLATE "C" ~ '^[!-~]{1,200}$'), "firstOfferVersion" INTEGER NOT NULL CHECK("firstOfferVersion"=1),
 "brandUserId" TEXT NOT NULL CHECK("brandUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "creatorUserId" TEXT NOT NULL CHECK("creatorUserId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "approvedBriefId" TEXT NOT NULL CHECK("approvedBriefId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "approvedBriefVersion" INTEGER NOT NULL CHECK("approvedBriefVersion" BETWEEN 1 AND 2147483646),
 "createCommandId" TEXT NOT NULL CHECK("createCommandId" COLLATE "C" ~ '^[!-~]{1,200}$'),
 "createOperationKey" TEXT NOT NULL CHECK("createOperationKey" COLLATE "C" ~ '^[A-Za-z0-9_:-]{1,120}$'),
 "createPayloadHash" TEXT NOT NULL CHECK("createPayloadHash" ~ '^[a-f0-9]{64}$'),
 "createResultHash" TEXT NOT NULL CHECK("createResultHash" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("createdAt">=TIMESTAMP '0001-01-01' AND "createdAt"<TIMESTAMP '10000-01-01'), CHECK("brandUserId"<>"creatorUserId"),
 FOREIGN KEY("admissionId") REFERENCES "LegacyDirectAdmission"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("versionId","admissionId",provenance,capability,version,"sourceHash")
  REFERENCES "LegacyDirectAdmissionVersion"(id,"admissionId",provenance,capability,version,"sourceHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("manifestId","manifestEntryId","versionId","admissionId",provenance,capability,version,"sourceHash")
  REFERENCES "LegacyAdmissionManifestEntry"("manifestId","entryId","versionId","admissionId",provenance,capability,version,"sourceHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("importReceiptId","manifestId",provenance,digest)
  REFERENCES "LegacyAdmissionImportReceipt"(id,"manifestId",provenance,digest) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("dealId") REFERENCES "Deal"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("firstOfferId") REFERENCES "DealOffer"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("approvedBriefId") REFERENCES "CampaignBrief"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("createCommandId") REFERENCES "DealCommand"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("brandUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("creatorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "FreshDealAdmissionLink_versionId_idx" ON "FreshDealAdmissionLink"("versionId");
CREATE INDEX "FreshDealAdmissionLink_importReceiptId_idx" ON "FreshDealAdmissionLink"("importReceiptId");
CREATE INDEX "FreshDealAdmissionLink_firstOfferId_idx" ON "FreshDealAdmissionLink"("firstOfferId");
CREATE INDEX "FreshDealAdmissionLink_createCommandId_idx" ON "FreshDealAdmissionLink"("createCommandId");

CREATE FUNCTION infame_legacy_manifest_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "LegacyDirectAdmissionVersion"%ROWTYPE; m "LegacyAdmissionManifest"%ROWTYPE; item JSONB;
BEGIN
 SELECT * INTO m FROM "LegacyAdmissionManifest" WHERE id=NEW."manifestId" AND provenance=NEW.provenance FOR UPDATE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Manifest parent missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO v FROM "LegacyDirectAdmissionVersion" WHERE id=NEW."versionId" FOR SHARE;
 IF v.id IS NULL OR v."admissionId" IS DISTINCT FROM NEW."admissionId" OR v.provenance IS DISTINCT FROM NEW.provenance
  OR v.capability IS DISTINCT FROM NEW.capability OR v.version IS DISTINCT FROM NEW.version OR v."sourceHash" IS DISTINCT FROM NEW."sourceHash"
  OR (v.content->'manifest'->>'id') IS DISTINCT FROM NEW."manifestId" OR (v.content->'manifest'->>'entryId') IS DISTINCT FROM NEW."entryId"
  THEN RAISE EXCEPTION 'Manifest entry version binding' USING ERRCODE='23514'; END IF;
 item := m.content->'entries'->(NEW.ordinal-1);
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'entryId' IS DISTINCT FROM NEW."entryId"
  OR item->>'admissionId' IS DISTINCT FROM NEW."admissionId" OR (item->>'version')::int IS DISTINCT FROM NEW.version
  OR item->>'sourceHash' IS DISTINCT FROM NEW."sourceHash" THEN RAISE EXCEPTION 'Manifest entry order binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Manifest entry order binding' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "LegacyAdmissionManifestEntry_guard" BEFORE INSERT OR UPDATE ON "LegacyAdmissionManifestEntry" FOR EACH ROW EXECUTE FUNCTION infame_legacy_manifest_entry_guard();

CREATE FUNCTION infame_legacy_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m "LegacyAdmissionManifest"%ROWTYPE; count_entries integer; count_expected integer;
BEGIN
 SELECT * INTO m FROM "LegacyAdmissionManifest" WHERE id=NEW."manifestId" AND provenance=NEW.provenance AND digest=NEW.digest FOR UPDATE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'Receipt manifest binding' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO count_entries FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=NEW."manifestId";
 count_expected := jsonb_array_length(m.content->'entries');
 IF NEW."entryCount"<>count_expected OR count_entries<>count_expected THEN RAISE EXCEPTION 'Receipt manifest completeness' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM "LegacyAdmissionManifestEntry" e WHERE e."manifestId"=NEW."manifestId" AND NOT EXISTS
   (SELECT 1 FROM "LegacyDirectAdmissionVersion" v WHERE v.id=e."versionId" AND v."admissionId"=e."admissionId" AND v.provenance=e.provenance AND v.capability=e.capability AND v.version=e.version AND v."sourceHash"=e."sourceHash"))
   THEN RAISE EXCEPTION 'Receipt entry version completeness' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LegacyAdmissionImportReceipt_guard" BEFORE INSERT OR UPDATE ON "LegacyAdmissionImportReceipt" FOR EACH ROW EXECUTE FUNCTION infame_legacy_receipt_guard();

CREATE FUNCTION infame_legacy_fresh_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "LegacyAdmissionManifestEntry"%ROWTYPE; r "LegacyAdmissionImportReceipt"%ROWTYPE; v "LegacyDirectAdmissionVersion"%ROWTYPE;
BEGIN
 SELECT * INTO e FROM "LegacyAdmissionManifestEntry" WHERE "manifestId"=NEW."manifestId" AND "entryId"=NEW."manifestEntryId" FOR SHARE;
 SELECT * INTO r FROM "LegacyAdmissionImportReceipt" WHERE id=NEW."importReceiptId" FOR SHARE;
 SELECT * INTO v FROM "LegacyDirectAdmissionVersion" WHERE id=NEW."versionId" FOR SHARE;
 IF e."versionId" IS NULL OR r.id IS NULL OR v.id IS NULL OR r."manifestId" IS DISTINCT FROM NEW."manifestId" OR r.provenance IS DISTINCT FROM NEW.provenance OR r.digest IS DISTINCT FROM NEW.digest
  OR e."versionId" IS DISTINCT FROM NEW."versionId" OR e."admissionId" IS DISTINCT FROM NEW."admissionId" OR e.provenance IS DISTINCT FROM NEW.provenance OR e.version IS DISTINCT FROM NEW.version OR e."sourceHash" IS DISTINCT FROM NEW."sourceHash"
  OR v.capability IS DISTINCT FROM 'FRESH_PINNED_SCOPE' OR NEW.capability IS DISTINCT FROM 'FRESH_PINNED_SCOPE'
  THEN RAISE EXCEPTION 'Fresh admission finalization binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FreshDealAdmissionLink_guard" BEFORE INSERT OR UPDATE ON "FreshDealAdmissionLink" FOR EACH ROW EXECUTE FUNCTION infame_legacy_fresh_link_guard();

CREATE TRIGGER "LegacyAdmissionManifest_immutable" BEFORE UPDATE ON "LegacyAdmissionManifest" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "LegacyAdmissionManifestEntry_immutable" BEFORE UPDATE ON "LegacyAdmissionManifestEntry" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "LegacyAdmissionImportReceipt_immutable" BEFORE UPDATE ON "LegacyAdmissionImportReceipt" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
CREATE TRIGGER "FreshDealAdmissionLink_immutable" BEFORE UPDATE ON "FreshDealAdmissionLink" FOR EACH ROW EXECUTE FUNCTION infame_planning_immutable();
