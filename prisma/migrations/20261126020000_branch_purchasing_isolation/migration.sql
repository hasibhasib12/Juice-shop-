-- Derive purchase-order ownership from its creator and supplier ownership from
-- the orders that reference it. Ambiguous shared suppliers stop the migration.
ALTER TABLE "Supplier" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "branchId" TEXT;

UPDATE "PurchaseOrder" po
SET "branchId" = u."branchId"
FROM "User" u
WHERE u.id = po."createdById";

DO $$
DECLARE
  branch_count INTEGER;
BEGIN
  SELECT count(*) INTO branch_count FROM "Branch";

  IF EXISTS (
    SELECT s.id
    FROM "Supplier" s
    JOIN "PurchaseOrder" po ON po."supplierId" = s.id
    GROUP BY s.id
    HAVING count(DISTINCT po."branchId") > 1
  ) THEN
    RAISE EXCEPTION 'Cannot safely assign supplier ownership: at least one supplier is referenced by purchase orders from multiple branches. Create branch-specific supplier records and retry.';
  END IF;

  UPDATE "Supplier" s
  SET "branchId" = (
    SELECT min(po."branchId")
    FROM "PurchaseOrder" po
    WHERE po."supplierId" = s.id
  )
  WHERE EXISTS (
    SELECT 1 FROM "PurchaseOrder" po WHERE po."supplierId" = s.id
  );

  IF branch_count = 1 THEN
    UPDATE "Supplier"
    SET "branchId" = (SELECT min(id) FROM "Branch")
    WHERE "branchId" IS NULL;
  ELSIF EXISTS (SELECT 1 FROM "Supplier" WHERE "branchId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot safely assign suppliers without purchase history: multiple branches exist. Assign their ownership before retrying.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PurchaseOrder" po
    JOIN "Supplier" s ON s.id = po."supplierId"
    WHERE po."branchId" IS DISTINCT FROM s."branchId"
  ) THEN
    RAISE EXCEPTION 'Purchase order and supplier ownership do not match. Resolve the records before retrying.';
  END IF;
END $$;

ALTER TABLE "Supplier" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';
ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Supplier_branchId_active_name_idx" ON "Supplier"("branchId", "active", "name");

ALTER TABLE "PurchaseOrder" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PurchaseOrder_branchId_status_createdAt_idx" ON "PurchaseOrder"("branchId", "status", "createdAt");
