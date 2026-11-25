import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function catalogAccess() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  const state = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, state?.permissionOverrides, "MANAGE_CATALOG")) {
    return { response: NextResponse.json({ error: "Catalogue management access required." }, { status: 403 }) };
  }
  return { user };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await catalogAccess();
  if (access.response) return access.response;
  const { id } = await context.params;
  const product = await prisma.product.findFirst({ where: { id, branchId: access.user!.branchId }, select: {
    id: true, name: true,
    variants: { orderBy: { sortOrder: "asc" }, include: { recipeItems: { select: { ingredientId: true, quantity: true } } } },
    modifierGroups: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
  } });
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  return NextResponse.json(product, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await catalogAccess();
  if (access.response) return access.response;
  const { id } = await context.params;
  const rate = await checkActionRateLimit("product-options-write", access.user!.id, 20, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many product option changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const config = body as { variants?: unknown[]; modifierGroups?: unknown[] };
  if (!Array.isArray(config.variants) || config.variants.length > 30 || !Array.isArray(config.modifierGroups) || config.modifierGroups.length > 20) {
    return NextResponse.json({ error: "Provide up to 30 variants and 20 modifier groups." }, { status: 400 });
  }
  const variants = config.variants as { name?: unknown; priceMinor?: unknown; sku?: unknown; active?: unknown; recipeItems?: unknown }[];
  const groups = config.modifierGroups as { name?: unknown; required?: unknown; minSelections?: unknown; maxSelections?: unknown; active?: unknown; options?: unknown }[];
  if (!variants.every(v => v && typeof v === "object" && typeof v.name === "string" && v.name.trim().length > 0 && v.name.length <= 60 && Number.isSafeInteger(v.priceMinor) && Number(v.priceMinor) > 0 && (v.sku === undefined || v.sku === null || (typeof v.sku === "string" && v.sku.length <= 64)) && (v.active === undefined || typeof v.active === "boolean") && (v.recipeItems === undefined || (Array.isArray(v.recipeItems) && v.recipeItems.length <= 50)))) {
    return NextResponse.json({ error: "Each variant needs a name, positive price, optional SKU and valid recipe items." }, { status: 400 });
  }
  if (!groups.every(g => g && typeof g === "object" && typeof g.name === "string" && g.name.trim().length > 0 && g.name.length <= 60 && (g.required === undefined || typeof g.required === "boolean") && Number.isSafeInteger(g.minSelections ?? 0) && Number(g.minSelections ?? 0) >= 0 && Number.isSafeInteger(g.maxSelections ?? 1) && Number(g.maxSelections ?? 1) >= 1 && Number(g.minSelections ?? 0) <= Number(g.maxSelections ?? 1) && Array.isArray(g.options) && g.options.length >= 1 && g.options.length <= 30 && (g.options as {name?:unknown;priceDeltaMinor?:unknown;active?:unknown}[]).every(o => o && typeof o === "object" && typeof o.name === "string" && o.name.trim().length > 0 && o.name.length <= 60 && Number.isSafeInteger(o.priceDeltaMinor ?? 0) && Number(o.priceDeltaMinor ?? 0) >= 0 && (o.active === undefined || typeof o.active === "boolean")))) {
    return NextResponse.json({ error: "Modifier groups need valid selection limits and at least one valid option." }, { status: 400 });
  }
  for (const variant of variants) {
    const recipes = (variant.recipeItems ?? []) as { ingredientId?: unknown; quantity?: unknown }[];
    if (!recipes.every(r => r && typeof r === "object" && typeof r.ingredientId === "string" && r.ingredientId.length <= 64 && typeof r.quantity === "number" && Number.isFinite(r.quantity) && r.quantity > 0 && Math.round(r.quantity * 1000) === r.quantity * 1000)) {
      return NextResponse.json({ error: "Variant recipe quantities must be positive with at most three decimal places." }, { status: 400 });
    }
    if (new Set(recipes.map(r => r.ingredientId)).size !== recipes.length) return NextResponse.json({ error: "Each ingredient may appear only once per variant recipe." }, { status: 400 });
  }
  try {
    const saved = await prisma.$transaction(async tx => {
      const product = await tx.product.findFirst({ where: { id, branchId: access.user!.branchId }, select: { id: true } });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      const ingredientIds = [...new Set(variants.flatMap(v => ((v.recipeItems ?? []) as {ingredientId:string}[]).map(r => r.ingredientId)))];
      const ingredients = ingredientIds.length ? await tx.ingredient.findMany({ where: { id: { in: ingredientIds } }, select: { id: true } }) : [];
      if (ingredients.length !== ingredientIds.length) throw new Error("INVALID_INGREDIENT");
      await tx.productVariant.deleteMany({ where: { productId: id } });
      await tx.productModifierGroup.deleteMany({ where: { productId: id } });
      for (const [index, variant] of variants.entries()) {
        await tx.productVariant.create({ data: {
          productId: id, name: (variant.name as string).trim(), priceMinor: variant.priceMinor as number,
          sku: typeof variant.sku === "string" && variant.sku.trim() ? variant.sku.trim() : null,
          active: variant.active !== false, sortOrder: index,
          recipeItems: { create: ((variant.recipeItems ?? []) as {ingredientId:string;quantity:number}[]).map(r => ({ ingredientId: r.ingredientId, quantity: r.quantity })) },
        } });
      }
      for (const [index, group] of groups.entries()) {
        await tx.productModifierGroup.create({ data: {
          productId: id, name: (group.name as string).trim(), required: group.required === true,
          minSelections: Number(group.minSelections ?? (group.required ? 1 : 0)),
          maxSelections: Number(group.maxSelections ?? 1), active: group.active !== false, sortOrder: index,
          options: { create: (group.options as {name:string;priceDeltaMinor?:number;active?:boolean}[]).map((o, optionIndex) => ({
            name: o.name.trim(), priceDeltaMinor: o.priceDeltaMinor ?? 0, active: o.active !== false, sortOrder: optionIndex,
          })) },
        } });
      }
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PRODUCT_OPTIONS_UPDATED", entityType: "Product", entityId: id, details: { variantCount: variants.length, modifierGroupCount: groups.length } } });
      return tx.product.findFirst({ where: { id, branchId: access.user!.branchId }, include: { variants: { orderBy: { sortOrder: "asc" }, include: { recipeItems: true } }, modifierGroups: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } } } });
    });
    return NextResponse.json({ product: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PRODUCT_NOT_FOUND") return NextResponse.json({ error: "Product not found." }, { status: 404 });
    if (message === "INVALID_INGREDIENT") return NextResponse.json({ error: "One or more recipe ingredients do not exist." }, { status: 400 });
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "A variant SKU is already in use." }, { status: 409 });
    return NextResponse.json({ error: "Product options could not be saved." }, { status: 503 });
  }
}
