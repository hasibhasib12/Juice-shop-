import assert from "node:assert/strict";
import test from "node:test";
import { parsePendingCheckout, type PendingCheckout } from "../lib/pos-checkout-recovery";

const valid: PendingCheckout = {
  version: 1,
  cashierId: "cashier-1",
  createdAt: 1_800_000_000_000,
  payload: {
    items: [{ productId: "product-1", quantity: 2, modifierOptionIds: [] }],
    paymentMethod: "CASH",
    cashReceivedMinor: 2000,
    paymentTenders: [{ method: "CASH", amountMinor: 2000 }],
    idempotencyKey: "checkout-key-123",
    customerName: "",
    notes: "",
  },
};

test("pending checkout parser preserves a valid immutable payload", () => {
  const parsed = parsePendingCheckout(JSON.stringify(valid));
  assert.deepEqual(parsed, valid);
});

test("pending checkout parser rejects malformed JSON and unsupported versions", () => {
  assert.equal(parsePendingCheckout("{"), null);
  assert.equal(parsePendingCheckout(JSON.stringify({ ...valid, version: 2 })), null);
});

test("pending checkout parser rejects missing cashier and malformed checkout items", () => {
  assert.equal(parsePendingCheckout(JSON.stringify({ ...valid, cashierId: "" })), null);
  assert.equal(parsePendingCheckout(JSON.stringify({
    ...valid,
    payload: { ...valid.payload, items: [{ productId: "product-1", quantity: 0, modifierOptionIds: [] }] },
  })), null);
});

test("pending checkout parser rejects invalid tenders and unsafe amounts", () => {
  assert.equal(parsePendingCheckout(JSON.stringify({
    ...valid,
    payload: { ...valid.payload, paymentTenders: [{ method: "CARD", amountMinor: 2000 }] },
  })), null);
  assert.equal(parsePendingCheckout(JSON.stringify({
    ...valid,
    payload: { ...valid.payload, cashReceivedMinor: Number.MAX_SAFE_INTEGER + 1 },
  })), null);
});
