import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { hasPermission } from "@/lib/permissions";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function managerOnly() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign-in required." }, { status: 401 }) };
  const permissionState = await prisma.user.findUnique({ where: { id: user.id }, select: { permissionOverrides: true } });
  if (!hasPermission(user.role, permissionState?.permissionOverrides, "MANAGE_PURCHASING")) return { response: NextResponse.json({ error: "Purchasing access required." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const access = await managerOnly();
  if (access.response) return access.response;
  const suppliers = await prisma.supplier.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return NextResponse.json({ suppliers }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await managerOnly();
  if (access.response) return access.response;
  const rate = await checkActionRateLimit("supplier-write", access.user!.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many supplier changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const value = body as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 120) return NextResponse.json({ error: "Supplier name must be 1–120 characters." }, { status: 400 });
  const optional = (key: string, max: number) => {
    const v = value[key];
    if (v === undefined || v === null || v === "") return null;
    return typeof v === "string" && v.trim().length <= max ? v.trim() : undefined;
  };
  const contact = optional("contact", 120);
  const phone = optional("phone", 40);
  const email = optional("email", 254);
  const address = optional("address", 500);
  const notes = optional("notes", 1000);
  if ([contact, phone, email, address, notes].includes(undefined)) return NextResponse.json({ error: "Supplier contact fields are too long or invalid." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid supplier email address." }, { status: 400 });
  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({ data: { name, contact, phone, email, address, notes } });
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "SUPPLIER_CREATED", entityType: "Supplier", entityId: created.id, details: { name } } });
      return created;
    });
    return NextResponse.json({ supplier }, { status: 201 });
  } catch { return NextResponse.json({ error: "Supplier could not be created." }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const access = await managerOnly();
  if (access.response) return access.response;
  const rate = await checkActionRateLimit("supplier-write", access.user!.id, 30, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many supplier changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const value = body as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return NextResponse.json({ error: "Supplier ID is required." }, { status: 400 });
  const data: Record<string, string | boolean | null> = {};
  if (value.name !== undefined) {
    if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 120) return NextResponse.json({ error: "Supplier name must be 1–120 characters." }, { status: 400 });
    data.name = value.name.trim();
  }
  for (const [key, max] of [["contact", 120], ["phone", 40], ["email", 254], ["address", 500], ["notes", 1000]] as const) {
    if (value[key] !== undefined) {
      if (value[key] === null || value[key] === "") data[key] = null;
      else if (typeof value[key] === "string" && value[key].trim().length <= max) data[key] = value[key].trim();
      else return NextResponse.json({ error: `Invalid supplier ${key}.` }, { status: 400 });
    }
  }
  if (typeof data.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return NextResponse.json({ error: "Enter a valid supplier email address." }, { status: 400 });
  if (value.active !== undefined) {
    if (typeof value.active !== "boolean") return NextResponse.json({ error: "Active must be true or false." }, { status: 400 });
    data.active = value.active;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "No supplier changes supplied." }, { status: 400 });
  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({ where: { id: value.id as string }, data });
      await tx.auditEvent.create({ data: { userId: access.user!.id, action: "SUPPLIER_UPDATED", entityType: "Supplier", entityId: updated.id, details: data } });
      return updated;
    });
    return NextResponse.json({ supplier }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Supplier could not be updated." }, { status: 404 }); }
}
