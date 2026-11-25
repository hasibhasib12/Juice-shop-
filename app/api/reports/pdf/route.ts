import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createTextPdf } from "@/lib/simple-pdf";
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
  const permission = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permission?.permissionOverrides, "VIEW_REPORTS")) return NextResponse.json({ error: "Report access required." }, { status: 403 });
  const period = request.nextUrl.searchParams.get("period") || "day";
  const date = request.nextUrl.searchParams.get("date");
  if (!["day", "week", "month"].includes(period) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return NextResponse.json({ error: "Invalid report period or date." }, { status: 400 });
  const setting = await prisma.posSetting.findUnique({ where: { key: "store.timezone" }, select: { value: true } });
  const timezone = typeof setting?.value === "string" ? setting.value : "Asia/Kabul";
  let selected = date;
  if (!selected) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (key: string) => parts.find((part) => part.type === key)?.value || "";
    selected = get("year") + "-" + get("month") + "-" + get("day");
  }
  const [year, month, day] = selected.split("-").map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  let startYear = year, startMonth = month - 1, startDay = day;
  if (period === "week") {
    const monday = new Date(Date.UTC(year, month - 1, day - ((valid.getUTCDay() + 6) % 7)));
    startYear = monday.getUTCFullYear(); startMonth = monday.getUTCMonth(); startDay = monday.getUTCDate();
  } else if (period === "month") startDay = 1;
  const next = new Date(Date.UTC(startYear, startMonth, startDay));
  if (period === "day") next.setUTCDate(next.getUTCDate() + 1);
  if (period === "week") next.setUTCDate(next.getUTCDate() + 7);
  if (period === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  const start = localMidnightUtc(startYear, startMonth, startDay, timezone);
  const end = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), timezone);
  const [orders, refunds, currencySetting] = await Promise.all([
    prisma.order.findMany({ where: { status: { in: ["COMPLETED", "REFUNDED"] }, completedAt: { gte: start, lt: end } }, select: { totalMinor: true, taxMinor: true, discountMinor: true, currency: true, payments: { where: { status: { in: ["COMPLETED", "REFUNDED"] } }, select: { method: true, amountMinor: true } }, lines: { select: { productName: true, quantity: true, lineTotalMinor: true } } } }),
    prisma.refund.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { amountMinor: true, taxRefundMinor: true, cashRefundMinor: true, otherRefundMinor: true, currency: true } }),
    prisma.posSetting.findUnique({ where: { key: "store.currency" }, select: { value: true } }),
  ]);
  const currencies = [...new Set([...orders.map(o => o.currency), ...refunds.map(r => r.currency)])];
  const currency = currencies.length === 1 ? currencies[0] : (typeof currencySetting?.value === "string" ? currencySetting.value : "AFN");
  const gross = orders.reduce((sum, order) => sum + order.totalMinor, 0);
  const refundTotal = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
  const tax = orders.reduce((sum, order) => sum + order.taxMinor, 0) - refunds.reduce((sum, refund) => sum + refund.taxRefundMinor, 0);
  const discounts = orders.reduce((sum, order) => sum + order.discountMinor, 0);
  const tenders = new Map<string, number>();
  const products = new Map<string, { quantity: number; sales: number }>();
  for (const order of orders) {
    for (const payment of order.payments) tenders.set(payment.method, (tenders.get(payment.method) || 0) + payment.amountMinor);
    for (const line of order.lines) { const current = products.get(line.productName) || { quantity: 0, sales: 0 }; current.quantity += line.quantity; current.sales += line.lineTotalMinor; products.set(line.productName, current); }
  }
  for (const refund of refunds) { tenders.set("CASH", (tenders.get("CASH") || 0) - refund.cashRefundMinor); tenders.set("OTHER", (tenders.get("OTHER") || 0) - refund.otherRefundMinor); }
  const money = (minor: number) => (minor / 100).toFixed(2) + " " + currency;
  const lines = [
    "JUICE SHOP - SALES REPORT", "Period: " + period.toUpperCase() + " | Selected date: " + selected,
    "Business timezone: " + timezone, "Range: " + start.toISOString() + " to " + end.toISOString(), " ",
    "ORDERS: " + orders.length, "GROSS SALES: " + money(gross), "REFUNDS: " + money(refundTotal),
    "NET SALES: " + money(gross - refundTotal), "TAX NET: " + money(tax), "DISCOUNTS: " + money(discounts), " ",
    "TENDER BREAKDOWN", ...[...tenders.entries()].map(([method, amount]) => method + ": " + money(amount)), " ",
    "TOP PRODUCTS", ...[...products.entries()].sort((a,b) => b[1].quantity - a[1].quantity).slice(0,12).map(([name,v]) => name + " | Qty " + v.quantity + " | " + money(v.sales)),
    " ", "Generated at: " + new Date().toISOString(),
  ];
  const pdf = createTextPdf(lines);
  return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="juice-shop-sales-' + selected + '.pdf"', "Cache-Control": "no-store" } });
}
