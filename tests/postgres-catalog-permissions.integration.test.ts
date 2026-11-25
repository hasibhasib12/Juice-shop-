import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, scryptSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { prisma } from "../lib/prisma";

const enabled = process.env.POS_TEST_DATABASE === "1";
const port = 3190;
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

test("POS catalogue API: persisted MANAGE_CATALOG permission gates product and category lifecycle", {
  skip: !enabled,
  timeout: 180_000,
}, async () => {
  const suffix = randomUUID();
  const userId = `catalog-it-cashier-${suffix}`;
  const email = `${suffix}@catalog-integration.invalid`;
  const password = `Integration-${randomUUID()}-Pass`;
  const baseCategoryId = `catalog-it-base-category-${suffix}`;
  const productId = `catalog-it-product-${suffix}`;
  const categoryName = `Catalog Integration ${suffix}`;
  const productName = `Catalog Product ${suffix}`;
  let createdCategoryId: string | undefined;
  let server: ChildProcess | undefined;

  try {
    await prisma.user.create({ data: {
      id: userId,
      name: "Catalogue Integration Cashier",
      email,
      passwordHash: passwordHash(password),
      role: "CASHIER",
      permissionOverrides: { MANAGE_CATALOG: false },
    } });
    await prisma.category.create({ data: { id: baseCategoryId, name: categoryName } });
    await prisma.product.create({ data: {
      id: productId,
      name: productName,
      priceMinor: 100,
      currency: "AFN",
      categoryId: baseCategoryId,
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

    const request = (path: string, method: string, body?: unknown) => fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const deniedRead = await request("/api/admin/products", "GET");
    await expectStatus(deniedRead, 403);
    const deniedProductCreate = await request("/api/admin/products", "POST", {
      name: "Denied product", categoryId: baseCategoryId, priceMinor: 100, currency: "AFN",
    });
    await expectStatus(deniedProductCreate, 403);
    const deniedProductUpdate = await request(`/api/admin/products/${productId}`, "PATCH", { name: "Unauthorized rename" });
    await expectStatus(deniedProductUpdate, 403);
    const deniedProductArchive = await request(`/api/admin/products/${productId}`, "DELETE");
    await expectStatus(deniedProductArchive, 403);
    const deniedCategoryCreate = await request("/api/admin/categories", "POST", { name: `Denied ${suffix}` });
    await expectStatus(deniedCategoryCreate, 403);
    const deniedCategoryUpdate = await request("/api/admin/categories", "PATCH", { id: baseCategoryId, name: "Unauthorized category rename" });
    await expectStatus(deniedCategoryUpdate, 403);
    const deniedCategoryArchive = await request("/api/admin/categories", "DELETE", { id: baseCategoryId });
    await expectStatus(deniedCategoryArchive, 403);

    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).name, productName);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: baseCategoryId } })).active, true);
    assert.equal(await prisma.category.count({ where: { name: `Denied ${suffix}` } }), 0);
    assert.equal(await prisma.auditEvent.count({
      where: { userId, action: { in: ["PRODUCT_CREATED", "PRODUCT_UPDATED", "PRODUCT_ARCHIVED", "CATEGORY_CREATED", "CATEGORY_UPDATED", "CATEGORY_ARCHIVED"] } },
    }), 0);

    await prisma.user.update({
      where: { id: userId },
      data: { permissionOverrides: { MANAGE_CATALOG: true } },
    });

    const grantedRead = await request("/api/admin/products", "GET");
    await expectStatus(grantedRead, 200);
    const grantedCreateCategory = await request("/api/admin/categories", "POST", { name: `Granted ${suffix}`, sortOrder: 5 });
    await expectStatus(grantedCreateCategory, 201);
    const createdCategory = await grantedCreateCategory.json() as { category: { id: string } };
    createdCategoryId = createdCategory.category.id;

    const grantedCreateProduct = await request("/api/admin/products", "POST", {
      name: `Granted Product ${suffix}`, categoryId: createdCategoryId, priceMinor: 250, currency: "AFN",
    });
    await expectStatus(grantedCreateProduct, 201);
    const createdProduct = await grantedCreateProduct.json() as { product: { id: string } };
    const grantedProductId = createdProduct.product.id;

    const grantedUpdateProduct = await request(`/api/admin/products/${grantedProductId}`, "PATCH", { name: `Updated Product ${suffix}` });
    await expectStatus(grantedUpdateProduct, 200);
    const grantedArchiveProduct = await request(`/api/admin/products/${grantedProductId}`, "DELETE");
    await expectStatus(grantedArchiveProduct, 200);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: grantedProductId } })).status, "ARCHIVED");

    const grantedUpdateCategory = await request("/api/admin/categories", "PATCH", { id: createdCategoryId, name: `Updated Category ${suffix}` });
    await expectStatus(grantedUpdateCategory, 200);
    const grantedArchiveCategory = await request("/api/admin/categories", "DELETE", { id: createdCategoryId });
    await expectStatus(grantedArchiveCategory, 200);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: createdCategoryId } })).active, false);

    for (const [action, entityId] of [
      ["CATEGORY_CREATED", createdCategoryId],
      ["CATEGORY_UPDATED", createdCategoryId],
      ["CATEGORY_ARCHIVED", createdCategoryId],
      ["PRODUCT_CREATED", grantedProductId],
      ["PRODUCT_UPDATED", grantedProductId],
      ["PRODUCT_ARCHIVED", grantedProductId],
    ] as const) {
      assert.equal(await prisma.auditEvent.count({ where: { userId, entityId, action } }), 1,
        `${action} must be recorded exactly once for the authorized mutation`);
    }

    await prisma.user.update({
      where: { id: userId },
      data: { permissionOverrides: { MANAGE_CATALOG: false } },
    });
    const deniedAfterRevoke = await request(`/api/admin/products/${productId}`, "PATCH", { name: "Revoked rename" });
    await expectStatus(deniedAfterRevoke, 403);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).name, productName);
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => server!.once("exit", () => resolve())),
        delay(5000),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    const productIds = [productId];
    if (createdCategoryId) {
      const createdProducts = await prisma.product.findMany({ where: { categoryId: createdCategoryId }, select: { id: true } });
      productIds.push(...createdProducts.map((product) => product.id));
    }
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...productIds, baseCategoryId, ...(createdCategoryId ? [createdCategoryId] : [])] } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (createdCategoryId) await prisma.category.deleteMany({ where: { id: createdCategoryId } });
    await prisma.category.deleteMany({ where: { id: baseCategoryId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
});
