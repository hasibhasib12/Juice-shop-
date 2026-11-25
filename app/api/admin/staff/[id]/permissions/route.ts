import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { PERMISSIONS, effectivePermissions, normalizePermissionOverrides } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER") return NextResponse.json({ error: "Only the owner can configure individual permissions." }, { status: 403 });
  const { id } = await context.params;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, permissionOverrides: true } });
  if (!target) return NextResponse.json({ error: "Staff account not found." }, { status: 404 });
  return NextResponse.json({ permissions: PERMISSIONS, overrides: normalizePermissionOverrides(target.permissionOverrides), effective: effectivePermissions(target.role, target.permissionOverrides), role: target.role }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER") return NextResponse.json({ error: "Only the owner can configure individual permissions." }, { status: 403 });
  const { id } = await context.params;
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const input = (parsed as { overrides?: unknown }).overrides;
  if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ error: "Provide an overrides object." }, { status: 400 });
  const raw = input as Record<string, unknown>;
  const allowed = new Set<string>(PERMISSIONS.map(({ key }) => key));
  if (Object.keys(raw).some((key) => !allowed.has(key)) || Object.values(raw).some((value) => value !== true && value !== false && value !== null)) return NextResponse.json({ error: "Unknown permission or invalid override." }, { status: 400 });
  const overrides = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, permissionOverrides: true } });
      if (!target) throw new Error("STAFF_NOT_FOUND");
      if (target.role === "OWNER") throw new Error("OWNER_FIXED");
      const updated = await tx.user.update({ where: { id }, data: { permissionOverrides: overrides }, select: { id: true, name: true, role: true, permissionOverrides: true } });
      await tx.auditEvent.create({ data: { userId: actor.id, action: "STAFF_PERMISSIONS_UPDATED", entityType: "User", entityId: id, details: { previous: normalizePermissionOverrides(target.permissionOverrides), next: overrides } } });
      return updated;
    });
    return NextResponse.json({ user: { id: result.id, name: result.name, role: result.role }, overrides: normalizePermissionOverrides(result.permissionOverrides), effective: effectivePermissions(result.role, result.permissionOverrides) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "STAFF_NOT_FOUND") return NextResponse.json({ error: "Staff account not found." }, { status: 404 });
    if (error instanceof Error && error.message === "OWNER_FIXED") return NextResponse.json({ error: "Owner permissions are always enabled." }, { status: 409 });
    return NextResponse.json({ error: "Permissions could not be updated." }, { status: 503 });
  }
}
