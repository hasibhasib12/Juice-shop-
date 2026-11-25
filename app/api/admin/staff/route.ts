import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { effectivePermissions } from "@/lib/permissions";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const users = await prisma.user.findMany({ where: actor.role === "OWNER" ? {} : { branchId: actor.branchId }, orderBy: [{ approvalStatus: "asc" }, { active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, active: true, approvalStatus: true, createdAt: true, phone: true, photoUrl: true, employeeCode: true, branch: { select: { id: true, name: true, code: true } }, permissionOverrides: true } });
  const usersWithPermissions = users.map(({ permissionOverrides, ...user }) => ({ ...user, permissions: effectivePermissions(user.role, permissionOverrides) }));
  return NextResponse.json({ users: usersWithPermissions, currentRole: actor.role, currentUserId: actor.id }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const rate = await checkActionRateLimit("staff-write", actor.id, 10, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many staff changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const body = parsed as { name?: string; email?: string; password?: string; role?: "MANAGER" | "CASHIER"; branchId?: string; phone?: string; photoUrl?: string; employeeCode?: string };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!name || name.length > 80 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 200) {
    return NextResponse.json({ error: "Provide a name, valid email and password of at least 12 characters." }, { status: 400 });
  }
  if (body.role !== undefined && body.role !== "MANAGER" && body.role !== "CASHIER") return NextResponse.json({ error: "Choose a valid staff role." }, { status: 400 });
  if (body.role === "MANAGER" && actor.role !== "OWNER") return NextResponse.json({ error: "Only the owner can create manager accounts." }, { status: 403 });
  const role = body.role === "MANAGER" ? "MANAGER" : "CASHIER";
  const branchId = typeof body.branchId === "string" ? body.branchId : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const employeeCode = typeof body.employeeCode === "string" ? body.employeeCode.trim().toUpperCase() : "";
  const photoUrl = typeof body.photoUrl === "string" ? body.photoUrl.trim() : "";
  if (!branchId) return NextResponse.json({ error: "Assign this employee to a branch." }, { status: 400 });
  if (actor.role === "MANAGER" && branchId !== actor.branchId) return NextResponse.json({ error: "Managers can only create staff in their own branch." }, { status: 403 });
  if (phone.length > 30 || employeeCode.length > 24 || (employeeCode && !/^[A-Z0-9_-]+$/.test(employeeCode)) || (photoUrl && (!/^https:\/\//i.test(photoUrl) || photoUrl.length > 2048))) return NextResponse.json({ error: "Check the phone, employee code and secure photo URL." }, { status: 400 });
  try {
    const user = await prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: branchId, active: true }, select: { id: true } });
      if (!branch) throw new Error("BRANCH_NOT_FOUND");
      const created = await tx.user.create({ data: { name, email, passwordHash: hashPassword(body.password!), role, branchId, active: actor.role === "OWNER", approvalStatus: actor.role === "OWNER" ? "APPROVED" : "PENDING", phone: phone || null, employeeCode: employeeCode || null, photoUrl: photoUrl || null }, select: { id: true, name: true, email: true, role: true, active: true, approvalStatus: true, phone: true, employeeCode: true, photoUrl: true, branch: { select: { id: true, name: true, code: true } } } });
      await tx.auditEvent.create({ data: { userId: actor.id, action: "STAFF_CREATED", entityType: "User", entityId: created.id, details: { name, email, role, branchId, phone: phone || null, employeeCode: employeeCode || null, approvalStatus: actor.role === "OWNER" ? "APPROVED" : "PENDING" } } });
      return created;
    });
    return NextResponse.json({ user, message: actor.role === "OWNER" ? "Staff account created and active." : "Staff request submitted. The platform owner must approve it before sign-in is enabled." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "BRANCH_NOT_FOUND") return NextResponse.json({ error: "Selected branch is unavailable." }, { status: 400 });
    return NextResponse.json({ error: "That email or employee code is already registered, or staff could not be created." }, { status: 409 });
  }
}
