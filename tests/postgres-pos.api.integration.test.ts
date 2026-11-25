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
  let createdCategoryId: string | undefined;
  let createdCashierShiftId: string | undefined;
  const categoryId = `api-it-category-${suffix}`;
  const productId = `api-it-product-${suffix}`;
  const ingredientId = `api-it-ingredient-${suffix}`;
  const shiftId = `api-it-shift-${suffix}`;
  const supplierId = `api-it-supplier-${suffix}`;
  const purchaseOrderId = `api-it-po-${suffix}`;
  const purchaseLineId = `api-it-po-line-${suffix}`;
  const invoiceNumber = `API-INV-${suffix}`;
  const password = `Integration-${randomUUID()}-Pass`;
  let server: ChildProcess | undefined;
  let serverOutput = "";

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
    await prisma.ingredient.create({ data: { id: ingredientId, name: "Private integration ingredient", unit: "ml", quantityOnHand: "1000.000" } });
    await prisma.product.create({ data: {
      id: productId, name: "API Integration Juice", priceMinor: 1000,
      currency: "AFN", categoryId,
      variants: { create: { name: "Large", priceMinor: 1500, recipeItems: { create: { ingredientId, quantity: "250.000" } } } },
    } });
    await prisma.shift.create({ data: { id: shiftId, userId, openingCashMinor: 500 } });
    await prisma.supplier.create({ data: { id: supplierId, name: `API Integration Supplier ${suffix}` } });
    await prisma.purchaseOrder.create({ data: {
      id: purchaseOrderId, supplierId, createdById: userId, status: "RECEIVED",
      currency: "AFN", subtotalMinor: 1000,
      lines: { create: {
        id: purchaseLineId, ingredientId, ingredientName: "Private integration ingredient",
        quantity: "10.000", receivedQuantity: "10.000", unitCostMinor: 100,
        lineTotalMinor: 1000,
      } },
    } });

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const captureServerOutput = (chunk: Buffer) => {
      serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12000);
    };
    server.stdout?.on("data", captureServerOutput);
    server.stderr?.on("data", captureServerOutput);
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

    const settingsResponse = await fetch(`${baseUrl}/api/settings`);
    await expectStatus(settingsResponse, 200);
    const settingsJson = await settingsResponse.json() as { settings: { currency: string; countryCode: string; countryName: string; timezone: string; locale: string; taxRateBps: number; taxLabel: string; maxDiscountPercentBps: number } };
    const requestedCurrency = settingsJson.settings.currency === "USD" ? "AFN" : "USD";
    const blockedCurrencyChange = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...settingsJson.settings, currency: requestedCurrency }),
    });
    await expectStatus(blockedCurrencyChange, 409);

    const cashierLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `cashier-${suffix}@api-integration.invalid`, password }),
    });
    await expectStatus(cashierLogin, 200);
    const cashierCookie = cashierLogin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(cashierCookie.includes("juice_shop_session="));

    const cashierInventoryRead = await fetch(`${baseUrl}/api/admin/inventory`, { headers: { cookie: cashierCookie } });
    await expectStatus(cashierInventoryRead, 403);
    const cashierSupplierRead = await fetch(`${baseUrl}/api/admin/suppliers`, { headers: { cookie: cashierCookie } });
    await expectStatus(cashierSupplierRead, 403);
    const cashierPurchaseOrderRead = await fetch(`${baseUrl}/api/admin/purchase-orders`, { headers: { cookie: cashierCookie } });
    await expectStatus(cashierPurchaseOrderRead, 403);
    const cashierInvoiceRead = await fetch(`${baseUrl}/api/admin/supplier-invoices`, { headers: { cookie: cashierCookie } });
    await expectStatus(cashierInvoiceRead, 403);
    for (const [path, method] of [
      ["/api/admin/inventory", "POST"],
      ["/api/admin/suppliers", "POST"],
      ["/api/admin/purchase-orders", "POST"],
      ["/api/admin/supplier-invoices", "POST"],
    ] as const) {
      const deniedMutation = await fetch(`${baseUrl}${path}`, {
        method, headers: { "content-type": "application/json", cookie: cashierCookie },
        body: JSON.stringify({}),
      });
      await expectStatus(deniedMutation, 403);
    }

    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_INVENTORY: true } } });
    const grantedInventoryRead = await fetch(`${baseUrl}/api/admin/inventory`, { headers: { cookie: cashierCookie } });
    await expectStatus(grantedInventoryRead, 200);
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_INVENTORY: false } } });
    const revokedInventoryRead = await fetch(`${baseUrl}/api/admin/inventory`, { headers: { cookie: cashierCookie } });
    await expectStatus(revokedInventoryRead, 403);

    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_PURCHASING: true } } });
    for (const path of ["/api/admin/suppliers", "/api/admin/purchase-orders", "/api/admin/supplier-invoices"]) {
      const grantedRead = await fetch(`${baseUrl}${path}`, { headers: { cookie: cashierCookie } });
      await expectStatus(grantedRead, 200);
    }
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_PURCHASING: false } } });
    for (const path of ["/api/admin/suppliers", "/api/admin/purchase-orders", "/api/admin/supplier-invoices"]) {
      const revokedRead = await fetch(`${baseUrl}${path}`, { headers: { cookie: cashierCookie } });
      await expectStatus(revokedRead, 403);
    }

    const cashierSettingsWrite = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT", headers: { "content-type": "application/json", cookie: cashierCookie },
      body: JSON.stringify(settingsJson.settings),
    });
    await expectStatus(cashierSettingsWrite, 403);
    assert.equal(await prisma.auditEvent.count({ where: { userId: cashierId, action: "STORE_SETTINGS_UPDATED" } }), 0,
      "cashier must not write store settings");

    const cashierShiftRead = await fetch(`${baseUrl}/api/shifts`, { headers: { cookie: cashierCookie } });
    await expectStatus(cashierShiftRead, 200);
    const cashierShiftJson = await cashierShiftRead.json() as { shift: { id: string } | null };
    assert.equal(cashierShiftJson.shift, null, "cashier must not see another user's active shift");

    const cashierCloseOwnerShift = await fetch(`${baseUrl}/api/shifts/close`, {
      method: "POST", headers: { "content-type": "application/json", cookie: cashierCookie },
      body: JSON.stringify({ closingCashMinor: 500 }),
    });
    await expectStatus(cashierCloseOwnerShift, 409);
    assert.equal((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).closedAt, null,
      "cashier must not close another user's shift");
    const cashierCashMovement = await fetch(`${baseUrl}/api/shifts/movements`, {
      method: "POST", headers: { "content-type": "application/json", cookie: cashierCookie },
      body: JSON.stringify({ type: "PAID_IN", amountMinor: 100, reason: "Unauthorized shift test" }),
    });
    await expectStatus(cashierCashMovement, 409);
    assert.equal(await prisma.cashMovement.count({ where: { userId: cashierId } }), 0,
      "cashier without an open shift must not create a cash movement");

    const categoryCreate = await fetch(`${baseUrl}/api/admin/categories`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: `Audit Integration ${suffix}`, sortOrder: 17 }),
    });
    await expectStatus(categoryCreate, 201);
    const categoryCreateJson = await categoryCreate.json() as { category: { id: string } };
    createdCategoryId = categoryCreateJson.category.id;
    assert.equal(await prisma.auditEvent.count({ where: { entityId: createdCategoryId, action: "CATEGORY_CREATED", userId } }), 1);

    const categoryUpdate = await fetch(`${baseUrl}/api/admin/categories`, {
      method: "PATCH", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id: createdCategoryId, name: `Updated Audit ${suffix}` }),
    });
    await expectStatus(categoryUpdate, 200);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: createdCategoryId, action: "CATEGORY_UPDATED", userId } }), 1);

    const categoryArchive = await fetch(`${baseUrl}/api/admin/categories`, {
      method: "DELETE", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ id: createdCategoryId }),
    });
    await expectStatus(categoryArchive, 200);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: createdCategoryId, action: "CATEGORY_ARCHIVED", userId } }), 1);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: createdCategoryId } })).active, false);


    const request = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

    const invoiceRequests = await Promise.all([
      request("/api/admin/supplier-invoices", {
        action: "invoice", purchaseOrderId, invoiceNumber,
        invoiceDate: new Date().toISOString(), lines: [{
          purchaseOrderLineId: purchaseLineId, quantity: "10", unitCostMinor: 100,
        }],
      }),
      request("/api/admin/supplier-invoices", {
        action: "invoice", purchaseOrderId, invoiceNumber: `${invoiceNumber}-RACE2`,
        invoiceDate: new Date().toISOString(), lines: [{
          purchaseOrderLineId: purchaseLineId, quantity: "10", unitCostMinor: 100,
        }],
      }),
    ]);
    assert.deepEqual(invoiceRequests.map((response) => response.status).sort(), [201, 409]);
    const invoiceResponse = invoiceRequests.find((response) => response.status === 201)!;
    const invoiceJson = await invoiceResponse.json() as { invoice: { id: string; totalMinor: number } };
    assert.equal(invoiceJson.invoice.totalMinor, 1000);
    const invoiceId = invoiceJson.invoice.id;
    const concurrentSupplierPayments = await Promise.all([
      request("/api/admin/supplier-invoices", { action: "payment", invoiceId, amountMinor: 600, method: "BANK_TRANSFER", reference: "integration-race-a" }),
      request("/api/admin/supplier-invoices", { action: "payment", invoiceId, amountMinor: 600, method: "BANK_TRANSFER", reference: "integration-race-b" }),
    ]);
    assert.deepEqual(concurrentSupplierPayments.map((response) => response.status).sort(), [201, 409]);
    const supplierPayments = await prisma.supplierPayment.findMany({ where: { invoiceId } });
    assert.equal(supplierPayments.length, 1);
    assert.equal(supplierPayments.reduce((sum, payment) => sum + payment.amountMinor, 0), 600);
    assert.equal((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, "PARTIALLY_PAID");
    assert.equal(await prisma.auditEvent.count({ where: { entityId: invoiceId, action: "SUPPLIER_PAYMENT_RECORDED", userId } }), 1);


    const cashierRequest = (path: string, body: unknown, method = "POST") => fetch(`${baseUrl}${path}`, {
      method, headers: { "content-type": "application/json", cookie: cashierCookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const deniedPurchasingRead = await cashierRequest("/api/admin/supplier-invoices", undefined, "GET");
    await expectStatus(deniedPurchasingRead, 403);
    const deniedPurchasingWrite = await cashierRequest("/api/admin/supplier-invoices", {
      action: "payment", invoiceId: "not-authorized", amountMinor: 1, method: "OTHER",
    });
    await expectStatus(deniedPurchasingWrite, 403);
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_PURCHASING: true } } });
    const grantedPurchasingRead = await cashierRequest("/api/admin/supplier-invoices", undefined, "GET");
    await expectStatus(grantedPurchasingRead, 200);
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { MANAGE_PURCHASING: false } } });
    const revokedPurchasingRead = await cashierRequest("/api/admin/supplier-invoices", undefined, "GET");
    await expectStatus(revokedPurchasingRead, 403);
    const crossOriginSupplierWrite = await fetch(`${baseUrl}/api/admin/suppliers`, {
      method: "POST",
      headers: {
        "content-type": "application/json", cookie,
        origin: "https://attacker.invalid", "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ name: "Cross-origin attempt" }),
    });
    await expectStatus(crossOriginSupplierWrite, 403);
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
    const shiftOpenedEvent = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: createdCashierShiftId, action: "SHIFT_OPENED", userId: cashierId },
      select: { details: true },
    });
    assert.equal((shiftOpenedEvent.details as { currency?: string } | null)?.currency, settingsJson.settings.currency);
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

    const checkoutItems = [{
      productId, variantId: (await prisma.productVariant.findFirstOrThrow({ where: { productId } })).id, quantity: 1,
    }];
    const draftCreate = await request("/api/orders/drafts", {
      items: checkoutItems, customerName: "Draft Customer", notes: "Saved before payment",
    });
    if (draftCreate.status !== 201) {
      throw new Error(`Draft creation failed (${draftCreate.status}): ${await draftCreate.text()}\\nRecent Next.js server output:\\n${serverOutput}`);
    }
    const draftCreateJson = await draftCreate.json() as { draft: { id: string; status: string; totalMinor: number } };
    const draftId = draftCreateJson.draft.id;
    assert.equal(draftCreateJson.draft.status, "DRAFT");
    assert.equal(draftCreateJson.draft.totalMinor, 1500);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: draftId, action: "ORDER_DRAFT_CREATED", userId } }), 1);

    const listedDrafts = await fetch(`${baseUrl}/api/orders/drafts`, { headers: { cookie } });
    await expectStatus(listedDrafts, 200);
    const listedDraftsJson = await listedDrafts.json() as { drafts: { id: string }[] };
    assert.equal(listedDraftsJson.drafts.some((draft) => draft.id === draftId), true);
    const cashierDraftList = await cashierRequest("/api/orders/drafts", undefined, "GET");
    await expectStatus(cashierDraftList, 200);
    const cashierDraftListJson = await cashierDraftList.json() as { drafts: { id: string }[] };
    assert.equal(cashierDraftListJson.drafts.some((draft) => draft.id === draftId), false);

    const forbiddenDraftEdit = await cashierRequest("/api/orders/drafts", {
      id: draftId, items: checkoutItems, customerName: "Unauthorized edit",
    });
    await expectStatus(forbiddenDraftEdit, 403);
    const forbiddenDraftDelete = await fetch(`${baseUrl}/api/orders/drafts?id=${encodeURIComponent(draftId)}`, {
      method: "DELETE", headers: { cookie: cashierCookie },
    });
    await expectStatus(forbiddenDraftDelete, 404);

    const draftUpdate = await request("/api/orders/drafts", {
      id: draftId, items: checkoutItems, customerName: "Updated Draft Customer", notes: "Reviewed before checkout",
    });
    await expectStatus(draftUpdate, 200);
    const draftUpdateJson = await draftUpdate.json() as { draft: { customerName: string; notes: string } };
    assert.equal(draftUpdateJson.draft.customerName, "Updated Draft Customer");
    assert.equal(draftUpdateJson.draft.notes, "Reviewed before checkout");
    assert.equal(await prisma.auditEvent.count({ where: { entityId: draftId, action: "ORDER_DRAFT_UPDATED", userId } }), 1);

    const checkoutBody = {
      items: checkoutItems,
      paymentTenders: [{ method: "OTHER", amountMinor: 1500 }],
      idempotencyKey: `api-it-key-${suffix}`,
      customerName: "API Integration Customer",
      notes: "End-to-end test",
      draftId,
    };
    const checkout = await request("/api/checkout", checkoutBody);
    await expectStatus(checkout, 201);
    const checkoutJson = await checkout.json() as { order: { id: string; totalMinor: number; lines: Array<{ id: string; quantity: number }> } };
    assert.equal(checkoutJson.order.totalMinor, 1500);
    assert.equal(checkoutJson.order.lines.length, 1);
    const orderId = checkoutJson.order.id;
    const lineId = checkoutJson.order.lines[0].id;

    const cashierOwnOrders = await cashierRequest("/api/orders", undefined, "GET");
    await expectStatus(cashierOwnOrders, 200);
    const cashierOwnOrdersJson = await cashierOwnOrders.json() as { orders: { id: string }[] };
    assert.equal(cashierOwnOrdersJson.orders.some((order) => order.id === orderId), false);
    const deniedForeignOrder = await cashierRequest(`/api/orders/${orderId}`, undefined, "GET");
    await expectStatus(deniedForeignOrder, 403);
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { VIEW_ALL_ORDERS: true } } });
    const grantedAllOrders = await cashierRequest("/api/orders", undefined, "GET");
    await expectStatus(grantedAllOrders, 200);
    const grantedAllOrdersJson = await grantedAllOrders.json() as { orders: { id: string }[] };
    assert.equal(grantedAllOrdersJson.orders.some((order) => order.id === orderId), true);
    const grantedForeignOrder = await cashierRequest(`/api/orders/${orderId}`, undefined, "GET");
    await expectStatus(grantedForeignOrder, 200);
    await prisma.user.update({ where: { id: cashierId }, data: { permissionOverrides: { VIEW_ALL_ORDERS: false } } });
    const revokedAllOrders = await cashierRequest("/api/orders", undefined, "GET");
    await expectStatus(revokedAllOrders, 200);
    const revokedAllOrdersJson = await revokedAllOrders.json() as { orders: { id: string }[] };
    assert.equal(revokedAllOrdersJson.orders.some((order) => order.id === orderId), false);
    const revokedForeignOrder = await cashierRequest(`/api/orders/${orderId}`, undefined, "GET");
    await expectStatus(revokedForeignOrder, 403);

    const replay = await request("/api/checkout", checkoutBody);
    await expectStatus(replay, 201);
    const replayJson = await replay.json() as { order: { id: string } };
    assert.equal(replayJson.order.id, orderId);
    assert.equal(await prisma.order.count({ where: { idempotencyKey: checkoutBody.idempotencyKey } }), 1);
    assert.equal(await prisma.payment.count({ where: { orderId } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: orderId, action: "ORDER_COMPLETED" } }), 1);
    const convertedDraft = await prisma.order.findUniqueOrThrow({ where: { id: draftId } });
    assert.equal(convertedDraft.status, "COMPLETED");
    assert.equal(convertedDraft.id, orderId);
    const secondDraftConversion = await request("/api/checkout", {
      ...checkoutBody, idempotencyKey: `api-it-draft-replay-${suffix}`,
    });
    await expectStatus(secondDraftConversion, 409);
    assert.equal(await prisma.order.count({ where: { id: draftId } }), 1);
    assert.equal(await prisma.payment.count({ where: { orderId: draftId } }), 1);

    const refundAttempts = await Promise.all([
      request(`/api/orders/${orderId}/refund`, { kind: "REFUND", amountMinor: 1500, reason: "API integration full refund" }),
      request(`/api/orders/${orderId}/refund`, { kind: "REFUND", amountMinor: 1500, reason: "Competing API refund" }),
    ]);
    const refundStatuses = refundAttempts.map((response) => response.status).sort();
    assert.deepEqual(refundStatuses, [201, 409]);
    assert.equal(await prisma.refund.count({ where: { orderId } }), 1);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, "REFUNDED");
    assert.equal(await prisma.payment.count({ where: { orderId, status: "REFUNDED" } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: orderId, action: "ORDER_PARTIALLY_OR_FULLY_REFUNDED" } }), 1);

    const voidCheckout = await request("/api/checkout", {
      ...checkoutBody,
      idempotencyKey: `api-it-void-${suffix}`,
    });
    await expectStatus(voidCheckout, 201);
    const voidCheckoutJson = await voidCheckout.json() as { order: { id: string; totalMinor: number } };
    const voidOrderId = voidCheckoutJson.order.id;
    const voidResponse = await request(`/api/orders/${voidOrderId}/refund`, {
      kind: "VOID", amountMinor: voidCheckoutJson.order.totalMinor, reason: "API integration void",
    });
    await expectStatus(voidResponse, 201);
    const reportResponse = await fetch(`${baseUrl}/api/reports?period=day`, { headers: { cookie } });
    await expectStatus(reportResponse, 200);
    const report = await reportResponse.json() as {
      orderCount: number; refundCount: number; voidCount: number; voidTotalMinor: number;
      currencyBreakdown: { currency: string; orderCount: number; refundCount: number; voidCount: number; totalMinor: number; voidTotalMinor: number; topProducts: { quantity: number }[] }[];
    };
    assert.equal(report.orderCount, 1, "voided orders must not count as completed sales");
    assert.equal(report.refundCount, 1, "voids must not be classified as refunds");
    assert.equal(report.voidCount, 1);
    assert.equal(report.voidTotalMinor, 1500);
    assert.equal(report.currencyBreakdown.length, 1);
    assert.equal(report.currencyBreakdown[0].totalMinor, 0, "full refund leaves zero net sales");
    assert.equal(report.currencyBreakdown[0].voidCount, 1);
    assert.equal(report.currencyBreakdown[0].voidTotalMinor, 1500);
    assert.equal(report.currencyBreakdown[0].topProducts.reduce((sum, item) => sum + item.quantity, 0), 1, "voided order lines must not inflate product sales");

    const returnAttempts = await Promise.all([
      request(`/api/orders/${orderId}/returns`, { items: [{ orderLineId: lineId, quantity: 1, condition: "PREPARED", disposition: "WASTE", reason: "Prepared drink returned" }] }),
      request(`/api/orders/${orderId}/returns`, { items: [{ orderLineId: lineId, quantity: 1, condition: "PREPARED", disposition: "WASTE", reason: "Competing return" }] }),
    ]);
    const returnStatuses = returnAttempts.map((response) => response.status).sort();
    assert.deepEqual(returnStatuses, [201, 409]);
    assert.equal(await prisma.orderLineReturn.count({ where: { orderId, orderLineId: lineId } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { entityId: orderId, action: "ORDER_ITEMS_RETURN_RECORDED" } }), 1);

    const beforeCashFailure = {
      orders: await prisma.order.count({ where: { cashierId: userId } }),
      payments: await prisma.payment.count({ where: { order: { cashierId: userId } } }),
      movements: await prisma.stockMovement.count({ where: { ingredientId, type: "SALE" } }),
      completedAudits: await prisma.auditEvent.count({ where: { userId, action: "ORDER_COMPLETED" } }),
    };
    const insufficientCash = await request("/api/checkout", {
      ...checkoutBody, idempotencyKey: `api-it-cash-short-${suffix}`,
      paymentTenders: [{ method: "CASH", amountMinor: 1500 }], cashReceivedMinor: 1000,
    });
    await expectStatus(insufficientCash, 400);
    assert.deepEqual({
      orders: await prisma.order.count({ where: { cashierId: userId } }),
      payments: await prisma.payment.count({ where: { order: { cashierId: userId } } }),
      movements: await prisma.stockMovement.count({ where: { ingredientId, type: "SALE" } }),
      completedAudits: await prisma.auditEvent.count({ where: { userId, action: "ORDER_COMPLETED" } }),
    }, beforeCashFailure, "insufficient cash must not partially persist a checkout");

    const invalidCheckout = await request("/api/checkout", {
      ...checkoutBody, idempotencyKey: `api-it-invalid-${suffix}`,
      paymentTenders: [{ method: "OTHER", amountMinor: 999 }],
    });
    await expectStatus(invalidCheckout, 400);
    assert.deepEqual({
      orders: await prisma.order.count({ where: { cashierId: userId } }),
      payments: await prisma.payment.count({ where: { order: { cashierId: userId } } }),
      movements: await prisma.stockMovement.count({ where: { ingredientId, type: "SALE" } }),
      completedAudits: await prisma.auditEvent.count({ where: { userId, action: "ORDER_COMPLETED" } }),
    }, beforeCashFailure, "invalid tender must not partially persist a checkout");

    await prisma.ingredient.update({ where: { id: ingredientId }, data: { quantityOnHand: "0.000" } });
    const insufficientStock = await request("/api/checkout", {
      ...checkoutBody, idempotencyKey: `api-it-stock-short-${suffix}`,
    });
    await expectStatus(insufficientStock, 409);
    assert.deepEqual({
      orders: await prisma.order.count({ where: { cashierId: userId } }),
      payments: await prisma.payment.count({ where: { order: { cashierId: userId } } }),
      movements: await prisma.stockMovement.count({ where: { ingredientId, type: "SALE" } }),
      completedAudits: await prisma.auditEvent.count({ where: { userId, action: "ORDER_COMPLETED" } }),
    }, beforeCashFailure, "insufficient stock must roll back order, payment, stock movement and audit writes");
    assert.equal(await prisma.order.count({ where: { idempotencyKey: `api-it-stock-short-${suffix}` } }), 0,
      "failed checkout must not consume the idempotency key");
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => server!.once("exit", () => resolve())),
        delay(5000),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    const invoiceIds = (await prisma.supplierInvoice.findMany({
      where: { purchaseOrderId }, select: { id: true },
    })).map((row) => row.id);
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.supplierPayment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: purchaseOrderId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.refund.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.orderLineReturn.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.payment.deleteMany({ where: { order: { cashierId: userId } } });
    await prisma.order.deleteMany({ where: { cashierId: userId } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: [userId, cashierId] } } });
    if (createdCategoryId) await prisma.auditEvent.deleteMany({ where: { entityId: createdCategoryId } });
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
    await prisma.stockMovement.deleteMany({ where: { ingredientId } });
    await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    if (createdCategoryId) await prisma.category.deleteMany({ where: { id: createdCategoryId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, cashierId] } } });
    await prisma.$disconnect();
  }
});
