import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { calculateExpectedShiftCash } from "@/lib/shift-cash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: string | number, untrusted = false) {
  let text = String(value);
  if (untrusted && (/^[=+@-]/.test(text) || text.charCodeAt(0) === 9 || text.charCodeAt(0) === 13)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function localMidnightUtc(year: number, monthIndex: number, day: number, timeZone: string) {
  const guess = Date.UTC(year, monthIndex, day);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const localAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return new Date(guess - (localAsUtc - guess));
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "VIEW_REPORTS")) return NextResponse.json({ error: "Report access required." }, { status: 403 });

  const date = request.nextUrl.searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const setting = await prisma.posSetting.findUnique({ where: { key: "store.timezone" }, select: { value: true } });
  const timezone = typeof setting?.value === "string" ? setting.value : "Asia/Kabul";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const selected = date || `${get("year")}-${get("month")}-${get("day")}`;
  const [year, month, day] = selected.split("-").map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const start = localMidnightUtc(year, month - 1, day, timezone);
  const endDate = new Date(Date.UTC(year, month - 1, day + 1));
  const end = localMidnightUtc(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), timezone);
  const shifts = await prisma.shift.findMany({
    where: { openedAt: { gte: start, lt: end } },
    include: {
      user: { select: { name: true, email: true } },
      orders: { where: { status: { in: ["COMPLETED", "REFUNDED", "VOIDED"] } }, include: { payments: { where: { method: "CASH", status: { in: ["COMPLETED", "REFUNDED"] } }, select: { amountMinor: true } } } },
      cashMovements: { select: { type: true, amountMinor: true } },
      refunds: { select: { cashRefundMinor: true, createdAt: true } },
    },
    orderBy: { openedAt: "asc" },
  });
  const openingEvents = shifts.length ? await prisma.auditEvent.findMany({
    where: { action: "SHIFT_OPENED", entityType: "Shift", entityId: { in: shifts.map((shift) => shift.id) } },
    select: { entityId: true, details: true },
  }) : [];
  const currencyByShift = new Map(openingEvents.map((event) => [event.entityId, (event.details as { currency?: string } | null)?.currency || "UNKNOWN"]));
  const rows: (string | number)[][] = [["Cashier", "Email", "Currency", "Shift opened", "Shift closed", "Opening cash minor", "Cash sales minor", "Cash refunds minor", "Paid in minor", "Paid out minor", "Expected cash minor", "Counted cash minor", "Variance minor", "Completed/refunded orders", "Voided orders"]];
  for (const shift of shifts) {
    const endAt = shift.closedAt || new Date();
    const cashRefund = shift.refunds.filter((refund) => refund.createdAt <= endAt).reduce((sum, refund) => sum + refund.cashRefundMinor, 0);
    const cashSales = shift.orders.reduce((sum, order) => sum + order.payments.reduce((paymentSum, payment) => paymentSum + payment.amountMinor, 0), 0);
    const paidIn = shift.cashMovements.filter((movement) => movement.type === "PAID_IN").reduce((sum, movement) => sum + movement.amountMinor, 0);
    const paidOut = shift.cashMovements.filter((movement) => movement.type === "PAID_OUT").reduce((sum, movement) => sum + movement.amountMinor, 0);
    const expected = calculateExpectedShiftCash(shift.openingCashMinor, cashSales, cashRefund, paidIn, paidOut);
    const counted = shift.closingCashMinor;
    rows.push([shift.user.name, shift.user.email, currencyByShift.get(shift.id) || "UNKNOWN", shift.openedAt.toISOString(), shift.closedAt?.toISOString() || "OPEN", shift.openingCashMinor, cashSales, cashRefund, paidIn, paidOut, expected, counted ?? "", counted === null ? "" : counted - expected, shift.orders.filter((order) => order.status !== "VOIDED").length, shift.orders.filter((order) => order.status === "VOIDED").length]);
  }
  const csv = rows.map((row) => row.map((value, index) => csvCell(value, index === 0 || index === 1 || index === 2 || index === 3)).join(",")).join("\r\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="juice-shop-shifts-${selected}.csv"`, "Cache-Control": "no-store" } });
}
