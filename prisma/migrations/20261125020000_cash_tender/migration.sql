ALTER TABLE "Payment" ADD COLUMN "cashReceivedMinor" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "changeDueMinor" INTEGER;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_cashReceivedMinor_nonnegative_check"
  CHECK ("cashReceivedMinor" IS NULL OR "cashReceivedMinor" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_changeDueMinor_nonnegative_check"
  CHECK ("changeDueMinor" IS NULL OR "changeDueMinor" >= 0);
