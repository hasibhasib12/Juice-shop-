import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { checkoutFingerprint } from "@/lib/checkout-fingerprint";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";
import { withSerializableRetry } from "@/lib/transaction-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutItem = { productId: string; quantity: number; variantId?: string; modifierOptionIds?: string[] };
type PaymentTender = { method: "CASH" | "OTHER"; amountMinor: number };
const fingerprint = (items: CheckoutItem[]) => createHash("sha256").update([...items].map((item) => JSON.stringify([item.productId, item.variantId ?? null, [...(item.modifierOptionIds ?? [])].sort(), item.quantity])).sort().join("|")).digest("hex");



export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const cashier = await getCurrentUser();
  if (!cashier) return NextResponse.json({ error: "Please sign in before taking payment." }, { status: 401 });
  const rate = await checkActionRateLimit("checkout", cashier.id, 60, 60);
  if (!rate.allowed) return NextResponse.json({ error: "Too many checkout requests. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: { items?: CheckoutItem[]; paymentMethod?: string; cashReceivedMinor?: number; paymentTenders?: PaymentTender[]; idempotencyKey?: string; discountApprovalId?: string; customerName?: string; notes?: string; draftId?: string };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.customerName !== undefined && (typeof body.customerName !== "string" || body.customerName.trim().length > 120)) return NextResponse.json({ error: "Customer name must be 120 characters or fewer." }, { status: 400 });
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 1000)) return NextResponse.json({ error: "Order notes must be 1,000 characters or fewer." }, { status: 400 });
  if (body.draftId !== undefined && (typeof body.draftId !== "string" || body.draftId.length > 64)) return NextResponse.json({ error: "Invalid draft ID." }, { status: 400 });

  const items = body.items;
  const key = body.idempotencyKey;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50 ||
      !items.every((item) => item && typeof item.productId === "string" &&
        item.productId.length <= 64 && Number.isSafeInteger(item.quantity) &&
        item.quantity >= 1 && item.quantity <= 100 &&
        (item.variantId === undefined || (typeof item.variantId === "string" && item.variantId.length <= 64)) &&
        (item.modifierOptionIds === undefined || (Array.isArray(item.modifierOptionIds) && item.modifierOptionIds.length <= 30 && item.modifierOptionIds.every((id) => typeof id === "string" && id.length <= 64) && new Set(item.modifierOptionIds).size === item.modifierOptionIds.length)))) {
    return NextResponse.json({ error: "Add between 1 and 50 valid order lines." }, { status: 400 });
  }
  if (typeof key !== "string" || key.length < 12 || key.length > 100) {
    return NextResponse.json({ error: "A valid checkout idempotency key is required." }, { status: 400 });
  }
  const tenders = body.paymentTenders ?? (body.paymentMethod === "CASH" ? [{ method: "CASH" as const, amountMinor: 0 }] : null);
  if (!tenders || !Array.isArray(tenders) || tenders.length < 1 || tenders.length > 2 || !tenders.every((tender) => tender && (tender.method === "CASH" || tender.method === "OTHER") && Number.isSafeInteger(tender.amountMinor) && tender.amountMinor >= (body.paymentTenders ? 1 : 0) && tender.amountMinor <= 2_000_000_000) || new Set(tenders.map((tender) => tender.method)).size !== tenders.length) {
    return NextResponse.json({ error: "Choose one or two valid payment tenders. Card payments require a configured provider." }, { status: 400 });
  }

  const requestFingerprint = checkoutFingerprint(items, tenders, body.cashReceivedMinor, body.discountApprovalId, { customerName: body.customerName, notes: body.notes, draftId: body.draftId });

  const quantities = new Map<string, number>();
  for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  if ([...quantities.values()].some((quantity) => quantity > 100)) {
    return NextResponse.json({ error: "A product quantity cannot exceed 100 per order." }, { status: 400 });
  }

  try {
    const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const previous = await tx.order.findUnique({
        where: { idempotencyKey: key },
        include: { lines: true, payments: true },
      });
      if (previous) {
        if (previous.cashierId !== cashier.id || !previous.requestFingerprint || previous.requestFingerprint !== requestFingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
        return previous;
      }
      const activeShift = await tx.shift.findFirst({ where: { userId: cashier.id, closedAt: null }, select: { id: true } });
      if (!activeShift) throw new Error("NO_OPEN_SHIFT");

      const products = await tx.product.findMany({
        where: { id: { in: [...quantities.keys()] }, branchId: cashier.branchId, status: "ACTIVE", available: true, category: { active: true } },
        select: {
          id: true, name: true, priceMinor: true, currency: true,
          recipeItems: { select: { ingredientId: true, quantity: true, ingredient: { select: { branchId: true, name: true, unit: true, quantityOnHand: true } } } },
          variants: { where: { active: true }, include: { recipeItems: { select: { ingredientId: true, quantity: true, ingredient: { select: { branchId: true, name: true, unit: true, quantityOnHand: true } } } } } },
          modifierGroups: { where: { active: true }, include: { options: { where: { active: true } } } },
        },
      });
      if (products.length !== quantities.size) throw new Error("PRODUCT_UNAVAILABLE");
      const currencies = new Set(products.map((product) => product.currency));
      if (currencies.size !== 1) throw new Error("MIXED_CURRENCIES");

      const normalizedLines = new Map<string, { productId: string; variantId?: string; modifierOptionIds: string[]; quantity: number }>();
      for (const item of items) {
        const modifierOptionIds = [...(item.modifierOptionIds ?? [])].sort();
        const signature = JSON.stringify([item.productId, item.variantId ?? null, modifierOptionIds]);
        const current = normalizedLines.get(signature);
        if (current) current.quantity += item.quantity;
        else normalizedLines.set(signature, { productId: item.productId, ...(item.variantId ? { variantId: item.variantId } : {}), modifierOptionIds, quantity: item.quantity });
      }
      const lines = [...normalizedLines.values()].map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId)!;
        const variant = item.variantId ? product.variants.find((candidate) => candidate.id === item.variantId) : null;
        if ((item.variantId && !variant) || (!item.variantId && product.variants.length > 0)) throw new Error("INVALID_VARIANT");
        const selectedOptions = product.modifierGroups.flatMap((group) => group.options.filter((option) => item.modifierOptionIds.includes(option.id)).map((option) => ({ groupId: group.id, groupName: group.name, optionId: option.id, name: option.name, priceDeltaMinor: option.priceDeltaMinor })));
        if (selectedOptions.length !== item.modifierOptionIds.length) throw new Error("INVALID_MODIFIER");
        for (const group of product.modifierGroups) {
          const count = selectedOptions.filter((option) => option.groupId === group.id).length;
          if (count < group.minSelections || count > group.maxSelections) throw new Error("INVALID_MODIFIER_SELECTION");
        }
        const basePrice = variant?.priceMinor ?? product.priceMinor;
        const unitPriceMinor = basePrice + selectedOptions.reduce((sum, option) => sum + option.priceDeltaMinor, 0);
        const lineTotalMinor = unitPriceMinor * item.quantity;
        if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 1 || !Number.isSafeInteger(lineTotalMinor)) throw new Error("INVALID_PRICE");
        return { productId: product.id, productName: product.name, quantity: item.quantity, unitPriceMinor, lineTotalMinor, variantName: variant?.name ?? null, selectedModifiers: selectedOptions.length ? selectedOptions.map(({ optionId, groupName, name, priceDeltaMinor }) => ({ optionId, groupName, name, priceDeltaMinor })) : undefined, _variant: variant, _product: product };
      });
      const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor <= 0) throw new Error("INVALID_TOTAL");
      const discountLimitSetting = await tx.posSetting.findUnique({ where: { key: "store.maxDiscountPercentBps" }, select: { value: true } });
      const maxDiscountPercentBps = typeof discountLimitSetting?.value === "number" && Number.isSafeInteger(discountLimitSetting.value) && discountLimitSetting.value >= 1 && discountLimitSetting.value <= 10000 ? discountLimitSetting.value : 10000;
      const currency = products[0].currency;
      const taxSetting = await tx.posSetting.findUnique({ where: { key: "store.taxRateBps" }, select: { value: true } });
      const taxRateBps = typeof taxSetting?.value === "number" && Number.isSafeInteger(taxSetting.value) && taxSetting.value >= 0 && taxSetting.value <= 10000 ? taxSetting.value : 0;
      let discountMinor = 0;
      let discountApproval: { id: string; managerId: string; reason: string } | null = null;
      if (body.discountApprovalId !== undefined) {
        if (typeof body.discountApprovalId !== "string" || body.discountApprovalId.length > 64) throw new Error("INVALID_DISCOUNT_APPROVAL");
        const approval = await tx.discountApproval.findFirst({ where: { id: body.discountApprovalId, cashierId: cashier.id, subtotalMinor, cartFingerprint: fingerprint(items), discountMinor: { gt: 0, lt: subtotalMinor }, expiresAt: { gt: new Date() }, usedAt: null }, select: { id: true, managerId: true, reason: true, discountMinor: true } });
        if (!approval) throw new Error("INVALID_DISCOUNT_APPROVAL");
        const approvingManager = await tx.user.findUnique({ where: { id: approval.managerId }, select: { active: true, role: true } });
        if (!approvingManager?.active || (approvingManager.role !== "OWNER" && approvingManager.role !== "MANAGER")) throw new Error("INVALID_DISCOUNT_APPROVAL");
        if (BigInt(approval.discountMinor) * 10000n > BigInt(subtotalMinor) * BigInt(maxDiscountPercentBps)) throw new Error("DISCOUNT_LIMIT_EXCEEDED");
        discountMinor = approval.discountMinor;
        discountApproval = approval;
        const consumed = await tx.discountApproval.updateMany({ where: { id: approval.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (consumed.count !== 1) throw new Error("INVALID_DISCOUNT_APPROVAL");
      }
      const taxableSubtotalMinor = subtotalMinor - discountMinor;
      const taxMinor = new Prisma.Decimal(taxableSubtotalMinor).mul(taxRateBps).div(10000).toDecimalPlaces(0).toNumber();
      const totalMinor = taxableSubtotalMinor + taxMinor;
      if (!Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new Error("INVALID_TOTAL");
      const normalizedTenders = tenders.map((tender) => ({ ...tender, amountMinor: tender.amountMinor || totalMinor }));
      const tenderTotal = normalizedTenders.reduce((sum, tender) => sum + tender.amountMinor, 0);
      if (!Number.isSafeInteger(tenderTotal) || tenderTotal !== totalMinor) throw new Error("TENDER_TOTAL_MISMATCH");
      const cashPayment = normalizedTenders.find((tender) => tender.method === "CASH");
      const cashReceivedMinor = cashPayment ? (normalizedTenders.length === 1 ? (body.cashReceivedMinor ?? cashPayment.amountMinor) : cashPayment.amountMinor) : null;
      if (cashReceivedMinor !== null && (!Number.isSafeInteger(cashReceivedMinor) || cashReceivedMinor < cashPayment!.amountMinor || cashReceivedMinor > 2_000_000_000)) throw new Error("INSUFFICIENT_TENDER");
      const changeDueMinor = cashReceivedMinor === null ? null : cashReceivedMinor - cashPayment!.amountMinor;
      const ingredientDemand = new Map<string, Prisma.Decimal>();
      for (const line of lines) {
        const recipe = line._variant?.recipeItems.length ? line._variant.recipeItems : line._product.recipeItems;
        for (const recipeItem of recipe) {
          const required = recipeItem.quantity.mul(line.quantity);
          ingredientDemand.set(recipeItem.ingredientId, (ingredientDemand.get(recipeItem.ingredientId) ?? new Prisma.Decimal(0)).plus(required));
        }
      }
      for (const [ingredientId, required] of ingredientDemand) {
        const ingredient = [...products.flatMap((product) => product.recipeItems), ...products.flatMap((product) => product.variants.flatMap((variant) => variant.recipeItems))].find((item) => item.ingredientId === ingredientId)?.ingredient;
        if (!ingredient || ingredient.branchId !== cashier.branchId) throw new Error("BRANCH_INVENTORY_MISMATCH");
        if (ingredient.quantityOnHand.lt(required)) throw new Error("INSUFFICIENT_STOCK");
      }

      let order;
      const persistedLines = lines.map((line) => ({
        productId: line.productId, productName: line.productName, quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor, lineTotalMinor: line.lineTotalMinor,
        variantName: line.variantName, selectedModifiers: line.selectedModifiers,
      }));
      const paymentCreates = normalizedTenders.map((tender) => ({ method: tender.method, status: "COMPLETED" as const, amountMinor: tender.amountMinor, currency, ...(tender.method === "CASH" ? { cashReceivedMinor, changeDueMinor } : {}) }));
      const orderFields = {
        status: "COMPLETED" as const, cashierId: cashier.id, shiftId: activeShift.id,
        customerName: body.customerName?.trim() || null, notes: body.notes?.trim() || null,
        subtotalMinor, discountMinor, taxMinor, totalMinor, currency,
        idempotencyKey: key, requestFingerprint, completedAt: new Date(),
      };
      if (body.draftId) {
        const draft = await tx.order.findUnique({ where: { id: body.draftId }, select: { id: true, status: true, cashierId: true } });
        if (!draft || draft.status !== "DRAFT") throw new Error("DRAFT_NOT_FOUND");
        if (draft.cashierId !== cashier.id && cashier.role !== "OWNER" && cashier.role !== "MANAGER") throw new Error("DRAFT_FORBIDDEN");
        const changed = await tx.order.updateMany({ where: { id: body.draftId, status: "DRAFT" }, data: orderFields });
        if (changed.count !== 1) throw new Error("DRAFT_NOT_FOUND");
        order = await tx.order.update({ where: { id: body.draftId }, data: { lines: { deleteMany: {}, create: persistedLines }, payments: { create: paymentCreates } }, include: { lines: true, payments: true } });
      } else {
        order = await tx.order.create({ data: { ...orderFields, lines: { create: persistedLines }, payments: { create: paymentCreates } }, include: { lines: true, payments: true } });
      }

      for (const [ingredientId, required] of ingredientDemand) {
        const changed = await tx.ingredient.updateMany({
          where: { id: ingredientId, branchId: cashier.branchId, quantityOnHand: { gte: required } },
          data: { quantityOnHand: { decrement: required } },
        });
        if (changed.count !== 1) throw new Error("INSUFFICIENT_STOCK");
        await tx.stockMovement.create({
          data: { ingredientId, type: "SALE", quantity: required.negated(), reason: "Recipe deduction at checkout", referenceId: order.id },
        });
      }

      await tx.auditEvent.create({
        data: {
          userId: cashier.id,
          action: "ORDER_COMPLETED",
          entityType: "Order",
          entityId: order.id,
          details: { orderNumber: order.orderNumber, totalMinor: order.totalMinor, discountMinor, discountApprovedBy: discountApproval?.managerId ?? null, discountReason: discountApproval?.reason ?? null, hasCustomerName: Boolean(body.customerName?.trim()), hasNotes: Boolean(body.notes?.trim()), taxMinor, taxRateBps, currency, payments: normalizedTenders.map((tender) => ({ method: tender.method, amountMinor: tender.amountMinor })), cashReceivedMinor, changeDueMinor },
        },
      });
      return order;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

    return NextResponse.json({
      order: {
        id: result.id,
        orderNumber: result.orderNumber,
        status: result.status,
        subtotalMinor: result.subtotalMinor,
        discountMinor: result.discountMinor,
        taxMinor: result.taxMinor,
        totalMinor: result.totalMinor,
        currency: result.currency,
        lines: result.lines,
        payments: result.payments,
        completedAt: result.completedAt,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INVALID_DISCOUNT_APPROVAL") return NextResponse.json({ error: "Discount approval is invalid, expired, already used, or no longer matches this order. Request approval again." }, { status: 409 });
    if (message === "DISCOUNT_LIMIT_EXCEEDED") return NextResponse.json({ error: "The approved discount exceeds the current store limit. Request a smaller discount." }, { status: 409 });
    if (message === "INSUFFICIENT_TENDER") return NextResponse.json({ error: "Cash received must cover the cash portion." }, { status: 400 });
    if (message === "TENDER_TOTAL_MISMATCH") return NextResponse.json({ error: "Payment amounts must add up exactly to the order total." }, { status: 400 });
    if (message === "INVALID_VARIANT") return NextResponse.json({ error: "A selected product size is no longer available." }, { status: 409 });
    if (message === "INVALID_MODIFIER" || message === "INVALID_MODIFIER_SELECTION") return NextResponse.json({ error: "Selected extras are invalid or do not meet the required choices." }, { status: 400 });
    if (message === "PRODUCT_UNAVAILABLE") return NextResponse.json({ error: "One or more products are no longer available." }, { status: 409 });
    if (message === "NO_OPEN_SHIFT") return NextResponse.json({ error: "Open your cash shift before completing a sale." }, { status: 409 });
    if (message === "BRANCH_INVENTORY_MISMATCH") return NextResponse.json({ error: "A recipe ingredient is not assigned to this branch. Ask a manager to correct the recipe before selling this item." }, { status: 409 });
    if (message === "INSUFFICIENT_STOCK") return NextResponse.json({ error: "Not enough ingredient stock to complete this order. No payment or order was recorded." }, { status: 409 });
    if (message === "MIXED_CURRENCIES") return NextResponse.json({ error: "All items in an order must use the same currency." }, { status: 409 });
    if (message === "DRAFT_NOT_FOUND") return NextResponse.json({ error: "The saved draft no longer exists or has already been completed." }, { status: 409 });
    if (message === "DRAFT_FORBIDDEN") return NextResponse.json({ error: "You cannot complete this draft." }, { status: 403 });
    if (message === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "This checkout key was already used by a different cashier or a different checkout request." }, { status: 409 });
    if (message === "INVALID_PRICE" || message === "INVALID_TOTAL") return NextResponse.json({ error: "The order total is invalid." }, { status: 422 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.order.findUnique({
        where: { idempotencyKey: key },
        include: { lines: true, payments: true },
      });
      if (existing) {
        if (existing.cashierId !== cashier.id || !existing.requestFingerprint || existing.requestFingerprint !== requestFingerprint) {
          return NextResponse.json({ error: "This checkout key was already used by a different cashier or a different checkout request." }, { status: 409 });
        }
        return NextResponse.json({
          order: {
            id: existing.id,
            orderNumber: existing.orderNumber,
            status: existing.status,
            subtotalMinor: existing.subtotalMinor,
            discountMinor: existing.discountMinor,
            taxMinor: existing.taxMinor,
            totalMinor: existing.totalMinor,
            currency: existing.currency,
            lines: existing.lines,
            payments: existing.payments,
            completedAt: existing.completedAt,
          },
        }, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Checkout conflicted with another update. Please retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Checkout could not be completed." }, { status: 503 });
  }
}
