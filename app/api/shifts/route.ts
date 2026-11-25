import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const shift = await prisma.shift.findFirst({
    where: { userId: user.id, closedAt: null },
    orderBy: { openedAt: "desc" },
  });
  if (!shift) return NextResponse.json({ shift: null }, { headers: { "Cache-Control": "no-store" } });
  const [cashPayments, cashRefunds, cashMovements, movements] = await Promise.all([
    prisma.payment.aggregate({ where: { method: "CASH", status: { in: ["COMPLETED", "REFUNDED"] }, order: { shiftId: shift.id } }, _sum: { amountMinor: true } }),
    prisma.refund.aggregate({ where: { shiftId: shift.id }, _sum: { cashRefundMinor: true } }),
    prisma.cashMovement.groupBy({ by: ["type"], where: { shiftId: shift.id }, _sum: { amountMinor: true } }),
    prisma.cashMovement.findMany({ where: { shiftId: shift.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const cashSalesMinor = cashPayments._sum.amountMinor ?? 0;
  const cashRefundMinor = cashRefunds._sum.cashRefundMinor ?? 0;
  const paidInMinor = cashMovements.find((movement) => movement.type === "PAID_IN")?._sum.amountMinor ?? 0;
  const paidOutMinor = cashMovements.find((movement) => movement.type === "PAID_OUT")?._sum.amountMinor ?? 0;
  const expectedCashMinor = shift.openingCashMinor + cashSalesMinor - cashRefundMinor + paidInMinor - paidOutMinor;
  return NextResponse.json({ shift, cashSalesMinor, cashRefundMinor, paidInMinor, paidOutMinor, expectedCashMinor, movements }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const rate = await checkActionRateLimit("shift-open", user.id, 10, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many shift changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: { openingCashMinor?: number };
  try { const parsed: unknown = await request.json(); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); body = parsed as typeof body; } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const openingCashMinor = body.openingCashMinor;
  if (!Number.isSafeInteger(openingCashMinor) || (openingCashMinor as number) < 0) {
    return NextResponse.json({ error: "Opening cash must be a non-negative amount in minor currency units." }, { status: 400 });
  }

  try {
    const shift = await prisma.$transaction(async (tx) => {
      const active = await tx.shift.findFirst({ where: { userId: user.id, closedAt: null } });
      if (active) throw new Error("SHIFT_ALREADY_OPEN");
      const created = await tx.shift.create({
        data: { userId: user.id, openingCashMinor: openingCashMinor as number },
      });
      await tx.auditEvent.create({
        data: { userId: user.id, action: "SHIFT_OPENED", entityType: "Shift", entityId: created.id, details: { openingCashMinor } },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ shift }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SHIFT_ALREADY_OPEN") {
      return NextResponse.json({ error: "You already have an open shift." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "The shift changed at the same time. Reload and retry." }, { status: 409 });
    return NextResponse.json({ error: "Shift could not be opened." }, { status: 503 });
  }
}
