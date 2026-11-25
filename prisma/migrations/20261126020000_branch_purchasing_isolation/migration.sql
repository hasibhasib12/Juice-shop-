-- Existing suppliers and purchase orders remain assigned to Main Branch.
ALTER TABLE "Supplier" ADD COLUMN "branchId" TEXT;
UPDATE "Supplier" SET "branchId" = 'main-branch' WHERE "branchId" IS NULL;
ALTER TABLE "Supplier" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';
ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Supplier_branchId_active_name_idx" ON "Supplier"("branchId", "active", "name");

ALTER TABLE "PurchaseOrder" ADD COLUMN "branchId" TEXT;
UPDATE "PurchaseOrder" SET "branchId" = 'main-branch' WHERE "branchId" IS NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PurchaseOrder_branchId_status_createdAt_idx" ON "PurchaseOrder"("branchId", "status", "createdAt");
