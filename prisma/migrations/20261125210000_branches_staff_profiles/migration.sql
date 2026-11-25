CREATE TABLE "Branch" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "address" TEXT,
  "phone" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kabul',
  "currency" TEXT NOT NULL DEFAULT 'AFN',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Branch" ("id", "name", "code", "timezone", "currency", "updatedAt")
VALUES ('main-branch', 'Main Branch', 'MAIN', 'Asia/Kabul', 'AFN', CURRENT_TIMESTAMP);

ALTER TABLE "User"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "photoUrl" TEXT,
  ADD COLUMN "employeeCode" TEXT,
  ADD COLUMN "branchId" TEXT;

UPDATE "User" SET "branchId" = 'main-branch' WHERE "branchId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "branchId" SET NOT NULL;
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");
CREATE INDEX "Branch_active_name_idx" ON "Branch"("active", "name");
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Shift" ADD COLUMN "branchId" TEXT;
UPDATE "Shift" AS s SET "branchId" = u."branchId" FROM "User" AS u WHERE s."userId" = u."id";
ALTER TABLE "Shift" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Shift_branchId_openedAt_idx" ON "Shift"("branchId", "openedAt");
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
