import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createTextPdf } from "@/lib/simple-pdf";
import { calculateExpectedShiftCash } from "@/lib/shift-cash";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function localMidnightUtc(year: number, monthIndex: number, day: number, timeZone: string) {
  const guess = Date.UTC(year, monthIndex, day);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value || 0);
  const localAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return new Date(guess - (localAsUtc - guess));
}
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permission = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permission?.permissionOverrides, "VIEW_REPORTS")) return NextResponse.json({ error: "Report access required." }, { status: 403 });
  const date = request.nextUrl.searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const setting = await prisma.posSetting.findUnique({ where: { key: "store.timezone" }, select: { value: true } });
  const timezone = typeof setting?.value === "string" ? setting.value : "Asia/Kabul";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (key: string) => parts.find(p => p.type === key)?.value || "";
  const selected = date || get("year") + "-" + get("month") + "-" + get("day");
  const [year, month, day] = selected.split("-").map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const start = localMidnightUtc(year, month - 1, day, timezone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), timezone);
  const shifts = await prisma.shift.findMany({ where: { openedAt: { gte: start, lt: end } }, include: {
    user: { select: { name: true, email: true } },
    orders: { where: { status: { in: ["COMPLETED", "REFUNDED", "VOIDED"] } }, include: { payments: { where: { method: "CASH", status: { in: ["COMPLETED", "REFUNDED"] } }, select: { amountMinor: true } } } },
    cashMovements: { select: { type: true, amountMinor: true } },
  }, orderBy: { openedAt: "asc" } });
  const refunds = shifts.length ? await prisma.refund.findMany({ where: { shiftId: { in: shifts.map(s => s.id) } }, select: { shiftId: true, cashRefundMinor: true, createdAt: true } }) : [];
  const openingEvents = shifts.length ? await prisma.auditEvent.findMany({
    where: { action: "SHIFT_OPENED", entityType: "Shift", entityId: { in: shifts.map(s => s.id) } },
    select: { entityId: true, details: true },
  }) : [];
  const currencyByShift = new Map(openingEvents.map(event => [event.entityId, (event.details as { currency?: string } | null)?.currency || "UNKNOWN"]));
  const lines = ["JUICE SHOP - SHIFT RECONCILIATION", "Business date: " + selected + " | Timezone: " + timezone, "Currency is captured when the shift opens; UNKNOWN means the shift predates currency snapshots.", " "];
  for (const shift of shifts) {
    const endAt = shift.closedAt || new Date();
    const cashRefund = refunds.filter(r => r.shiftId === shift.id && r.createdAt <= endAt).reduce((sum,r)=>sum+r.cashRefundMinor,0);
    const cashSales = shift.orders.reduce((sum,o)=>sum+o.payments.reduce((p,payment)=>p+payment.amountMinor,0),0);
    const paidIn = shift.cashMovements.filter(m=>m.type==="PAID_IN").reduce((sum,m)=>sum+m.amountMinor,0);
    const paidOut = shift.cashMovements.filter(m=>m.type==="PAID_OUT").reduce((sum,m)=>sum+m.amountMinor,0);
    const expected = calculateExpectedShiftCash(shift.openingCashMinor,cashSales,cashRefund,paidIn,paidOut);
    const counted = shift.closingCashMinor;
    lines.push(shift.user.name + " | " + shift.user.email + " | Currency: " + (currencyByShift.get(shift.id) || "UNKNOWN"), "Opened: " + shift.openedAt.toISOString() + " | Closed: " + (shift.closedAt?.toISOString() || "OPEN"),
      "Opening float: " + shift.openingCashMinor + " minor | Cash sales: " + cashSales + " minor | Cash refunds: " + cashRefund + " minor",
      "Paid in: " + paidIn + " minor | Paid out: " + paidOut + " minor", "Expected cash: " + expected + " minor | Counted: " + (counted ?? "Not closed") + " | Variance: " + (counted === null ? "N/A" : counted - expected) + " minor",
      "Completed/refunded orders: " + shift.orders.filter(order => order.status !== "VOIDED").length,
      "Voided orders: " + shift.orders.filter(order => order.status === "VOIDED").length, " ");
  }
  if (!shifts.length) lines.push("No shifts were opened on this business date.");
  lines.push("Generated at: " + new Date().toISOString());
  return new NextResponse(new Uint8Array(createTextPdf(lines)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="juice-shop-shifts-' + selected + '.pdf"', "Cache-Control": "no-store" } });
}
