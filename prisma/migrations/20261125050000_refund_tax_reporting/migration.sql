ALTER TABLE "Refund" ADD COLUMN "taxRefundMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_taxRefundMinor_nonnegative_check" CHECK ("taxRefundMinor" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_taxRefundMinor_lte_amount_check" CHECK ("taxRefundMinor" <= "amountMinor");
