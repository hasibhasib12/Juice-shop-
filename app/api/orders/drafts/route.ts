import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftItem = { productId: string; quantity: number; variantId?: string; modifierOptionIds?: string[] };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  try {
    const drafts = await prisma.order.findMany({
      where: { status: "DRAFT", ...(user.role === "OWNER" || user.role === "MANAGER" ? {} : { cashierId: user.id }) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, orderNumber: true, customerName: true, notes: true, subtotalMinor: true,
        taxMinor: true, totalMinor: true, currency: true, createdAt: true,
        cashier: { select: { id: true, name: true } },
        lines: { select: { id: true, productId: true, productName: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true, variantName: true, selectedModifiers: true } },
      },
    });
    return NextResponse.json({ drafts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Draft orders are unavailable." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const rate = await checkActionRateLimit("order-draft-write", user.id, 60, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many draft changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: { id?: string; items?: DraftItem[]; customerName?: string; notes?: string };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (body.id !== undefined && (typeof body.id !== "string" || body.id.length > 64)) {
    return NextResponse.json({ error: "Invalid draft ID." }, { status: 400 });
  }
  if (body.customerName !== undefined && (typeof body.customerName !== "string" || body.customerName.trim().length > 120)) {
    return NextResponse.json({ error: "Customer name must be 120 characters or fewer." }, { status: 400 });
  }
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 1000)) {
    return NextResponse.json({ error: "Order notes must be 1,000 characters or fewer." }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50 ||
      !body.items.every((item) => item && typeof item.productId === "string" && item.productId.length <= 64 &&
        Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 100 &&
        (item.variantId === undefined || (typeof item.variantId === "string" && item.variantId.length <= 64)) &&
        (item.modifierOptionIds === undefined || (Array.isArray(item.modifierOptionIds) && item.modifierOptionIds.length <= 30 && item.modifierOptionIds.every((id) => typeof id === "string" && id.length <= 64) && new Set(item.modifierOptionIds).size === item.modifierOptionIds.length)))) {
    return NextResponse.json({ error: "A draft must contain 1–50 valid product lines." }, { status: 400 });
  }

  const quantities = new Map<string, number>();
  for (const item of body.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  if ([...quantities.values()].some((quantity) => quantity > 100)) {
    return NextResponse.json({ error: "A product quantity cannot exceed 100 per draft." }, { status: 400 });
  }

  try {
    const draft = await prisma.$transaction(async (tx) => {
      if (body.id) {
        const existing = await tx.order.findUnique({ where: { id: body.id }, select: { id: true, cashierId: true, status: true } });
        if (!existing) throw new Error("DRAFT_NOT_FOUND");
        if (existing.status !== "DRAFT") throw new Error("DRAFT_NOT_EDITABLE");
        if (existing.cashierId !== user.id && user.role !== "OWNER" && user.role !== "MANAGER") throw new Error("DRAFT_FORBIDDEN");
      }

      const products = await tx.product.findMany({
        where: { id: { in: [...quantities.keys()] }, status: "ACTIVE", available: true, category: { active: true } },
        select: { id: true, name: true, priceMinor: true, currency: true,
          variants: { where: { active: true }, select: { id: true, name: true, priceMinor: true } },
          modifierGroups: { where: { active: true }, include: { options: { where: { active: true } } } },
        },
      });
      if (products.length !== quantities.size) throw new Error("PRODUCT_UNAVAILABLE");
      if (new Set(products.map((product) => product.currency)).size !== 1) throw new Error("MIXED_CURRENCIES");
      const lineMap = new Map<string, { productId: string; variantId?: string; modifierOptionIds: string[]; quantity: number }>();
      for (const item of body.items!) {
        const modifierOptionIds = [...(item.modifierOptionIds ?? [])].sort();
        const key = JSON.stringify([item.productId, item.variantId ?? null, modifierOptionIds]);
        const existing = lineMap.get(key);
        if (existing) existing.quantity += item.quantity;
        else lineMap.set(key, { productId: item.productId, ...(item.variantId ? { variantId: item.variantId } : {}), modifierOptionIds, quantity: item.quantity });
      }
      const lines = [...lineMap.values()].map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId)!;
        const variant = item.variantId ? product.variants.find((candidate) => candidate.id === item.variantId) : null;
        if ((item.variantId && !variant) || (!item.variantId && product.variants.length > 0)) throw new Error("INVALID_VARIANT");
        const selected = product.modifierGroups.flatMap((group) => group.options.filter((option) => item.modifierOptionIds.includes(option.id)).map((option) => ({ groupId: group.id, optionId: option.id, groupName: group.name, name: option.name, priceDeltaMinor: option.priceDeltaMinor })));
        if (selected.length !== item.modifierOptionIds.length || product.modifierGroups.some((group) => { const count = selected.filter((option) => option.groupId === group.id).length; return count < group.minSelections || count > group.maxSelections; })) throw new Error("INVALID_MODIFIER");
        const unitPriceMinor = (variant?.priceMinor ?? product.priceMinor) + selected.reduce((sum, option) => sum + option.priceDeltaMinor, 0);
        const lineTotalMinor = unitPriceMinor * item.quantity;
        if (!Number.isSafeInteger(lineTotalMinor) || lineTotalMinor < 0) throw new Error("INVALID_TOTAL");
        return { productId: product.id, productName: product.name, quantity: item.quantity, unitPriceMinor, lineTotalMinor, variantName: variant?.name ?? null, selectedModifiers: selected.length ? selected.map(({ groupId, optionId, groupName, name, priceDeltaMinor }) => ({ groupId, optionId, groupName, name, priceDeltaMinor })) : undefined };
      });
      const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      if (!Number.isSafeInteger(subtotalMinor)) throw new Error("INVALID_TOTAL");
      const setting = await tx.posSetting.findUnique({ where: { key: "store.taxRateBps" }, select: { value: true } });
      const taxRateBps = typeof setting?.value === "number" && Number.isSafeInteger(setting.value) && setting.value >= 0 && setting.value <= 10000 ? setting.value : 0;
      const taxMinor = new Prisma.Decimal(subtotalMinor).mul(taxRateBps).div(10000).toDecimalPlaces(0).toNumber();
      const totalMinor = subtotalMinor + taxMinor;
      if (!Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(totalMinor)) throw new Error("INVALID_TOTAL");

      const data = {
        customerName: body.customerName?.trim() || null,
        notes: body.notes?.trim() || null,
        subtotalMinor, discountMinor: 0, taxMinor, totalMinor, currency: products[0].currency,
        lines: { deleteMany: {}, create: lines },
      };
      const saved = body.id
        ? await tx.order.update({ where: { id: body.id }, data, include: { lines: true } })
        : await tx.order.create({ data: { ...data, status: "DRAFT", cashierId: user.id }, include: { lines: true } });
      await tx.auditEvent.create({
        data: { userId: user.id, action: body.id ? "ORDER_DRAFT_UPDATED" : "ORDER_DRAFT_CREATED", entityType: "Order", entityId: saved.id, details: { lineCount: lines.length, subtotalMinor, currency: saved.currency } },
      });
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ draft }, { status: body.id ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "DRAFT_NOT_FOUND") return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    if (message === "DRAFT_NOT_EDITABLE") return NextResponse.json({ error: "Only an open draft can be edited." }, { status: 409 });
    if (message === "DRAFT_FORBIDDEN") return NextResponse.json({ error: "You cannot edit another cashier's draft." }, { status: 403 });
    if (message === "INVALID_VARIANT") return NextResponse.json({ error: "A selected size is no longer available." }, { status: 409 });
    if (message === "INVALID_MODIFIER") return NextResponse.json({ error: "Selected extras are invalid or do not meet the required choices." }, { status: 400 });
    if (message === "PRODUCT_UNAVAILABLE") return NextResponse.json({ error: "One or more products are no longer available." }, { status: 409 });
    if (message === "MIXED_CURRENCIES") return NextResponse.json({ error: "All draft items must use the same currency." }, { status: 409 });
    if (message === "INVALID_TOTAL") return NextResponse.json({ error: "The draft total is invalid." }, { status: 422 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Draft changed at the same time. Please reload and retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Draft could not be saved." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const rate = await checkActionRateLimit("order-draft-write", user.id, 60, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many draft changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || id.length > 64) return NextResponse.json({ error: "A valid draft ID is required." }, { status: 400 });
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const result = await tx.order.deleteMany({
        where: { id, status: "DRAFT", ...(user.role === "OWNER" || user.role === "MANAGER" ? {} : { cashierId: user.id }) },
      });
      if (!result.count) return false;
      await tx.auditEvent.create({ data: { userId: user.id, action: "ORDER_DRAFT_DELETED", entityType: "Order", entityId: id } });
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "Draft not found or you cannot remove it." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Draft could not be deleted." }, { status: 503 });
  }
}
