import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitPolicy } from "../lib/rate-limit-policy";
test("allows attempts below the configured limit", () => {
  const result = rateLimitPolicy(3, 10, new Date(1000), 60, 2000);
  assert.deepEqual(result, { allowed: true, retryAfterSeconds: 59, remaining: 7 });
});
test("blocks attempts over the configured limit and returns retry delay", () => {
  const result = rateLimitPolicy(11, 10, new Date(1000), 60, 2000);
  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 59, remaining: 0 });
});
test("keeps retry-after at one second after a window expires", () => {
  const result = rateLimitPolicy(1, 10, new Date(1000), 60, 62000);
  assert.equal(result.retryAfterSeconds, 1);
});
