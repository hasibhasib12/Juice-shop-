import { createHash } from "node:crypto";

export type CheckoutFingerprintItem = { productId: string; quantity: number };
export type CheckoutFingerprintTender = { method: "CASH" | "OTHER"; amountMinor: number };

export function checkoutFingerprint(
  items: CheckoutFingerprintItem[],
  tenders: CheckoutFingerprintTender[],
  cashReceivedMinor: number | undefined,
  discountApprovalId: string | undefined,
  metadata?: { customerName?: string; notes?: string },
) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  const canonicalItems = [...quantities.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([productId, quantity]) => ({ productId, quantity }));
  const canonicalTenders = [...tenders]
    .map(({ method, amountMinor }) => ({ method, amountMinor }))
    .sort((a, b) => a.method.localeCompare(b.method));

  return createHash("sha256").update(JSON.stringify({
    items: canonicalItems,
    tenders: canonicalTenders,
    cashReceivedMinor: cashReceivedMinor ?? null,
    discountApprovalId: discountApprovalId ?? null,
    customerName: metadata?.customerName?.trim() || null,
    notes: metadata?.notes?.trim() || null,
  })).digest("hex");
}
