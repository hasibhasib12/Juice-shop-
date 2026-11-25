CREATE TYPE "RefundKind" AS ENUM ('REFUND', 'VOID');

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "processedById" TEXT NOT NULL,
  "kind" "RefundKind" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Refund_amountMinor_positive_check" CHECK ("amountMinor" > 0)
);

CREATE UNIQUE INDEX "Refund_orderId_key" ON "Refund"("orderId");
CREATE INDEX "Refund_processedById_createdAt_idx" ON "Refund"("processedById", "createdAt");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
