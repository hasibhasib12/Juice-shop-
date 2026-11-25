ALTER TABLE "Order" ADD COLUMN "shiftId" TEXT;
CREATE INDEX "Order_shiftId_idx" ON "Order"("shiftId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
