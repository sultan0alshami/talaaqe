-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'PROVIDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('FREELANCER', 'COMPANY', 'AGENCY', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'BRIEF_GENERATED', 'BRIEF_APPROVED', 'PROVIDERS_RECOMMENDED', 'PROPOSAL_REQUESTED', 'PROVIDER_SELECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('RECOMMENDED', 'PROPOSAL_REQUESTED', 'PROPOSAL_SENT', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "Complexity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "VerifiedStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "companyName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationType" TEXT,
    "sector" TEXT,
    "location" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerType" "ProviderType" NOT NULL,
    "roleTitleAr" TEXT,
    "roleTitleEn" TEXT,
    "bio" TEXT,
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "priceRangeMin" INTEGER,
    "priceRangeMax" INTEGER,
    "availability" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verifiedStatus" "VerifiedStatus" NOT NULL DEFAULT 'PENDING',
    "location" TEXT,
    "locationAr" TEXT,
    "locationEn" TEXT,
    "languages" TEXT[],
    "avatarColor" TEXT,
    "avatarInitial" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleEn" TEXT,
    "url" TEXT,
    "imageUrl" TEXT,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "budgetMin" INTEGER,
    "budgetMax" INTEGER,
    "timelineAr" TEXT,
    "timelineEn" TEXT,
    "complexity" "Complexity",
    "requiredSkills" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brief" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "summaryAr" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "objectiveAr" TEXT NOT NULL,
    "objectiveEn" TEXT NOT NULL,
    "scopeAr" TEXT[],
    "scopeEn" TEXT[],
    "deliverablesAr" TEXT[],
    "deliverablesEn" TEXT[],
    "requiredSkills" TEXT[],
    "budgetMin" INTEGER NOT NULL,
    "budgetMax" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "timelineAr" TEXT NOT NULL,
    "timelineEn" TEXT NOT NULL,
    "complexity" "Complexity" NOT NULL,
    "complexityPct" INTEGER NOT NULL DEFAULT 50,
    "missingAr" TEXT[],
    "missingEn" TEXT[],
    "providerTypeAr" TEXT NOT NULL,
    "providerTypeEn" TEXT NOT NULL,
    "criteriaAr" TEXT[],
    "criteriaEn" TEXT[],
    "milestones" JSONB NOT NULL,
    "qualityScore" INTEGER,
    "approvedByClient" BOOLEAN NOT NULL DEFAULT false,
    "editedByClient" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "extractedRequirements" JSONB NOT NULL,
    "questionsAsked" INTEGER NOT NULL DEFAULT 0,
    "readyForBrief" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "reasonAr" TEXT NOT NULL,
    "reasonEn" TEXT NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'RECOMMENDED',
    "noteAr" TEXT,
    "noteEn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "description" TEXT,
    "demoCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCategory" (
    "providerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "ProviderCategory_pkey" PRIMARY KEY ("providerId","categoryId")
);

-- CreateTable
CREATE TABLE "ProviderSkill" (
    "providerId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "ProviderSkill_pkey" PRIMARY KEY ("providerId","skillId")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "textAr" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "flow" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_userId_key" ON "Provider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Brief_projectId_key" ON "Brief"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_projectId_key" ON "Conversation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_projectId_providerId_key" ON "Match"("projectId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "ActivityLog_projectId_createdAt_idx" ON "ActivityLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brief" ADD CONSTRAINT "Brief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCategory" ADD CONSTRAINT "ProviderCategory_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCategory" ADD CONSTRAINT "ProviderCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSkill" ADD CONSTRAINT "ProviderSkill_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSkill" ADD CONSTRAINT "ProviderSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
