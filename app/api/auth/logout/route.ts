import { NextRequest, NextResponse } from "next/server";
import { isAllowedMutationOrigin } from "@/lib/request-security";
import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  await destroySession();
  return NextResponse.json({ ok: true });
}
