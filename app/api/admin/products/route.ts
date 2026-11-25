import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function managerOnly(): Promise<{ user?: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; response?: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  if (user.role !== "OWNER" && user.role !== "MANAGER") {
    return { response: NextResponse.json({ error: "Manager or owner access required." }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const access = await managerOnly();
  if (access.response) return access.response;
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
      include: { category: { select: { id: true, name: true } } },
    }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, active: true } }),
  ]);
  return NextResponse.json({ products, categories }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await managerOnly();
  if (access.response) return access.response;
  const rate = await checkActionRateLimit("catalog-write", access.user!.id, 60, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many catalogue changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { name?: string; description?: string; imageUrl?: string; sku?: string; priceMinor?: number; currency?: string; categoryId?: string; available?: boolean };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  if (!name || name.length > 100 || typeof body.categoryId !== "string" || !body.categoryId || body.categoryId.length > 64 || !Number.isSafeInteger(body.priceMinor) || (body.priceMinor ?? 0) < 1 || !currency || !/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ error: "Name, category, positive price in minor units and ISO currency are required." }, { status: 400 });
  }
  if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 500)) return NextResponse.json({ error: "Description is too long or invalid." }, { status: 400 });
  if (body.imageUrl !== undefined && (typeof body.imageUrl !== "string" || body.imageUrl.length > 1000 || !/^https:\/\//i.test(body.imageUrl))) return NextResponse.json({ error: "Product image must be an HTTPS URL." }, { status: 400 });
  if (body.sku !== undefined && (typeof body.sku !== "string" || body.sku.length > 100)) return NextResponse.json({ error: "SKU must be 100 characters or fewer." }, { status: 400 });
  if (body.available !== undefined && typeof body.available !== "boolean") return NextResponse.json({ error: "Availability must be true or false." }, { status: 400 });
  try {
    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category || !category.active) return NextResponse.json({ error: "Choose an active category." }, { status: 400 });
    const product = await prisma.product.create({
      data: { name, description: body.description?.trim() || null, imageUrl: body.imageUrl?.trim() || null, sku: body.sku?.trim() || null, priceMinor: body.priceMinor!, currency, categoryId: category.id, available: body.available ?? true },
      include: { category: { select: { id: true, name: true } } },
    });
    await prisma.auditEvent.create({ data: { userId: access.user!.id, action: "PRODUCT_CREATED", entityType: "Product", entityId: product.id, details: { name, priceMinor: product.priceMinor, currency } } });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "That SKU is already in use." }, { status: 409 });
    return NextResponse.json({ error: "Product could not be created." }, { status: 503 });
  }
}
