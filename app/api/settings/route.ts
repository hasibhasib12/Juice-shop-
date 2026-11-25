import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const defaults = {
  countryCode: "AF",
  countryName: "Afghanistan",
  currency: "AFN",
  timezone: "Asia/Kabul",
  locale: "en-AF",
  taxRateBps: 0,
  taxLabel: "Tax",
  maxDiscountPercentBps: 10000,
};

const settingKeys = {
  countryCode: "store.countryCode",
  countryName: "store.countryName",
  currency: "store.currency",
  timezone: "store.timezone",
  locale: "store.locale",
  taxRateBps: "store.taxRateBps",
  taxLabel: "store.taxLabel",
  maxDiscountPercentBps: "store.maxDiscountPercentBps",
} as const;

export async function GET() {
  try {
    const rows = await prisma.posSetting.findMany({
      where: { key: { in: Object.values(settingKeys) } },
      select: { key: true, value: true },
    });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const settings = Object.fromEntries(
      Object.entries(settingKeys).map(([field, key]) => [
        field,
        stored.has(key) ? stored.get(key) : defaults[field as keyof typeof defaults],
      ]),
    );
    return NextResponse.json(
      { settings, configured: rows.length === Object.keys(settingKeys).length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { settings: defaults, configured: false, source: "defaults" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isAllowedMutationOrigin(request.headers.get("origin"), request.nextUrl.origin, request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "OWNER") return NextResponse.json({ error: "Only the owner can change store settings." }, { status: 403 });
  const rate = await checkActionRateLimit("store-settings-write", user.id, 10, 900);
  if (!rate.allowed) return NextResponse.json({ error: "Too many settings changes. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  let body: { countryCode?: string; countryName?: string; currency?: string; timezone?: string; locale?: string; taxRateBps?: number; taxLabel?: string; maxDiscountPercentBps?: number };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const settings = {
    countryCode: body.countryCode,
    countryName: body.countryName,
    currency: body.currency,
    timezone: body.timezone,
    locale: body.locale,
    taxRateBps: body.taxRateBps,
    taxLabel: body.taxLabel,
    maxDiscountPercentBps: body.maxDiscountPercentBps,
  };
  if (typeof settings.countryCode !== "string" || !/^[A-Z]{2}$/.test(settings.countryCode) ||
      typeof settings.countryName !== "string" || !settings.countryName.trim() || settings.countryName.trim().length > 80 ||
      typeof settings.currency !== "string" || !/^[A-Z]{3}$/.test(settings.currency) ||
      typeof settings.timezone !== "string" || !settings.timezone || settings.timezone.length > 80 ||
      typeof settings.locale !== "string" || !settings.locale || settings.locale.length > 24 ||
      !Number.isSafeInteger(settings.taxRateBps) || (settings.taxRateBps ?? -1) < 0 || (settings.taxRateBps ?? 10001) > 10000 ||
      typeof settings.taxLabel !== "string" || !settings.taxLabel.trim() || settings.taxLabel.trim().length > 30 ||
      !Number.isSafeInteger(settings.maxDiscountPercentBps) || (settings.maxDiscountPercentBps ?? -1) < 1 || (settings.maxDiscountPercentBps ?? 10001) > 10000) {
    return NextResponse.json({ error: "Provide a valid country, ISO currency code, timezone and locale." }, { status: 400 });
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone });
    new Intl.NumberFormat(settings.locale, { style: "currency", currency: settings.currency });
  } catch {
    return NextResponse.json({ error: "The timezone, locale or currency is not supported." }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const [field, value] of Object.entries(settings)) {
        if (typeof value !== "string" && typeof value !== "number") continue;
        await tx.posSetting.upsert({
          where: { key: `store.${field}` },
          update: { value },
          create: { key: `store.${field}`, value },
        });
      }
      await tx.auditEvent.create({
        data: { userId: user.id, action: "STORE_SETTINGS_UPDATED", entityType: "PosSetting", details: settings },
      });
    });
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Store settings could not be saved." }, { status: 503 });
  }
}
