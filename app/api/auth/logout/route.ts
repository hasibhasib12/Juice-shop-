import { NextRequest, NextResponse } from "next/server";
import { isAllowedMutationOrigin } from "@/lib/request-security";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) {
    await destroySession();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const openShift = await prisma.shift.findFirst({ where: { userId: user.id, closedAt: null }, select: { id: true } });
  if (openShift) {
    return NextResponse.json({ error: "Close your cash shift before logging out. Your shift is still open." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  await destroySession();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
