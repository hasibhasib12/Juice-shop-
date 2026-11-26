import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value: string | number, untrusted = false) {
  let text = String(value);
  if (untrusted && (/^[=+@-]/.test(text) || text.charCodeAt(0) === 9 || text.charCodeAt(0) === 13)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "VIEW_REPORTS")) return NextResponse.json({ error: "Report access required." }, { status: 403 });

  const [ingredients, branch] = await Promise.all([
    prisma.ingredient.findMany({ where: { branchId: user.branchId }, orderBy: { name: "asc" }, select: { name: true, unit: true, quantityOnHand: true, reorderLevel: true, averageCostMinor: true } }),
    prisma.branch.findUnique({ where: { id: user.branchId }, select: { currency: true } }),
  ]);
  const currency = branch?.currency?.toUpperCase() || "AFN";
  const values = ingredients.map((item) => item.quantityOnHand.mul(item.averageCostMinor).toDecimalPlaces(0).toFixed(0));
  const totalValue = values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
  const rows: (string | number)[][] = [
    ["Ingredient", "Unit", "Quantity on hand", "Reorder level", "Average unit cost minor", "Stock value minor", "Currency", "Stock status"],
    ...ingredients.map((item, index) => [item.name, item.unit, item.quantityOnHand.toString(), item.reorderLevel.toString(), item.averageCostMinor, values[index], currency, item.quantityOnHand.lte(item.reorderLevel) ? "LOW" : "OK"]),
    ["TOTAL", "", "", "", "", totalValue, currency, ""],
  ];
  const csv = rows.map((row) => row.map((value, index) => csvCell(value, index === 0 || index === 1 || index === 7)).join(",")).join("\r\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="juice-shop-stock-valuation.csv"', "Cache-Control": "no-store" } });
}
