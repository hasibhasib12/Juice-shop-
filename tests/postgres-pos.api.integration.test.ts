import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, scryptSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { prisma } from "../lib/prisma";

const enabled = process.env.POS_TEST_DATABASE === "1";
const port = 3187;
const baseUrl = `http://127.0.0.1:${port}`;

function passwordHash(password: string) {
  const salt = randomUUID().replaceAll("-", "");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

async function expectStatus(response: Response, expected: number) {
  if (response.status !== expected) throw new Error(`Expected HTTP ${expected}, received ${response.status}: ${await response.text()}`);
}

async function waitForServer(child: ChildProcess) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js integration server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health/db`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await delay(1000);
  }
  throw new Error("Next.js integration server did not become ready within 90 seconds");
}

test("POS HTTP API integration: login, checkout, refund and item return", { skip: !enabled, timeout: 180_000 }, async () => {
  const suffix = randomUUID();
  const userId = `api-it-user-${suffix}`;
  const cashierId = `api-it-cashier-${suffix}`;
  let createdTableId: string | undefined;
  let createdCashierShiftId: string | undefined;
  const categoryId = `api-it-category-${suffix}`;
  const productId = `api-it-product-${suffix}`;
  const ingredientId = `api-it-ingredient-${suffix}`;
  const shiftId = `api-it-shift-${suffix}`;
  const password = `Integration-${randomUUID()}-Pass`;
  let server: ChildProcess | undefined;

  try {
    await prisma.user.create({ data: {
      id: userId, name: "POS API Integration Owner",
      email: `${suffix}@api-integration.invalid`,
      passwordHash: passwordHash(password), role: "OWNER",
    } });
    await prisma.user.create({ data: {
      id: cashierId, name: "POS API Integration Cashier",
      email: `cashier-${suffix}@api-integration.invalid`,
      passwordHash: passwordHash(password), role: "CASHIER",
    } });
    await prisma.category.create({ data: { id: categoryId, name: `API Integration ${suffix}` } });
    await prisma.ingredient.create({ data: { id: ingredientId, name: "Private integration ingredient", unit: "ml" } });
    await prisma.product.create({ data: {
      id: productId, name: "API Integration Juice", priceMinor: 1000,
      currency: "AFN", categoryId,
      variants: { create: { name: "Large", priceMinor: 1500, recipeItems: { create: { ingredientId, quantity: "250.000" } } } },
    } });
    await prisma.shift.create({ data: { id: shiftId, userId, openingCashMinor: 500 } });

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "ignore",
    });
    await waitForServer(server);

    const publicCatalogue = await fetch(`${baseUrl}/api/products`);
    await expectStatus(publicCatalogue, 200);
    const publicCatalogueJson = await publicCatalogue.json() as { products: { id: string; variants: Record<string, unknown>[] }[] };
    const exposedProduct = publicCatalogueJson.products.find((item) => item.id === productId);
    assert.ok(exposedProduct);
    assert.equal(exposedProduct.variants.length, 1);
    assert.equal("recipeItems" in exposedProduct.variants[0], false);
    assert.equal("ingredientId" in exposedProduct.variants[0], false);

    const origin = baseUrl;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${suffix}@api-integration.invalid`, password }),
    });
    await expectStatus(login, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(cookie.includes("juice_shop_session="));

    const request = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

    const cashierLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `cashier-${suffix}@api-integration.invalid`, password }),
    });
    await expectStatus(cashierLogin, 200);
    const cashierCookie = cashierLogin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const cashierRequest = (path: string, body: unknown, method = "POST") => fetch(`${baseUrl}${path}`, {
      method, headers: { "content-type": "application/json", cookie: cashierCookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const malformedDiscountEmail = await cashierRequest("/api/discounts/authorize", {
      managerEmail: 123, managerPassword: password, discountMinor: 1, reason: "Test", items: [],
    });
    await expectStatus(malformedDiscountEmail, 400);
    const malformedDiscountReason = await cashierRequest("/api/discounts/authorize", {
      managerEmail: `${suffix}@api-integration.invalid`, managerPassword: password, discountMinor: 1, reason: 123, items: [],
    });
    await expectStatus(malformedDiscountReason, 400);
    const concurrentShiftOpens = await Promise.all([
      cashierRequest("/api/shifts", { openingCashMinor: 100 }),
      cashierRequest("/api/shifts", { openingCashMinor: 100 }),
    ]);
    assert.deepEqual(concurrentShiftOpens.map((response) => response.status).sort(), [201, 409]);
    const openedShiftResponse = concurrentShiftOpens.find((response) => response.status === 201)!;
    const openedShiftJson = await openedShiftResponse.json() as { shift: { id: string } };
    createdCashierShiftId = openedShiftJson.shift.id;
    assert.equal(await prisma.auditEvent.count({ where: { entityId: createdCashierShiftId, action: "SHIFT_OPENED", userId: cashierId } }), 1);
    const deniedTableCreate = await cashierRequest("/api/tables", { name: "Denied table" });
    await expectStatus(deniedTableCreate, 403);
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_TABLES: true } } });
    const allowedTableCreate = await cashierRequest("/api/tables", { name: `API-${suffix.slice(0, 8)}`, section: "Integration", capacity: 4, sortOrder: 10 });
    await expectStatus(allowedTableCreate, 201);
    const tableJson = await allowedTableCreate.json() as { table: { id: string } };
    assert.ok(tableJson.table.id);
    createdTableId = tableJson.table.id;
    assert.equal(await prisma.auditEvent.count({ where: { entityId: createdTableId, action: "DINING_TABLE_CREATED", userId: cashierId } }), 1);
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_TABLES: false } } });
    const deniedTableUpdate = await cashierRequest("/api/tables", { id: tableJson.table.id, name: "Should be denied" }, "PATCH");
    await expectStatus(deniedTableUpdate, 403);

    const checkoutBody = {
      items: [{ productId, quantity: 1 }],
      paymentTenders: [{ method: "OTHER", amountMinor: 1000 }],
      idempotencyKey: `api-it-key-${suffix}`,
      customerName: "API Integration Customer",
      notes: "End-to-end test",
    };
    const checkout = await request("/api/checkout", checkoutBody);
    await expectStatus(checkout, 201);
    const checkoutJson = await checkout.json() as { order: { id: string; totalMinor: number; lines: Array<{ id: string; quantity: number }> } };
    assert.equal(checkoutJson.order.totalMinor, 1000);
    assert.equal(checkoutJson.order.lines.length, 1);
    const orderId = checkoutJson.order.id;
    const lineId = checkoutJson.order.lines[0].id;

    const replay = await request("/api/checkout", checkoutBody);
    await expectStatus(replay, 201);
    const replayJson = await replay.json() as { order: { id: string } };
    assert.equal(replayJson.order.id, orderId);
    assert.equal(await prisma.order.count({ where: { idempotencyKey: checkoutBody.idempotencyKey } }), 1);
    assert.equal(await prisma.payment.count({ where: { orderId } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: orderId, action: "ORDER_COMPLETED" } }), 1);

    const refundAttempts = await Promise.all([
      request(`/api/orders/${orderId}/refund`, { kind: "REFUND", amountMinor: 1000, reason: "API integration full refund" }),
      request(`/api/orders/${orderId}/refund`, { kind: "REFUND", amountMinor: 1000, reason: "Competing API refund" }),
    ]);
    const refundStatuses = refundAttempts.map((response) => response.status).sort();
    assert.deepEqual(refundStatuses, [201, 409]);
    assert.equal(await prisma.refund.count({ where: { orderId } }), 1);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, "REFUNDED");
    assert.equal(await prisma.payment.count({ where: { orderId, status: "REFUNDED" } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: orderId, action: "ORDER_PARTIALLY_OR_FULLY_REFUNDED" } }), 1);

    const returnAttempts = await Promise.all([
      request(`/api/orders/${orderId}/returns`, { items: [{ orderLineId: lineId, quantity: 1, condition: "PREPARED", disposition: "WASTE", reason: "Prepared drink returned" }] }),
      request(`/api/orders/${orderId}/returns`, { items: [{ orderLineId: lineId, quantity: 1, condition: "PREPARED", disposition: "WASTE", reason: "Competing return" }] }),
    ]);
    const returnStatuses = returnAttempts.map((response) => response.status).sort();
    assert.deepEqual(returnStatuses, [201, 409]);
    assert.equal(await prisma.orderLineReturn.count({ where: { orderId, orderLineId: lineId } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: orderId, action: "ORDER_ITEMS_RETURN_RECORDED" } }), 1);

    const invalidCheckout = await request("/api/checkout", {
      ...checkoutBody, idempotencyKey: `api-it-invalid-${suffix}`,
      paymentTenders: [{ method: "OTHER", amountMinor: 999 }],
    });
    await expectStatus(invalidCheckout, 400);
    assert.equal(await prisma.order.count({ where: { cashierId: userId } }), 1);
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => server!.once("exit", () => resolve())),
        delay(5000),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    await prisma.refund.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.orderLineReturn.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.payment.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.order.deleteMany({ where: { cashierId: userId } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: [userId, cashierId] } } });
    if (createdTableId) {
      await prisma.auditEvent.deleteMany({ where: { entityId: createdTableId } });
      await prisma.diningTable.deleteMany({ where: { id: createdTableId } });
    }
    if (createdCashierShiftId) {
      await prisma.cashMovement.deleteMany({ where: { shiftId: createdCashierShiftId } });
      await prisma.auditEvent.deleteMany({ where: { entityId: createdCashierShiftId } });
      await prisma.shift.deleteMany({ where: { id: createdCashierShiftId } });
    }
    await prisma.cashMovement.deleteMany({ where: { shiftId } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, cashierId] } } });
    await prisma.$disconnect();
  }
});
