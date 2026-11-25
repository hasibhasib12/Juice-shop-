import assert from "node:assert/strict";
import test from "node:test";
import { createTextPdf } from "../lib/simple-pdf";
test("creates a valid single-page PDF with cross-reference table", () => {
  const text = createTextPdf(["Sales report", "Net sales: 123.45 AFN"]).toString("ascii");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("/Type /Catalog"));
  assert.ok(text.includes("Sales report"));
  assert.ok(text.includes("xref"));
  assert.ok(text.endsWith("%%EOF"));
});
test("escapes PDF delimiters", () => {
  const text = createTextPdf(["Juice (fresh) \\ daily"]).toString("ascii");
  assert.ok(text.includes("Juice \\(fresh\\) \\\\ daily"));
});
test("limits report output to one printable page", () => {
  const text = createTextPdf(Array.from({ length: 70 }, (_, i) => "Line " + i)).toString("ascii");
  assert.ok(text.includes("(Line 47)"));
  assert.ok(!text.includes("(Line 48)"));
});
