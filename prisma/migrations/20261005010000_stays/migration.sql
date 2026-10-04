-- CreateEnum
CREATE TYPE "StayKind" AS ENUM ('BOOKING', 'BLOCK');

-- CreateEnum
CREATE TYPE "StayStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StaySource" AS ENUM ('DIRECT', 'ICAL', 'MOCK_OTA');

-- CreateTable
CREATE TABLE "Stay" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "kind" "StayKind" NOT NULL,
    "status" "StayStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "StaySource" NOT NULL DEFAULT 'DIRECT',
    "externalId" TEXT,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guests" INTEGER,
    "totalCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Stay_propertyId_checkIn_idx" ON "Stay"("propertyId", "checkIn");

-- CreateIndex
CREATE UNIQUE INDEX "Stay_source_externalId_key" ON "Stay"("source", "externalId");

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Double-booking guard: the database, not application code, guarantees no overlap.
-- Half-open [checkIn, checkOut) so checkout day is free; cancelled stays are ignored.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Stay" ADD CONSTRAINT stay_dates_valid CHECK ("checkOut" > "checkIn");

ALTER TABLE "Stay"
  ADD CONSTRAINT stay_no_overlap
  EXCLUDE USING gist (
    "propertyId" WITH =,
    daterange("checkIn", "checkOut", '[)') WITH &&
  ) WHERE (status = 'CONFIRMED');
