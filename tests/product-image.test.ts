import assert from "node:assert/strict";
import test from "node:test";
import { detectProductImageType, isProductImageRequestSizeAllowed } from "../lib/product-image";
test("recognizes JPEG signatures", () => assert.deepEqual(detectProductImageType(Uint8Array.from([0xff,0xd8,0xff,0x00])), { mime: "image/jpeg", extension: "jpg" }));
test("recognizes PNG signatures", () => assert.deepEqual(detectProductImageType(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), { mime: "image/png", extension: "png" }));
test("recognizes WebP signatures", () => assert.deepEqual(detectProductImageType(Uint8Array.from([...Buffer.from("RIFF"),0,0,0,0,...Buffer.from("WEBP")])), { mime: "image/webp", extension: "webp" }));
test("rejects spoofed and incomplete image signatures", () => {
  assert.equal(detectProductImageType(Uint8Array.from(Buffer.from("<svg></svg>"))), null);
  assert.equal(detectProductImageType(Uint8Array.from([0xff,0xd8])), null);
});

test("allows image requests up to the file limit plus multipart overhead", () => {
  assert.equal(isProductImageRequestSizeAllowed(String(5 * 1024 * 1024 + 64 * 1024)), true);
  assert.equal(isProductImageRequestSizeAllowed(String(5 * 1024 * 1024 + 64 * 1024 + 1)), false);
});

test("rejects malformed and negative image request lengths", () => {
  assert.equal(isProductImageRequestSizeAllowed("not-a-number"), false);
  assert.equal(isProductImageRequestSizeAllowed("-1"), false);
  assert.equal(isProductImageRequestSizeAllowed(null), true);
});
