import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const rate = await checkActionRateLimit("staff-write", actor.id, 10, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many staff changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { id } = await context.params;
  let body: { active?: boolean; role?: "OWNER" | "MANAGER" | "CASHIER" };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.active !== undefined && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Active must be true or false." }, { status: 400 });
  }
  if (body.role !== undefined && !["OWNER", "MANAGER", "CASHIER"].includes(body.role)) {
    return NextResponse.json({ error: "Invalid staff role." }, { status: 400 });
  }
  if (body.active === undefined && body.role === undefined) {
    return NextResponse.json({ error: "No staff changes supplied." }, { status: 400 });
  }
  if (id === actor.id) {
    return NextResponse.json({ error: "You cannot change your own account status or role." }, { status: 400 });
  }
  if (actor.role !== "OWNER" && body.role !== undefined) {
    return NextResponse.json({ error: "Only the owner can change staff roles." }, { status: 403 });
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, active: true, sessionVersion: true },
      });
      if (!target) throw new Error("STAFF_NOT_FOUND");
      // Managers may only activate/deactivate cashier accounts, never manager or owner accounts.
      if (actor.role === "MANAGER" && target.role !== "CASHIER") {
        throw new Error("STAFF_FORBIDDEN");
      }
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.role !== undefined ? { role: body.role } : {}),
          // Revoke all existing sessions whenever account access or privilege changes.
          sessionVersion: { increment: 1 },
        },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      await tx.auditEvent.create({
        data: {
          userId: actor.id,
          action: "STAFF_UPDATED",
          entityType: "User",
          entityId: id,
          details: { previousRole: target.role, previousActive: target.active, active: body.active, role: body.role, sessionsRevoked: true },
        },
      });
      return updated;
    });
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "STAFF_NOT_FOUND") {
      return NextResponse.json({ error: "Staff account not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "STAFF_FORBIDDEN") {
      return NextResponse.json({ error: "Managers may only update cashier accounts." }, { status: 403 });
    }
    return NextResponse.json({ error: "Staff account could not be updated." }, { status: 503 });
  }
}
