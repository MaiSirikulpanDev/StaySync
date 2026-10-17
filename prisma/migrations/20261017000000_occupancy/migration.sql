-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "consumerGroup" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("consumerGroup","eventId")
);

-- CreateTable
CREATE TABLE "PropertyOccupancyDaily" (
    "propertyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "bookedNights" INTEGER NOT NULL,
    "revenueCents" INTEGER NOT NULL,
    "lastEventId" UUID NOT NULL,

    CONSTRAINT "PropertyOccupancyDaily_pkey" PRIMARY KEY ("propertyId","date")
);
