import { NextRequest, NextResponse } from "next/server";
import { isAllowedMutationOrigin } from "@/lib/request-security";
import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createSession, hashPassword } from "@/lib/auth";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const setupSecret = process.env.POS_SETUP_KEY;
  if (!setupSecret || setupSecret.length < 32) {
    return NextResponse.json({ error: "Initial setup is not enabled." }, { status: 503 });
  }

  try {
    const rate = await checkActionRateLimit("initial-setup", "global", 5, 900);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many initial setup attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds), "Cache-Control": "no-store" } },
      );
    }
  } catch {
    return NextResponse.json({ error: "Initial setup is temporarily unavailable." }, { status: 503 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const body = parsed as { setupKey?: unknown; name?: unknown; email?: unknown; password?: unknown };

  const supplied = typeof body.setupKey === "string" && body.setupKey.length <= 256 ? Buffer.from(body.setupKey) : Buffer.alloc(0);
  const expected = Buffer.from(setupSecret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Invalid setup key." }, { status: 401 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 || password.length < 12 || password.length > 256) {
    return NextResponse.json({ error: "Enter a valid name, email and password (at least 12 characters)." }, { status: 400 });
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      if (await tx.user.count() !== 0) throw new Error("SETUP_ALREADY_COMPLETE");
      const created = await tx.user.create({
        data: { name, email, passwordHash: hashPassword(password), role: "OWNER", active: true },
        select: { id: true, name: true, email: true, role: true },
      });
      await tx.auditEvent.create({
        data: { userId: created.id, action: "INITIAL_OWNER_CREATED", entityType: "User", entityId: created.id },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    await createSession(user);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SETUP_ALREADY_COMPLETE") {
      return NextResponse.json({ error: "Initial setup has already been completed." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That email address is already registered." }, { status: 409 });
    }
    return NextResponse.json({ error: "Initial setup could not be completed." }, { status: 503 });
  }
}
