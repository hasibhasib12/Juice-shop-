import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutItem = { productId: string; quantity: number };
type PaymentTender = { method: "CASH" | "OTHER"; amountMinor: number };
const fingerprint = (items: CheckoutItem[]) => createHash("sha256").update([...items].sort((a,b) => a.productId.localeCompare(b.productId)).map((item) => `${item.productId}:${item.quantity}`).join("|")).digest("hex");

export async function POST(request: NextRequest) {
  const cashier = await getCurrentUser();
  if (!cashier) return NextResponse.json({ error: "Please sign in before taking payment." }, { status: 401 });

  let body: { items?: CheckoutItem[]; paymentMethod?: string; cashReceivedMinor?: number; paymentTenders?: PaymentTender[]; idempotencyKey?: string; discountApprovalId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const items = body.items;
  const key = body.idempotencyKey;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50 ||
      !items.every((item) => item && typeof item.productId === "string" &&
        item.productId.length <= 64 && Number.isSafeInteger(item.quantity) &&
        item.quantity >= 1 && item.quantity <= 100)) {
    return NextResponse.json({ error: "Add between 1 and 50 valid order lines." }, { status: 400 });
  }
  if (typeof key !== "string" || key.length < 12 || key.length > 100) {
    return NextResponse.json({ error: "A valid checkout idempotency key is required." }, { status: 400 });
  }
  const tenders = body.paymentTenders ?? (body.paymentMethod === "CASH" ? [{ method: "CASH" as const, amountMinor: 0 }] : null);
  if (!tenders || !Array.isArray(tenders) || tenders.length < 1 || tenders.length > 2 || !tenders.every((tender) => tender && (tender.method === "CASH" || tender.method === "OTHER") && Number.isSafeInteger(tender.amountMinor) && tender.amountMinor >= (body.paymentTenders ? 1 : 0) && tender.amountMinor <= 2_000_000_000) || new Set(tenders.map((tender) => tender.method)).size !== tenders.length) {
    return NextResponse.json({ error: "Choose one or two valid payment tenders. Card payments require a configured provider." }, { status: 400 });
  }

  const quantities = new Map<string, number>();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  if ([...quantities.values()].some((quantity) => quantity > 100)) {
    return NextResponse.json({ error: "A product quantity cannot exceed 100 per order." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.order.findUnique({
        where: { idempotencyKey: key },
        include: { lines: true, payments: true },
      });
      if (previous) {
        if (previous.cashierId !== cashier.id) throw new Error("IDEMPOTENCY_CONFLICT");
        return previous;
      }
      const activeShift = await tx.shift.findFirst({ where: { userId: cashier.id, closedAt: null }, select: { id: true } });
      if (!activeShift) throw new Error("NO_OPEN_SHIFT");

      const products = await tx.product.findMany({
        where: { id: { in: [...quantities.keys()] }, status: "ACTIVE", available: true, category: { active: true } },
        select: {
          id: true, name: true, priceMinor: true, currency: true,
          recipeItems: { select: { ingredientId: true, quantity: true, ingredient: { select: { name: true, unit: true, quantityOnHand: true } } } },
        },
      });
      if (products.length !== quantities.size) throw new Error("PRODUCT_UNAVAILABLE");
      const currencies = new Set(products.map((product) => product.currency));
      if (currencies.size !== 1) throw new Error("MIXED_CURRENCIES");

      const lines = products.map((product) => {
        const quantity = quantities.get(product.id)!;
        const lineTotalMinor = product.priceMinor * quantity;
        if (!Number.isSafeInteger(lineTotalMinor) || lineTotalMinor < 0) throw new Error("INVALID_PRICE");
        return { productId: product.id, productName: product.name, quantity, unitPriceMinor: product.priceMinor, lineTotalMinor };
      });
      const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor <= 0) throw new Error("INVALID_TOTAL");
      const currency = products[0].currency;
      const taxSetting = await tx.posSetting.findUnique({ where: { key: "store.taxRateBps" }, select: { value: true } });
      const taxRateBps = typeof taxSetting?.value === "number" && Number.isSafeInteger(taxSetting.value) && taxSetting.value >= 0 && taxSetting.value <= 10000 ? taxSetting.value : 0;
      let discountMinor = 0;
      let discountApproval: { id: string; managerId: string; reason: string } | null = null;
      if (body.discountApprovalId !== undefined) {
        if (typeof body.discountApprovalId !== "string" || body.discountApprovalId.length > 64) throw new Error("INVALID_DISCOUNT_APPROVAL");
        const approval = await tx.discountApproval.findFirst({ where: { id: body.discountApprovalId, cashierId: cashier.id, subtotalMinor, cartFingerprint: fingerprint(items), discountMinor: { gt: 0, lte: subtotalMinor }, expiresAt: { gt: new Date() }, usedAt: null }, select: { id: true, managerId: true, reason: true, discountMinor: true } });
        if (!approval) throw new Error("INVALID_DISCOUNT_APPROVAL");
        discountMinor = approval.discountMinor;
        discountApproval = approval;
        const consumed = await tx.discountApproval.updateMany({ where: { id: approval.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (consumed.count !== 1) throw new Error("INVALID_DISCOUNT_APPROVAL");
      }
      const taxableSubtotalMinor = subtotalMinor - discountMinor;
      const taxMinor = new Prisma.Decimal(taxableSubtotalMinor).mul(taxRateBps).div(10000).toDecimalPlaces(0).toNumber();
      const totalMinor = taxableSubtotalMinor + taxMinor;
      if (!Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new Error("INVALID_TOTAL");
      const normalizedTenders = tenders.map((tender) => ({ ...tender, amountMinor: tender.amountMinor || totalMinor }));
      const tenderTotal = normalizedTenders.reduce((sum, tender) => sum + tender.amountMinor, 0);
      if (!Number.isSafeInteger(tenderTotal) || tenderTotal !== totalMinor) throw new Error("TENDER_TOTAL_MISMATCH");
      const cashPayment = normalizedTenders.find((tender) => tender.method === "CASH");
      const cashReceivedMinor = cashPayment ? (normalizedTenders.length === 1 ? (body.cashReceivedMinor ?? cashPayment.amountMinor) : cashPayment.amountMinor) : null;
      if (cashReceivedMinor !== null && (!Number.isSafeInteger(cashReceivedMinor) || cashReceivedMinor < cashPayment!.amountMinor || cashReceivedMinor > 2_000_000_000)) throw new Error("INSUFFICIENT_TENDER");
      const changeDueMinor = cashReceivedMinor === null ? null : cashReceivedMinor - cashPayment!.amountMinor;
      const ingredientDemand = new Map<string, Prisma.Decimal>();
      for (const product of products) {
        const soldQuantity = quantities.get(product.id)!;
        for (const recipeItem of product.recipeItems) {
          const required = recipeItem.quantity.mul(soldQuantity);
          ingredientDemand.set(recipeItem.ingredientId, (ingredientDemand.get(recipeItem.ingredientId) ?? new Prisma.Decimal(0)).plus(required));
        }
      }
      for (const [ingredientId, required] of ingredientDemand) {
        const ingredient = products.flatMap((product) => product.recipeItems).find((item) => item.ingredientId === ingredientId)?.ingredient;
        if (!ingredient || ingredient.quantityOnHand.lt(required)) throw new Error("INSUFFICIENT_STOCK");
      }

      const order = await tx.order.create({
        data: {
          status: "COMPLETED",
          cashierId: cashier.id,
          shiftId: activeShift.id,
          subtotalMinor,
          discountMinor,
          taxMinor,
          totalMinor,
          currency,
          idempotencyKey: key,
          completedAt: new Date(),
          lines: { create: lines },
          payments: { create: normalizedTenders.map((tender) => ({ method: tender.method, status: "COMPLETED" as const, amountMinor: tender.amountMinor, currency, ...(tender.method === "CASH" ? { cashReceivedMinor, changeDueMinor } : {}) })) },
        },
        include: { lines: true, payments: true },
      });

      for (const [ingredientId, required] of ingredientDemand) {
        const changed = await tx.ingredient.updateMany({
          where: { id: ingredientId, quantityOnHand: { gte: required } },
          data: { quantityOnHand: { decrement: required } },
        });
        if (changed.count !== 1) throw new Error("INSUFFICIENT_STOCK");
        await tx.stockMovement.create({
          data: { ingredientId, type: "SALE", quantity: required.negated(), reason: "Recipe deduction at checkout", referenceId: order.id },
        });
      }

      await tx.auditEvent.create({
        data: {
          userId: cashier.id,
          action: "ORDER_COMPLETED",
          entityType: "Order",
          entityId: order.id,
          details: { orderNumber: order.orderNumber, totalMinor: order.totalMinor, discountMinor, discountApprovedBy: discountApproval?.managerId ?? null, discountReason: discountApproval?.reason ?? null, taxMinor, taxRateBps, currency, payments: normalizedTenders.map((tender) => ({ method: tender.method, amountMinor: tender.amountMinor })), cashReceivedMinor, changeDueMinor },
        },
      });
      return order;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({
      order: {
        id: result.id,
        orderNumber: result.orderNumber,
        status: result.status,
        subtotalMinor: result.subtotalMinor,
        discountMinor: result.discountMinor,
        taxMinor: result.taxMinor,
        totalMinor: result.totalMinor,
        currency: result.currency,
        lines: result.lines,
        payments: result.payments,
        completedAt: result.completedAt,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INVALID_DISCOUNT_APPROVAL") return NextResponse.json({ error: "Discount approval is invalid, expired, already used, or no longer matches this order. Request approval again." }, { status: 409 });
    if (message === "INSUFFICIENT_TENDER") return NextResponse.json({ error: "Cash received must cover the cash portion." }, { status: 400 });
    if (message === "TENDER_TOTAL_MISMATCH") return NextResponse.json({ error: "Payment amounts must add up exactly to the order total." }, { status: 400 });
    if (message === "PRODUCT_UNAVAILABLE") return NextResponse.json({ error: "One or more products are no longer available." }, { status: 409 });
    if (message === "NO_OPEN_SHIFT") return NextResponse.json({ error: "Open your cash shift before completing a sale." }, { status: 409 });
    if (message === "INSUFFICIENT_STOCK") return NextResponse.json({ error: "Not enough ingredient stock to complete this order. No payment or order was recorded." }, { status: 409 });
    if (message === "MIXED_CURRENCIES") return NextResponse.json({ error: "All items in an order must use the same currency." }, { status: 409 });
    if (message === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "This checkout key belongs to another cashier." }, { status: 409 });
    if (message === "INVALID_PRICE" || message === "INVALID_TOTAL") return NextResponse.json({ error: "The order total is invalid." }, { status: 422 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey: key }, select: { id: true, orderNumber: true, status: true, totalMinor: true, currency: true } });
      if (existing) return NextResponse.json({ order: existing }, { status: 200 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Checkout conflicted with another update. Please retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Checkout could not be completed." }, { status: 503 });
  }
}
