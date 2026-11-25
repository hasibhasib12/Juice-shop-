import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function managerOnly(): Promise<{ user?: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; response?: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_INVENTORY")) return { response: NextResponse.json({ error: "Inventory access required." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const access = await managerOnly();
  if (access.response) return access.response;
  const ingredients = await prisma.ingredient.findMany({
    orderBy: { name: "asc" },
    include: { recipeItems: { include: { product: { select: { id: true, name: true } } } } },
  });
  return NextResponse.json({ ingredients }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await managerOnly();
  if (access.response) return access.response;
  let body: { action?: "create" | "movement"; name?: string; unit?: string; reorderLevel?: string | number; openingQuantity?: string | number; ingredientId?: string; type?: "PURCHASE" | "WASTE" | "ADJUSTMENT"; quantity?: string | number; reason?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  try {
    if (body.action === "create") {
      const name = body.name?.trim();
      const unit = body.unit?.trim();
      const opening = new Prisma.Decimal(body.openingQuantity ?? 0);
      const reorder = new Prisma.Decimal(body.reorderLevel ?? 0);
      if (!name || name.length > 100 || !unit || unit.length > 20 || !opening.isFinite() || opening.lt(0) || !reorder.isFinite() || reorder.lt(0)) {
        return NextResponse.json({ error: "Provide a name, unit and valid non-negative stock quantities." }, { status: 400 });
      }
      const ingredient = await prisma.$transaction(async (tx) => {
        const created = await tx.ingredient.create({ data: { name, unit, quantityOnHand: opening, reorderLevel: reorder } });
        if (opening.gt(0)) await tx.stockMovement.create({ data: { ingredientId: created.id, type: "PURCHASE", quantity: opening, reason: "Opening stock" } });
        await tx.auditEvent.create({ data: { userId: access.user!.id, action: "INGREDIENT_CREATED", entityType: "Ingredient", entityId: created.id, details: { name, unit, openingQuantity: opening.toString() } } });
        return created;
      });
      return NextResponse.json({ ingredient }, { status: 201 });
    }

    if (body.action === "movement") {
      if (!body.ingredientId || !["PURCHASE", "WASTE", "ADJUSTMENT"].includes(body.type || "")) return NextResponse.json({ error: "Choose an ingredient and movement type." }, { status: 400 });
      const quantity = new Prisma.Decimal(body.quantity ?? "NaN");
      if (!quantity.isFinite() || quantity.lte(0) || quantity.gt(100000000)) return NextResponse.json({ error: "Quantity must be greater than zero." }, { status: 400 });
      const result = await prisma.$transaction(async (tx) => {
        const ingredient = await tx.ingredient.findUnique({ where: { id: body.ingredientId } });
        if (!ingredient) throw new Error("INGREDIENT_NOT_FOUND");
        let delta = quantity;
        if (body.type === "WASTE") delta = quantity.negated();
        if (body.type === "ADJUSTMENT") delta = quantity.minus(ingredient.quantityOnHand);
        const next = ingredient.quantityOnHand.plus(delta);
        if (next.lt(0)) throw new Error("INSUFFICIENT_STOCK");
        const updated = await tx.ingredient.update({ where: { id: ingredient.id }, data: { quantityOnHand: next } });
        await tx.stockMovement.create({ data: { ingredientId: ingredient.id, type: body.type!, quantity: delta, reason: body.reason?.trim().slice(0, 250) || null } });
        await tx.auditEvent.create({ data: { userId: access.user!.id, action: "STOCK_MOVEMENT_RECORDED", entityType: "Ingredient", entityId: ingredient.id, details: { type: body.type, delta: delta.toString(), reason: body.reason || null } } });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ ingredient: result });
    }
    return NextResponse.json({ error: "Unknown inventory action." }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "INGREDIENT_NOT_FOUND") return NextResponse.json({ error: "Ingredient not found." }, { status: 404 });
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") return NextResponse.json({ error: "This movement would make stock negative." }, { status: 409 });
    return NextResponse.json({ error: "Inventory change could not be saved." }, { status: 409 });
  }
}
