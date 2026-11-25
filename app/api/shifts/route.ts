import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const shift = await prisma.shift.findFirst({
    where: { userId: user.id, closedAt: null },
    orderBy: { openedAt: "desc" },
  });
  return NextResponse.json({ shift }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  let body: { openingCashMinor?: number };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const openingCashMinor = body.openingCashMinor;
  if (!Number.isSafeInteger(openingCashMinor) || (openingCashMinor as number) < 0) {
    return NextResponse.json({ error: "Opening cash must be a non-negative amount in minor currency units." }, { status: 400 });
  }

  try {
    const shift = await prisma.$transaction(async (tx) => {
      const active = await tx.shift.findFirst({ where: { userId: user.id, closedAt: null } });
      if (active) throw new Error("SHIFT_ALREADY_OPEN");
      const created = await tx.shift.create({
        data: { userId: user.id, openingCashMinor: openingCashMinor as number },
      });
      await tx.auditEvent.create({
        data: { userId: user.id, action: "SHIFT_OPENED", entityType: "Shift", entityId: created.id, details: { openingCashMinor } },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ shift }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SHIFT_ALREADY_OPEN") {
      return NextResponse.json({ error: "You already have an open shift." }, { status: 409 });
    }
    return NextResponse.json({ error: "Shift could not be opened." }, { status: 503 });
  }
}
