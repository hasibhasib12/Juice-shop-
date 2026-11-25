import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function managerOnly() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  if (user.role !== "OWNER" && user.role !== "MANAGER") return { response: NextResponse.json({ error: "Manager or owner access required." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const access = await managerOnly();
  if (access.response) return access.response;
  const [orders, suppliers, ingredients] = await Promise.all([
    prisma.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { supplier: { select: { id: true, name: true } }, lines: { orderBy: { ingredientName: "asc" } } },
    }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.ingredient.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, quantityOnHand: true, averageCostMinor: true } }),
  ]);
  return NextResponse.json({ orders, suppliers, ingredients }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await managerOnly();
  if (access.response) return access.response;
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { supplierId?: unknown; currency?: unknown; notes?: unknown; lines?: unknown };
  if (typeof body.supplierId !== "string" || !body.supplierId) return NextResponse.json({ error: "Choose a supplier." }, { status: 400 });
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "AFN";
  if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a three-letter ISO code." }, { status: 400 });
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 1000)) return NextResponse.json({ error: "Notes must be 1,000 characters or fewer." }, { status: 400 });
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) return NextResponse.json({ error: "Add between 1 and 100 purchase order lines." }, { status: 400 });

  const seen = new Set<string>();
  const input: { ingredientId: string; quantity: Prisma.Decimal; unitCostMinor: number }[] = [];
  try {
    for (const raw of body.lines) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_LINE");
      const line = raw as { ingredientId?: unknown; quantity?: unknown; unitCostMinor?: unknown };
      if (typeof line.ingredientId !== "string" || !line.ingredientId || seen.has(line.ingredientId) ||
          !Number.isSafeInteger(line.unitCostMinor) || (line.unitCostMinor as number) < 0) throw new Error("INVALID_LINE");
      const quantity = new Prisma.Decimal(String(line.quantity));
      if (!quantity.isFinite() || quantity.lte(0) || quantity.gt(1000000) || quantity.decimalPlaces() > 3) throw new Error("INVALID_LINE");
      seen.add(line.ingredientId);
      input.push({ ingredientId: line.ingredientId, quantity, unitCostMinor: line.unitCostMinor as number });
    }
  } catch { return NextResponse.json({ error: "Each line needs a unique ingredient, positive quantity (up to 3 decimals), and non-negative unit cost." }, { status: 400 }); }

  try {
    const order = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: body.supplierId as string } });
      if (!supplier || !supplier.active) throw new Error("SUPPLIER_NOT_FOUND");
      const ingredients = await tx.ingredient.findMany({ where: { id: { in: input.map((line) => line.ingredientId) } } });
      if (ingredients.length !== input.length) throw new Error("INGREDIENT_NOT_FOUND");
      const byId = new Map(ingredients.map((item) => [item.id, item]));
      const lines = input.map((line) => {
        const ingredient = byId.get(line.ingredientId)!;
        const total = line.quantity.mul(line.unitCostMinor).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
        if (!total.isFinite() || total.gt(Number.MAX_SAFE_INTEGER)) throw new Error("TOTAL_TOO_LARGE");
        return {
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          lineTotalMinor: total.toNumber(),
        };
      });
      const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      if (!Number.isSafeInteger(subtotalMinor)) throw new Error("TOTAL_TOO_LARGE");
      const created = await tx.purchaseOrder.create({
        data: {
          supplierId: supplier.id,
          createdById: access.user!.id,
          currency,
          subtotalMinor,
          notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
          lines: { create: lines },
        },
        include: { supplier: { select: { id: true, name: true } }, lines: true },
      });
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PURCHASE_ORDER_CREATED", entityType: "PurchaseOrder", entityId: created.id, details: { orderNumber: created.orderNumber, supplier: supplier.name, subtotalMinor, currency } } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_NOT_FOUND") return NextResponse.json({ error: "Supplier not found or inactive." }, { status: 404 });
    if (error instanceof Error && error.message === "INGREDIENT_NOT_FOUND") return NextResponse.json({ error: "One or more ingredients were not found." }, { status: 404 });
    if (error instanceof Error && error.message === "TOTAL_TOO_LARGE") return NextResponse.json({ error: "Purchase order total is too large." }, { status: 400 });
    return NextResponse.json({ error: "Purchase order could not be created." }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const access = await managerOnly();
  if (access.response) return access.response;
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { id?: unknown; action?: unknown };
  if (typeof body.id !== "string" || !body.id || (body.action !== "receive" && body.action !== "cancel")) return NextResponse.json({ error: "Choose a purchase order and valid action." }, { status: 400 });

  try {
    const order = await prisma.$transaction(async (tx) => {
      const current = await tx.purchaseOrder.findUnique({ where: { id: body.id as string }, include: { lines: true } });
      if (!current) throw new Error("ORDER_NOT_FOUND");
      if (current.status !== "DRAFT") throw new Error("ORDER_NOT_DRAFT");
      if (body.action === "cancel") {
        const cancelled = await tx.purchaseOrder.update({ where: { id: current.id }, data: { status: "CANCELLED" }, include: { supplier: { select: { id: true, name: true } }, lines: true } });
        await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PURCHASE_ORDER_CANCELLED", entityType: "PurchaseOrder", entityId: current.id, details: { orderNumber: current.orderNumber } } });
        return cancelled;
      }

      for (const line of current.lines) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: line.ingredientId } });
        if (!ingredient) throw new Error("INGREDIENT_NOT_FOUND");
        const received = line.quantity;
        const previousValue = ingredient.quantityOnHand.mul(ingredient.averageCostMinor);
        const receivedValue = received.mul(line.unitCostMinor);
        const nextQuantity = ingredient.quantityOnHand.plus(received);
        const nextAverage = nextQuantity.gt(0)
          ? previousValue.plus(receivedValue).div(nextQuantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          : new Prisma.Decimal(0);
        if (nextAverage.gt(Number.MAX_SAFE_INTEGER)) throw new Error("COST_TOO_LARGE");
        await tx.ingredient.update({
          where: { id: ingredient.id },
          data: { quantityOnHand: nextQuantity, averageCostMinor: nextAverage.toNumber() },
        });
        await tx.stockMovement.create({
          data: { ingredientId: ingredient.id, type: "PURCHASE", quantity: received, reason: `Purchase order #${current.orderNumber}` },
        });
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQuantity: received } });
      }
      const receivedOrder = await tx.purchaseOrder.update({
        where: { id: current.id },
        data: { status: "RECEIVED", receivedAt: new Date() },
        include: { supplier: { select: { id: true, name: true } }, lines: true },
      });
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PURCHASE_ORDER_RECEIVED", entityType: "PurchaseOrder", entityId: current.id, details: { orderNumber: current.orderNumber, subtotalMinor: current.subtotalMinor, currency: current.currency } } });
      return receivedOrder;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
    if (error instanceof Error && error.message === "ORDER_NOT_DRAFT") return NextResponse.json({ error: "Only draft purchase orders can be received or cancelled." }, { status: 409 });
    if (error instanceof Error && error.message === "INGREDIENT_NOT_FOUND") return NextResponse.json({ error: "A purchase order ingredient no longer exists." }, { status: 409 });
    if (error instanceof Error && error.message === "COST_TOO_LARGE") return NextResponse.json({ error: "Average stock cost is too large." }, { status: 400 });
    return NextResponse.json({ error: "Purchase order could not be processed." }, { status: 409 });
  }
}
