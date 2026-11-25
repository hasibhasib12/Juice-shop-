import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { withSerializableRetry } from "../lib/transaction-retry";

const enabled = process.env.POS_TEST_DATABASE === "1";

test("PostgreSQL POS concurrency invariants", { skip: !enabled }, async () => {
  const suffix = randomUUID();
  const userId = `it-user-${suffix}`;
  const categoryId = `it-category-${suffix}`;
  const productId = `it-product-${suffix}`;
  const ingredientId = `it-ingredient-${suffix}`;
  const shiftId = `it-shift-${suffix}`;
  const orderId = `it-order-${suffix}`;
  const idempotencyKey = `it-key-${suffix}`;

  try {
    await prisma.user.create({ data: {
      id: userId, name: "Integration cashier", email: `${suffix}@integration.invalid`,
      passwordHash: "integration-only-not-a-real-password", role: "CASHIER",
    } });
    await prisma.category.create({ data: { id: categoryId, name: `Integration ${suffix}` } });
    await prisma.ingredient.create({ data: {
      id: ingredientId, name: `Integration stock ${suffix}`, unit: "portion",
      quantityOnHand: new Prisma.Decimal(1),
    } });
    await prisma.product.create({ data: {
      id: productId, name: "Integration product", priceMinor: 1000,
      currency: "AFN", categoryId,
    } });
    await prisma.recipeItem.create({ data: {
      id: `it-recipe-${suffix}`, productId, ingredientId, quantity: new Prisma.Decimal(1),
    } });
    await prisma.shift.create({ data: { id: shiftId, userId, openingCashMinor: 500 } });
    
    const consumeStock = () => withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const changed = await tx.ingredient.updateMany({
        where: { id: ingredientId, quantityOnHand: { gte: new Prisma.Decimal(1) } },
        data: { quantityOnHand: { decrement: new Prisma.Decimal(1) } },
      });
      if (changed.count !== 1) throw new Error("INSUFFICIENT_STOCK");
      await tx.stockMovement.create({ data: {
        ingredientId, type: "SALE", quantity: new Prisma.Decimal(-1), reason: "integration concurrency test",
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    const stockAttempts = await Promise.allSettled([consumeStock(), consumeStock()]);
    assert.equal(stockAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(stockAttempts.filter((result) => result.status === "rejected").length, 1);
    const stock = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    assert.equal(stock.quantityOnHand.toString(), "0");
    assert.equal(await prisma.stockMovement.count({ where: { ingredientId, type: "SALE" } }), 1);

    const createIdempotentOrder = () => prisma.order.create({ data: {
      id: `it-idem-${randomUUID()}`, cashierId: userId, shiftId,
      status: "COMPLETED", subtotalMinor: 1000, totalMinor: 1000,
      currency: "AFN", idempotencyKey, requestFingerprint: "same-request",
      completedAt: new Date(),
    } });
    const idempotencyAttempts = await Promise.allSettled([
      createIdempotentOrder(), createIdempotentOrder(),
    ]);
    assert.equal(idempotencyAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await prisma.order.count({ where: { idempotencyKey } }), 1);

    await prisma.order.create({ data: {
      id: orderId, cashierId: userId, shiftId, status: "COMPLETED",
      subtotalMinor: 1000, totalMinor: 1000, currency: "AFN",
      payments: { create: { method: "OTHER", status: "COMPLETED", amountMinor: 1000, currency: "AFN" } },
    } });

    const processPartialRefund = () => withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const existing = await tx.refund.aggregate({
        where: { orderId }, _sum: { amountMinor: true },
      });
      const alreadyRefunded = existing._sum.amountMinor ?? 0;
      if (alreadyRefunded + 700 > 1000) throw new Error("REFUND_EXCEEDS_BALANCE");
      await tx.refund.create({ data: {
        orderId, processedById: userId, kind: "REFUND", amountMinor: 700,
        currency: "AFN", reason: "integration concurrency test",
        cashRefundMinor: 0, otherRefundMinor: 700, taxRefundMinor: 0,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    const refundAttempts = await Promise.allSettled([processPartialRefund(), processPartialRefund()]);
    assert.equal(refundAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(refundAttempts.filter((result) => result.status === "rejected").length, 1);
    const refundTotal = await prisma.refund.aggregate({
      where: { orderId }, _sum: { amountMinor: true },
    });
    assert.equal(refundTotal._sum.amountMinor, 700);

    await prisma.cashMovement.create({ data: {
      shiftId, userId, type: "PAID_IN", amountMinor: 200, reason: "integration test",
    } });
    await prisma.cashMovement.create({ data: {
      shiftId, userId, type: "PAID_OUT", amountMinor: 50, reason: "integration test",
    } });
    await prisma.order.create({ data: {
      id: `it-cash-order-${suffix}`, cashierId: userId, shiftId, status: "COMPLETED",
      subtotalMinor: 1000, totalMinor: 1000, currency: "AFN",
      payments: { create: { method: "CASH", status: "COMPLETED", amountMinor: 1000, currency: "AFN" } },
    } });
    const cashSales = await prisma.payment.aggregate({
      where: { status: "COMPLETED", method: "CASH", order: { shiftId } },
      _sum: { amountMinor: true },
    });
    const movements = await prisma.cashMovement.groupBy({
      by: ["type"], where: { shiftId }, _sum: { amountMinor: true },
    });
    const paidIn = movements.find((row) => row.type === "PAID_IN")?._sum.amountMinor ?? 0;
    const paidOut = movements.find((row) => row.type === "PAID_OUT")?._sum.amountMinor ?? 0;
    const expectedCash = 500 + (cashSales._sum.amountMinor ?? 0) + paidIn - paidOut;
    assert.equal(expectedCash, 1650);
  } finally {
    await prisma.refund.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.payment.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.order.deleteMany({ where: { cashierId: userId } });
    await prisma.cashMovement.deleteMany({ where: { shiftId } });
    await prisma.stockMovement.deleteMany({ where: { ingredientId } });
    await prisma.recipeItem.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});

test.after(async () => {
  if (enabled) await prisma.$disconnect();
});
