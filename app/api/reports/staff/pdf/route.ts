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
  const [tzSetting, currencySetting] = await Promise.all([
    prisma.posSetting.findUnique({ where: { key: "store.timezone" }, select: { value: true } }),
    prisma.posSetting.findUnique({ where: { key: "store.currency" }, select: { value: true } }),
  ]);
  const timezone = typeof tzSetting?.value === "string" ? tzSetting.value : "Asia/Kabul";
  const defaultCurrency = typeof currencySetting?.value === "string" ? currencySetting.value : "AFN";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (key: string) => parts.find(p => p.type === key)?.value || "";
  const selected = date || get("year") + "-" + get("month") + "-" + get("day");
  const [year, month, day] = selected.split("-").map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return NextResponse.json({ error: "Invalid report date." }, { status: 400 });
  const start = localMidnightUtc(year, month - 1, day, timezone);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const end = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), timezone);
  const [staff, orders, refunds, shifts, movements] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    prisma.order.findMany({ where: { status: { in: ["COMPLETED", "REFUNDED", "VOIDED"] }, completedAt: { gte: start, lt: end } }, select: { cashierId: true, currency: true, totalMinor: true, discountMinor: true } }),
    prisma.refund.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { processedById: true, currency: true, amountMinor: true } }),
    prisma.shift.findMany({ where: { openedAt: { gte: start, lt: end } }, select: { userId: true, closedAt: true, openingCashMinor: true, closingCashMinor: true } }),
    prisma.cashMovement.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { userId: true, type: true, amountMinor: true } }),
  ]);
  const lines = ["JUICE SHOP - STAFF PERFORMANCE", "Business date: " + selected + " | Timezone: " + timezone, "Sales attributed to cashier; refunds attributed to processor.", " "];
  for (const member of staff) {
    const units = new Set([...orders.filter(o => o.cashierId === member.id).map(o => o.currency), ...refunds.filter(r => r.processedById === member.id).map(r => r.currency)]);
    if (!units.size) units.add(defaultCurrency);
    for (const unit of units) {
      const sales = orders.filter(o => o.cashierId === member.id && o.currency === unit);
      const memberRefunds = refunds.filter(r => r.processedById === member.id && r.currency === unit);
      const memberShifts = shifts.filter(s => s.userId === member.id);
      const memberMoves = movements.filter(m => m.userId === member.id);
      const gross = sales.reduce((sum, o) => sum + o.totalMinor, 0);
      const money = (n: number) => (n / 100).toFixed(2) + " " + unit;
      lines.push(member.name + " | " + member.email + " | " + member.role + " | " + unit,
        "Orders: " + sales.length + " | Gross: " + money(gross) + " | Discounts: " + money(sales.reduce((sum,o)=>sum+o.discountMinor,0)),
        "Average order: " + money(sales.length ? Math.round(gross/sales.length) : 0),
        "Refunds processed: " + memberRefunds.length + " | " + money(memberRefunds.reduce((sum,r)=>sum+r.amountMinor,0)),
        "Shifts opened/closed: " + memberShifts.length + "/" + memberShifts.filter(s=>s.closedAt!==null).length,
        "Opening/closing cash: " + money(memberShifts.reduce((sum,s)=>sum+s.openingCashMinor,0)) + " / " + money(memberShifts.reduce((sum,s)=>sum+(s.closingCashMinor??0),0)),
        "Paid in/out: " + money(memberMoves.filter(m=>m.type==="PAID_IN").reduce((sum,m)=>sum+m.amountMinor,0)) + " / " + money(memberMoves.filter(m=>m.type==="PAID_OUT").reduce((sum,m)=>sum+m.amountMinor,0)), " ");
    }
  }
  lines.push("Generated at: " + new Date().toISOString());
  return new NextResponse(new Uint8Array(createTextPdf(lines)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="juice-shop-staff-' + selected + '.pdf"', "Cache-Control": "no-store" } });
}
