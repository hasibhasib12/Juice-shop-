import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/transaction-retry";
import { hasPermission } from "@/lib/permissions";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function managerOnly() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_PURCHASING")) return { response: NextResponse.json({ error: "Purchasing access required." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const access = await managerOnly();
  if (access.response) return access.response;
  const [orders, suppliers, ingredients] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { branchId: access.user!.branchId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { supplier: { select: { id: true, name: true } }, lines: { orderBy: { ingredientName: "asc" } } },
    }),
    prisma.supplier.findMany({ where: { branchId: access.user!.branchId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.ingredient.findMany({ where: { branchId: access.user!.branchId }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, quantityOnHand: true, averageCostMinor: true } }),
  ]);
  return NextResponse.json({ orders, suppliers, ingredients }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await managerOnly();
  if (access.response) return access.response;
  const rate = await checkActionRateLimit("purchase-order-write", access.user!.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many purchasing changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
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
    const order = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const configuredCurrency = await tx.posSetting.findUnique({ where: { key: "store.currency" }, select: { value: true } });
      const storeCurrency = typeof configuredCurrency?.value === "string" ? configuredCurrency.value.toUpperCase() : "AFN";
      if (currency !== storeCurrency) throw new Error("PURCHASE_CURRENCY_MISMATCH");
      const supplier = await tx.supplier.findFirst({ where: { id: body.supplierId as string, branchId: access.user!.branchId } });
      if (!supplier || !supplier.active) throw new Error("SUPPLIER_NOT_FOUND");
      const ingredients = await tx.ingredient.findMany({ where: { id: { in: input.map((line) => line.ingredientId) }, branchId: access.user!.branchId } });
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
          branchId: access.user!.branchId,
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPPLIER_NOT_FOUND") return NextResponse.json({ error: "Supplier not found or inactive." }, { status: 404 });
    if (error instanceof Error && error.message === "INGREDIENT_NOT_FOUND") return NextResponse.json({ error: "One or more ingredients were not found." }, { status: 404 });
    if (error instanceof Error && error.message === "TOTAL_TOO_LARGE") return NextResponse.json({ error: "Purchase order total is too large." }, { status: 400 });
    if (error instanceof Error && error.message === "PURCHASE_CURRENCY_MISMATCH") return NextResponse.json({ error: "Purchase order currency must match the store currency. Foreign-currency cost conversion is not configured." }, { status: 400 });
    return NextResponse.json({ error: "Purchase order could not be created." }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await managerOnly();
  if (access.response) return access.response;
  const rate = await checkActionRateLimit("purchase-order-write", access.user!.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many purchasing changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { id?: unknown; action?: unknown; receipts?: unknown };
  if (typeof body.id !== "string" || !body.id || (body.action !== "receive" && body.action !== "cancel")) return NextResponse.json({ error: "Choose a purchase order and valid action." }, { status: 400 });

  const receiptInputs: { lineId: string; quantity: Prisma.Decimal }[] = [];
  if (body.action === "receive") {
    if (!Array.isArray(body.receipts) || body.receipts.length < 1 || body.receipts.length > 100) {
      return NextResponse.json({ error: "Provide at least one line with a positive received quantity." }, { status: 400 });
    }
    try {
      const seen = new Set<string>();
      for (const raw of body.receipts) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_RECEIPT");
        const item = raw as { lineId?: unknown; quantity?: unknown };
        if (typeof item.lineId !== "string" || !item.lineId || seen.has(item.lineId)) throw new Error("INVALID_RECEIPT");
        const quantity = new Prisma.Decimal(String(item.quantity));
        if (!quantity.isFinite() || quantity.lte(0) || quantity.gt(1000000) || quantity.decimalPlaces() > 3) throw new Error("INVALID_RECEIPT");
        seen.add(item.lineId);
        receiptInputs.push({ lineId: item.lineId, quantity });
      }
    } catch {
      return NextResponse.json({ error: "Each received line needs a unique line ID and a positive quantity (up to 3 decimals)." }, { status: 400 });
    }
  }

  try {
    const order = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const current = await tx.purchaseOrder.findFirst({ where: { id: body.id as string, branchId: access.user!.branchId }, include: { lines: true } });
      if (!current) throw new Error("ORDER_NOT_FOUND");
      if (body.action === "cancel") {
        if (current.status !== "DRAFT" && current.status !== "PARTIALLY_RECEIVED") throw new Error("ORDER_NOT_OPEN");
        const cancelled = await tx.purchaseOrder.update({ where: { id: current.id }, data: { status: "CANCELLED" }, include: { supplier: { select: { id: true, name: true } }, lines: true } });
        await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PURCHASE_ORDER_CANCELLED", entityType: "PurchaseOrder", entityId: current.id, details: { orderNumber: current.orderNumber, alreadyReceived: current.lines.some((line) => line.receivedQuantity.gt(0)) } } });
        return cancelled;
      }
      if (current.status !== "DRAFT" && current.status !== "PARTIALLY_RECEIVED") throw new Error("ORDER_NOT_OPEN");
      const configuredCurrency = await tx.posSetting.findUnique({ where: { key: "store.currency" }, select: { value: true } });
      const storeCurrency = typeof configuredCurrency?.value === "string" ? configuredCurrency.value.toUpperCase() : "AFN";
      if (current.currency !== storeCurrency) throw new Error("PURCHASE_CURRENCY_MISMATCH");

      const lineById = new Map(current.lines.map((line) => [line.id, line]));
      const applied: { lineId: string; ingredientId: string; quantity: string }[] = [];
      for (const receipt of receiptInputs) {
        const line = lineById.get(receipt.lineId);
        if (!line) throw new Error("RECEIPT_LINE_NOT_FOUND");
        const outstanding = line.quantity.minus(line.receivedQuantity);
        if (outstanding.lte(0) || receipt.quantity.gt(outstanding)) throw new Error("RECEIPT_EXCEEDS_OUTSTANDING");
        const ingredient = await tx.ingredient.findFirst({ where: { id: line.ingredientId, branchId: access.user!.branchId } });
        if (!ingredient) throw new Error("INGREDIENT_NOT_FOUND");
        const previousValue = ingredient.quantityOnHand.mul(ingredient.averageCostMinor);
        const receivedValue = receipt.quantity.mul(line.unitCostMinor);
        const nextQuantity = ingredient.quantityOnHand.plus(receipt.quantity);
        const nextAverage = nextQuantity.gt(0)
          ? previousValue.plus(receivedValue).div(nextQuantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          : new Prisma.Decimal(0);
        if (nextAverage.gt(Number.MAX_SAFE_INTEGER)) throw new Error("COST_TOO_LARGE");
        await tx.ingredient.update({
          where: { id: ingredient.id },
          data: { quantityOnHand: nextQuantity, averageCostMinor: nextAverage.toNumber() },
        });
        await tx.stockMovement.create({
          data: { ingredientId: ingredient.id, type: "PURCHASE", quantity: receipt.quantity, reason: `Purchase order #${current.orderNumber}` },
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: line.receivedQuantity.plus(receipt.quantity) },
        });
        applied.push({ lineId: line.id, ingredientId: ingredient.id, quantity: receipt.quantity.toString() });
      }

      const fullyReceived = current.lines.every((line) => {
        const incoming = receiptInputs.find((receipt) => receipt.lineId === line.id)?.quantity ?? new Prisma.Decimal(0);
        return line.receivedQuantity.plus(incoming).gte(line.quantity);
      });
      const receivedOrder = await tx.purchaseOrder.update({
        where: { id: current.id },
        data: { status: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED", ...(fullyReceived ? { receivedAt: new Date() } : {}) },
        include: { supplier: { select: { id: true, name: true } }, lines: true },
      });
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PURCHASE_ORDER_RECEIVED", entityType: "PurchaseOrder", entityId: current.id, details: { orderNumber: current.orderNumber, partial: !fullyReceived, receipts: applied } } });
      return receivedOrder;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
    if (error instanceof Error && error.message === "ORDER_NOT_OPEN") return NextResponse.json({ error: "Only open purchase orders can be received or cancelled." }, { status: 409 });
    if (error instanceof Error && error.message === "RECEIPT_LINE_NOT_FOUND") return NextResponse.json({ error: "A received line does not belong to this purchase order." }, { status: 400 });
    if (error instanceof Error && error.message === "RECEIPT_EXCEEDS_OUTSTANDING") return NextResponse.json({ error: "A received quantity exceeds the outstanding quantity." }, { status: 400 });
    if (error instanceof Error && error.message === "INGREDIENT_NOT_FOUND") return NextResponse.json({ error: "A purchase order ingredient no longer exists." }, { status: 409 });
    if (error instanceof Error && error.message === "COST_TOO_LARGE") return NextResponse.json({ error: "Average stock cost is too large." }, { status: 400 });
    if (error instanceof Error && error.message === "PURCHASE_CURRENCY_MISMATCH") return NextResponse.json({ error: "This purchase order uses a different currency from the store. Update the currency or configure a verified conversion before receiving stock." }, { status: 409 });
    return NextResponse.json({ error: "Purchase order could not be processed." }, { status: 409 });
  }
}
