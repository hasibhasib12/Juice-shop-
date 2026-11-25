import assert from "node:assert/strict";
import test from "node:test";
test("sensitive action rate-limit policies are positive and bounded", () => {
  const policies = [{ max: 60, seconds: 60 }, { max: 10, seconds: 900 }, { max: 20, seconds: 900 }, { max: 30, seconds: 900 }];
  for (const policy of policies) {
    assert.ok(Number.isSafeInteger(policy.max) && policy.max > 0 && policy.max <= 1000);
    assert.ok(Number.isSafeInteger(policy.seconds) && policy.seconds > 0 && policy.seconds <= 86400);
  }
});
