-- Additive private reusable lists. No existing creator/deal parties are changed.
CREATE TYPE "CreatorCollectionScope" AS ENUM ('OWN_BRAND', 'CLIENT');
CREATE UNIQUE INDEX "OrganizationClient_id_organizationId_brandId_key" ON "OrganizationClient"(id,"organizationId","brandId");

CREATE TABLE "CreatorCollection" (
  id TEXT NOT NULL PRIMARY KEY,
  scope "CreatorCollectionScope" NOT NULL,
  "brandId" TEXT NOT NULL,
  "organizationId" TEXT,
  "clientId" TEXT,
  name TEXT NOT NULL,
  "nameLanguage" TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  archived BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorCollection_scope_check" CHECK (
    (scope='OWN_BRAND' AND "organizationId" IS NULL AND "clientId" IS NULL)
    OR (scope='CLIENT' AND "organizationId" IS NOT NULL AND "clientId" IS NOT NULL)
  ),
  CONSTRAINT "CreatorCollection_content_check" CHECK (char_length(name) BETWEEN 1 AND 200 AND name ~ '[^[:space:]]'
    AND ("nameLanguage" IS NULL OR char_length("nameLanguage") BETWEEN 2 AND 100)),
  CONSTRAINT "CreatorCollection_revision_check" CHECK (revision BETWEEN 1 AND 2147483646),
  CONSTRAINT "CreatorCollection_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CreatorCollection_clientId_organizationId_brandId_fkey" FOREIGN KEY ("clientId","organizationId","brandId")
    REFERENCES "OrganizationClient"(id,"organizationId","brandId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CreatorCollection_scope_brandId_archived_id_idx" ON "CreatorCollection"(scope,"brandId",archived,id);
CREATE INDEX "CreatorCollection_scope_clientId_archived_id_idx" ON "CreatorCollection"(scope,"clientId",archived,id);

CREATE TABLE "CreatorCollectionEntry" (
  id TEXT NOT NULL PRIMARY KEY,
  "collectionId" TEXT NOT NULL,
  "creatorReferenceId" TEXT NOT NULL,
  "creatorId" TEXT,
  note TEXT,
  "noteLanguage" TEXT,
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorCollectionEntry_reference_check" CHECK (char_length("creatorReferenceId") BETWEEN 1 AND 200
    AND ("creatorId" IS NULL OR "creatorId"="creatorReferenceId")),
  CONSTRAINT "CreatorCollectionEntry_note_check" CHECK ((note IS NULL OR char_length(note)<=2000)
    AND ("noteLanguage" IS NULL OR char_length("noteLanguage") BETWEEN 2 AND 100)),
  CONSTRAINT "CreatorCollectionEntry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CreatorCollection"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CreatorCollectionEntry_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"(id) ON DELETE SET NULL ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CreatorCollectionEntry_collectionId_creatorReferenceId_key" ON "CreatorCollectionEntry"("collectionId","creatorReferenceId");
CREATE INDEX "CreatorCollectionEntry_creatorId_idx" ON "CreatorCollectionEntry"("creatorId");
CREATE INDEX "CreatorCollectionEntry_collectionId_removedAt_id_idx" ON "CreatorCollectionEntry"("collectionId","removedAt",id);

CREATE TABLE "CreatorCollectionCommand" (
  id TEXT NOT NULL PRIMARY KEY,
  "actorUserId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  action TEXT NOT NULL,
  result JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreatorCollectionCommand_hash_check" CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CreatorCollectionCommand_identity_check" CHECK (char_length("actorUserId") BETWEEN 1 AND 200
    AND char_length("operationKey") BETWEEN 1 AND 200 AND char_length(action) BETWEEN 1 AND 100),
  CONSTRAINT "CreatorCollectionCommand_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CreatorCollection"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CreatorCollectionCommand_actorUserId_operationKey_key" ON "CreatorCollectionCommand"("actorUserId","operationKey");
CREATE INDEX "CreatorCollectionCommand_collectionId_id_idx" ON "CreatorCollectionCommand"("collectionId",id);

CREATE FUNCTION infame_collection_identity_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW."brandId" IS DISTINCT FROM OLD."brandId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.revision::bigint <> OLD.revision::bigint + 1 THEN
    RAISE EXCEPTION 'Collection updates require immutable scope and exact next revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CreatorCollection_identity_revision" BEFORE UPDATE ON "CreatorCollection"
  FOR EACH ROW EXECUTE FUNCTION infame_collection_identity_revision();

CREATE FUNCTION infame_collection_entry_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."collectionId" IS DISTINCT FROM OLD."collectionId"
    OR NEW."creatorReferenceId" IS DISTINCT FROM OLD."creatorReferenceId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Collection entry identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."creatorId" IS DISTINCT FROM OLD."creatorId" THEN
    IF OLD."creatorId" IS NOT NULL AND NEW."creatorId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Creator" WHERE id=OLD."creatorId")
      AND (to_jsonb(NEW)-'creatorId') IS NOT DISTINCT FROM (to_jsonb(OLD)-'creatorId') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Collection creator reference cannot be reassigned or revived' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CreatorCollectionEntry_identity" BEFORE UPDATE ON "CreatorCollectionEntry"
  FOR EACH ROW EXECUTE FUNCTION infame_collection_entry_identity();

CREATE FUNCTION infame_collection_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Collection command receipts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "CreatorCollectionCommand_immutable" BEFORE UPDATE ON "CreatorCollectionCommand"
  FOR EACH ROW EXECUTE FUNCTION infame_collection_command_immutable();
