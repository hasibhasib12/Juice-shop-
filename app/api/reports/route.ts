import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });

  const period = request.nextUrl.searchParams.get("period") || "day";
  const dateParam = request.nextUrl.searchParams.get("date");
  if (!["day", "week", "month"].includes(period)) return NextResponse.json({ error: "Period must be day, week or month." }, { status: 400 });
  const selected = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : new Date();
  if (!Number.isFinite(selected.getTime())) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  let start = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), selected.getUTCDate()));
  if (period === "week") {
    const day = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
  } else if (period === "month") start = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const end = new Date(start);
  if (period === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 7);
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);

  const orders = await prisma.order.findMany({
    where: { status: "COMPLETED", completedAt: { gte: start, lt: end } },
    select: { id: true, orderNumber: true, totalMinor: true, taxMinor: true, discountMinor: true, currency: true, cashier: { select: { name: true } }, payments: { where: { status: "COMPLETED" }, select: { method: true, amountMinor: true } }, lines: { select: { productName: true, quantity: true, lineTotalMinor: true } } },
    orderBy: { completedAt: "desc" },
  });
  const currencies = [...new Set(orders.map((order) => order.currency))];
  const totalMinor = orders.reduce((sum, order) => sum + order.totalMinor, 0);
  const taxMinor = orders.reduce((sum, order) => sum + order.taxMinor, 0);
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
  return NextResponse.json({
    period, start, end, orderCount: orders.length, currencies, totalMinor, taxMinor, discountMinor,
    averageOrderMinor: orders.length ? Math.round(totalMinor / orders.length) : 0,
    tenders: [...tenders.entries()].map(([method, amountMinor]) => ({ method, amountMinor })),
    topProducts: [...products.entries()].map(([name, values]) => ({ name, ...values })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    recentOrders: orders.slice(0, 20).map((order) => ({ orderNumber: order.orderNumber, totalMinor: order.totalMinor, currency: order.currency, cashier: order.cashier.name })),
  }, { headers: { "Cache-Control": "no-store" } });
}
