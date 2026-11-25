-- Existing dining tables belong to Main Branch.
ALTER TABLE "DiningTable" ADD COLUMN "branchId" TEXT;
UPDATE "DiningTable" SET "branchId" = 'main-branch' WHERE "branchId" IS NULL;
ALTER TABLE "DiningTable" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "DiningTable" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';
ALTER TABLE "DiningTable" DROP CONSTRAINT "DiningTable_name_key";
ALTER TABLE "DiningTable"
  ADD CONSTRAINT "DiningTable_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "DiningTable_branchId_name_key" ON "DiningTable"("branchId", "name");
CREATE INDEX "DiningTable_branchId_active_sortOrder_name_idx" ON "DiningTable"("branchId", "active", "sortOrder", "name");
