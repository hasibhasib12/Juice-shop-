CREATE TABLE "DiscountApproval" (
  "id" TEXT NOT NULL,
  "cashierId" TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  "subtotalMinor" INTEGER NOT NULL,
  "discountMinor" INTEGER NOT NULL,
  "cartFingerprint" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscountApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DiscountApproval_cashierId_expiresAt_usedAt_idx" ON "DiscountApproval"("cashierId", "expiresAt", "usedAt");
CREATE INDEX "DiscountApproval_managerId_createdAt_idx" ON "DiscountApproval"("managerId", "createdAt");
ALTER TABLE "DiscountApproval" ADD CONSTRAINT "DiscountApproval_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiscountApproval" ADD CONSTRAINT "DiscountApproval_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
