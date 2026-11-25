import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpectedShiftCash } from "../lib/shift-cash";
test("calculates expected cash from float, cash sales, refunds and drawer movements", () => {
  assert.equal(calculateExpectedShiftCash(5000, 12500, 1500, 700, 200), 16500);
});
test("does not treat non-cash refunds as a cash drawer reduction", () => {
  assert.equal(calculateExpectedShiftCash(0, 10000, 0, 0, 0), 10000);
});
test("supports negative expected cash when paid outs exceed available cash", () => {
  assert.equal(calculateExpectedShiftCash(100, 0, 0, 0, 250), -150);
});
