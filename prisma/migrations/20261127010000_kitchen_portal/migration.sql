ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'KITCHEN';
CREATE TYPE "KitchenStatus" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'SERVED');
ALTER TABLE "Order" ADD COLUMN "kitchenStatus" "KitchenStatus" NOT NULL DEFAULT 'QUEUED';
CREATE INDEX "Order_kitchenStatus_createdAt_idx" ON "Order"("kitchenStatus", "createdAt");
