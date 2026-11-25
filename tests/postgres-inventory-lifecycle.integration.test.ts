import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, scryptSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { prisma } from "../lib/prisma";

const enabled = process.env.POS_TEST_DATABASE === "1";
const port = 3189;
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

test("POS inventory API: permission, stock lifecycle and rejected-write safety", {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const suffix = randomUUID();
  const userId = `inventory-it-manager-${suffix}`;
  const email = `${suffix}@inventory-integration.invalid`;
  const password = `Integration-${randomUUID()}-Pass`;
  const ingredientName = `Inventory Integration ${suffix}`;
  let ingredientId: string | undefined;
  let server: ChildProcess | undefined;

  try {
    await prisma.user.create({ data: {
      id: userId,
      name: "Inventory Integration Manager",
      email,
      passwordHash: passwordHash(password),
      role: "CASHIER",
      permissionOverrides: { MANAGE_INVENTORY: false },
    } });

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "ignore",
    });
    await waitForServer(server);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await expectStatus(login, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(cookie.includes("juice_shop_session="));

    const post = (body: unknown) => fetch(`${baseUrl}/api/admin/inventory`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

    const openingMovementCountBeforeDenied = await prisma.stockMovement.count({ where: { reason: "Opening stock" } });
    const deniedCreate = await post({
      action: "create", name: ingredientName, unit: "kg", openingQuantity: "10", reorderLevel: "2",
    });
    await expectStatus(deniedCreate, 403);
    assert.equal(await prisma.ingredient.count({ where: { name: ingredientName } }), 0);
    assert.equal(await prisma.stockMovement.count({ where: { reason: "Opening stock" } }), openingMovementCountBeforeDenied);
    assert.equal(await prisma.auditEvent.count({ where: { userId, action: "INGREDIENT_CREATED" } }), 0);

    await prisma.user.update({
      where: { id: userId },
      data: { permissionOverrides: { MANAGE_INVENTORY: true } },
    });

    const create = await post({
      action: "create", name: ingredientName, unit: "kg", openingQuantity: "10", reorderLevel: "2",
    });
    await expectStatus(create, 201);
    const created = await create.json() as { ingredient: { id: string; quantityOnHand: string | number } };
    ingredientId = created.ingredient.id;
    assert.equal(Number(created.ingredient.quantityOnHand), 10);
    assert.equal(await prisma.stockMovement.count({ where: { ingredientId, type: "PURCHASE" } }), 1);
    assert.equal(await prisma.auditEvent.count({
      where: { userId, entityId: ingredientId, action: "INGREDIENT_CREATED" },
    }), 1);

    const purchase = await post({
      action: "movement", ingredientId, type: "PURCHASE", quantity: "5", reason: "Supplier delivery",
    });
    await expectStatus(purchase, 200);
    assert.equal(Number((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).quantityOnHand), 15);

    const waste = await post({
      action: "movement", ingredientId, type: "WASTE", quantity: "3", reason: "Spoilage",
    });
    await expectStatus(waste, 200);
    assert.equal(Number((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).quantityOnHand), 12);

    const movementCountBeforeInvalid = await prisma.stockMovement.count({ where: { ingredientId } });
    const auditCountBeforeInvalid = await prisma.auditEvent.count({
      where: { userId, entityId: ingredientId, action: "STOCK_MOVEMENT_RECORDED" },
    });
    const overdraw = await post({
      action: "movement", ingredientId, type: "WASTE", quantity: "13", reason: "Must not overdraw",
    });
    await expectStatus(overdraw, 409);
    assert.equal(Number((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).quantityOnHand), 12);
    assert.equal(await prisma.stockMovement.count({ where: { ingredientId } }), movementCountBeforeInvalid);
    assert.equal(await prisma.auditEvent.count({
      where: { userId, entityId: ingredientId, action: "STOCK_MOVEMENT_RECORDED" },
    }), auditCountBeforeInvalid);

    const invalidQuantity = await post({
      action: "movement", ingredientId, type: "PURCHASE", quantity: "-1", reason: "Invalid negative purchase",
    });
    await expectStatus(invalidQuantity, 400);
    assert.equal(Number((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).quantityOnHand), 12);
    assert.equal(await prisma.stockMovement.count({ where: { ingredientId } }), movementCountBeforeInvalid);
    assert.equal(await prisma.auditEvent.count({
      where: { userId, entityId: ingredientId, action: "STOCK_MOVEMENT_RECORDED" },
    }), auditCountBeforeInvalid);

    const adjustment = await post({
      action: "movement", ingredientId, type: "ADJUSTMENT", quantity: "8", reason: "Physical stock count",
    });
    await expectStatus(adjustment, 200);
    assert.equal(Number((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).quantityOnHand), 8);
    const adjustmentMovement = await prisma.stockMovement.findFirstOrThrow({
      where: { ingredientId, type: "ADJUSTMENT" },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(Number(adjustmentMovement.quantity), -4);

    await prisma.user.update({
      where: { id: userId },
      data: { permissionOverrides: { MANAGE_INVENTORY: false } },
    });
    const movementCountBeforeRevoked = await prisma.stockMovement.count({ where: { ingredientId } });
    const auditCountBeforeRevoked = await prisma.auditEvent.count({
      where: { userId, entityId: ingredientId, action: "STOCK_MOVEMENT_RECORDED" },
    });
    const revokedMovement = await post({
      action: "movement", ingredientId, type: "PURCHASE", quantity: "100", reason: "Revoked permission",
    });
    await expectStatus(revokedMovement, 403);
    assert.equal(Number((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).quantityOnHand), 8);
    assert.equal(await prisma.stockMovement.count({ where: { ingredientId } }), movementCountBeforeRevoked);
    assert.equal(await prisma.auditEvent.count({
      where: { userId, entityId: ingredientId, action: "STOCK_MOVEMENT_RECORDED" },
    }), auditCountBeforeRevoked);
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => server!.once("exit", () => resolve())),
        delay(5000),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    if (ingredientId) {
      await prisma.auditEvent.deleteMany({ where: { entityId: ingredientId } });
      await prisma.stockMovement.deleteMany({ where: { ingredientId } });
      await prisma.ingredient.deleteMany({ where: { id: ingredientId } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});
