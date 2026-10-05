-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('BUSINESS', 'AGENCY');

-- CreateEnum
CREATE TYPE "MembershipState" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "OrganizationClientState" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "OrganizationKind" NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" "MembershipState" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationClient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "state" "OrganizationClientState" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "authorizingUserId" TEXT,
    "authorizingSessionVersion" INTEGER,
    "allowedCapabilities" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "view" BOOLEAN NOT NULL DEFAULT false,
    "plan" BOOLEAN NOT NULL DEFAULT false,
    "approveShortlist" BOOLEAN NOT NULL DEFAULT false,
    "reviewContent" BOOLEAN NOT NULL DEFAULT false,
    "signCustomer" BOOLEAN NOT NULL DEFAULT false,
    "financial" BOOLEAN NOT NULL DEFAULT false,
    "manageGrants" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationCommand" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_ownerUserId_idx" ON "Organization"("ownerUserId");

-- CreateIndex
CREATE INDEX "OrganizationMembership_userId_state_idx" ON "OrganizationMembership"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_id_organizationId_key" ON "OrganizationMembership"("id", "organizationId");

-- CreateIndex
CREATE INDEX "OrganizationClient_brandId_state_idx" ON "OrganizationClient"("brandId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationClient_organizationId_brandId_key" ON "OrganizationClient"("organizationId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationClient_id_organizationId_key" ON "OrganizationClient"("id", "organizationId");

-- CreateIndex
CREATE INDEX "ClientGrant_organizationId_clientId_active_idx" ON "ClientGrant"("organizationId", "clientId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ClientGrant_membershipId_clientId_key" ON "ClientGrant"("membershipId", "clientId");

-- CreateIndex
CREATE INDEX "OrganizationCommand_organizationId_idx" ON "OrganizationCommand"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCommand_actorUserId_operationKey_key" ON "OrganizationCommand"("actorUserId", "operationKey");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationClient" ADD CONSTRAINT "OrganizationClient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationClient" ADD CONSTRAINT "OrganizationClient_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientGrant" ADD CONSTRAINT "ClientGrant_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientGrant" ADD CONSTRAINT "ClientGrant_clientId_organizationId_fkey" FOREIGN KEY ("clientId", "organizationId") REFERENCES "OrganizationClient"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCommand" ADD CONSTRAINT "OrganizationCommand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Local authority rows advance exact revisions; current consent is not inferred.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_revision_positive" CHECK (revision > 0);
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_name_bounded" CHECK (length(name) BETWEEN 1 AND 120 AND length(btrim(name)) > 0);
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_revision_positive" CHECK (revision > 0);
ALTER TABLE "OrganizationClient" ADD CONSTRAINT "OrganizationClient_revision_positive" CHECK (revision > 0);
ALTER TABLE "ClientGrant" ADD CONSTRAINT "ClientGrant_revision_positive" CHECK (revision > 0);
ALTER TABLE "OrganizationClient" ADD CONSTRAINT "OrganizationClient_active_authorized" CHECK (state <> 'ACTIVE' OR COALESCE(
  length("authorizingUserId") > 0 AND "authorizingSessionVersion" > 0
  AND jsonb_typeof("allowedCapabilities") = 'object'
  AND "allowedCapabilities" ?& ARRAY['view','plan','approveShortlist','reviewContent','signCustomer','financial','manageGrants']
  AND "allowedCapabilities" - ARRAY['view','plan','approveShortlist','reviewContent','signCustomer','financial','manageGrants'] = '{}'::jsonb
  AND jsonb_typeof("allowedCapabilities"->'view') = 'boolean'
  AND jsonb_typeof("allowedCapabilities"->'plan') = 'boolean'
  AND jsonb_typeof("allowedCapabilities"->'approveShortlist') = 'boolean'
  AND jsonb_typeof("allowedCapabilities"->'reviewContent') = 'boolean'
  AND jsonb_typeof("allowedCapabilities"->'signCustomer') = 'boolean'
  AND jsonb_typeof("allowedCapabilities"->'financial') = 'boolean'
  AND jsonb_typeof("allowedCapabilities"->'manageGrants') = 'boolean', false));
ALTER TABLE "OrganizationCommand" ADD CONSTRAINT "OrganizationCommand_hash_valid" CHECK ("payloadHash" ~ '^[a-f0-9]{64}$');

CREATE FUNCTION infame_organization_identity_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.revision::bigint <> OLD.revision::bigint + 1 THEN
    RAISE EXCEPTION 'Authority updates require stable identity and the next revision' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='Organization' THEN
    IF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" THEN
      RAISE EXCEPTION 'Organization owner identity is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='OrganizationMembership' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
      RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "Organization" WHERE id=OLD."organizationId" AND "ownerUserId"=OLD."userId") AND NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Owner membership is protected' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='OrganizationClient' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."brandId" IS DISTINCT FROM OLD."brandId" THEN
      RAISE EXCEPTION 'Client association identity is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='ClientGrant' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."membershipId" IS DISTINCT FROM OLD."membershipId" OR NEW."clientId" IS DISTINCT FROM OLD."clientId" THEN
      RAISE EXCEPTION 'Client grant identity is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Organization_identity_revision" BEFORE UPDATE ON "Organization" FOR EACH ROW EXECUTE FUNCTION infame_organization_identity_revision();
CREATE TRIGGER "OrganizationMembership_identity_revision" BEFORE UPDATE ON "OrganizationMembership" FOR EACH ROW EXECUTE FUNCTION infame_organization_identity_revision();
CREATE TRIGGER "OrganizationClient_identity_revision" BEFORE UPDATE ON "OrganizationClient" FOR EACH ROW EXECUTE FUNCTION infame_organization_identity_revision();
CREATE TRIGGER "ClientGrant_identity_revision" BEFORE UPDATE ON "ClientGrant" FOR EACH ROW EXECUTE FUNCTION infame_organization_identity_revision();
CREATE FUNCTION infame_organization_command_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Organization command receipts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "OrganizationCommand_immutable" BEFORE UPDATE ON "OrganizationCommand" FOR EACH ROW EXECUTE FUNCTION infame_organization_command_immutable();
