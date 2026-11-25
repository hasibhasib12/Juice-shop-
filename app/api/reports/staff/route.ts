import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localMidnightUtc(year: number, monthIndex: number, day: number, timeZone: string) {
  const guess = Date.UTC(year, monthIndex, day);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const localAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return new Date(guess - (localAsUtc - guess));
}

function csvCell(value: string | number, untrusted = false) {
  let text = String(value);
  if (untrusted && (/^[=+@-]/.test(text) || text.charCodeAt(0) === 9 || text.charCodeAt(0) === 13)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });

  const date = request.nextUrl.searchParams.get("date");
  if (date && !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const [timezoneSetting, currencySetting] = await Promise.all([
    prisma.posSetting.findUnique({ where: { key: "store.timezone" }, select: { value: true } }),
    prisma.posSetting.findUnique({ where: { key: "store.currency" }, select: { value: true } }),
  ]);
  const timezone = typeof timezoneSetting?.value === "string" ? timezoneSetting.value : "Asia/Kabul";
  const currency = typeof currencySetting?.value === "string" ? currencySetting.value : "AFN";
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (key: string) => current.find((part) => part.type === key)?.value || "";
  const selected = date || `${get("year")}-${get("month")}-${get("day")}`;
  const [year, month, day] = selected.split("-").map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const start = localMidnightUtc(year, month - 1, day, timezone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), timezone);

  const [staff, orders, refunds, shifts, movements] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    prisma.order.findMany({ where: { status: { in: ["COMPLETED", "REFUNDED", "VOIDED"] }, completedAt: { gte: start, lt: end } }, select: { cashierId: true, currency: true, totalMinor: true, discountMinor: true, payments: { where: { status: { in: ["COMPLETED", "REFUNDED"] } }, select: { amountMinor: true } } } }),
    prisma.refund.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { processedById: true, currency: true, amountMinor: true } }),
    prisma.shift.findMany({ where: { openedAt: { gte: start, lt: end } }, select: { userId: true, closedAt: true, openingCashMinor: true, closingCashMinor: true } }),
    prisma.cashMovement.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { userId: true, type: true, amountMinor: true } }),
  ]);
  const rows = staff.flatMap((member) => {
    const currencies = new Set([
      ...orders.filter((order) => order.cashierId === member.id).map((order) => order.currency),
      ...refunds.filter((refund) => refund.processedById === member.id).map((refund) => refund.currency),
    ]);
    if (!currencies.size) currencies.add(currency);
    return [...currencies].map((unit) => {
      const sales = orders.filter((order) => order.cashierId === member.id && order.currency === unit);
      const memberRefunds = refunds.filter((refund) => refund.processedById === member.id && refund.currency === unit);
      const memberShifts = shifts.filter((shift) => shift.userId === member.id);
      const memberMovements = movements.filter((movement) => movement.userId === member.id);
      return {
        userId: member.id, name: member.name, email: member.email, role: member.role, currency: unit,
        orderCount: sales.length, grossSalesMinor: sales.reduce((sum, order) => sum + order.totalMinor, 0),
        discountsMinor: sales.reduce((sum, order) => sum + order.discountMinor, 0),
        averageOrderMinor: sales.length ? Math.round(sales.reduce((sum, order) => sum + order.totalMinor, 0) / sales.length) : 0,
        refundsProcessedMinor: memberRefunds.reduce((sum, refund) => sum + refund.amountMinor, 0),
        refundsProcessedCount: memberRefunds.length, shiftsOpened: memberShifts.length,
        shiftsClosed: memberShifts.filter((shift) => shift.closedAt !== null).length,
        openingCashMinor: memberShifts.reduce((sum, shift) => sum + shift.openingCashMinor, 0),
        closingCashMinor: memberShifts.reduce((sum, shift) => sum + (shift.closingCashMinor ?? 0), 0),
        paidInMinor: memberMovements.filter((movement) => movement.type === "PAID_IN").reduce((sum, movement) => sum + movement.amountMinor, 0),
        paidOutMinor: memberMovements.filter((movement) => movement.type === "PAID_OUT").reduce((sum, movement) => sum + movement.amountMinor, 0),
      };
    });
  });
  const report = { date: selected, timezone, rows };
  if (request.nextUrl.searchParams.get("format") === "csv") {
    const header = ["Staff", "Email", "Role", "Currency", "Orders", "Gross sales minor", "Discounts minor", "Average order minor", "Refunds processed count", "Refunds processed minor", "Shifts opened", "Shifts closed", "Opening cash minor", "Closing cash minor", "Paid in minor", "Paid out minor"];
    const data = rows.map((row) => [row.name, row.email, row.role, row.currency, row.orderCount, row.grossSalesMinor, row.discountsMinor, row.averageOrderMinor, row.refundsProcessedCount, row.refundsProcessedMinor, row.shiftsOpened, row.shiftsClosed, row.openingCashMinor, row.closingCashMinor, row.paidInMinor, row.paidOutMinor]);
    const csv = [header, ...data].map((line) => line.map((value, index) => csvCell(value, [0, 1, 2, 3].includes(index))).join(",")).join("\r\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="juice-shop-staff-${selected}.csv"`, "Cache-Control": "no-store" } });
  }
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
