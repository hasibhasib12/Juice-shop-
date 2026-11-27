import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const managers = ["OWNER", "MANAGER"];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (![...managers, "DRIVER"].includes(user.role)) return NextResponse.json({ error: "Dispatch access required." }, { status: 403 });
  try {
    const orders = await prisma.order.findMany({
      where: {
        cashier: { branchId: user.branchId },
        status: "COMPLETED",
        orderType: "DELIVERY",
        deliveryStatus: { notIn: ["DELIVERED", "CANCELLED"] },
        ...(user.role === "DRIVER" ? { driverId: user.id } : {}),
      },
      orderBy: [{ createdAt: "asc" }],
      take: 150,
      select: {
        id: true, orderNumber: true, createdAt: true, customerName: true, customerPhone: true,
        deliveryAddress: true, deliveryFeeMinor: true, deliveryStatus: true, dispatchedAt: true,
        notes: true, totalMinor: true, currency: true,
        driver: { select: { id: true, name: true, phone: true } },
        lines: { select: { id: true, productName: true, quantity: true, variantName: true } },
      },
    });
    const drivers = user.role === "DRIVER" ? [] : await prisma.user.findMany({
      where: { branchId: user.branchId, role: "DRIVER", active: true, approvalStatus: "APPROVED" },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, phone: true, driverOnDuty: true,
        driverLocation: { select: { latitude: true, longitude: true, accuracyMeters: true, capturedAt: true, updatedAt: true } },
      },
    });
    const driverSelf = user.role === "DRIVER" ? await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        driverOnDuty: true,
        driverLocation: { select: { latitude: true, longitude: true, accuracyMeters: true, capturedAt: true, updatedAt: true } },
      },
    }) : null;
    return NextResponse.json({ orders, drivers, driverSelf, currentRole: user.role, branch: user.branch }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Dispatch data is temporarily unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (![...managers, "DRIVER"].includes(user.role)) return NextResponse.json({ error: "Dispatch access required." }, { status: 403 });
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { orderId?: unknown; driverId?: unknown; status?: unknown };
  if (typeof body.orderId !== "string" || body.orderId.length > 64) return NextResponse.json({ error: "Choose a valid delivery order." }, { status: 400 });
  const isManager = managers.includes(user.role);
  try {
    const order = await prisma.order.findFirst({
      where: { id: body.orderId, cashier: { branchId: user.branchId }, status: "COMPLETED", orderType: "DELIVERY" },
      select: { id: true, driverId: true, deliveryStatus: true },
    });
    if (!order || !order.deliveryStatus) return NextResponse.json({ error: "Delivery order not found." }, { status: 404 });

    if (body.driverId !== undefined) {
      if (!isManager) return NextResponse.json({ error: "Only a branch manager can assign drivers." }, { status: 403 });
      if (typeof body.driverId !== "string" || body.driverId.length > 64) return NextResponse.json({ error: "Choose a valid driver." }, { status: 400 });
      const driver = await prisma.user.findFirst({
        where: { id: body.driverId, branchId: user.branchId, role: "DRIVER", active: true, approvalStatus: "APPROVED" },
        select: { id: true },
      });
      if (!driver) return NextResponse.json({ error: "This driver is not active in your branch." }, { status: 400 });
      if (["DELIVERED", "CANCELLED"].includes(order.deliveryStatus)) return NextResponse.json({ error: "This delivery is already closed." }, { status: 409 });
      const changed = await prisma.order.updateMany({
        where: { id: order.id, deliveryStatus: order.deliveryStatus },
        data: { driverId: driver.id, deliveryStatus: "ASSIGNED", dispatchedAt: new Date() },
      });
      if (!changed.count) return NextResponse.json({ error: "The delivery changed on another screen. Refresh and retry." }, { status: 409 });
      await prisma.auditEvent.create({ data: { userId: user.id, action: "DELIVERY_DRIVER_ASSIGNED", entityType: "Order", entityId: order.id, details: { driverId: driver.id } } });
      return NextResponse.json({ ok: true });
    }

    const nextStatus = body.status;
    const transitions: Record<string, string[]> = {
      PENDING: ["ASSIGNED"], ASSIGNED: ["PICKED_UP"], PICKED_UP: ["DELIVERED", "FAILED"], FAILED: ["ASSIGNED"],
    };
    if (typeof nextStatus !== "string" || !transitions[order.deliveryStatus].includes(nextStatus)) {
      return NextResponse.json({ error: "That delivery status transition is not allowed." }, { status: 409 });
    }
    if (!isManager && (order.driverId !== user.id || !["PICKED_UP", "DELIVERED", "FAILED"].includes(nextStatus))) {
      return NextResponse.json({ error: "You can only update deliveries assigned to you." }, { status: 403 });
    }
    if (isManager && nextStatus === "ASSIGNED") return NextResponse.json({ error: "Assign a driver to start this delivery." }, { status: 400 });
    const changed = await prisma.order.updateMany({
      where: { id: order.id, deliveryStatus: order.deliveryStatus, ...(isManager ? {} : { driverId: user.id }) },
      data: { deliveryStatus: nextStatus as "PICKED_UP" | "DELIVERED" | "FAILED", ...(nextStatus === "DELIVERED" ? { deliveredAt: new Date() } : {}) },
    });
    if (!changed.count) return NextResponse.json({ error: "This delivery changed on another screen. Refresh and retry." }, { status: 409 });
    await prisma.auditEvent.create({ data: { userId: user.id, action: "DELIVERY_STATUS_UPDATED", entityType: "Order", entityId: order.id, details: { from: order.deliveryStatus, to: nextStatus } } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Delivery update failed. Refresh and try again." }, { status: 503 });
  }
}
