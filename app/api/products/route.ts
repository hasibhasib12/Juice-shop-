import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      where: { active: true, products: { some: { status: "ACTIVE", available: true } } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, sortOrder: true },
    });
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE", available: true, category: { active: true } },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        priceMinor: true,
        currency: true,
        category: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ categories, products });
  } catch {
    return NextResponse.json(
      { error: "Products are not available. Check that the database migration has been applied." },
      { status: 503 },
    );
  }
}
