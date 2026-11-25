import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { productId: string; quantity: number };
const fingerprint = (items: Item[]) => createHash("sha256").update([...items].sort((a,b) => a.productId.localeCompare(b.productId)).map((item) => `${item.productId}:${item.quantity}`).join("|")).digest("hex");

export async function POST(request: NextRequest) {
  const cashier = await getCurrentUser();
  if (!cashier) return NextResponse.json({ error: "Sign in before requesting a discount." }, { status: 401 });

  let body: { managerEmail?: string; managerPassword?: string; discountMinor?: number; reason?: string; items?: Item[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

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
  if (!Array.isArray(items) || items.length < 1 || items.length > 50 || !items.every((item) => item && typeof item.productId === "string" && item.productId.length <= 64 && Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 100)) {
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
    select: { id: true, priceMinor: true, currency: true },
  });
  if (products.length !== quantities.size) return NextResponse.json({ error: "One or more cart products are unavailable." }, { status: 409 });
  if (new Set(products.map((product) => product.currency)).size !== 1) return NextResponse.json({ error: "All products must use the same currency." }, { status: 409 });
  const subtotalMinor = products.reduce((sum, product) => sum + product.priceMinor * quantities.get(product.id)!, 0);
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor <= 0 || body.discountMinor! > subtotalMinor) return NextResponse.json({ error: "Discount cannot exceed the current cart subtotal." }, { status: 400 });

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
