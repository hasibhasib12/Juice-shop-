import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "MANAGER") return NextResponse.json({ error: "Manager or owner access required." }, { status: 403 });
  let body: { name?: string; sortOrder?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const name = body.name?.trim();
  if (!name || name.length > 60) return NextResponse.json({ error: "Category name must be 1–60 characters." }, { status: 400 });
  try {
    const category = await prisma.category.create({ data: { name, sortOrder: Number.isSafeInteger(body.sortOrder) ? body.sortOrder! : 0 } });
    await prisma.auditEvent.create({ data: { userId: user.id, action: "CATEGORY_CREATED", entityType: "Category", entityId: category.id, details: { name } } });
    return NextResponse.json({ category }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Category already exists or could not be created." }, { status: 409 });
  }
}
