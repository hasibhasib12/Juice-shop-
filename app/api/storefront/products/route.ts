import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // The public storefront is intentionally pinned to one configured branch.
    // Never expose the staff catalogue across all branches.
    const branchId = process.env.STOREFRONT_BRANCH_ID || "main-branch";
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, active: true },
      select: { id: true, name: true, currency: true, timezone: true },
    });
    if (!branch) return NextResponse.json({ error: "Storefront is not configured." }, { status: 503 });

    const categories = await prisma.category.findMany({
      where: { branchId, active: true, products: { some: { status: "ACTIVE", available: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
    const products = await prisma.product.findMany({
      where: { branchId, status: "ACTIVE", available: true, category: { active: true } },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      select: {
        id: true, name: true, description: true, imageUrl: true, priceMinor: true, currency: true,
        category: { select: { name: true } },
        variants: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, priceMinor: true } },
      },
    });
    return NextResponse.json({
      store: { name: branch.name, currency: branch.currency, timezone: branch.timezone },
      categories,
      products: products.map((product) => ({ ...product, category: product.category.name })),
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "The shop catalogue is temporarily unavailable." }, { status: 503 });
  }
}
