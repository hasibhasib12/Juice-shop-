import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword, verifyPassword, createSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (currentPassword.length < 1 || currentPassword.length > 256 || newPassword.length < 12 || newPassword.length > 256) {
    return NextResponse.json({ error: "Enter your current password and a new password of at least 12 characters." }, { status: 400 });
  }

  try {
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, active: true } });
    if (!account?.active || !verifyPassword(currentPassword, account.passwordHash)) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
    }
    if (verifyPassword(newPassword, account.passwordHash)) {
      return NextResponse.json({ error: "Choose a new password different from your current password." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: user.id, active: true, passwordHash: account.passwordHash },
        data: { passwordHash: hashPassword(newPassword), sessionVersion: { increment: 1 } },
      });
      if (changed.count !== 1) throw new Error("ACCOUNT_CHANGED");
      await tx.auditEvent.create({
        data: { userId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id },
      });
    });

    await createSession({ id: user.id });
    return NextResponse.json({ ok: true, message: "Password changed. Other active sessions have been signed out." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_CHANGED") {
      return NextResponse.json({ error: "Account changed during this request. Please sign in and try again." }, { status: 409 });
    }
    return NextResponse.json({ error: "Password could not be changed right now." }, { status: 503 });
  }
}
