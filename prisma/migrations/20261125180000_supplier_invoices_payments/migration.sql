CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOIDED');
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'OTHER');

CREATE TABLE "SupplierInvoice" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "totalMinor" INTEGER NOT NULL,
  "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'OPEN',
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierInvoiceLine" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unitCostMinor" INTEGER NOT NULL,
  "lineTotalMinor" INTEGER NOT NULL,
  CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierPayment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "method" "SupplierPaymentMethod" NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierInvoice_supplierId_invoiceNumber_key" ON "SupplierInvoice"("supplierId", "invoiceNumber");
CREATE INDEX "SupplierInvoice_purchaseOrderId_createdAt_idx" ON "SupplierInvoice"("purchaseOrderId", "createdAt");
CREATE INDEX "SupplierInvoice_status_dueDate_idx" ON "SupplierInvoice"("status", "dueDate");
CREATE UNIQUE INDEX "SupplierInvoiceLine_invoiceId_purchaseOrderLineId_key" ON "SupplierInvoiceLine"("invoiceId", "purchaseOrderLineId");
CREATE INDEX "SupplierPayment_invoiceId_paidAt_idx" ON "SupplierPayment"("invoiceId", "paidAt");

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_purchaseOrderLineId_fkey"
FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
