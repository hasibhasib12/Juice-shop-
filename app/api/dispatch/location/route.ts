import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LocationBody = {
  action?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracyMeters?: unknown;
  headingDegrees?: unknown;
  speedMetersPerSecond?: unknown;
};

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "DRIVER") return NextResponse.json({ error: "Only drivers can share driver location." }, { status: 403 });

  let body: LocationBody;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as LocationBody;
  } catch {
    return NextResponse.json({ error: "Invalid location request." }, { status: 400 });
  }

  try {
    if (body.action === "stop") {
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { driverOnDuty: false } }),
        prisma.driverLocation.deleteMany({ where: { driverId: user.id, branchId: user.branchId } }),
      ]);
      await prisma.auditEvent.create({ data: { userId: user.id, action: "DRIVER_LOCATION_SHARING_STOPPED", entityType: "User", entityId: user.id } });
      return NextResponse.json({ ok: true, onDuty: false });
    }

    if (body.action !== "start" && body.action !== "update") {
      return NextResponse.json({ error: "Choose start, update, or stop." }, { status: 400 });
    }
    if (!validCoordinate(body.latitude, -90, 90) || !validCoordinate(body.longitude, -180, 180)) {
      return NextResponse.json({ error: "A valid phone GPS location is required." }, { status: 400 });
    }
    const optionalNumber = (value: unknown, min: number, max: number) =>
      typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
    const onDuty = await prisma.user.findFirst({ where: { id: user.id, branchId: user.branchId, role: "DRIVER", active: true, approvalStatus: "APPROVED" }, select: { driverOnDuty: true } });
    if (!onDuty) return NextResponse.json({ error: "Active driver account required." }, { status: 403 });
    if (body.action === "update" && !onDuty.driverOnDuty) return NextResponse.json({ error: "Start duty before sharing location." }, { status: 409 });

    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { driverOnDuty: true } }),
      prisma.driverLocation.upsert({
        where: { driverId: user.id },
        create: {
          driverId: user.id, branchId: user.branchId, latitude: body.latitude, longitude: body.longitude,
          accuracyMeters: optionalNumber(body.accuracyMeters, 0, 10000),
          headingDegrees: optionalNumber(body.headingDegrees, 0, 360),
          speedMetersPerSecond: optionalNumber(body.speedMetersPerSecond, 0, 150),
          capturedAt: now, updatedAt: now,
        },
        update: {
          branchId: user.branchId, latitude: body.latitude, longitude: body.longitude,
          accuracyMeters: optionalNumber(body.accuracyMeters, 0, 10000),
          headingDegrees: optionalNumber(body.headingDegrees, 0, 360),
          speedMetersPerSecond: optionalNumber(body.speedMetersPerSecond, 0, 150),
          capturedAt: now, updatedAt: now,
        },
      }),
    ]);
    if (body.action === "start") {
      await prisma.auditEvent.create({ data: { userId: user.id, action: "DRIVER_LOCATION_SHARING_STARTED", entityType: "User", entityId: user.id } });
    }
    return NextResponse.json({ ok: true, onDuty: true, capturedAt: now.toISOString() });
  } catch {
    return NextResponse.json({ error: "Could not save your GPS location. Try again." }, { status: 503 });
  }
}
