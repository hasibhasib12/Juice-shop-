import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } });
  return NextResponse.json({ users, currentRole: actor.role }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  let body: { name?: string; email?: string; password?: string; role?: "MANAGER" | "CASHIER" };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!name || name.length > 80 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 200) {
    return NextResponse.json({ error: "Provide a name, valid email and password of at least 12 characters." }, { status: 400 });
  }
  if (body.role === "MANAGER" && actor.role !== "OWNER") return NextResponse.json({ error: "Only the owner can create manager accounts." }, { status: 403 });
  const role = body.role === "MANAGER" ? "MANAGER" : "CASHIER";
  try {
    const user = await prisma.user.create({ data: { name, email, passwordHash: hashPassword(body.password), role }, select: { id: true, name: true, email: true, role: true, active: true } });
    await prisma.auditEvent.create({ data: { userId: actor.id, action: "STAFF_CREATED", entityType: "User", entityId: user.id, details: { name, email, role } } });
    return NextResponse.json({ user }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "That email is already registered or staff could not be created." }, { status: 409 });
  }
}
