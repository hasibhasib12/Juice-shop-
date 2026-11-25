-- Assign all existing inventory to the existing Main Branch before enforcing ownership.
ALTER TABLE "Ingredient" ADD COLUMN "branchId" TEXT;
UPDATE "Ingredient" SET "branchId" = 'main-branch' WHERE "branchId" IS NULL;
ALTER TABLE "Ingredient" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Ingredient" ALTER COLUMN "branchId" SET DEFAULT 'main-branch';

ALTER TABLE "Ingredient"
  ADD CONSTRAINT "Ingredient_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Ingredient_branchId_name_idx" ON "Ingredient"("branchId", "name");
CREATE INDEX "Ingredient_branchId_quantityOnHand_idx" ON "Ingredient"("branchId", "quantityOnHand");
