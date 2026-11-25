import { NextRequest, NextResponse } from "next/server";\nimport { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const defaults = {
  countryCode: "AF",
  countryName: "Afghanistan",
  currency: "AFN",
  timezone: "Asia/Kabul",
  locale: "en-AF",
};

const settingKeys = {
  countryCode: "store.countryCode",
  countryName: "store.countryName",
  currency: "store.currency",
  timezone: "store.timezone",
  locale: "store.locale",
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
    // Keep the POS display predictable while the initial database migration is pending.
    return NextResponse.json(
      { settings: defaults, configured: false, source: "defaults" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  if (user.role !== "OWNER") return NextResponse.json({ error: "Only the owner can change store settings." }, { status: 403 });

  let body: { countryCode?: string; countryName?: string; currency?: string; timezone?: string; locale?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const settings = {
    countryCode: body.countryCode,
    countryName: body.countryName,
    currency: body.currency,
    timezone: body.timezone,
    locale: body.locale,
  };
  if (!settings.countryCode || !/^[A-Z]{2}$/.test(settings.countryCode) ||
      !settings.countryName || settings.countryName.trim().length > 80 ||
      !settings.currency || !/^[A-Z]{3}$/.test(settings.currency) ||
      !settings.timezone || settings.timezone.length > 80 ||
      !settings.locale || settings.locale.length > 24) {
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
        await tx.posSetting.upsert({
          where: { key: `store.${field}` },
          update: { value },
          create: { key: `store.${field}`, value },
        });
      }
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          action: "STORE_SETTINGS_UPDATED",
          entityType: "PosSetting",
          details: settings,
        },
      });
    });
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "Store settings could not be saved." }, { status: 503 });
  }
}
