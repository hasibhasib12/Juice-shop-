import { NextResponse } from "next/server";
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
