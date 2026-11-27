ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DRIVER';
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'DELIVERY';
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED');
ALTER TABLE "Order"
  ADD COLUMN "customerPhone" TEXT,
  ADD COLUMN "deliveryAddress" TEXT,
  ADD COLUMN "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryStatus" "DeliveryStatus",
  ADD COLUMN "driverId" TEXT,
  ADD COLUMN "dispatchedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD CONSTRAINT "Order_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Order_driverId_deliveryStatus_createdAt_idx" ON "Order"("driverId", "deliveryStatus", "createdAt");
CREATE INDEX "Order_deliveryStatus_createdAt_idx" ON "Order"("deliveryStatus", "createdAt");
