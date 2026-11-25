import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { productId: string; quantity: number; variantId?: string; modifierOptionIds?: string[] };
const fingerprint = (items: Item[]) => createHash("sha256").update([...items].map((item) => JSON.stringify([item.productId, item.variantId ?? null, [...(item.modifierOptionIds ?? [])].sort(), item.quantity])).sort().join("|")).digest("hex");

export async function POST(request: NextRequest) {
  const cashier = await getCurrentUser();
  if (!cashier) return NextResponse.json({ error: "Sign in before requesting a discount." }, { status: 401 });

  let body: { managerEmail?: string; managerPassword?: string; discountMinor?: number; reason?: string; items?: Item[] };
  try { const parsed: unknown = await request.json(); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); body = parsed as typeof body; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const email = body.managerEmail?.trim().toLowerCase();
  const reason = body.reason?.trim();
  const items = body.items;
  if (!email || email.length > 254 || typeof body.managerPassword !== "string" || body.managerPassword.length < 1 || body.managerPassword.length > 200) {
    return NextResponse.json({ error: "Manager email and password are required." }, { status: 400 });
  }
  if (!Number.isSafeInteger(body.discountMinor) || body.discountMinor! <= 0 || body.discountMinor! > 2_000_000_000) {
    return NextResponse.json({ error: "Enter a valid discount amount." }, { status: 400 });
  }
  if (!reason || reason.length < 3 || reason.length > 200) return NextResponse.json({ error: "Enter a discount reason between 3 and 200 characters." }, { status: 400 });
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) return NextResponse.json({ error: "The current cart is invalid." }, { status: 400 });
  const validItems = items.every((item) => {
    if (!item || typeof item.productId !== "string" || item.productId.length > 64 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) return false;
    if (item.variantId !== undefined && (typeof item.variantId !== "string" || item.variantId.length > 64)) return false;
    if (item.modifierOptionIds !== undefined && (!Array.isArray(item.modifierOptionIds) || item.modifierOptionIds.length > 30 || !item.modifierOptionIds.every((id) => typeof id === "string" && id.length <= 64) || new Set(item.modifierOptionIds).size !== item.modifierOptionIds.length)) return false;
    return true;
  });
  if (!validItems) return NextResponse.json({ error: "The current cart is invalid." }, { status: 400 });
    return NextResponse.json({ error: "The current cart is invalid." }, { status: 400 });
  }

  const manager = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, active: true, passwordHash: true } });
  if (!manager?.active || (manager.role !== "MANAGER" && manager.role !== "OWNER") || !verifyPassword(body.managerPassword, manager.passwordHash)) {
    return NextResponse.json({ error: "Manager authorization failed. Check the manager credentials." }, { status: 403 });
  }

  const quantities = new Map<string, number>();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  if ([...quantities.values()].some((quantity) => quantity > 100)) return NextResponse.json({ error: "A product quantity cannot exceed 100." }, { status: 400 });

  const products = await prisma.product.findMany({
    where: { id: { in: [...quantities.keys()] }, status: "ACTIVE", available: true, category: { active: true } },
    select: { id: true, priceMinor: true, currency: true, variants: { where: { active: true }, select: { id: true, priceMinor: true } }, modifierGroups: { where: { active: true }, select: { id: true, minSelections: true, maxSelections: true, options: { where: { active: true }, select: { id: true, priceDeltaMinor: true } } } } },
  });
  if (products.length !== quantities.size) return NextResponse.json({ error: "One or more cart products are unavailable." }, { status: 409 });
  if (new Set(products.map((product) => product.currency)).size !== 1) return NextResponse.json({ error: "All products must use the same currency." }, { status: 409 });
  let subtotalMinor = 0;
  for (const item of items) {
    const product = products.find(p => p.id === item.productId)!;
    const variant = item.variantId ? product.variants.find(v => v.id === item.variantId) : null;
    if ((item.variantId && !variant) || (!item.variantId && product.variants.length > 0)) return NextResponse.json({ error: "A selected size is unavailable." }, { status: 409 });
    const ids = item.modifierOptionIds ?? [];
    if (new Set(ids).size !== ids.length) return NextResponse.json({ error: "Duplicate extras are not allowed." }, { status: 400 });
    const chosen = product.modifierGroups.flatMap(g => g.options.filter(o => ids.includes(o.id)).map(o => ({ groupId: g.id, priceDeltaMinor: o.priceDeltaMinor })));
    if (chosen.length !== ids.length || product.modifierGroups.some(g => { const count = chosen.filter(o => o.groupId === g.id).length; return count < g.minSelections || count > g.maxSelections; })) return NextResponse.json({ error: "Selected extras are invalid." }, { status: 400 });
    subtotalMinor += ((variant?.priceMinor ?? product.priceMinor) + chosen.reduce((sum, option) => sum + option.priceDeltaMinor, 0)) * item.quantity;
  }
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor <= 0 || body.discountMinor! >= subtotalMinor) return NextResponse.json({ error: "Discount cannot exceed the current cart subtotal." }, { status: 400 });
  const limitSetting = await prisma.posSetting.findUnique({ where: { key: "store.maxDiscountPercentBps" }, select: { value: true } });
  const maxDiscountPercentBps = typeof limitSetting?.value === "number" && Number.isSafeInteger(limitSetting.value) && limitSetting.value >= 1 && limitSetting.value <= 10000 ? limitSetting.value : 10000;
  if (BigInt(body.discountMinor!) * 10000n > BigInt(subtotalMinor) * BigInt(maxDiscountPercentBps)) {
    return NextResponse.json({ error: `Discount exceeds the store limit of ${(maxDiscountPercentBps / 100).toFixed(2)}%.` }, { status: 400 });
  }

  try {
    const approval = await prisma.$transaction(async (tx) => {
      const created = await tx.discountApproval.create({
        data: {
          cashierId: cashier.id,
          managerId: manager.id,
          subtotalMinor,
          discountMinor: body.discountMinor!,
          cartFingerprint: fingerprint(items),
          reason,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
        select: { id: true, discountMinor: true, expiresAt: true },
      });
      await tx.auditEvent.create({
        data: { userId: manager.id, action: "DISCOUNT_APPROVED", entityType: "DiscountApproval", entityId: created.id, details: { cashierId: cashier.id, subtotalMinor, discountMinor: created.discountMinor, reason } },
      });
      return created;
    });
    return NextResponse.json({ approval, managerName: manager.name }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not record discount approval." }, { status: 503 });
  }
}
