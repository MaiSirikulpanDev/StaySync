-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "SyncIssue" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SyncIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncIssue_channelId_idx" ON "SyncIssue"("channelId");

-- AddForeignKey
ALTER TABLE "SyncIssue" ADD CONSTRAINT "SyncIssue_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A webhook's listingId must identify exactly one property.
CREATE UNIQUE INDEX "Channel_mock_ota_listing_key" ON "Channel" ((config->>'listingId')) WHERE type = 'MOCK_OTA';
