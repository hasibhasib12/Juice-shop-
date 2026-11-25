import assert from "node:assert/strict";
import test from "node:test";
import { detectProductImageType } from "../lib/product-image";
test("recognizes JPEG signatures", () => assert.deepEqual(detectProductImageType(Uint8Array.from([0xff,0xd8,0xff,0x00])), { mime: "image/jpeg", extension: "jpg" }));
test("recognizes PNG signatures", () => assert.deepEqual(detectProductImageType(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), { mime: "image/png", extension: "png" }));
test("recognizes WebP signatures", () => assert.deepEqual(detectProductImageType(Uint8Array.from([...Buffer.from("RIFF"),0,0,0,0,...Buffer.from("WEBP")])), { mime: "image/webp", extension: "webp" }));
test("rejects spoofed and incomplete image signatures", () => {
  assert.equal(detectProductImageType(Uint8Array.from(Buffer.from("<svg></svg>"))), null);
  assert.equal(detectProductImageType(Uint8Array.from([0xff,0xd8])), null);
});
