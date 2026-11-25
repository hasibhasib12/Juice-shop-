import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const { id } = await context.params;
  let body: { active?: boolean; role?: "OWNER" | "MANAGER" | "CASHIER" };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (id === actor.id && (body.active === false || (body.role && body.role !== actor.role))) return NextResponse.json({ error: "You cannot deactivate or change your own role." }, { status: 400 });
  if (body.role && actor.role !== "OWNER") return NextResponse.json({ error: "Only the owner can change staff roles." }, { status: 403 });
  if (body.role && !["OWNER", "MANAGER", "CASHIER"].includes(body.role)) return NextResponse.json({ error: "Invalid staff role." }, { status: 400 });
  if (body.active === undefined && body.role === undefined) return NextResponse.json({ error: "No staff changes supplied." }, { status: 400 });
  try {
    const user = await prisma.user.update({ where: { id }, data: { ...(body.active !== undefined ? { active: body.active } : {}), ...(body.role ? { role: body.role } : {}) }, select: { id: true, name: true, email: true, role: true, active: true } });
    await prisma.auditEvent.create({ data: { userId: actor.id, action: "STAFF_UPDATED", entityType: "User", entityId: id, details: { active: body.active, role: body.role } } });
    return NextResponse.json({ user });
  } catch { return NextResponse.json({ error: "Staff account could not be updated." }, { status: 404 }); }
}
