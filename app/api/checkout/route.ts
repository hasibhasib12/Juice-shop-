import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutItem = { productId: string; quantity: number };

export async function POST(request: NextRequest) {
  const cashier = await getCurrentUser();
  if (!cashier) return NextResponse.json({ error: "Please sign in before taking payment." }, { status: 401 });

  let body: { items?: CheckoutItem[]; paymentMethod?: string; idempotencyKey?: string };
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
  if (body.paymentMethod !== "CASH") {
    return NextResponse.json({ error: "Only cash checkout is enabled. Card payments require a configured payment provider." }, { status: 422 });
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

      const products = await tx.product.findMany({
        where: { id: { in: [...quantities.keys()] }, status: "ACTIVE", available: true, category: { active: true } },
        select: { id: true, name: true, priceMinor: true, currency: true },
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

      const order = await tx.order.create({
        data: {
          status: "COMPLETED",
          cashierId: cashier.id,
          subtotalMinor,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: subtotalMinor,
          currency,
          idempotencyKey: key,
          completedAt: new Date(),
          lines: { create: lines },
          payments: { create: { method: "CASH", status: "COMPLETED", amountMinor: subtotalMinor, currency } },
        },
        include: { lines: true, payments: true },
      });

      await tx.auditEvent.create({
        data: {
          userId: cashier.id,
          action: "ORDER_COMPLETED",
          entityType: "Order",
          entityId: order.id,
          details: { orderNumber: order.orderNumber, totalMinor: order.totalMinor, currency, paymentMethod: "CASH" },
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
    if (message === "PRODUCT_UNAVAILABLE") return NextResponse.json({ error: "One or more products are no longer available." }, { status: 409 });
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
