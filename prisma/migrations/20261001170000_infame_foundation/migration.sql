-- Preserve inherited user identities; legacy session cookies are retired in application code.
ALTER TYPE "Role" RENAME VALUE 'CLIENT' TO 'BRAND';
ALTER TYPE "Role" RENAME VALUE 'PROVIDER' TO 'CREATOR';
-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'SNAPCHAT', 'X');

-- CreateEnum
CREATE TYPE "ProfileState" AS ENUM ('DRAFT', 'PRIVATE', 'PUBLISHED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "OwnershipStatus" AS ENUM ('UNPROVED', 'PENDING', 'VERIFIED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('API', 'SCREENSHOT_VERIFIED', 'SELF_REPORTED', 'PUBLIC_IMPORT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'REVOKED', 'NEEDS_RECHECK');

-- CreateEnum
CREATE TYPE "DealFormat" AS ENUM ('STORY', 'POST', 'REEL', 'LIVE', 'CAMPAIGN', 'VIDEO', 'SHORT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'BRIEF_GENERATED', 'BRIEF_APPROVED', 'SHORTLISTED', 'IN_DEALS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OFFERED', 'COUNTERED', 'ACCEPTED', 'AGREED', 'DELIVERED', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "isTest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notificationPreferences" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "timeZone" TEXT;

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "destination" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "countryCode" TEXT,
    "city" JSONB,
    "timeZone" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dialects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nicheIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fameTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentStyles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currency" TEXT,
    "minimumMinor" BIGINT,
    "availability" JSONB,
    "travel" JSONB,
    "state" "ProfileState" NOT NULL DEFAULT 'DRAFT',
    "isTest" BOOLEAN NOT NULL DEFAULT true,
    "publicConsentAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "primaryAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "countryCode" TEXT,
    "city" JSONB,
    "timeZone" TEXT,
    "website" TEXT,
    "sector" TEXT,
    "state" "ProfileState" NOT NULL DEFAULT 'DRAFT',
    "isTest" BOOLEAN NOT NULL DEFAULT true,
    "publicConsentAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Niche" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Niche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "providerAccountId" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "intendedConfirmedAt" TIMESTAMP(3),
    "ownershipStatus" "OwnershipStatus" NOT NULL DEFAULT 'UNPROVED',
    "ownershipReviewedBy" TEXT,
    "ownershipReviewedAt" TIMESTAMP(3),
    "ownershipProofAssetId" TEXT,
    "consentAt" TIMESTAMP(3),
    "mappingRevision" INTEGER NOT NULL DEFAULT 1,
    "factsApprovedAt" TIMESTAMP(3),
    "publicVisible" BOOLEAN NOT NULL DEFAULT false,
    "brandVisible" BOOLEAN NOT NULL DEFAULT false,
    "supportedFormats" "DealFormat"[] DEFAULT ARRAY[]::"DealFormat"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricsSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" "EvidenceSource" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mappingRevision" INTEGER NOT NULL,
    "jobId" TEXT,
    "providerObservationId" TEXT,
    "followers" BIGINT,
    "averageViews" BIGINT,
    "engagementRate" DECIMAL(12,8),
    "demographics" JSONB,
    "evidenceAssetId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "excludedAt" TIMESTAMP(3),
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "MetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactCorrection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorRate" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "format" "DealFormat" NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorWork" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "assetId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publicVisible" BOOLEAN NOT NULL DEFAULT false,
    "brandVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvertisingLicence" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platformScope" "Platform"[] DEFAULT ARRAY[]::"Platform"[],
    "evidenceAssetId" TEXT,
    "validFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvertisingLicence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessVerification" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "identifier" TEXT,
    "evidenceAssetId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioVersion" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "inputRevision" INTEGER NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "step" TEXT NOT NULL DEFAULT 'WELCOME',
    "mode" TEXT NOT NULL DEFAULT 'TEXT',
    "input" JSONB NOT NULL DEFAULT '{}',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "consent" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftCommand" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceJob" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,
    "operationKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "conversation" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "currentBriefVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignBrief" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "inputRevision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "briefVersion" INTEGER NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "requirementSnapshot" JSONB NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorMatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'OFFERED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentOfferVersion" INTEGER NOT NULL DEFAULT 1,
    "acceptedOfferVersion" INTEGER,
    "agreementVersion" INTEGER,
    "briefVersion" INTEGER NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "brandPaymentReportedAt" TIMESTAMP(3),
    "creatorReceiptReportedAt" TIMESTAMP(3),
    "firstRatingAt" TIMESTAMP(3),
    "ratingsRevealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealOffer" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "proposerUserId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementSnapshot" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "offerVersion" INTEGER NOT NULL,
    "briefVersion" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementConfirmation" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealMessage" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealRating" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateAsset" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "reservedMicros" BIGINT NOT NULL,
    "actualMicros" BIGINT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AiReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationFallback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceAssetId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "VerificationFallback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "creatorId" TEXT,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNCLAIMED',
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorClaim" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceAssetId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "creatorId" TEXT,
    "campaignId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAudit" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_expiresAt_idx" ON "AuthToken"("userId", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_userId_key" ON "Creator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_handle_key" ON "Creator"("handle");

-- CreateIndex
CREATE INDEX "Creator_state_isTest_idx" ON "Creator"("state", "isTest");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_userId_key" ON "Brand"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_state_isTest_idx" ON "Brand"("state", "isTest");

-- CreateIndex
CREATE INDEX "SocialAccount_platform_handle_idx" ON "SocialAccount"("platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_creatorId_platform_handle_key" ON "SocialAccount"("creatorId", "platform", "handle");

-- CreateIndex
CREATE INDEX "MetricsSnapshot_accountId_observedAt_idx" ON "MetricsSnapshot"("accountId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricsSnapshot_accountId_providerObservationId_key" ON "MetricsSnapshot"("accountId", "providerObservationId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorRate_creatorId_platform_format_currency_key" ON "CreatorRate"("creatorId", "platform", "format", "currency");

-- CreateIndex
CREATE INDEX "BusinessVerification_brandId_kind_status_idx" ON "BusinessVerification"("brandId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioVersion_creatorId_version_key" ON "PortfolioVersion"("creatorId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingDraft_userId_kind_key" ON "OnboardingDraft"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "DraftCommand_draftId_operationKey_key" ON "DraftCommand"("draftId", "operationKey");

-- CreateIndex
CREATE INDEX "SourceJob_status_createdAt_idx" ON "SourceJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceJob_draftId_operationKey_key" ON "SourceJob"("draftId", "operationKey");

-- CreateIndex
CREATE INDEX "Campaign_brandId_createdAt_idx" ON "Campaign"("brandId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBrief_campaignId_version_key" ON "CampaignBrief"("campaignId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorMatch_runId_creatorId_key" ON "CreatorMatch"("runId", "creatorId");

-- CreateIndex
CREATE INDEX "Deal_brandId_status_idx" ON "Deal"("brandId", "status");

-- CreateIndex
CREATE INDEX "Deal_creatorId_status_idx" ON "Deal"("creatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DealOffer_dealId_version_key" ON "DealOffer"("dealId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSnapshot_dealId_version_key" ON "AgreementSnapshot"("dealId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementConfirmation_dealId_version_userId_key" ON "AgreementConfirmation"("dealId", "version", "userId");

-- CreateIndex
CREATE INDEX "DealMessage_dealId_createdAt_idx" ON "DealMessage"("dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DealRating_dealId_userId_key" ON "DealRating"("dealId", "userId");

-- CreateIndex
CREATE INDEX "DealEvent_dealId_createdAt_idx" ON "DealEvent"("dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_deduplicationKey_key" ON "OutboxEvent"("deduplicationKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateAsset_storageKey_key" ON "PrivateAsset"("storageKey");

-- CreateIndex
CREATE INDEX "AiReservation_userId_createdAt_idx" ON "AiReservation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiReservation_userId_operationKey_key" ON "AiReservation"("userId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRecord_platform_handle_key" ON "ImportRecord"("platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminAudit_resourceType_resourceId_createdAt_idx" ON "AdminAudit"("resourceType", "resourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricsSnapshot" ADD CONSTRAINT "MetricsSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactCorrection" ADD CONSTRAINT "FactCorrection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorRate" ADD CONSTRAINT "CreatorRate_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorWork" ADD CONSTRAINT "CreatorWork_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvertisingLicence" ADD CONSTRAINT "AdvertisingLicence_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessVerification" ADD CONSTRAINT "BusinessVerification_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioVersion" ADD CONSTRAINT "PortfolioVersion_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingDraft" ADD CONSTRAINT "OnboardingDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftCommand" ADD CONSTRAINT "DraftCommand_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OnboardingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceJob" ADD CONSTRAINT "SourceJob_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OnboardingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBrief" ADD CONSTRAINT "CampaignBrief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRun" ADD CONSTRAINT "MatchRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorMatch" ADD CONSTRAINT "CreatorMatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MatchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorMatch" ADD CONSTRAINT "CreatorMatch_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealOffer" ADD CONSTRAINT "DealOffer_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementSnapshot" ADD CONSTRAINT "AgreementSnapshot_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementConfirmation" ADD CONSTRAINT "AgreementConfirmation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealMessage" ADD CONSTRAINT "DealMessage_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRating" ADD CONSTRAINT "DealRating_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealEvent" ADD CONSTRAINT "DealEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Safety constraints Prisma's declarative schema cannot express.
ALTER TABLE "User" ADD CONSTRAINT "User_session_version_positive" CHECK ("sessionVersion" > 0);
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_version_positive" CHECK (version > 0);
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_attempts_bounded" CHECK (attempts >= 0 AND "maxAttempts" BETWEEN 1 AND 10 AND attempts <= "maxAttempts");
ALTER TABLE "RateBucket" ADD CONSTRAINT "RateBucket_count_nonnegative" CHECK (count >= 0);
ALTER TABLE "CreatorRate" ADD CONSTRAINT "CreatorRate_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_minimum_positive" CHECK ("minimumMinor" IS NULL OR "minimumMinor" > 0);
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_handle_normalized" CHECK (handle ~ '^[a-z0-9_]{3,30}$');
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_slug_normalized" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80);
ALTER TABLE "CreatorMatch" ADD CONSTRAINT "CreatorMatch_score_bounded" CHECK (score BETWEEN 60 AND 100);
ALTER TABLE "DealRating" ADD CONSTRAINT "DealRating_score_bounded" CHECK (score BETWEEN 1 AND 5 AND role IN ('BRAND','CREATOR'));
ALTER TABLE "AgreementConfirmation" ADD CONSTRAINT "AgreementConfirmation_role_participant" CHECK (role IN ('BRAND','CREATOR'));
ALTER TABLE "MetricsSnapshot" ADD CONSTRAINT "MetricsSnapshot_metrics_nonnegative" CHECK (("followers" IS NULL OR "followers" >= 0) AND ("averageViews" IS NULL OR "averageViews" >= 0) AND ("engagementRate" IS NULL OR "engagementRate" >= 0));
ALTER TABLE "AiReservation" ADD CONSTRAINT "AiReservation_cost_nonnegative" CHECK ("reservedMicros" >= 0 AND ("actualMicros" IS NULL OR "actualMicros" >= 0));
ALTER TABLE "PrivateAsset" ADD CONSTRAINT "PrivateAsset_size_bounded" CHECK (size BETWEEN 1 AND 10485760);
CREATE UNIQUE INDEX "Deal_one_active_pair" ON "Deal" ("campaignId", "creatorId") WHERE status NOT IN ('COMPLETED','DECLINED','CANCELLED');
CREATE UNIQUE INDEX "DealOffer_one_pending" ON "DealOffer" ("dealId") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "CreatorClaim_one_pending" ON "CreatorClaim" ("creatorId") WHERE status = 'PENDING';
CREATE UNIQUE INDEX "SocialAccount_scoped_identity" ON "SocialAccount" (id, "creatorId");
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_primary_account_scope" FOREIGN KEY ("primaryAccountId",id) REFERENCES "SocialAccount" (id,"creatorId") DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX "Campaign_brand_scope" ON "Campaign" (id,"brandId");
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_campaign_brand_scope" FOREIGN KEY ("campaignId","brandId") REFERENCES "Campaign" (id,"brandId");
ALTER TABLE "AgreementConfirmation" ADD CONSTRAINT "AgreementConfirmation_snapshot_version" FOREIGN KEY ("dealId",version) REFERENCES "AgreementSnapshot" ("dealId",version);

CREATE FUNCTION infame_observation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['approvedAt','approvedBy','excludedAt','reviewStatus'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['approvedAt','approvedBy','excludedAt','reviewStatus']) THEN
    RAISE EXCEPTION 'Observed evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MetricsSnapshot_immutable" BEFORE UPDATE ON "MetricsSnapshot" FOR EACH ROW EXECUTE FUNCTION infame_observation_immutable();

CREATE FUNCTION infame_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Agreement snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AgreementSnapshot_immutable" BEFORE UPDATE ON "AgreementSnapshot" FOR EACH ROW EXECUTE FUNCTION infame_snapshot_immutable();

CREATE FUNCTION infame_approved_brief_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."approvedAt" IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'Approved brief is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CampaignBrief_approved_immutable" BEFORE UPDATE ON "CampaignBrief" FOR EACH ROW EXECUTE FUNCTION infame_approved_brief_immutable();

