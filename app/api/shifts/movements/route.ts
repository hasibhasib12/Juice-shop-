import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const rate = await checkActionRateLimit("cash-movement", user.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many cash-drawer changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: { type?: string; amountMinor?: number; reason?: string };
  try { const parsed: unknown = await request.json(); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); body = parsed as typeof body; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const type = body.type;
  const amountMinor = body.amountMinor;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if ((type !== "PAID_IN" && type !== "PAID_OUT") || !Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0 || (amountMinor as number) > 2_000_000_000 || reason.length < 3 || reason.length > 240) {
    return NextResponse.json({ error: "Choose paid in or paid out, a valid amount, and a reason (3–240 characters)." }, { status: 400 });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({ where: { userId: user.id, closedAt: null }, orderBy: { openedAt: "desc" } });
      if (!shift) throw new Error("NO_OPEN_SHIFT");
      const [payments, refunds, existing] = await Promise.all([
        tx.payment.aggregate({ where: { method: "CASH", status: { in: ["COMPLETED", "REFUNDED"] }, order: { shiftId: shift.id } }, _sum: { amountMinor: true } }),
        tx.refund.aggregate({ where: { shiftId: shift.id }, _sum: { cashRefundMinor: true } }),
        tx.cashMovement.groupBy({ by: ["type"], where: { shiftId: shift.id }, _sum: { amountMinor: true } }),
      ]);
      const paidIn = existing.find((movement) => movement.type === "PAID_IN")?._sum.amountMinor ?? 0;
      const paidOut = existing.find((movement) => movement.type === "PAID_OUT")?._sum.amountMinor ?? 0;
      const expectedBefore = shift.openingCashMinor + (payments._sum.amountMinor ?? 0) - (refunds._sum.cashRefundMinor ?? 0) + paidIn - paidOut;
      if (type === "PAID_OUT" && amountMinor! > expectedBefore) throw new Error("INSUFFICIENT_DRAWER_CASH");
      if (type === "PAID_IN" && expectedBefore + amountMinor! > 2_000_000_000) throw new Error("DRAWER_LIMIT");
      const movement = await tx.cashMovement.create({ data: { shiftId: shift.id, userId: user.id, type, amountMinor: amountMinor as number, reason } });
      await tx.auditEvent.create({ data: { userId: user.id, action: type === "PAID_IN" ? "CASH_PAID_IN" : "CASH_PAID_OUT", entityType: "CashMovement", entityId: movement.id, details: { shiftId: shift.id, amountMinor, reason, expectedBefore, expectedAfter: type === "PAID_IN" ? expectedBefore + amountMinor! : expectedBefore - amountMinor! } } });
      return { movement, expectedCashMinor: type === "PAID_IN" ? expectedBefore + amountMinor! : expectedBefore - amountMinor! };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NO_OPEN_SHIFT") return NextResponse.json({ error: "Open your cash shift before recording a cash movement." }, { status: 409 });
    if (message === "INSUFFICIENT_DRAWER_CASH") return NextResponse.json({ error: "Paid out cannot exceed the expected cash currently in the drawer." }, { status: 409 });
    if (message === "DRAWER_LIMIT") return NextResponse.json({ error: "The drawer balance exceeds the supported amount." }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "The drawer changed during this movement. Please retry." }, { status: 409 });
    return NextResponse.json({ error: "Cash movement could not be recorded." }, { status: 503 });
  }
}
