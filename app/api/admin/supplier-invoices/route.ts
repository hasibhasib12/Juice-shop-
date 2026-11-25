import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function managerOnly() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_PURCHASING")) return { response: NextResponse.json({ error: "Purchasing access required." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const access = await managerOnly();
  if (access.response) return access.response;
  const [invoices, orders] = await Promise.all([
    prisma.supplierInvoice.findMany({
      orderBy: { createdAt: "desc" }, take: 200,
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, orderNumber: true } },
        lines: { include: { purchaseOrderLine: { select: { ingredientName: true, unitCostMinor: true, quantity: true, receivedQuantity: true } } } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] } },
      orderBy: { createdAt: "desc" }, take: 100,
      include: {
        supplier: { select: { id: true, name: true } },
        lines: true,
        invoices: { where: { status: { not: "VOIDED" } }, select: { lines: { select: { purchaseOrderLineId: true, quantity: true } } } },
      },
    }),
  ]);
  const ordersWithRemaining = orders.map(({ invoices: linkedInvoices, ...order }) => ({
    ...order,
    lines: order.lines.map((line) => {
      const invoicedQuantity = linkedInvoices.reduce((sum, invoice) => {
        const matched = invoice.lines.find((invoiceLine) => invoiceLine.purchaseOrderLineId === line.id);
        return matched ? sum.add(matched.quantity) : sum;
      }, new Prisma.Decimal(0));
      return {
        ...line,
        invoicedQuantity: invoicedQuantity.toString(),
        remainingQuantity: new Prisma.Decimal(line.receivedQuantity).minus(invoicedQuantity).toString(),
      };
    }),
  }));
  return NextResponse.json({ invoices, orders: ordersWithRemaining }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await managerOnly();
  if (access.response) return access.response;
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { action?: unknown; purchaseOrderId?: unknown; invoiceNumber?: unknown; invoiceDate?: unknown; dueDate?: unknown; notes?: unknown; lines?: unknown; invoiceId?: unknown; amountMinor?: unknown; method?: unknown; reference?: unknown; paidAt?: unknown };
  if (body.action === "invoice") {
    if (typeof body.purchaseOrderId !== "string" || typeof body.invoiceNumber !== "string" || !body.invoiceNumber.trim() || body.invoiceNumber.length > 100) return NextResponse.json({ error: "Choose a purchase order and enter an invoice number." }, { status: 400 });
    if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) return NextResponse.json({ error: "Match at least one invoice line to a received purchase-order line." }, { status: 400 });
    if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 1000)) return NextResponse.json({ error: "Notes must be 1,000 characters or fewer." }, { status: 400 });
    const invoiceDate = new Date(String(body.invoiceDate || ""));
    const dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;
    if (!Number.isFinite(invoiceDate.getTime()) || (dueDate && !Number.isFinite(dueDate.getTime()))) return NextResponse.json({ error: "Enter valid invoice and due dates." }, { status: 400 });
    const seen = new Set<string>();
    const lines: { purchaseOrderLineId: string; quantity: Prisma.Decimal; unitCostMinor: number; lineTotalMinor: number }[] = [];
    try {
      for (const raw of body.lines) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID");
        const line = raw as { purchaseOrderLineId?: unknown; quantity?: unknown; unitCostMinor?: unknown };
        if (typeof line.purchaseOrderLineId !== "string" || !line.purchaseOrderLineId || seen.has(line.purchaseOrderLineId) || !Number.isSafeInteger(line.unitCostMinor) || (line.unitCostMinor as number) < 0) throw new Error("INVALID");
        const quantity = new Prisma.Decimal(String(line.quantity));
        if (!quantity.isFinite() || quantity.lte(0) || quantity.decimalPlaces() > 3) throw new Error("INVALID");
        const total = quantity.mul(line.unitCostMinor as number).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
        if (!total.isFinite() || total.gt(Number.MAX_SAFE_INTEGER)) throw new Error("INVALID");
        seen.add(line.purchaseOrderLineId);
        lines.push({ purchaseOrderLineId: line.purchaseOrderLineId, quantity, unitCostMinor: line.unitCostMinor as number, lineTotalMinor: total.toNumber() });
      }
    } catch { return NextResponse.json({ error: "Invoice lines need unique purchase-order lines, positive quantities and non-negative unit costs." }, { status: 400 }); }
    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const order = await tx.purchaseOrder.findUnique({ where: { id: body.purchaseOrderId as string }, include: { lines: true } });
        if (!order || !["RECEIVED", "PARTIALLY_RECEIVED"].includes(order.status)) throw new Error("ORDER_NOT_RECEIVED");
        const byId = new Map(order.lines.map((line) => [line.id, line]));
        for (const line of lines) {
          const poLine = byId.get(line.purchaseOrderLineId);
          if (!poLine || line.quantity.gt(poLine.receivedQuantity)) throw new Error("LINE_NOT_RECEIVED");
        }
        const priorInvoices = await tx.supplierInvoiceLine.findMany({
          where: {
            purchaseOrderLineId: { in: lines.map((line) => line.purchaseOrderLineId) },
            invoice: { status: { not: "VOIDED" } },
          },
          select: { purchaseOrderLineId: true, quantity: true },
        });
        const previouslyBilled = new Map<string, Prisma.Decimal>();
        for (const prior of priorInvoices) {
          previouslyBilled.set(prior.purchaseOrderLineId, (previouslyBilled.get(prior.purchaseOrderLineId) ?? new Prisma.Decimal(0)).add(prior.quantity));
        }
        for (const line of lines) {
          const poLine = byId.get(line.purchaseOrderLineId)!;
          const alreadyBilled = previouslyBilled.get(line.purchaseOrderLineId) ?? new Prisma.Decimal(0);
          if (alreadyBilled.add(line.quantity).gt(poLine.receivedQuantity)) throw new Error("QUANTITY_ALREADY_BILLED");
        }
        const totalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
        if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new Error("TOTAL_INVALID");
        const created = await tx.supplierInvoice.create({
          data: {
            supplierId: order.supplierId, purchaseOrderId: order.id, invoiceNumber: (body.invoiceNumber as string).trim(),
            currency: order.currency, totalMinor, invoiceDate, dueDate,
            notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
            lines: { create: lines.map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, quantity: line.quantity, unitCostMinor: line.unitCostMinor, lineTotalMinor: line.lineTotalMinor })) },
          },
          include: { supplier: { select: { id: true, name: true } }, lines: true, payments: true, purchaseOrder: { select: { id: true, orderNumber: true } } },
        });
        await tx.auditEvent.create({ data: { userId: access.user!.id, action: "SUPPLIER_INVOICE_CREATED", entityType: "SupplierInvoice", entityId: created.id, details: { invoiceNumber: created.invoiceNumber, purchaseOrderNumber: order.orderNumber, totalMinor, currency: order.currency } } });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ invoice }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "ORDER_NOT_RECEIVED") return NextResponse.json({ error: "Invoices can only be matched to received purchase orders." }, { status: 409 });
      if (error instanceof Error && error.message === "LINE_NOT_RECEIVED") return NextResponse.json({ error: "Invoice quantities cannot exceed quantities already received on the purchase order." }, { status: 409 });
      if (error instanceof Error && error.message === "QUANTITY_ALREADY_BILLED") return NextResponse.json({ error: "Invoice quantities cannot exceed the remaining uninvoiced received quantity." }, { status: 409 });
      if (error instanceof Error && error.message === "TOTAL_INVALID") return NextResponse.json({ error: "Invoice total must be a positive safe amount." }, { status: 400 });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "This invoice number is already recorded for the supplier." }, { status: 409 });
      return NextResponse.json({ error: "Supplier invoice could not be recorded." }, { status: 409 });
    }
  }
  if (body.action === "payment") {
    if (typeof body.invoiceId !== "string" || !Number.isSafeInteger(body.amountMinor) || (body.amountMinor as number) <= 0 || !["CASH", "BANK_TRANSFER", "OTHER"].includes(String(body.method))) return NextResponse.json({ error: "Enter a valid invoice, positive payment amount and payment method." }, { status: 400 });
    if ((body.reference !== undefined && (typeof body.reference !== "string" || body.reference.length > 120)) || (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 1000))) return NextResponse.json({ error: "Payment reference or notes are too long." }, { status: 400 });
    const paidAt = body.paidAt ? new Date(String(body.paidAt)) : new Date();
    if (!Number.isFinite(paidAt.getTime())) return NextResponse.json({ error: "Enter a valid payment date." }, { status: 400 });
    try {
      const result = await prisma.$transaction(async (tx) => {
        const invoice = await tx.supplierInvoice.findUnique({ where: { id: body.invoiceId as string }, include: { payments: true } });
        if (!invoice || invoice.status === "VOIDED") throw new Error("INVOICE_UNAVAILABLE");
        const paid = invoice.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
        const balance = invoice.totalMinor - paid;
        const amount = body.amountMinor as number;
        if (amount > balance) throw new Error("OVERPAYMENT");
        const payment = await tx.supplierPayment.create({ data: { invoiceId: invoice.id, amountMinor: amount, currency: invoice.currency, method: body.method as "CASH" | "BANK_TRANSFER" | "OTHER", reference: typeof body.reference === "string" ? body.reference.trim() || null : null, notes: typeof body.notes === "string" ? body.notes.trim() || null : null, paidAt, createdById: access.user!.id } });
        const nextPaid = paid + amount;
        const updated = await tx.supplierInvoice.update({ where: { id: invoice.id }, data: { status: nextPaid === invoice.totalMinor ? "PAID" : "PARTIALLY_PAID" } });
        await tx.auditEvent.create({ data: { userId: access.user!.id, action: "SUPPLIER_PAYMENT_RECORDED", entityType: "SupplierInvoice", entityId: invoice.id, details: { paymentId: payment.id, amountMinor: amount, method: payment.method, reference: payment.reference, balanceMinor: invoice.totalMinor - nextPaid } } });
        return { payment, invoice: updated, balanceMinor: invoice.totalMinor - nextPaid };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "INVOICE_UNAVAILABLE") return NextResponse.json({ error: "Invoice not found or unavailable." }, { status: 404 });
      if (error instanceof Error && error.message === "OVERPAYMENT") return NextResponse.json({ error: "Payment exceeds the outstanding invoice balance." }, { status: 409 });
      return NextResponse.json({ error: "Supplier payment could not be recorded." }, { status: 409 });
    }
  }
  return NextResponse.json({ error: "Choose invoice or payment action." }, { status: 400 });
}
