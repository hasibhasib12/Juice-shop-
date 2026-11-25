import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function inventoryAccess(): Promise<{ user?: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; response?: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_INVENTORY")) {
    return { response: NextResponse.json({ error: "Inventory access required." }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const access = await inventoryAccess();
  if (access.response) return access.response;
  try {
    const [products, ingredients] = await Promise.all([
      prisma.product.findMany({ where: { branchId: access.user!.branchId, status: "ACTIVE" }, orderBy: { name: "asc" }, include: { recipeItems: { include: { ingredient: true } } } }),
      prisma.ingredient.findMany({ where: { branchId: access.user!.branchId }, orderBy: { name: "asc" } }),
    ]);
    return NextResponse.json({ products, ingredients }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Recipes are unavailable." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await inventoryAccess();
  if (access.response) return access.response;
  const user = access.user!;
  const rate = await checkActionRateLimit("recipe-write", user.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many recipe changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: { productId?: string; ingredientId?: string; quantity?: string | number };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.productId !== "string" || !body.productId || body.productId.length > 64 ||
      typeof body.ingredientId !== "string" || !body.ingredientId || body.ingredientId.length > 64 ||
      (typeof body.quantity !== "string" && typeof body.quantity !== "number") ||
      (typeof body.quantity === "string" && body.quantity.length > 40)) {
    return NextResponse.json({ error: "Choose a product, ingredient and positive recipe quantity." }, { status: 400 });
  }
  let quantity: Prisma.Decimal;
  try { quantity = new Prisma.Decimal(body.quantity); } catch {
    return NextResponse.json({ error: "Recipe quantity must be a valid positive number." }, { status: 400 });
  }
  if (!quantity.isFinite() || quantity.lte(0) || quantity.gt(100000000)) return NextResponse.json({ error: "Recipe quantity must be greater than zero and within the supported range." }, { status: 400 });
  try {
    const recipe = await prisma.$transaction(async (tx) => {
      const [product, ingredient] = await Promise.all([
        tx.product.findFirst({ where: { id: body.productId!, branchId: user.branchId }, select: { id: true } }),
        tx.ingredient.findFirst({ where: { id: body.ingredientId!, branchId: user.branchId }, select: { id: true } }),
      ]);
      if (!product || !ingredient) throw new Error("BRANCH_RESOURCE_NOT_FOUND");
      const saved = await tx.recipeItem.upsert({
        where: { productId_ingredientId: { productId: body.productId!, ingredientId: body.ingredientId! } },
        update: { quantity },
        create: { productId: body.productId!, ingredientId: body.ingredientId!, quantity },
        include: { product: { select: { id: true, name: true } }, ingredient: { select: { id: true, name: true, unit: true } } },
      });
      await tx.auditEvent.create({ data: { userId: user.id, action: "RECIPE_ITEM_SAVED", entityType: "RecipeItem", entityId: saved.id, details: { productId: body.productId, ingredientId: body.ingredientId, quantity: quantity.toString() } } });
      return saved;
    });
    return NextResponse.json({ recipe });
  } catch (error) {
    if (error instanceof Error && error.message === "BRANCH_RESOURCE_NOT_FOUND") return NextResponse.json({ error: "The selected product or ingredient is not available in this branch." }, { status: 404 });
    return NextResponse.json({ error: "Recipe could not be saved. Check the selected product and ingredient." }, { status: 409 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await inventoryAccess();
  if (access.response) return access.response;
  const user = access.user!;
  const rate = await checkActionRateLimit("recipe-write", user.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many recipe changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: { productId?: string; ingredientId?: string };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.productId !== "string" || !body.productId || body.productId.length > 64 ||
      typeof body.ingredientId !== "string" || !body.ingredientId || body.ingredientId.length > 64) {
    return NextResponse.json({ error: "Product and ingredient are required." }, { status: 400 });
  }
  try {
    await prisma.$transaction(async (tx) => {
      const [product, ingredient] = await Promise.all([
        tx.product.findFirst({ where: { id: body.productId!, branchId: user.branchId }, select: { id: true } }),
        tx.ingredient.findFirst({ where: { id: body.ingredientId!, branchId: user.branchId }, select: { id: true } }),
      ]);
      if (!product || !ingredient) throw new Error("BRANCH_RESOURCE_NOT_FOUND");
      const deleted = await tx.recipeItem.delete({ where: { productId_ingredientId: { productId: body.productId!, ingredientId: body.ingredientId! } } });
      await tx.auditEvent.create({ data: { userId: user.id, action: "RECIPE_ITEM_REMOVED", entityType: "RecipeItem", entityId: deleted.id, details: body } });
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    if (error instanceof Error && error.message === "BRANCH_RESOURCE_NOT_FOUND") return NextResponse.json({ error: "The selected product or ingredient is not available in this branch." }, { status: 404 });
    return NextResponse.json({ error: "Recipe item could not be removed." }, { status: 404 });
  }
}
