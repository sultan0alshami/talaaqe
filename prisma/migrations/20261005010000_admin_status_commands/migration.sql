-- Additive durable replay receipts. Existing data/history remain unchanged.
CREATE TABLE "AdminCommand" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "resultJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminCommand_hash_check" CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AdminCommand_key_check" CHECK (length("operationKey") BETWEEN 1 AND 120),
  CONSTRAINT "AdminCommand_result_check" CHECK (jsonb_typeof("resultJson") = 'object')
);
CREATE UNIQUE INDEX "AdminCommand_actorUserId_operationKey_key" ON "AdminCommand"("actorUserId", "operationKey");
CREATE INDEX "AdminCommand_resourceId_createdAt_idx" ON "AdminCommand"("resourceId", "createdAt");
