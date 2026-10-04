-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PricingRuleType" AS ENUM ('SEASONAL', 'WEEKEND');

-- CreateTable
CREATE TABLE "Property" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "baseRateCents" INTEGER NOT NULL,
    "minStay" INTEGER NOT NULL DEFAULT 1,
    "maxGuests" INTEGER NOT NULL,
    "icalToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "type" "PricingRuleType" NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "rateCents" INTEGER,
    "adjustPercent" INTEGER,
    "minStay" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Property_icalToken_key" ON "Property"("icalToken");

-- CreateIndex
CREATE INDEX "PricingRule_propertyId_idx" ON "PricingRule"("propertyId");

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

