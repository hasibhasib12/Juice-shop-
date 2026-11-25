ALTER TABLE "Refund" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "Refund_shiftId_createdAt_idx" ON "Refund"("shiftId", "createdAt");

ALTER TABLE "Refund"
ADD CONSTRAINT "Refund_shiftId_fkey"
FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Refund" AS refund
SET "shiftId" = (
  SELECT shift."id"
  FROM "Shift" AS shift
  WHERE shift."userId" = refund."processedById"
    AND shift."openedAt" <= refund."createdAt"
    AND (shift."closedAt" IS NULL OR shift."closedAt" >= refund."createdAt")
  ORDER BY shift."openedAt" DESC
  LIMIT 1
)
WHERE refund."cashRefundMinor" > 0;
