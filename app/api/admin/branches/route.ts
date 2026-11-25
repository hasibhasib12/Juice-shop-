import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER" && actor.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  const branches = await prisma.branch.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, timezone: true, currency: true } });
  return NextResponse.json({ branches }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (actor.role !== "OWNER") return NextResponse.json({ error: "Only the owner can create branches." }, { status: 403 });
  let body: { name?: string; code?: string; timezone?: string; currency?: string };
  try { const parsed: unknown = await request.json(); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); body = parsed as typeof body; }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "Asia/Kabul";
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "AFN";
  if (name.length < 2 || name.length > 80 || !/^[A-Z0-9_-]{2,12}$/.test(code) || timezone.length > 80 || !/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Enter a branch name, a 2–12 character code, timezone and three-letter currency code." }, { status: 400 });
  try {
    const branch = await prisma.branch.create({ data: { name, code, timezone, currency } });
    await prisma.auditEvent.create({ data: { userId: actor.id, action: "BRANCH_CREATED", entityType: "Branch", entityId: branch.id, details: { name, code, timezone, currency } } });
    return NextResponse.json({ branch }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "That branch code already exists or the branch could not be created." }, { status: 409 }); }
}
