import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkActionRateLimit } from "@/lib/action-rate-limit";
import { isAllowedMutationOrigin } from "@/lib/request-security";
import { withSerializableRetry } from "@/lib/transaction-retry";

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

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const requestedBranchId = request.nextUrl.searchParams.get("branchId");
  if (requestedBranchId && (!user || (user.role !== "OWNER" && requestedBranchId !== user.branchId))) return NextResponse.json({ error: "Branch settings access denied." }, { status: 403 });
  const branchId = requestedBranchId || user?.branchId || null;
  try {
    const rows = await prisma.posSetting.findMany({
      where: { key: { in: Object.values(settingKeys) } },
      select: { key: true, value: true },
    });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const branchRows = branchId ? await prisma.branchSetting.findMany({ where: { branchId, key: { in: ["taxRateBps", "taxLabel", "maxDiscountPercentBps"] } }, select: { key: true, value: true } }) : [];
    const branchStored = new Map(branchRows.map((row) => [row.key, row.value]));
    const settings = Object.fromEntries(
      Object.entries(settingKeys).map(([field, key]) => [
        field,
        field === "taxRateBps" && branchStored.has("taxRateBps") ? branchStored.get("taxRateBps") :
        field === "maxDiscountPercentBps" && branchStored.has("maxDiscountPercentBps") ? branchStored.get("maxDiscountPercentBps") :
        field === "taxLabel" && branchStored.has("taxLabel") ? branchStored.get("taxLabel") :
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

  let body: { branchId?: string; countryCode?: string; countryName?: string; currency?: string; timezone?: string; locale?: string; taxRateBps?: number; taxLabel?: string; maxDiscountPercentBps?: number };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const targetBranchId = typeof body.branchId === "string" ? body.branchId : user.branchId;
  if (!targetBranchId || (user.role !== "OWNER" && targetBranchId !== user.branchId)) return NextResponse.json({ error: "Branch settings access denied." }, { status: 403 });
  const targetBranch = await prisma.branch.findFirst({ where: { id: targetBranchId, active: true }, select: { id: true } });
  if (!targetBranch) return NextResponse.json({ error: "Active branch not found." }, { status: 404 });
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
    await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      const currentCurrencyRow = await tx.posSetting.findUnique({ where: { key: "store.currency" }, select: { value: true } });
      const currentCurrency = typeof currentCurrencyRow?.value === "string" ? currentCurrencyRow.value.toUpperCase() : defaults.currency;
      if (settings.currency !== currentCurrency) {
        const [openShifts, openPurchaseOrders] = await Promise.all([
          tx.shift.count({ where: { closedAt: null } }),
          tx.purchaseOrder.count({ where: { status: { in: ["DRAFT", "PARTIALLY_RECEIVED"] } } }),
        ]);
        if (openShifts > 0 || openPurchaseOrders > 0) throw new Error("STORE_CURRENCY_IN_USE");
      }
      for (const [field, value] of Object.entries(settings)) {
        if (typeof value !== "string" && typeof value !== "number") continue;
        if (field === "taxRateBps" || field === "taxLabel" || field === "maxDiscountPercentBps") {
          await tx.branchSetting.upsert({
            where: { branchId_key: { branchId: targetBranchId, key: field } },
            update: { value },
            create: { branchId: targetBranchId, key: field, value },
          });
        } else {
          await tx.posSetting.upsert({
            where: { key: `store.${field}` },
            update: { value },
            create: { key: `store.${field}`, value },
          });
        }
      }
      await tx.auditEvent.create({
        data: { userId: user.id, action: "STORE_SETTINGS_UPDATED", entityType: "BranchSetting", entityId: targetBranchId, details: { branchId: targetBranchId, ...settings } },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "STORE_CURRENCY_IN_USE") {
      return NextResponse.json({ error: "Close all active cashier shifts and finish or cancel open purchase orders before changing the store currency. This prevents mixed-currency cash reconciliation and inventory valuation." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Store activity changed while settings were being saved. Reload and retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Store settings could not be saved." }, { status: 503 });
  }
}
