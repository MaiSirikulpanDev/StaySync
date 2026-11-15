-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'SKIPPED_BUDGET');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('CREATE_BOOKING', 'CANCEL_STAY', 'CHANGE_DATES', 'CREATE_BLOCK');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "GuestMessage" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "stayId" UUID,
    "fromName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replyDraft" TEXT,
    "repliedAt" TIMESTAMP(3),

    CONSTRAINT "GuestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" UUID NOT NULL,
    "guestMessageId" UUID NOT NULL,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "traceId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" UUID NOT NULL,
    "agentRunId" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" UUID NOT NULL,
    "agentRunId" UUID NOT NULL,
    "type" "ProposalType" NOT NULL,
    "params" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestMessage_propertyId_idx" ON "GuestMessage"("propertyId");

-- CreateIndex
CREATE INDEX "AgentRun_guestMessageId_idx" ON "AgentRun"("guestMessageId");

-- CreateIndex
CREATE INDEX "AgentRun_createdAt_idx" ON "AgentRun"("createdAt");

-- CreateIndex
CREATE INDEX "AgentToolCall_agentRunId_idx" ON "AgentToolCall"("agentRunId");

-- CreateIndex
CREATE INDEX "AgentProposal_agentRunId_idx" ON "AgentProposal"("agentRunId");

-- CreateIndex
CREATE INDEX "AgentProposal_status_idx" ON "AgentProposal"("status");

-- AddForeignKey
ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_guestMessageId_fkey" FOREIGN KEY ("guestMessageId") REFERENCES "GuestMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

