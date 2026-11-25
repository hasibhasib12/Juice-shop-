import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedMutationOrigin } from "../lib/request-security";

test("allows same-origin browser mutations", () => {
  assert.equal(isAllowedMutationOrigin("https://pos.example.com", "https://pos.example.com", "same-origin"), true);
});

test("rejects cross-origin and same-site browser mutations", () => {
  assert.equal(isAllowedMutationOrigin("https://attacker.example", "https://pos.example.com", "cross-site"), false);
  assert.equal(isAllowedMutationOrigin("https://sibling.example.com", "https://pos.example.com", "same-site"), false);
});

test("rejects malformed origins and cross-site fetch metadata", () => {
  assert.equal(isAllowedMutationOrigin("not a url", "https://pos.example.com", null), false);
  assert.equal(isAllowedMutationOrigin(null, "https://pos.example.com", "cross-site"), false);
});

test("allows non-browser clients that omit browser origin metadata", () => {
  assert.equal(isAllowedMutationOrigin(null, "https://pos.example.com", null), true);
});
