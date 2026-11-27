ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "driverOnDuty" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "DriverLocation" (
    "driverId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "headingDegrees" DOUBLE PRECISION,
    "speedMetersPerSecond" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverLocation_pkey" PRIMARY KEY ("driverId")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverLocation_driverId_fkey') THEN
        ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_driverId_fkey"
        FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DriverLocation_branchId_fkey') THEN
        ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_branchId_fkey"
        FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "DriverLocation_branchId_updatedAt_idx" ON "DriverLocation"("branchId", "updatedAt");
