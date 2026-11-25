ALTER TABLE "Category" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Product" ADD COLUMN "branchId" TEXT;

UPDATE "Category" SET "branchId" = 'main-branch' WHERE "branchId" IS NULL;
UPDATE "Product" SET "branchId" = 'main-branch' WHERE "branchId" IS NULL;

ALTER TABLE "Category" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "branchId" SET NOT NULL;

ALTER TABLE "Category" ADD CONSTRAINT "Category_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Category_name_key";
CREATE UNIQUE INDEX "Category_branchId_name_key" ON "Category"("branchId", "name");
CREATE INDEX "Category_branchId_active_sortOrder_idx" ON "Category"("branchId", "active", "sortOrder");
CREATE INDEX "Product_branchId_status_available_idx" ON "Product"("branchId", "status", "available");
