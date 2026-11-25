ALTER TABLE "Refund" ADD COLUMN "cashRefundMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD COLUMN "otherRefundMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cashRefundMinor_nonnegative_check" CHECK ("cashRefundMinor" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_otherRefundMinor_nonnegative_check" CHECK ("otherRefundMinor" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_refund_split_total_check" CHECK ("cashRefundMinor" + "otherRefundMinor" = "amountMinor");
