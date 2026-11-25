import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: actor.id }, select: { permissionOverrides: true } });
  if (!hasPermission(actor.role, permissionState?.permissionOverrides, "PROCESS_REFUNDS")) return NextResponse.json({ error: "Refund permission is required to refund or void a sale." }, { status: 403 });
  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });

  let body: { kind?: string; reason?: string; amountMinor?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const kind = body.kind;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if ((kind !== "REFUND" && kind !== "VOID") || !reason || reason.length < 3 || reason.length > 240) {
    return NextResponse.json({ error: "Choose refund or void and provide a reason (3–240 characters)." }, { status: 400 });
  }
  if (body.amountMinor !== undefined && (!Number.isSafeInteger(body.amountMinor) || body.amountMinor <= 0 || body.amountMinor > 2_000_000_000)) {
    return NextResponse.json({ error: "Refund amount must be a positive amount in the order currency." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { payments: true } });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "COMPLETED") throw new Error("ORDER_NOT_REFUNDABLE");

      const originalPayments = order.payments.filter((payment) => payment.status === "COMPLETED" || payment.status === "REFUNDED");
      const paidMinor = originalPayments.reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (!originalPayments.length || paidMinor !== order.totalMinor) throw new Error("PAYMENT_TOTAL_MISMATCH");

      const previous = await tx.refund.findMany({
        where: { orderId: order.id },
        select: { amountMinor: true, cashRefundMinor: true, otherRefundMinor: true, taxRefundMinor: true },
      });
      const refundedMinor = previous.reduce((sum, refund) => sum + refund.amountMinor, 0);
      const refundedCashMinor = previous.reduce((sum, refund) => sum + refund.cashRefundMinor, 0);
      const refundedOtherMinor = previous.reduce((sum, refund) => sum + refund.otherRefundMinor, 0);
      const refundedTaxMinor = previous.reduce((sum, refund) => sum + refund.taxRefundMinor, 0);
      const remainingMinor = order.totalMinor - refundedMinor;
      const remainingCashMinor = originalPayments.filter((payment) => payment.method === "CASH").reduce((sum, payment) => sum + payment.amountMinor, 0) - refundedCashMinor;
      const remainingOtherMinor = originalPayments.filter((payment) => payment.method !== "CASH").reduce((sum, payment) => sum + payment.amountMinor, 0) - refundedOtherMinor;
      const remainingTaxMinor = order.taxMinor - refundedTaxMinor;

      if (remainingMinor <= 0 || remainingCashMinor < 0 || remainingOtherMinor < 0 || remainingCashMinor + remainingOtherMinor !== remainingMinor || remainingTaxMinor < 0) {
        throw new Error("REFUND_LEDGER_MISMATCH");
      }
      const amountMinor = body.amountMinor ?? remainingMinor;
      if (kind === "VOID" && amountMinor !== remainingMinor) throw new Error("VOID_MUST_BE_FULL");
      if (amountMinor > remainingMinor) throw new Error("REFUND_EXCEEDS_BALANCE");
      const isFinalRefund = amountMinor === remainingMinor;
      let cashRefundMinor = isFinalRefund ? remainingCashMinor : Number((BigInt(amountMinor) * BigInt(remainingCashMinor)) / BigInt(remainingMinor));
      let otherRefundMinor = amountMinor - cashRefundMinor;
      if (otherRefundMinor > remainingOtherMinor) {
        const overflow = otherRefundMinor - remainingOtherMinor;
        cashRefundMinor += overflow;
        otherRefundMinor = remainingOtherMinor;
      }
      if (cashRefundMinor > remainingCashMinor || cashRefundMinor + otherRefundMinor !== amountMinor) throw new Error("REFUND_LEDGER_MISMATCH");
      const taxRefundMinor = isFinalRefund ? remainingTaxMinor : Math.min(remainingTaxMinor, Number((BigInt(amountMinor) * BigInt(remainingTaxMinor)) / BigInt(remainingMinor)));

      let refundShiftId: string | null = null;
      if (cashRefundMinor > 0) {
        const activeShift = await tx.shift.findFirst({ where: { userId: actor.id, closedAt: null }, select: { id: true } });
        if (!activeShift) throw new Error("NO_OPEN_SHIFT_FOR_CASH_REFUND");
        refundShiftId = activeShift.id;
      }

      const refund = await tx.refund.create({
        data: { orderId: order.id, processedById: actor.id, shiftId: refundShiftId, kind, amountMinor, currency: order.currency, reason, cashRefundMinor, otherRefundMinor, taxRefundMinor },
      });
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: isFinalRefund ? { status: kind === "VOID" ? "VOIDED" : "REFUNDED" } : {},
        select: { id: true, orderNumber: true, status: true, totalMinor: true, currency: true },
      });
      if (isFinalRefund) {
        await tx.payment.updateMany({ where: { orderId: order.id, status: "COMPLETED" }, data: { status: "REFUNDED" } });
      }
      await tx.auditEvent.create({
        data: {
          userId: actor.id,
          action: kind === "VOID" ? "ORDER_VOIDED" : "ORDER_PARTIALLY_OR_FULLY_REFUNDED",
          entityType: "Order",
          entityId: order.id,
          details: { refundId: refund.id, amountMinor, remainingAfterMinor: remainingMinor - amountMinor, currency: order.currency, reason, cashRefundMinor, otherRefundMinor, taxRefundMinor, finalRefund: isFinalRefund },
        },
      });
      return { refund, order: updatedOrder, refundedTotalMinor: refundedMinor + amountMinor, remainingMinor: remainingMinor - amountMinor };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (message === "ORDER_NOT_REFUNDABLE") return NextResponse.json({ error: "This order is no longer eligible for a refund." }, { status: 409 });
    if (message === "PAYMENT_TOTAL_MISMATCH" || message === "REFUND_LEDGER_MISMATCH") return NextResponse.json({ error: "The payment/refund ledger does not reconcile. No refund was recorded; contact the owner." }, { status: 409 });
    if (message === "REFUND_EXCEEDS_BALANCE") return NextResponse.json({ error: "Refund amount exceeds the remaining refundable balance." }, { status: 409 });
    if (message === "VOID_MUST_BE_FULL") return NextResponse.json({ error: "A void must reverse the entire remaining balance. Use a refund for a partial amount." }, { status: 400 });
    if (message === "NO_OPEN_SHIFT_FOR_CASH_REFUND") return NextResponse.json({ error: "Open your cash shift before refunding a cash payment so the cash drawer can be reconciled." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Another refund was processed at the same time. Refresh the order and try again." }, { status: 409 });
    return NextResponse.json({ error: "The refund could not be completed." }, { status: 503 });
  }
}
