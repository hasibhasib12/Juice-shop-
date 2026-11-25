import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, scryptSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { prisma } from "../lib/prisma";

const enabled = process.env.POS_TEST_DATABASE === "1";
const port = 3188;
const baseUrl = `http://127.0.0.1:${port}`;

function passwordHash(password: string) {
  const salt = randomUUID().replaceAll("-", "");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

async function expectStatus(response: Response, expected: number) {
  if (response.status !== expected) {
    throw new Error(`Expected HTTP ${expected}, received ${response.status}: ${await response.text()}`);
  }
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

test("POS purchasing API: invoice authorization and purchase-order line boundaries", {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const suffix = randomUUID();
  const userId = `purchasing-it-cashier-${suffix}`;
  const supplierId = `purchasing-it-supplier-${suffix}`;
  const ingredientId = `purchasing-it-ingredient-${suffix}`;
  const orderAId = `purchasing-it-order-a-${suffix}`;
  const orderBId = `purchasing-it-order-b-${suffix}`;
  const lineAId = `purchasing-it-line-a-${suffix}`;
  const lineBId = `purchasing-it-line-b-${suffix}`;
  const password = `Integration-${randomUUID()}-Pass`;
  const invoiceNumber = `PURCH-IT-${suffix}`;
  let server: ChildProcess | undefined;

  try {
    await prisma.user.create({ data: {
      branch: { connect: { code: "MAIN" } },
      id: userId,
      name: "Purchasing Integration Cashier",
      email: `${suffix}@purchasing-integration.invalid`,
      passwordHash: passwordHash(password),
      role: "CASHIER",
      permissionOverrides: { MANAGE_PURCHASING: false },
    } });
    await prisma.supplier.create({ data: { id: supplierId, name: `Purchasing Integration Supplier ${suffix}` } });
    await prisma.ingredient.create({ data: {
      id: ingredientId,
      name: `Purchasing Integration Ingredient ${suffix}`,
      unit: "kg",
      quantityOnHand: "50.000",
    } });
    for (const [orderId, lineId] of [[orderAId, lineAId], [orderBId, lineBId]]) {
      await prisma.purchaseOrder.create({ data: {
        id: orderId,
        supplierId,
        createdById: userId,
        status: "RECEIVED",
        currency: "AFN",
        subtotalMinor: 1000,
        lines: { create: {
          id: lineId,
          ingredientId,
          ingredientName: "Purchasing Integration Ingredient",
          quantity: "10.000",
          receivedQuantity: "10.000",
          unitCostMinor: 100,
          lineTotalMinor: 1000,
        } },
      } });
    }

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "ignore",
    });
    await waitForServer(server);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${suffix}@purchasing-integration.invalid`, password }),
    });
    await expectStatus(login, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(cookie.includes("juice_shop_session="));

    const post = (body: unknown) => fetch(`${baseUrl}/api/admin/supplier-invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

    const deniedInvoice = await post({
      action: "invoice", purchaseOrderId: orderAId, invoiceNumber,
      invoiceDate: new Date().toISOString(),
      lines: [{ purchaseOrderLineId: lineAId, quantity: "2", unitCostMinor: 100 }],
    });
    await expectStatus(deniedInvoice, 403);
    const deniedPayment = await post({
      action: "payment", invoiceId: "not-authorized", amountMinor: 100, method: "OTHER",
    });
    await expectStatus(deniedPayment, 403);
    assert.equal(await prisma.supplierInvoice.count({ where: { purchaseOrderId: { in: [orderAId, orderBId] } } }), 0);
    assert.equal(await prisma.supplierPayment.count({ where: { invoice: { purchaseOrderId: { in: [orderAId, orderBId] } } } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: { userId, action: { in: ["SUPPLIER_INVOICE_CREATED", "SUPPLIER_PAYMENT_RECORDED"] } } }), 0);

    await prisma.user.update({ where: { id: userId }, data: { permissionOverrides: { MANAGE_PURCHASING: true } } });

    const crossOrderLine = await post({
      action: "invoice", purchaseOrderId: orderAId, invoiceNumber: `${invoiceNumber}-CROSS`,
      invoiceDate: new Date().toISOString(),
      lines: [{ purchaseOrderLineId: lineBId, quantity: "2", unitCostMinor: 100 }],
    });
    await expectStatus(crossOrderLine, 409);
    assert.equal(await prisma.supplierInvoice.count({ where: { purchaseOrderId: orderAId } }), 0,
      "a line belonging to another purchase order must not be invoiced against this order");
    assert.equal(await prisma.auditEvent.count({ where: { userId, action: "SUPPLIER_INVOICE_CREATED" } }), 0,
      "rejected cross-order invoice must not write an audit event");

    const invoiceResponse = await post({
      action: "invoice", purchaseOrderId: orderAId, invoiceNumber,
      invoiceDate: new Date().toISOString(),
      lines: [{ purchaseOrderLineId: lineAId, quantity: "2", unitCostMinor: 100 }],
    });
    await expectStatus(invoiceResponse, 201);
    const invoiceJson = await invoiceResponse.json() as { invoice: { id: string; totalMinor: number } };
    assert.equal(invoiceJson.invoice.totalMinor, 200);
    const invoiceId = invoiceJson.invoice.id;
    assert.equal(await prisma.auditEvent.count({
      where: { userId, entityId: invoiceId, action: "SUPPLIER_INVOICE_CREATED" },
    }), 1);

    const paymentResponse = await post({
      action: "payment", invoiceId, amountMinor: 100, method: "BANK_TRANSFER", reference: "integration-payment",
    });
    await expectStatus(paymentResponse, 201);
    assert.equal(await prisma.supplierPayment.count({ where: { invoiceId } }), 1);
    assert.equal(await prisma.auditEvent.count({
      where: { userId, entityId: invoiceId, action: "SUPPLIER_PAYMENT_RECORDED" },
    }), 1);
    assert.equal((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, "PARTIALLY_PAID");

    const overpayment = await post({
      action: "payment", invoiceId, amountMinor: 101, method: "BANK_TRANSFER", reference: "integration-overpayment",
    });
    await expectStatus(overpayment, 409);
    assert.equal(await prisma.supplierPayment.count({ where: { invoiceId } }), 1,
      "a payment above the outstanding balance must not create another payment");
    assert.equal(await prisma.auditEvent.count({
      where: { userId, entityId: invoiceId, action: "SUPPLIER_PAYMENT_RECORDED" },
    }), 1, "rejected overpayment must not write an audit event");
    assert.equal((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, "PARTIALLY_PAID");
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
      where: { purchaseOrderId: { in: [orderAId, orderBId] } },
      select: { id: true },
    })).map((invoice) => invoice.id);
    await prisma.auditEvent.deleteMany({
      where: { OR: [
        { entityId: { in: invoiceIds } },
        { userId, action: { in: ["SUPPLIER_INVOICE_CREATED", "SUPPLIER_PAYMENT_RECORDED"] } },
      ] },
    });
    await prisma.supplierPayment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: [orderAId, orderBId] } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: [orderAId, orderBId] } } });
    await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});
