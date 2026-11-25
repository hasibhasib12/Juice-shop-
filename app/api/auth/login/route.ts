import { NextRequest, NextResponse } from "next/server";
import { authenticate, createSession } from "@/lib/auth";
import { checkLoginRateLimit, clearLoginRateLimit } from "@/lib/login-rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const body = parsed as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || email.length > 254 || password.length < 1 || password.length > 256) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });
    }

    const rateLimit = await checkLoginRateLimit(email);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
      );
    }

    const user = await authenticate(email, password);
    if (!user) return NextResponse.json({ error: "Invalid email or password." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    await clearLoginRateLimit(email);
    await createSession(user);
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  }
}
