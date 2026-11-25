import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });

  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20;
  const cursor = request.nextUrl.searchParams.get("cursor");
  const canViewAll = hasPermission(user.role, permissionState?.permissionOverrides, "VIEW_ALL_ORDERS");

  try {
    const orders = await prisma.order.findMany({
      where: { ...(canViewAll ? {} : { cashierId: user.id }) },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        lines: { select: { id: true, productName: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true, variantName: true, selectedModifiers: true, returns: { select: { quantity: true, condition: true, disposition: true, reason: true, createdAt: true } } } },
        payments: { select: { id: true, method: true, status: true, amountMinor: true, currency: true } },
        refunds: { orderBy: { createdAt: "desc" }, select: { kind: true, amountMinor: true, reason: true, createdAt: true } },
        cashier: { select: { id: true, name: true } },
      },
    });
    const hasMore = orders.length > limit;
    const page = hasMore ? orders.slice(0, limit) : orders;
    return NextResponse.json({
      orders: page,
      currentRole: user.role,
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Orders are unavailable." }, { status: 503 });
  }
}
