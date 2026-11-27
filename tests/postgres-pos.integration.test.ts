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
  const refundUserId = `it-refund-user-${suffix}`;
  const refundShiftId = `it-refund-shift-${suffix}`;
  const categoryId = `it-category-${suffix}`;
  const productId = `it-product-${suffix}`;
  const ingredientId = `it-ingredient-${suffix}`;
  const shiftId = `it-shift-${suffix}`;
  const orderId = `it-order-${suffix}`;
  const idempotencyKey = `it-key-${suffix}`;
  const purchaseIngredientId = `it-purchase-ingredient-${suffix}`;
  const supplierId = `it-supplier-${suffix}`;
  const purchaseOrderId = `it-po-${suffix}`;
  const purchaseLineId = `it-po-line-${suffix}`;
  const settingsBranchIds: string[] = [];

  try {
    const settingsBranchA = await prisma.branch.create({ data: { name: `Settings isolation A ${suffix}`, code: `SIA${suffix.slice(0, 7).toUpperCase()}`, currency: "AFN", timezone: "Asia/Kabul" } });
    settingsBranchIds.push(settingsBranchA.id);
    const settingsBranchB = await prisma.branch.create({ data: { name: `Settings isolation B ${suffix}`, code: `SIB${suffix.slice(0, 7).toUpperCase()}`, currency: "EUR", timezone: "Europe/Berlin" } });
    settingsBranchIds.push(settingsBranchB.id);
    await prisma.branchSetting.createMany({ data: [
      { branchId: settingsBranchA.id, key: "taxRateBps", value: 500 },
      { branchId: settingsBranchA.id, key: "taxLabel", value: "VAT-A" },
      { branchId: settingsBranchA.id, key: "maxDiscountPercentBps", value: 1500 },
      { branchId: settingsBranchB.id, key: "taxRateBps", value: 1900 },
      { branchId: settingsBranchB.id, key: "taxLabel", value: "Sales tax B" },
      { branchId: settingsBranchB.id, key: "maxDiscountPercentBps", value: 3000 },
    ] });
    const [settingsA, settingsB] = await Promise.all([
      prisma.branchSetting.findMany({ where: { branchId: settingsBranchA.id }, orderBy: { key: "asc" } }),
      prisma.branchSetting.findMany({ where: { branchId: settingsBranchB.id }, orderBy: { key: "asc" } }),
    ]);
    assert.deepEqual(Object.fromEntries(settingsA.map((row) => [row.key, row.value])), {
      taxLabel: "VAT-A", taxRateBps: 500, maxDiscountPercentBps: 1500,
    });
    assert.deepEqual(Object.fromEntries(settingsB.map((row) => [row.key, row.value])), {
      taxLabel: "Sales tax B", taxRateBps: 1900, maxDiscountPercentBps: 3000,
    });
    await prisma.user.create({ data: {
      branch: { connect: { code: "MAIN" } },
      id: userId, name: "Integration cashier", email: `${suffix}@integration.invalid`,
      passwordHash: "integration-only-not-a-real-password", role: "CASHIER",
    } });
    await prisma.user.create({ data: {
      branch: { connect: { code: "MAIN" } },
      id: refundUserId, name: "Integration refund cashier", email: `refund-${suffix}@integration.invalid`,
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
    await prisma.shift.create({ data: { id: shiftId, userId, branchId: "main-branch", openingCashMinor: 500 } });
    await prisma.shift.create({ data: { id: refundShiftId, userId: refundUserId, branchId: "main-branch", openingCashMinor: 1000 } });
    
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

    // A cash refund is paid from the refunding cashier's drawer, not the
    // original sale's drawer. Keep the original cash sale on its source shift.
    const cashOrderId = `it-cash-order-${suffix}`;
    await prisma.refund.create({ data: {
      orderId: cashOrderId, processedById: refundUserId, shiftId: refundShiftId,
      kind: "REFUND", amountMinor: 300, currency: "AFN", reason: "cross-shift drawer allocation",
      cashRefundMinor: 300, otherRefundMinor: 0, taxRefundMinor: 0,
    } });
    const originShiftRefunds = await prisma.refund.aggregate({
      where: { shiftId }, _sum: { cashRefundMinor: true },
    });
    const refundShiftRefunds = await prisma.refund.aggregate({
      where: { shiftId: refundShiftId }, _sum: { cashRefundMinor: true },
    });
    const originalDrawerExpected = 500 + (cashSales._sum.amountMinor ?? 0)
      - (originShiftRefunds._sum.cashRefundMinor ?? 0) + paidIn - paidOut;
    const refundDrawerExpected = 1000 - (refundShiftRefunds._sum.cashRefundMinor ?? 0);
    assert.equal(originalDrawerExpected, 1650);
    assert.equal(refundDrawerExpected, 700);

    // Two cashiers cannot both receive the same outstanding PO quantity.
    // The winning receipt must update stock, weighted-average cost, line
    // quantity, movement ledger, status and audit atomically.
    await prisma.ingredient.create({ data: {
      id: purchaseIngredientId, name: `Integration purchase stock ${suffix}`, unit: "kg",
      quantityOnHand: new Prisma.Decimal(4), averageCostMinor: 100,
    } });
    await prisma.supplier.create({ data: {
      id: supplierId, name: `Integration supplier ${suffix}`,
    } });
    await prisma.purchaseOrder.create({ data: {
      id: purchaseOrderId, supplierId, createdById: userId, status: "DRAFT",
      currency: "AFN", subtotalMinor: 2000,
      lines: { create: {
        id: purchaseLineId, ingredientId: purchaseIngredientId,
        ingredientName: "Integration purchase stock", quantity: new Prisma.Decimal(10),
        receivedQuantity: new Prisma.Decimal(0), unitCostMinor: 200,
        lineTotalMinor: 2000,
      } },
    } });

    const receiveSix = () => withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const current = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: purchaseOrderId }, include: { lines: true },
      });
      if (current.status !== "DRAFT" && current.status !== "PARTIALLY_RECEIVED") {
        throw new Error("ORDER_NOT_OPEN");
      }
      const line = current.lines.find((item) => item.id === purchaseLineId);
      if (!line) throw new Error("RECEIPT_LINE_NOT_FOUND");
      const receiptQuantity = new Prisma.Decimal(6);
      const outstanding = line.quantity.minus(line.receivedQuantity);
      if (outstanding.lte(0) || receiptQuantity.gt(outstanding)) {
        throw new Error("RECEIPT_EXCEEDS_OUTSTANDING");
      }
      const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id: purchaseIngredientId } });
      const previousValue = ingredient.quantityOnHand.mul(ingredient.averageCostMinor);
      const receivedValue = receiptQuantity.mul(line.unitCostMinor);
      const nextQuantity = ingredient.quantityOnHand.plus(receiptQuantity);
      const nextAverage = previousValue.plus(receivedValue).div(nextQuantity)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
      await tx.ingredient.update({
        where: { id: purchaseIngredientId },
        data: { quantityOnHand: nextQuantity, averageCostMinor: nextAverage.toNumber() },
      });
      await tx.stockMovement.create({ data: {
        ingredientId: purchaseIngredientId, type: "PURCHASE", quantity: receiptQuantity,
        reason: `Purchase order #${current.orderNumber}`,
      } });
      await tx.purchaseOrderLine.update({
        where: { id: purchaseLineId },
        data: { receivedQuantity: line.receivedQuantity.plus(receiptQuantity) },
      });
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: "PARTIALLY_RECEIVED" },
      });
      await tx.auditEvent.create({ data: {
        userId, action: "PURCHASE_ORDER_RECEIVED", entityType: "PurchaseOrder",
        entityId: purchaseOrderId, details: { partial: true, quantity: "6" },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    const receiptAttempts = await Promise.allSettled([receiveSix(), receiveSix()]);
    assert.equal(receiptAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(receiptAttempts.filter((result) => result.status === "rejected").length, 1);
    const receivedIngredient = await prisma.ingredient.findUniqueOrThrow({ where: { id: purchaseIngredientId } });
    assert.equal(receivedIngredient.quantityOnHand.toString(), "10");
    assert.equal(receivedIngredient.averageCostMinor, 160);
    const receivedLine = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: purchaseLineId } });
    assert.equal(receivedLine.receivedQuantity.toString(), "6");
    const receivedOrder = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId } });
    assert.equal(receivedOrder.status, "PARTIALLY_RECEIVED");
    assert.equal(await prisma.stockMovement.count({
      where: { ingredientId: purchaseIngredientId, type: "PURCHASE" },
    }), 1);
    assert.equal(await prisma.auditEvent.count({
      where: { entityType: "PurchaseOrder", entityId: purchaseOrderId, action: "PURCHASE_ORDER_RECEIVED" },
    }), 1);
  } finally {
    if (settingsBranchIds.length) await prisma.branch.deleteMany({ where: { id: { in: settingsBranchIds } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: purchaseOrderId } });
    await prisma.stockMovement.deleteMany({ where: { ingredientId: purchaseIngredientId } });
    await prisma.purchaseOrder.deleteMany({ where: { id: purchaseOrderId } });
    await prisma.ingredient.deleteMany({ where: { id: purchaseIngredientId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.refund.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.payment.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.order.deleteMany({ where: { cashierId: userId } });
    await prisma.cashMovement.deleteMany({ where: { shiftId } });
    await prisma.stockMovement.deleteMany({ where: { ingredientId } });
    await prisma.recipeItem.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.shift.deleteMany({ where: { id: { in: [shiftId, refundShiftId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, refundUserId] } } });
  }
});

test.after(async () => {
  if (enabled) await prisma.$disconnect();
});
