CREATE TYPE "CashMovementType" AS ENUM ('PAID_IN', 'PAID_OUT');
CREATE TABLE "CashMovement" (
  "id" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "CashMovementType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashMovement_amountMinor_positive_check" CHECK ("amountMinor" > 0)
);
CREATE INDEX "CashMovement_shiftId_createdAt_idx" ON "CashMovement"("shiftId","createdAt");
CREATE INDEX "CashMovement_userId_createdAt_idx" ON "CashMovement"("userId","createdAt");
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
