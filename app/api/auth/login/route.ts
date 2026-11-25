import { NextRequest, NextResponse } from "next/server";
import { authenticate, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (email.length > 254 || password.length < 1 || password.length > 256) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 400 });
    }

    const user = await authenticate(email, password);
    if (!user) return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    await createSession(user);
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  }
}
