ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'KITCHEN';
CREATE TYPE "KitchenStatus" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'SERVED');

-- Historical completed orders are already finished; only future orders enter the queue.
ALTER TABLE "Order" ADD COLUMN "kitchenStatus" "KitchenStatus" NOT NULL DEFAULT 'SERVED';
ALTER TABLE "Order" ALTER COLUMN "kitchenStatus" SET DEFAULT 'QUEUED';
CREATE INDEX "Order_kitchenStatus_createdAt_idx" ON "Order"("kitchenStatus", "createdAt");
