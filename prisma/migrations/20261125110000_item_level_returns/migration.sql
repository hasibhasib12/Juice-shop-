CREATE TYPE "ReturnCondition" AS ENUM ('SEALED_UNUSED', 'OPENED', 'PREPARED', 'DAMAGED');
CREATE TYPE "ReturnDisposition" AS ENUM ('WASTE', 'NOT_RESTOCKABLE');

CREATE TABLE "OrderLineReturn" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "processedById" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "condition" "ReturnCondition" NOT NULL,
  "disposition" "ReturnDisposition" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderLineReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderLineReturn_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "OrderLineReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderLineReturn_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderLineReturn_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OrderLineReturn_orderId_createdAt_idx" ON "OrderLineReturn"("orderId", "createdAt");
CREATE INDEX "OrderLineReturn_orderLineId_createdAt_idx" ON "OrderLineReturn"("orderLineId", "createdAt");
