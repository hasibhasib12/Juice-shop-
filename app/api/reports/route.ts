import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const period = request.nextUrl.searchParams.get("period") || "day";
  const dateParam = request.nextUrl.searchParams.get("date");
  if (!["day", "week", "month"].includes(period)) return NextResponse.json({ error: "Period must be day, week or month." }, { status: 400 });
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const timezoneRow = await prisma.posSetting.findUnique({ where: { key: "store.timezone" }, select: { value: true } });
  const timezone = typeof timezoneRow?.value === "string" ? timezoneRow.value : "Asia/Kabul";
  const currentParts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => currentParts.find((item) => item.type === type)?.value || "";
  const selected = dateParam || `${part("year")}-${part("month")}-${part("day")}`;
  const [year, month, day] = selected.split("-").map(Number);
  const validDate = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || validDate.getUTCFullYear() !== year || validDate.getUTCMonth() !== month - 1 || validDate.getUTCDate() !== day) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  let startDay = day;
  let startMonth = month - 1;
  let startYear = year;
  if (period === "week") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const monday = new Date(Date.UTC(year, month - 1, day - ((weekday + 6) % 7)));
    startDay = monday.getUTCDate(); startMonth = monday.getUTCMonth(); startYear = monday.getUTCFullYear();
  } else if (period === "month") { startDay = 1; }
  const next = new Date(Date.UTC(startYear, startMonth, startDay));
  if (period === "day") next.setUTCDate(next.getUTCDate() + 1);
  if (period === "week") next.setUTCDate(next.getUTCDate() + 7);
  if (period === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  const start = localMidnightUtc(startYear, startMonth, startDay, timezone);
  const end = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), timezone);

  const orders = await prisma.order.findMany({
    where: { status: { in: ["COMPLETED", "REFUNDED", "VOIDED"] }, completedAt: { gte: start, lt: end } },
    select: { id: true, orderNumber: true, totalMinor: true, taxMinor: true, discountMinor: true, currency: true, cashier: { select: { name: true } }, payments: { where: { status: { in: ["COMPLETED", "REFUNDED"] } }, select: { method: true, amountMinor: true } }, lines: { select: { productName: true, quantity: true, lineTotalMinor: true } } },
    orderBy: { completedAt: "desc" },
  });
  const refundRows = await prisma.refund.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { amountMinor: true, taxRefundMinor: true, cashRefundMinor: true, otherRefundMinor: true, currency: true, kind: true } });
  const currencies = [...new Set([...orders.map((order) => order.currency), ...refundRows.map((refund) => refund.currency)])];
  const refundTotalMinor = refundRows.reduce((sum, refund) => sum + refund.amountMinor, 0);
  const taxRefundMinor = refundRows.reduce((sum, refund) => sum + refund.taxRefundMinor, 0);
  const grossTotalMinor = orders.reduce((sum, order) => sum + order.totalMinor, 0);
  const grossTaxMinor = orders.reduce((sum, order) => sum + order.taxMinor, 0);
  const totalMinor = grossTotalMinor - refundTotalMinor;
  const taxMinor = grossTaxMinor - taxRefundMinor;
  const discountMinor = orders.reduce((sum, order) => sum + order.discountMinor, 0);
  const tenders = new Map<string, number>();
  const products = new Map<string, { quantity: number; salesMinor: number }>();
  for (const order of orders) {
    for (const payment of order.payments) tenders.set(payment.method, (tenders.get(payment.method) || 0) + payment.amountMinor);
    for (const line of order.lines) {
      const current = products.get(line.productName) || { quantity: 0, salesMinor: 0 };
      current.quantity += line.quantity;
      current.salesMinor += line.lineTotalMinor;
      products.set(line.productName, current);
    }
  }
  for (const refund of refundRows) {
    if (refund.cashRefundMinor) tenders.set("CASH", (tenders.get("CASH") || 0) - refund.cashRefundMinor);
    if (refund.otherRefundMinor) tenders.set("OTHER", (tenders.get("OTHER") || 0) - refund.otherRefundMinor);
  }
  const report = {
    period, start, end, orderCount: orders.length, refundCount: refundRows.length, refundTotalMinor, currencies, totalMinor, taxMinor, discountMinor,
    averageOrderMinor: orders.length ? Math.round(grossTotalMinor / orders.length) : 0,
    tenders: [...tenders.entries()].map(([method, amountMinor]) => ({ method, amountMinor })),
    topProducts: [...products.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    recentOrders: orders.slice(0, 20).map((order) => ({ orderNumber: order.orderNumber, totalMinor: order.totalMinor, currency: order.currency, cashier: order.cashier.name })),
  };
  if (request.nextUrl.searchParams.get("format") === "csv") {
    const cell = (value: string | number, untrusted = false) => {
      let text = String(value);
      if (untrusted && (["=", "+", "@", "-"].includes(text[0] || "") || text.charCodeAt(0) === 9 || text.charCodeAt(0) === 13)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows: (string | number)[][] = [
      ["Section", "Name", "Quantity", "Amount minor", "Currency"],
      ["Summary", "Period", report.period, "", ""],
      ["Summary", "Start", report.start.toISOString(), "", ""],
      ["Summary", "End", report.end.toISOString(), "", ""],
      ["Summary", "Orders", report.orderCount, "", ""],
      ["Summary", "Refund count", report.refundCount, "", ""],
      ["Summary", "Net sales", report.totalMinor, "", report.currencies.join("|")],
      ["Summary", "Tax", report.taxMinor, "", report.currencies.join("|")],
      ["Summary", "Refund total", report.refundTotalMinor, "", report.currencies.join("|")],
      ["Summary", "Discounts", report.discountMinor, "", report.currencies.join("|")],
      ...report.tenders.map((item) => ["Tender", item.method, "", item.amountMinor, report.currencies.join("|")]),
      ...report.topProducts.map((item) => ["Product", item.name, item.quantity, item.salesMinor, report.currencies.join("|")]),
      ...report.recentOrders.map((item) => ["Order", `#${item.orderNumber} · ${item.cashier}`, "", item.totalMinor, item.currency]),
    ];
    const csv = rows.map((row) => row.map((value, index) => cell(value, index === 1)).join(",")).join(String.fromCharCode(13, 10));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="juice-shop-${period}-${selected}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
