import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  let body: { closingCashMinor?: number };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const closingCashMinor = body.closingCashMinor;
  if (!Number.isSafeInteger(closingCashMinor) || (closingCashMinor as number) < 0) {
    return NextResponse.json({ error: "Counted cash must be a non-negative amount in minor currency units." }, { status: 400 });
  }

  try {
    const closed = await prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({
        where: { userId: user.id, closedAt: null },
        orderBy: { openedAt: "desc" },
      });
      if (!shift) throw new Error("NO_OPEN_SHIFT");
      const closedAt = new Date();
      const cashPayments = await tx.payment.aggregate({
        where: {
          method: "CASH",
          status: { in: ["COMPLETED", "REFUNDED"] },
          order: { cashierId: user.id, createdAt: { gte: shift.openedAt, lte: closedAt } },
        },
        _sum: { amountMinor: true },
      });
      const cashSalesMinor = cashPayments._sum.amountMinor ?? 0;
      const cashRefunds = await tx.refund.aggregate({
        where: { processedById: user.id, createdAt: { gte: shift.openedAt, lte: closedAt } },
        _sum: { cashRefundMinor: true },
      });
      const cashRefundMinor = cashRefunds._sum.cashRefundMinor ?? 0;
      const cashMovements = await tx.cashMovement.groupBy({ by: ["type"], where: { shiftId: shift.id }, _sum: { amountMinor: true } });
      const paidInMinor = cashMovements.find((movement) => movement.type === "PAID_IN")?._sum.amountMinor ?? 0;
      const paidOutMinor = cashMovements.find((movement) => movement.type === "PAID_OUT")?._sum.amountMinor ?? 0;
      const expectedCashMinor = shift.openingCashMinor + cashSalesMinor - cashRefundMinor + paidInMinor - paidOutMinor;
      const updated = await tx.shift.update({
        where: { id: shift.id },
        data: { closingCashMinor: closingCashMinor as number, expectedCashMinor, closedAt },
      });
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          action: "SHIFT_CLOSED",
          entityType: "Shift",
          entityId: shift.id,
          details: { closingCashMinor, expectedCashMinor, cashSalesMinor, cashRefundMinor, paidInMinor, paidOutMinor, varianceMinor: (closingCashMinor as number) - expectedCashMinor },
        },
      });
      return { ...updated, cashSalesMinor, cashRefundMinor, paidInMinor, paidOutMinor, varianceMinor: (closingCashMinor as number) - expectedCashMinor };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ shift: closed });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_OPEN_SHIFT") {
      return NextResponse.json({ error: "There is no open shift to close." }, { status: 409 });
    }
    return NextResponse.json({ error: "Shift could not be closed." }, { status: 503 });
  }
}
