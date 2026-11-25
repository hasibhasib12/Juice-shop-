export type CheckoutPayload = {
  items: { productId: string; quantity: number; variantId?: string; modifierOptionIds: string[] }[];
  paymentMethod: "CASH";
  cashReceivedMinor: number;
  paymentTenders: { method: "CASH" | "OTHER"; amountMinor: number }[];
  idempotencyKey: string;
  customerName: string;
  notes: string;
  draftId?: string;
  discountApprovalId?: string;
};

export type PendingCheckout = {
  version: 1;
  cashierId: string;
  createdAt: number;
  payload: CheckoutPayload;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePendingCheckout(raw: string): PendingCheckout | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== 1 ||
      typeof value.cashierId !== "string" || value.cashierId.length === 0 ||
      !Number.isSafeInteger(value.createdAt) || (value.createdAt as number) <= 0 ||
      !isRecord(value.payload)) return null;

  const payload = value.payload;
  if (payload.paymentMethod !== "CASH" ||
      typeof payload.idempotencyKey !== "string" || payload.idempotencyKey.length < 12 ||
      !Number.isSafeInteger(payload.cashReceivedMinor) || (payload.cashReceivedMinor as number) < 0 ||
      typeof payload.customerName !== "string" || typeof payload.notes !== "string" ||
      (payload.draftId !== undefined && typeof payload.draftId !== "string") ||
      (payload.discountApprovalId !== undefined && typeof payload.discountApprovalId !== "string") ||
      !Array.isArray(payload.items) || payload.items.length === 0 ||
      !Array.isArray(payload.paymentTenders) || payload.paymentTenders.length === 0) return null;

  const validItems = payload.items.every((item) => isRecord(item) &&
    typeof item.productId === "string" && item.productId.length > 0 &&
    Number.isSafeInteger(item.quantity) && (item.quantity as number) >= 1 &&
    (item.variantId === undefined || typeof item.variantId === "string") &&
    Array.isArray(item.modifierOptionIds) &&
    item.modifierOptionIds.every((id) => typeof id === "string"));
  const validTenders = payload.paymentTenders.every((tender) => isRecord(tender) &&
    (tender.method === "CASH" || tender.method === "OTHER") &&
    Number.isSafeInteger(tender.amountMinor) && (tender.amountMinor as number) > 0);
  if (!validItems || !validTenders) return null;

  return value as unknown as PendingCheckout;
}
