import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function managerOnly() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  const state = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, state?.permissionOverrides, "MANAGE_CATALOG")) {
    return { response: NextResponse.json({ error: "Catalogue management access required." }, { status: 403 }) };
  }
  return { user };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await managerOnly();
  if (access.response) return access.response;
  const rate = await checkActionRateLimit("catalog-write", access.user!.id, 60, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many catalogue changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { name?: string; description?: string | null; imageUrl?: string | null; sku?: string | null; priceMinor?: number; currency?: string; categoryId?: string; available?: boolean; status?: "ACTIVE" | "ARCHIVED" };
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string") return NextResponse.json({ error: "Product name must be text." }, { status: 400 });
    const name = body.name.trim();
    if (!name || name.length > 100) return NextResponse.json({ error: "Product name must be 1–100 characters." }, { status: 400 });
    data.name = name;
  }
  if (body.description !== undefined) {
    if (body.description !== null && (typeof body.description !== "string" || body.description.length > 500)) return NextResponse.json({ error: "Description is too long or invalid." }, { status: 400 });
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.imageUrl !== undefined) {
    if (body.imageUrl !== null && (typeof body.imageUrl !== "string" || body.imageUrl.length > 1000 || !/^https:\/\//i.test(body.imageUrl))) return NextResponse.json({ error: "Product image must be an HTTPS URL." }, { status: 400 });
    data.imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() || null : null;
  }
  if (body.sku !== undefined) {
    if (body.sku !== null && (typeof body.sku !== "string" || body.sku.length > 100)) return NextResponse.json({ error: "SKU must be 100 characters or fewer." }, { status: 400 });
    data.sku = typeof body.sku === "string" ? body.sku.trim() || null : null;
  }
  if (body.priceMinor !== undefined) {
    if (!Number.isSafeInteger(body.priceMinor) || body.priceMinor < 1) return NextResponse.json({ error: "Price must be a positive integer in minor units." }, { status: 400 });
    data.priceMinor = body.priceMinor;
  }
  if (body.currency !== undefined) {
    if (typeof body.currency !== "string") return NextResponse.json({ error: "Currency must be a three-letter ISO code." }, { status: 400 });
    const currency = body.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a three-letter ISO code." }, { status: 400 });
    data.currency = currency;
  }
  if (body.categoryId !== undefined) {
    if (typeof body.categoryId !== "string" || !body.categoryId || body.categoryId.length > 64) return NextResponse.json({ error: "Choose a valid category." }, { status: 400 });
    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category || !category.active) return NextResponse.json({ error: "Choose an active category." }, { status: 400 });
    data.categoryId = category.id;
  }
  if (body.available !== undefined) {
    if (typeof body.available !== "boolean") return NextResponse.json({ error: "Availability must be true or false." }, { status: 400 });
    data.available = body.available;
  }
  if (body.status !== undefined) {
    if (body.status !== "ACTIVE" && body.status !== "ARCHIVED") return NextResponse.json({ error: "Invalid product status." }, { status: 400 });
    data.status = body.status;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "No valid changes supplied." }, { status: 400 });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data, include: { category: { select: { id: true, name: true } } } });
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PRODUCT_UPDATED", entityType: "Product", entityId: id, details: data as object } });
      return updated;
    });
    return NextResponse.json({ product });
  } catch {
    return NextResponse.json({ error: "Product could not be updated. Check the SKU and try again." }, { status: 409 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedMutationOrigin(_request.headers.get("origin"), _request.nextUrl.origin, _request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await managerOnly();
  if (access.response) return access.response;
  const rate = await checkActionRateLimit("catalog-write", access.user!.id, 60, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many catalogue changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  try {
    const product = await prisma.$transaction(async (tx) => {
      const archived = await tx.product.update({ where: { id }, data: { status: "ARCHIVED", available: false } });
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "PRODUCT_ARCHIVED", entityType: "Product", entityId: id } });
      return archived;
    });
    return NextResponse.json({ product: { id: product.id, status: product.status } });
  } catch {
    return NextResponse.json({ error: "Product could not be archived." }, { status: 404 });
  }
}
