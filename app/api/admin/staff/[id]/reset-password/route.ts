import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") {
    return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  }
  const rate = await checkActionRateLimit("staff-password-reset", actor.id, 10, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many password reset requests. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const { id } = await context.params;
  if (id === actor.id) {
    return NextResponse.json({ error: "Use the self-service password change screen for your own account." }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const newPassword = (parsed as { newPassword?: unknown }).newPassword;
  if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 256) {
    return NextResponse.json({ error: "New password must contain 12–256 characters." }, { status: 400 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, active: true, branchId: true },
      });
      if (!target) throw new Error("STAFF_NOT_FOUND");
      if (actor.role === "MANAGER" && (target.role !== "CASHIER" || target.branchId !== actor.branchId)) {
        throw new Error("STAFF_FORBIDDEN");
      }
      if (!target.active) throw new Error("STAFF_INACTIVE");

      const user = await tx.user.update({
        where: { id },
        data: { passwordHash: hashPassword(newPassword), sessionVersion: { increment: 1 } },
        select: { id: true, name: true, email: true, role: true },
      });
      await tx.auditEvent.create({
        data: {
          userId: actor.id,
          action: "STAFF_PASSWORD_RESET",
          entityType: "User",
          entityId: id,
          details: { targetRole: target.role, sessionsRevoked: true },
        },
      });
      return user;
    });
    return NextResponse.json({ user: updated, message: "Password reset. The staff member must sign in again." }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STAFF_NOT_FOUND") {
      return NextResponse.json({ error: "Staff account not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "STAFF_FORBIDDEN") {
      return NextResponse.json({ error: "Managers may reset passwords for cashier accounts in their own branch only." }, { status: 403 });
    }
    if (error instanceof Error && error.message === "STAFF_INACTIVE") {
      return NextResponse.json({ error: "Reactivate the staff account before resetting its password." }, { status: 409 });
    }
    return NextResponse.json({ error: "Password could not be reset." }, { status: 503 });
  }
}
