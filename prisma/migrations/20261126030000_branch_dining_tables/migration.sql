-- Infer table ownership from the branches of orders that used each table.
-- Shared/ambiguous historical tables stop the migration instead of being hidden.
ALTER TABLE "DiningTable" ADD COLUMN "branchId" TEXT;

DO $$
DECLARE
  branch_count INTEGER;
BEGIN
  SELECT count(*) INTO branch_count FROM "Branch";

  IF EXISTS (
    SELECT t.id
    FROM "DiningTable" t
    JOIN "Order" o ON o."tableId" = t.id
    JOIN "User" u ON u.id = o."cashierId"
    GROUP BY t.id
    HAVING count(DISTINCT u."branchId") > 1
  ) THEN
    RAISE EXCEPTION 'Cannot safely assign dining-table ownership: at least one table has orders from multiple branches. Resolve shared tables before retrying.';
  END IF;

  UPDATE "DiningTable" t
  SET "branchId" = (
    SELECT min(u."branchId")
    FROM "Order" o
    JOIN "User" u ON u.id = o."cashierId"
    WHERE o."tableId" = t.id
  )
  WHERE EXISTS (
    SELECT 1
    FROM "Order" o
    JOIN "User" u ON u.id = o."cashierId"
    WHERE o."tableId" = t.id
  );

  IF branch_count = 1 THEN
    UPDATE "DiningTable"
    SET "branchId" = (SELECT min(id) FROM "Branch")
    WHERE "branchId" IS NULL;
  ELSIF EXISTS (SELECT 1 FROM "DiningTable" WHERE "branchId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot safely assign unused dining tables: multiple branches exist. Assign their ownership before retrying.';
  END IF;
END $$;

ALTER TABLE "DiningTable" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "DiningTable" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';

-- Older databases may have either a unique constraint or only a standalone
-- index for the original global table-name uniqueness rule.
-- The original uniqueness may be represented either as a table constraint
-- (which owns its index) or as a standalone unique index, depending on the
-- database's migration history. IF EXISTS makes both cases safe and retryable.
ALTER TABLE "DiningTable" DROP CONSTRAINT IF EXISTS "DiningTable_name_key";
DROP INDEX IF EXISTS "DiningTable_name_key";

ALTER TABLE "DiningTable"
  ADD CONSTRAINT "DiningTable_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "DiningTable_branchId_name_key" ON "DiningTable"("branchId", "name");
CREATE INDEX "DiningTable_branchId_active_sortOrder_name_idx" ON "DiningTable"("branchId", "active", "sortOrder", "name");
