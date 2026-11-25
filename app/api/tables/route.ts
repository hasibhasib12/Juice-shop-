import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  const canViewAllOrders = hasPermission(user.role, permissionState?.permissionOverrides, "VIEW_ALL_ORDERS");
  const visibleOrderFilter = { status: "DRAFT" as const, ...(canViewAllOrders ? {} : { cashierId: user.id }) };
  try {
    const [tables, openOrders] = await Promise.all([
      prisma.diningTable.findMany({
        where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, section: true, capacity: true, sortOrder: true,
          orders: { where: visibleOrderFilter, take: 1, select: { id: true, orderNumber: true, customerName: true, totalMinor: true, currency: true, cashier: { select: { name: true } } } } },
      }),
      prisma.order.findMany({ where: visibleOrderFilter,
        orderBy: { createdAt: "asc" }, take: 100,
        select: { id: true, orderNumber: true, customerName: true, totalMinor: true, currency: true, cashier: { select: { name: true } } } }),
    ]);
    return NextResponse.json({ tables: tables.map(({ orders, ...table }) => ({ ...table, currentOrder: orders[0] ?? null })), openOrders }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Tables are unavailable." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_TABLES")) return NextResponse.json({ error: "Table management permission required." }, { status: 403 });
  const rate = await checkActionRateLimit("table-write", user.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many table changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: { name?: string; section?: string; capacity?: number; sortOrder?: number };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed as typeof body;
  } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const section = body.section === undefined || body.section === "" ? null : typeof body.section === "string" ? body.section.trim() : undefined;
  const capacity = body.capacity ?? 2;
  const sortOrder = body.sortOrder ?? 0;
  if (!name || name.length > 40 || section === undefined || (section && section.length > 60) || !Number.isInteger(capacity) || capacity < 1 || capacity > 30 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    return NextResponse.json({ error: "Enter a table name, valid section, capacity (1–30), and sort order." }, { status: 400 });
  }
  try {
    const table = await prisma.$transaction(async (tx) => {
      const created = await tx.diningTable.create({ data: { name, section, capacity, sortOrder } });
      await tx.auditEvent.create({ data: { userId: user.id, action: "DINING_TABLE_CREATED", entityType: "DiningTable", entityId: created.id, details: { name, section, capacity } } });
      return created;
    });
    return NextResponse.json({ table }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "A table with this name already exists." }, { status: 409 });
    return NextResponse.json({ error: "Table could not be created." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_TABLES")) return NextResponse.json({ error: "Table management permission required." }, { status: 403 });
  const rate = await checkActionRateLimit("table-write", user.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many table changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: { id?: string; name?: string; section?: string | null; capacity?: number; sortOrder?: number; active?: boolean };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed as typeof body;
  } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (typeof body.id !== "string" || !body.id || body.id.length > 64) return NextResponse.json({ error: "A valid table ID is required." }, { status: 400 });
  const data: Prisma.DiningTableUpdateInput = {};
  if (body.name !== undefined) { if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 40) return NextResponse.json({ error: "Table name must be 1–40 characters." }, { status: 400 }); data.name = body.name.trim(); }
  if (body.section !== undefined) { if (body.section !== null && (typeof body.section !== "string" || body.section.trim().length > 60)) return NextResponse.json({ error: "Section must be 60 characters or fewer." }, { status: 400 }); data.section = typeof body.section === "string" && body.section.trim() ? body.section.trim() : null; }
  if (body.capacity !== undefined) { if (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 30) return NextResponse.json({ error: "Capacity must be between 1 and 30." }, { status: 400 }); data.capacity = body.capacity; }
  if (body.sortOrder !== undefined) { if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 10000) return NextResponse.json({ error: "Sort order is invalid." }, { status: 400 }); data.sortOrder = body.sortOrder; }
  if (body.active !== undefined) { if (typeof body.active !== "boolean") return NextResponse.json({ error: "Active must be true or false." }, { status: 400 }); data.active = body.active; }
  try {
    const table = await prisma.$transaction(async (tx) => {
      const current = await tx.diningTable.findUnique({ where: { id: body.id }, select: { id: true, name: true, active: true } });
      if (!current) throw new Error("TABLE_NOT_FOUND");
      if (body.active === false) {
        const open = await tx.order.count({ where: { tableId: current.id, status: "DRAFT" } });
        if (open) throw new Error("TABLE_HAS_OPEN_ORDER");
      }
      const updated = await tx.diningTable.update({ where: { id: current.id }, data });
      await tx.auditEvent.create({ data: { userId: user.id, action: "DINING_TABLE_UPDATED", entityType: "DiningTable", entityId: current.id, details: { before: current, changes: body } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ table }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "TABLE_NOT_FOUND") return NextResponse.json({ error: "Table not found." }, { status: 404 });
    if (message === "TABLE_HAS_OPEN_ORDER") return NextResponse.json({ error: "Transfer or close the open order before deactivating this table." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "A table with this name already exists." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Table changed at the same time. Reload and retry." }, { status: 409 });
    return NextResponse.json({ error: "Table could not be updated." }, { status: 503 });
  }
}
