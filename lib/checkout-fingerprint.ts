import { createHash } from "node:crypto";

export type CheckoutFingerprintItem = { productId: string; quantity: number; variantId?: string; modifierOptionIds?: string[] };
export type CheckoutFingerprintTender = { method: "CASH" | "OTHER"; amountMinor: number };

export function checkoutFingerprint(
  items: CheckoutFingerprintItem[],
  tenders: CheckoutFingerprintTender[],
  cashReceivedMinor: number | undefined,
  discountApprovalId: string | undefined,
  metadata?: { customerName?: string; notes?: string; draftId?: string; orderType?: "TAKEAWAY" | "DINE_IN" | "DELIVERY"; customerPhone?: string; deliveryAddress?: string; deliveryFeeMinor?: number },
) {
  const quantities = new Map<string, { productId: string; variantId: string | null; modifierOptionIds: string[]; quantity: number }>();
  for (const item of items) {
    const modifierOptionIds = [...(item.modifierOptionIds ?? [])].sort();
    const variantId = item.variantId ?? null;
    const key = JSON.stringify([item.productId, variantId, modifierOptionIds]);
    const current = quantities.get(key);
    if (current) current.quantity += item.quantity;
    else quantities.set(key, { productId: item.productId, variantId, modifierOptionIds, quantity: item.quantity });
  }
  const canonicalItems = [...quantities.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const canonicalTenders = [...tenders]
    .map(({ method, amountMinor }) => ({ method, amountMinor }))
    .sort((a, b) => a.method.localeCompare(b.method) || a.amountMinor - b.amountMinor);

  return createHash("sha256").update(JSON.stringify({
    items: canonicalItems,
    tenders: canonicalTenders,
    cashReceivedMinor: cashReceivedMinor ?? null,
    discountApprovalId: discountApprovalId ?? null,
    customerName: metadata?.customerName?.trim() || null,
    notes: metadata?.notes?.trim() || null,
    orderType: metadata?.orderType ?? "TAKEAWAY",
    customerPhone: metadata?.customerPhone?.trim() || null,
    deliveryAddress: metadata?.deliveryAddress?.trim() || null,
    deliveryFeeMinor: metadata?.deliveryFeeMinor ?? 0,
    ...(metadata?.draftId ? { draftId: metadata.draftId } : {}),
  })).digest("hex");
}
