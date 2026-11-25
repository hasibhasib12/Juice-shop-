import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        lines: true,
        payments: true,
        refunds: { orderBy: { createdAt: 'desc' } },
        cashier: { select: { id: true, name: true } },
      },
    });
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const canViewAll = user.role === "OWNER" || user.role === "MANAGER";
    if (!canViewAll && order.cashierId !== user.id) {
      return NextResponse.json({ error: "You cannot view this order." }, { status: 403 });
    }
    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Order is unavailable." }, { status: 503 });
  }
}
