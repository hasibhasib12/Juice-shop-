-- Preserve historical ingredient ownership where recipes identify a single branch.
-- If legacy data is ambiguous, stop the migration rather than silently moving stock.
ALTER TABLE "Ingredient" ADD COLUMN "branchId" TEXT;

DO $$
DECLARE
  branch_count INTEGER;
BEGIN
  SELECT count(*) INTO branch_count FROM "Branch";

  IF EXISTS (
    SELECT i.id
    FROM "Ingredient" i
    JOIN "RecipeItem" ri ON ri."ingredientId" = i.id
    JOIN "Product" p ON p.id = ri."productId"
    GROUP BY i.id
    HAVING count(DISTINCT p."branchId") > 1
  ) THEN
    RAISE EXCEPTION 'Cannot safely assign ingredient branch ownership: at least one ingredient is used by products in multiple branches. Resolve shared ingredients before retrying.';
  END IF;

  UPDATE "Ingredient" i
  SET "branchId" = (
    SELECT min(p."branchId")
    FROM "RecipeItem" ri
    JOIN "Product" p ON p.id = ri."productId"
    WHERE ri."ingredientId" = i.id
  )
  WHERE EXISTS (
    SELECT 1
    FROM "RecipeItem" ri
    JOIN "Product" p ON p.id = ri."productId"
    WHERE ri."ingredientId" = i.id
  );

  IF branch_count = 1 THEN
    UPDATE "Ingredient"
    SET "branchId" = (SELECT min(id) FROM "Branch")
    WHERE "branchId" IS NULL;
  ELSIF EXISTS (SELECT 1 FROM "Ingredient" WHERE "branchId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot safely assign unreferenced ingredients: multiple branches exist. Assign their ownership before retrying.';
  END IF;
END $$;

ALTER TABLE "Ingredient" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Ingredient" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';

ALTER TABLE "Ingredient"
  ADD CONSTRAINT "Ingredient_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Ingredient_branchId_name_idx" ON "Ingredient"("branchId", "name");
CREATE INDEX "Ingredient_branchId_quantityOnHand_idx" ON "Ingredient"("branchId", "quantityOnHand");
