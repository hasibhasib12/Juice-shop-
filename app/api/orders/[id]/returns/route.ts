import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReturnInput = {
  orderLineId: string;
  quantity: number;
  condition: "SEALED_UNUSED" | "OPENED" | "PREPARED" | "DAMAGED";
  disposition: "WASTE" | "NOT_RESTOCKABLE";
  reason: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: actor.id }, select: { permissionOverrides: true } });
  if (!hasPermission(actor.role, permissionState?.permissionOverrides, "PROCESS_REFUNDS")) return NextResponse.json({ error: "Return permission is required." }, { status: 403 });
  const rate = await checkActionRateLimit("item-return", actor.id, 10, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many return requests. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });

  let body: { items?: ReturnInput[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return NextResponse.json({ error: "Add at least one returned order line." }, { status: 400 });
  const seen = new Set<string>();
  for (const item of body.items) {
    if (!item || typeof item.orderLineId !== "string" || item.orderLineId.length > 64 || seen.has(item.orderLineId) ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 ||
      !["SEALED_UNUSED", "OPENED", "PREPARED", "DAMAGED"].includes(item.condition) ||
      !["WASTE", "NOT_RESTOCKABLE"].includes(item.disposition) ||
      typeof item.reason !== "string" || item.reason.trim().length < 3 || item.reason.trim().length > 240) {
      return NextResponse.json({ error: "Each return needs a valid line, quantity, condition, disposition and reason." }, { status: 400 });
    }
    if (item.condition === "PREPARED" && item.disposition !== "WASTE") return NextResponse.json({ error: "Prepared drinks must be recorded as waste; ingredients cannot be restocked." }, { status: 400 });
    if (item.condition === "SEALED_UNUSED" && item.disposition !== "NOT_RESTOCKABLE") return NextResponse.json({ error: "Sealed returns cannot be restocked until finished-product inventory is implemented." }, { status: 400 });
    seen.add(item.orderLineId);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status === "DRAFT") throw new Error("ORDER_NOT_COMPLETED");
      const created = [];
      for (const item of body.items!) {
        const line = await tx.orderLine.findFirst({ where: { id: item.orderLineId, orderId: order.id }, select: { id: true, quantity: true, productName: true } });
        if (!line) throw new Error("LINE_NOT_FOUND");
        const prior = await tx.orderLineReturn.aggregate({ where: { orderLineId: line.id }, _sum: { quantity: true } });
        const returned = prior._sum.quantity ?? 0;
        if (returned + item.quantity > line.quantity) throw new Error("RETURN_EXCEEDS_SOLD");
        const entry = await tx.orderLineReturn.create({ data: {
          orderId: order.id, orderLineId: line.id, processedById: actor.id,
          quantity: item.quantity, condition: item.condition, disposition: item.disposition, reason: item.reason.trim(),
        }});
        created.push({ ...entry, productName: line.productName, previouslyReturned: returned, remainingReturnable: line.quantity - returned - item.quantity });
      }
      await tx.auditEvent.create({ data: {
        userId: actor.id, action: "ORDER_ITEMS_RETURN_RECORDED", entityType: "Order", entityId: order.id,
        details: { returns: created.map((entry) => ({ returnId: entry.id, orderLineId: entry.orderLineId, quantity: entry.quantity, condition: entry.condition, disposition: entry.disposition, reason: entry.reason })), inventoryRestocked: false },
      }});
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ returns: result, inventoryRestocked: false }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (message === "ORDER_NOT_COMPLETED") return NextResponse.json({ error: "Draft orders cannot have item returns." }, { status: 409 });
    if (message === "LINE_NOT_FOUND") return NextResponse.json({ error: "An order line was not found on this order." }, { status: 404 });
    if (message === "RETURN_EXCEEDS_SOLD") return NextResponse.json({ error: "Returned quantity exceeds the quantity originally sold." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Another return was recorded at the same time. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ error: "The item return could not be recorded." }, { status: 503 });
  }
}
