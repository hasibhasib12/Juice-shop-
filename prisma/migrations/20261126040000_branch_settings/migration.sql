CREATE TABLE "BranchSetting" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BranchSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BranchSetting_branchId_key_key" ON "BranchSetting"("branchId", "key");
CREATE INDEX "BranchSetting_branchId_idx" ON "BranchSetting"("branchId");
ALTER TABLE "BranchSetting" ADD CONSTRAINT "BranchSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BranchSetting" ("id", "branchId", "key", "value", "updatedAt")
SELECT 'branch-setting-' || md5(b."id" || ':' || s."key"), b."id",
       replace(s."key", 'store.', ''), s."value", CURRENT_TIMESTAMP
FROM "Branch" b
CROSS JOIN "PosSetting" s
WHERE s."key" IN ('store.taxRateBps', 'store.taxLabel', 'store.maxDiscountPercentBps')
ON CONFLICT ("branchId", "key") DO NOTHING;
