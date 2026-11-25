import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner approval is required to refund or void a sale." }, { status: 403 });
  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  let body: { kind?: string; reason?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const kind = body.kind;
  const reason = body.reason?.trim();
  if ((kind !== "REFUND" && kind !== "VOID") || !reason || reason.length < 3 || reason.length > 240) {
    return NextResponse.json({ error: "Choose refund or void and provide a reason (3–240 characters)." }, { status: 400 });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: { payments: true, refund: true } });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.refund || order.status !== "COMPLETED") throw new Error("ORDER_ALREADY_REVERSED");
      const completedPayments = order.payments.filter((payment) => payment.status === "COMPLETED");
      const paidMinor = completedPayments.reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (!completedPayments.length || paidMinor !== order.totalMinor) throw new Error("PAYMENT_TOTAL_MISMATCH");
      const cashRefundMinor = completedPayments.filter((payment) => payment.method === "CASH").reduce((sum, payment) => sum + payment.amountMinor, 0);
      const otherRefundMinor = completedPayments.filter((payment) => payment.method !== "CASH").reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (cashRefundMinor > 0) {
        const activeShift = await tx.shift.findFirst({ where: { userId: actor.id, closedAt: null }, select: { id: true } });
        if (!activeShift) throw new Error("NO_OPEN_SHIFT_FOR_CASH_REFUND");
      }
      const refund = await tx.refund.create({ data: { orderId: order.id, processedById: actor.id, kind, amountMinor: order.totalMinor, currency: order.currency, reason, cashRefundMinor, otherRefundMinor } });
      await tx.payment.updateMany({ where: { orderId: order.id, status: "COMPLETED" }, data: { status: "REFUNDED" } });
      const updatedOrder = await tx.order.update({ where: { id: order.id }, data: { status: kind === "VOID" ? "VOIDED" : "REFUNDED" }, select: { id: true, orderNumber: true, status: true, totalMinor: true, currency: true } });
      await tx.auditEvent.create({ data: { userId: actor.id, action: kind === "VOID" ? "ORDER_VOIDED" : "ORDER_REFUNDED", entityType: "Order", entityId: order.id, details: { refundId: refund.id, amountMinor: refund.amountMinor, currency: refund.currency, reason } } });
      return { refund, order: updatedOrder };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (message === "ORDER_ALREADY_REVERSED") return NextResponse.json({ error: "This order has already been refunded, voided or otherwise closed." }, { status: 409 });
    if (message === "PAYMENT_TOTAL_MISMATCH") return NextResponse.json({ error: "The completed payment ledger does not match the order total. Contact the owner; no reversal was recorded." }, { status: 409 });
    if (message === "NO_OPEN_SHIFT_FOR_CASH_REFUND") return NextResponse.json({ error: "Open your cash shift before refunding a cash payment so the cash drawer can be reconciled." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return NextResponse.json({ error: "Another reversal was processed at the same time. Refresh the order history." }, { status: 409 });
    return NextResponse.json({ error: "The refund or void could not be completed." }, { status: 503 });
  }
}
