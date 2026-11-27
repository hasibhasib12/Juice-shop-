import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "KITCHEN" && user.role !== "OWNER" && user.role !== "MANAGER") {
    return NextResponse.json({ error: "Kitchen access required." }, { status: 403 });
  }
  try {
    const orders = await prisma.order.findMany({
      where: { cashier: { branchId: user.branchId }, status: "COMPLETED", kitchenStatus: { not: "SERVED" } },
      orderBy: [{ createdAt: "asc" }],
      take: 100,
      select: {
        id: true, orderNumber: true, kitchenStatus: true, orderType: true, createdAt: true, customerName: true, notes: true,
        table: { select: { name: true } },
        lines: { select: { id: true, productName: true, quantity: true, variantName: true, selectedModifiers: true } },
      },
    });
    return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Kitchen orders are temporarily unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "KITCHEN" && user.role !== "OWNER" && user.role !== "MANAGER") {
    return NextResponse.json({ error: "Kitchen access required." }, { status: 403 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const input = body as { orderId?: unknown; status?: unknown };
  if (typeof input.orderId !== "string" || input.orderId.length > 64 || !["PREPARING", "READY", "SERVED"].includes(String(input.status))) {
    return NextResponse.json({ error: "Choose an order and valid kitchen status." }, { status: 400 });
  }
  try {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, cashier: { branchId: user.branchId }, status: "COMPLETED" },
      select: { id: true, kitchenStatus: true },
    });
    if (!order) return NextResponse.json({ error: "Kitchen order not found." }, { status: 404 });
    const allowed: Record<string, string[]> = { QUEUED: ["PREPARING"], PREPARING: ["READY"], READY: ["SERVED"], SERVED: [] };
    if (!allowed[order.kitchenStatus].includes(String(input.status))) {
      return NextResponse.json({ error: "That preparation step is not allowed. Refresh the kitchen queue." }, { status: 409 });
    }
    const updated = await prisma.order.updateMany({
      where: { id: order.id, kitchenStatus: order.kitchenStatus },
      data: { kitchenStatus: input.status as "PREPARING" | "READY" | "SERVED" },
    });
    if (!updated.count) return NextResponse.json({ error: "This order changed on another screen. Refresh and try again." }, { status: 409 });
    await prisma.auditEvent.create({ data: { userId: user.id, action: "KITCHEN_STATUS_UPDATED", entityType: "Order", entityId: order.id, details: { from: order.kitchenStatus, to: String(input.status) } } });
    return NextResponse.json({ ok: true, status: input.status });
  } catch {
    return NextResponse.json({ error: "Kitchen status could not be updated." }, { status: 503 });
  }
}
