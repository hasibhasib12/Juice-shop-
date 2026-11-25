import assert from "node:assert/strict";
import test from "node:test";
import { isSerializationConflict, withSerializableRetry } from "../lib/transaction-retry";

test("recognizes Prisma serializable transaction conflicts only", () => {
  assert.equal(isSerializationConflict({ code: "P2034" }), true);
  assert.equal(isSerializationConflict({ code: "P2002" }), false);
  assert.equal(isSerializationConflict(new Error("conflict")), false);
  assert.equal(isSerializationConflict(null), false);
});

test("retries serialization conflicts and returns the successful result", async () => {
  let calls = 0;
  const result = await withSerializableRetry(async () => {
    calls += 1;
    if (calls < 3) throw { code: "P2034" };
    return "committed";
  });
  assert.equal(result, "committed");
  assert.equal(calls, 3);
});

test("does not retry non-serialization errors", async () => {
  let calls = 0;
  await assert.rejects(withSerializableRetry(async () => {
    calls += 1;
    throw { code: "P2002" };
  }));
  assert.equal(calls, 1);
});

test("stops after the configured retry count", async () => {
  let calls = 0;
  await assert.rejects(withSerializableRetry(async () => {
    calls += 1;
    throw { code: "P2034" };
  }, 2));
  assert.equal(calls, 2);
});
