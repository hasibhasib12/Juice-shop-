import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });

  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20;
  const cursor = request.nextUrl.searchParams.get("cursor");
  const canViewAll = user.role === "OWNER" || user.role === "MANAGER";

  try {
    const orders = await prisma.order.findMany({
      where: {
        ...(canViewAll ? {} : { cashierId: user.id }),
        ...(cursor ? { id: cursor } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        lines: { select: { id: true, productName: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true } },
        payments: { select: { id: true, method: true, status: true, amountMinor: true, currency: true } },
        cashier: { select: { id: true, name: true } },
      },
    });
    const hasMore = orders.length > limit;
    const page = hasMore ? orders.slice(0, limit) : orders;
    return NextResponse.json({
      orders: page,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Orders are unavailable." }, { status: 503 });
  }
}
