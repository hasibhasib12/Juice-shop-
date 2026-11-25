import assert from "node:assert/strict";
import test from "node:test";
import { effectivePermissions, hasPermission, normalizePermissionOverrides } from "../lib/permissions";

test("owner permissions cannot be reduced by overrides", () => {
  const p = effectivePermissions("OWNER", { VIEW_REPORTS: false, VIEW_ALL_ORDERS: false });
  assert.equal(p.VIEW_REPORTS, true);
  assert.equal(p.VIEW_ALL_ORDERS, true);
  assert.equal(p.PROCESS_REFUNDS, true);
});

test("manager defaults preserve existing operational access and all-order visibility", () => {
  const p = effectivePermissions("MANAGER", {});
  assert.equal(p.VIEW_REPORTS, true);
  assert.equal(p.VIEW_ALL_ORDERS, true);
  assert.equal(p.MANAGE_PURCHASING, true);
});

test("cashiers cannot view other cashiers' orders unless explicitly granted", () => {
  assert.equal(hasPermission("CASHIER", {}, "VIEW_ALL_ORDERS"), false);
  assert.equal(hasPermission("CASHIER", { VIEW_ALL_ORDERS: true }, "VIEW_ALL_ORDERS"), true);
  assert.equal(hasPermission("CASHIER", { VIEW_ALL_ORDERS: false }, "VIEW_ALL_ORDERS"), false);
});

test("cashiers are denied by default and can receive individual grants", () => {
  assert.equal(hasPermission("CASHIER", {}, "VIEW_REPORTS"), false);
  assert.equal(hasPermission("CASHIER", { VIEW_REPORTS: true }, "VIEW_REPORTS"), true);
  assert.equal(hasPermission("CASHIER", { VIEW_REPORTS: true }, "MANAGE_INVENTORY"), false);
});

test("invalid override values and unknown keys are ignored", () => {
  assert.deepEqual(normalizePermissionOverrides({ VIEW_REPORTS: "true", UNKNOWN: true, MANAGE_TABLES: false }), { MANAGE_TABLES: false });
});
