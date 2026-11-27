import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This endpoint intentionally returns only public order-display fields.
// It never exposes customer details, order contents, payments, or staff data.
export async function GET(_request: Request, context: { params: Promise<{ branchCode: string }> }) {
  const { branchCode } = await context.params;
  const code = branchCode.trim().toUpperCase();
  if (!code || code.length > 24 || !/^[A-Z0-9_-]+$/.test(code)) {
    return NextResponse.json({ error: "Invalid branch display." }, { status: 400 });
  }

  try {
    const branch = await prisma.branch.findFirst({
      where: { code, active: true },
      select: { id: true, name: true, code: true },
    });
    if (!branch) return NextResponse.json({ error: "Branch display not found." }, { status: 404 });

    const orders = await prisma.order.findMany({
      where: {
        cashier: { branchId: branch.id },
        status: "COMPLETED",
        kitchenStatus: { in: ["QUEUED", "PREPARING", "READY"] },
      },
      orderBy: [{ createdAt: "asc" }],
      take: 60,
      select: { orderNumber: true, kitchenStatus: true, createdAt: true },
    });

    return NextResponse.json({
      branch: { name: branch.name, code: branch.code },
      orders: orders.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.kitchenStatus,
        createdAt: order.createdAt,
      })),
      updatedAt: new Date().toISOString(),
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "Order display is temporarily unavailable." }, { status: 503 });
  }
}
