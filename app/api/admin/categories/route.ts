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

async function categoryWriteLimit(userId: string) {
  const rate = await checkActionRateLimit("catalog-write", userId, 60, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many catalogue changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  return null;
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await catalogAccess();
  if (access.response) return access.response;
  const user = access.user!;
  const rateResponse = await categoryWriteLimit(user.id);
  if (rateResponse) return rateResponse;
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { name?: string; sortOrder?: number };
  const name = body.name?.trim();
  if (!name || name.length > 60) return NextResponse.json({ error: "Category name must be 1–60 characters." }, { status: 400 });
  try {
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({ data: { name, sortOrder: Number.isSafeInteger(body.sortOrder) ? body.sortOrder! : 0 } });
      await tx.auditEvent.create({ data: { userId: user.id, action: "CATEGORY_CREATED", entityType: "Category", entityId: created.id, details: { name } } });
      return created;
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Category already exists or could not be created." }, { status: 409 });
  }
}


export async function PATCH(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await catalogAccess();
  if (access.response) return access.response;
  const user = access.user!;
  const rateResponse = await categoryWriteLimit(user.id);
  if (rateResponse) return rateResponse;

  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { id?: unknown; name?: unknown; active?: unknown; sortOrder?: unknown };
  if (typeof body.id !== "string" || !body.id || body.id.length > 64) return NextResponse.json({ error: "A valid category ID is required." }, { status: 400 });

  const data: { name?: string; active?: boolean; sortOrder?: number } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 60) return NextResponse.json({ error: "Category name must be 1–60 characters." }, { status: 400 });
    data.name = body.name.trim();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "Active must be true or false." }, { status: 400 });
    data.active = body.active;
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isSafeInteger(body.sortOrder) || Math.abs(body.sortOrder as number) > 100000) return NextResponse.json({ error: "Sort order must be a valid integer." }, { status: 400 });
    data.sortOrder = body.sortOrder as number;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "No category changes supplied." }, { status: 400 });

  try {
    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({ where: { id: body.id as string }, data });
      await tx.auditEvent.create({ data: { userId: user.id, action: "CATEGORY_UPDATED", entityType: "Category", entityId: updated.id, details: data } });
      return updated;
    });
    return NextResponse.json({ category }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: "Category could not be updated." }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await catalogAccess();
  if (access.response) return access.response;
  const user = access.user!;
  const rateResponse = await categoryWriteLimit(user.id);
  if (rateResponse) return rateResponse;

  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { id?: unknown }).id !== "string") {
    return NextResponse.json({ error: "A category ID is required." }, { status: 400 });
  }
  const id = (parsed as { id: string }).id;
  try {
    const category = await prisma.$transaction(async (tx) => {
      const archived = await tx.category.update({ where: { id }, data: { active: false } });
      await tx.auditEvent.create({ data: { userId: user.id, action: "CATEGORY_ARCHIVED", entityType: "Category", entityId: id, details: { name: archived.name } } });
      return archived;
    });
    return NextResponse.json({ category }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Category could not be archived." }, { status: 404 });
  }
}
