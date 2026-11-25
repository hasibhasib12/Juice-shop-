import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  let body: { orderId?: string; tableId?: string | null };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed as typeof body;
  } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (typeof body.orderId !== "string" || !body.orderId || body.orderId.length > 64 || (body.tableId !== null && body.tableId !== undefined && (typeof body.tableId !== "string" || body.tableId.length > 64))) {
    return NextResponse.json({ error: "A valid order and table selection are required." }, { status: 400 });
  }
  const tableId = body.tableId ?? null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: body.orderId! }, select: { id: true, orderNumber: true, status: true, cashierId: true, tableId: true } });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status !== "DRAFT") throw new Error("ORDER_NOT_OPEN");
      if (order.cashierId !== user.id && user.role !== "OWNER" && user.role !== "MANAGER") throw new Error("ORDER_FORBIDDEN");
      if (tableId) {
        const table = await tx.diningTable.findUnique({ where: { id: tableId }, select: { id: true, active: true } });
        if (!table || !table.active) throw new Error("TABLE_UNAVAILABLE");
      }
      const updated = await tx.order.update({ where: { id: order.id }, data: { tableId }, select: { id: true, orderNumber: true, tableId: true } });
      await tx.auditEvent.create({ data: { userId: user.id, action: tableId ? (order.tableId ? "DINING_ORDER_TRANSFERRED" : "DINING_ORDER_ASSIGNED") : "DINING_ORDER_UNASSIGNED", entityType: "Order", entityId: order.id, details: { fromTableId: order.tableId, toTableId: tableId } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ order: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Open order not found." }, { status: 404 });
    if (message === "ORDER_NOT_OPEN") return NextResponse.json({ error: "Only open draft orders can be assigned to a table." }, { status: 409 });
    if (message === "ORDER_FORBIDDEN") return NextResponse.json({ error: "You cannot move another cashier's order." }, { status: 403 });
    if (message === "TABLE_UNAVAILABLE") return NextResponse.json({ error: "That table is unavailable." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "That table already has an open order. Transfer or close it first." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "The order or table changed at the same time. Reload and retry." }, { status: 409 });
    return NextResponse.json({ error: "Order could not be moved." }, { status: 503 });
  }
}
