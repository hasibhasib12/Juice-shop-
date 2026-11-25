import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  if (user.role !== "OWNER" && user.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });

  const [ingredients, currencySetting] = await Promise.all([
    prisma.ingredient.findMany({ orderBy: { name: "asc" }, select: { name: true, unit: true, quantityOnHand: true, reorderLevel: true, averageCostMinor: true } }),
    prisma.posSetting.findUnique({ where: { key: "store.currency" }, select: { value: true } }),
  ]);
  const currency = typeof currencySetting?.value === "string" ? currencySetting.value : "AFN";
  const rows: (string | number)[][] = [
    ["Ingredient", "Unit", "Quantity on hand", "Reorder level", "Average unit cost minor", "Stock value minor", "Currency", "Stock status"],
    ...ingredients.map((item) => {
      const value = Math.round(Number(item.quantityOnHand) * item.averageCostMinor);
      return [item.name, item.unit, item.quantityOnHand.toString(), item.reorderLevel.toString(), item.averageCostMinor, value, currency, item.quantityOnHand.lte(item.reorderLevel) ? "LOW" : "OK"];
    }),
    ["TOTAL", "", "", "", "", ingredients.reduce((sum, item) => sum + Math.round(Number(item.quantityOnHand) * item.averageCostMinor), 0), currency, ""],
  ];
  const csv = rows.map((row) => row.map((value, index) => csvCell(value, index === 0 || index === 1 || index === 7)).join(",")).join("\r\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="juice-shop-stock-valuation.csv"', "Cache-Control": "no-store" } });
}
