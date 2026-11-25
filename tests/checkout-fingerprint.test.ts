import assert from "node:assert/strict";
import test from "node:test";
import { checkoutFingerprint } from "../lib/checkout-fingerprint";

const splitTender = [
  { method: "CASH" as const, amountMinor: 750 },
  { method: "OTHER" as const, amountMinor: 500 },
];
const base = { cashReceivedMinor: 1300, discountApprovalId: undefined };

test("checkout fingerprint is stable across item and tender ordering", () => {
  const first = checkoutFingerprint([
    { productId: "juice-b", quantity: 1 },
    { productId: "juice-a", quantity: 2 },
  ], splitTender, base.cashReceivedMinor, base.discountApprovalId);
  const second = checkoutFingerprint([
    { productId: "juice-a", quantity: 2 },
    { productId: "juice-b", quantity: 1 },
  ], [...splitTender].reverse(), base.cashReceivedMinor, base.discountApprovalId);
  assert.equal(first, second);
});

test("checkout fingerprint canonicalizes duplicate lines for the same product", () => {
  const splitLines = checkoutFingerprint([
    { productId: "juice-a", quantity: 1 },
    { productId: "juice-a", quantity: 2 },
  ], [{ method: "CASH" as const, amountMinor: 1250 }], base.cashReceivedMinor, base.discountApprovalId);
  const mergedLine = checkoutFingerprint([
    { productId: "juice-a", quantity: 3 },
  ], cash, base.cashReceivedMinor, base.discountApprovalId);
  assert.equal(splitLines, mergedLine);
});

test("checkout fingerprint changes when payment, cash received, or discount changes", () => {
  const original = checkoutFingerprint([{ productId: "juice-a", quantity: 1 }], [{ method: "CASH" as const, amountMinor: 1250 }], 1300, undefined);
  assert.notEqual(original, checkoutFingerprint([{ productId: "juice-a", quantity: 1 }], [{ method: "CASH", amountMinor: 1200 }], 1300, undefined));
  assert.notEqual(original, checkoutFingerprint([{ productId: "juice-a", quantity: 1 }], [{ method: "CASH" as const, amountMinor: 1250 }], 1400, undefined));
  assert.notEqual(original, checkoutFingerprint([{ productId: "juice-a", quantity: 1 }], [{ method: "CASH" as const, amountMinor: 1250 }], 1300, "approval-1"));
});
