import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_INVENTORY")) return NextResponse.json({ error: "Inventory access required." }, { status: 403 });
  const [products, ingredients] = await Promise.all([
    prisma.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, include: { recipeItems: { include: { ingredient: true } } } }),
    prisma.ingredient.findMany({ orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ products, ingredients }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  let body: { productId?: string; ingredientId?: string; quantity?: string | number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const quantity = new Prisma.Decimal(body.quantity ?? "NaN");
  if (!body.productId || !body.ingredientId || !quantity.isFinite() || quantity.lte(0)) return NextResponse.json({ error: "Choose a product, ingredient and positive recipe quantity." }, { status: 400 });
  try {
    const recipe = await prisma.recipeItem.upsert({
      where: { productId_ingredientId: { productId: body.productId, ingredientId: body.ingredientId } },
      update: { quantity },
      create: { productId: body.productId, ingredientId: body.ingredientId, quantity },
      include: { product: { select: { id: true, name: true } }, ingredient: { select: { id: true, name: true, unit: true } } },
    });
    await prisma.auditEvent.create({ data: { userId: user.id, action: "RECIPE_ITEM_SAVED", entityType: "RecipeItem", entityId: recipe.id, details: { productId: body.productId, ingredientId: body.ingredientId, quantity: quantity.toString() } } });
    return NextResponse.json({ recipe });
  } catch {
    return NextResponse.json({ error: "Recipe could not be saved. Check the selected product and ingredient." }, { status: 409 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  let body: { productId?: string; ingredientId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body.productId || !body.ingredientId) return NextResponse.json({ error: "Product and ingredient are required." }, { status: 400 });
  try {
    await prisma.recipeItem.delete({ where: { productId_ingredientId: { productId: body.productId, ingredientId: body.ingredientId } } });
    await prisma.auditEvent.create({ data: { userId: user.id, action: "RECIPE_ITEM_REMOVED", entityType: "RecipeItem", details: body } });
    return NextResponse.json({ removed: true });
  } catch { return NextResponse.json({ error: "Recipe item could not be removed." }, { status: 404 }); }
}
