CREATE TABLE "DiningTable" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "section" TEXT,
  "capacity" INTEGER NOT NULL DEFAULT 2,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiningTable_name_key" ON "DiningTable"("name");
CREATE INDEX "DiningTable_active_sortOrder_name_idx" ON "DiningTable"("active", "sortOrder", "name");
ALTER TABLE "Order" ADD COLUMN "tableId" TEXT;
CREATE INDEX "Order_tableId_status_idx" ON "Order"("tableId", "status");
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Order_one_open_draft_per_table" ON "Order"("tableId") WHERE "status" = 'DRAFT' AND "tableId" IS NOT NULL;
