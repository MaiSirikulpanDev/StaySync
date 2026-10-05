-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('ICAL', 'MOCK_OTA');

-- CreateTable
CREATE TABLE "Channel" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "type" "ChannelType" NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Channel_propertyId_idx" ON "Channel"("propertyId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The publisher only ever scans unpublished rows, oldest first.
CREATE INDEX "OutboxEvent_unpublished_idx" ON "OutboxEvent" ("createdAt") WHERE "publishedAt" IS NULL;
