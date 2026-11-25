import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createTextPdf } from "@/lib/simple-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function money(minor: number, currency: string) {
  return (minor / 100).toFixed(2) + " " + currency;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { id: "asc" } },
        payments: true,
        refunds: { orderBy: { createdAt: "desc" } },
        cashier: { select: { id: true, name: true, branchId: true } },
      },
    });
    if (!order || order.cashier.branchId !== user.branchId) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    const permissionState = await prisma.user.findUnique({
      where: { id: user.id },
      select: { permissionOverrides: true },
    });
    const canViewAll = hasPermission(user.role, permissionState?.permissionOverrides, "VIEW_ALL_ORDERS");
    if (!canViewAll && order.cashierId !== user.id) {
      return NextResponse.json({ error: "You cannot view this order." }, { status: 403 });
    }

    const lines = [
      "JUICE SHOP",
      "Fresh - Healthy - Happy",
      "RECEIPT #" + order.orderNumber,
      "Status: " + order.status,
      "Date: " + (order.completedAt?.toISOString() ?? order.createdAt.toISOString()),
      "Cashier: " + order.cashier.name,
      ...(order.customerName ? ["Customer: " + order.customerName] : []),
      ...(order.notes ? ["Notes: " + order.notes] : []),
      "----------------------------------------",
      "ITEMS",
      ...order.lines.flatMap((line) => [
        line.productName + (line.variantName ? " - " + line.variantName : ""),
        "  " + line.quantity + " x " + money(line.unitPriceMinor, order.currency) + " = " + money(line.lineTotalMinor, order.currency),
      ]),
      "----------------------------------------",
      "Subtotal: " + money(order.subtotalMinor, order.currency),
      "Discount: -" + money(order.discountMinor, order.currency),
      "Tax: " + money(order.taxMinor, order.currency),
      "TOTAL: " + money(order.totalMinor, order.currency),
      "----------------------------------------",
      "PAYMENTS",
      ...order.payments.map((payment) =>
        (payment.method === "OTHER" ? "Other (manual)" : payment.method) +
        " - " + payment.status + " - " + money(payment.amountMinor, payment.currency || order.currency)
      ),
      ...order.payments.some((payment) => payment.cashReceivedMinor != null)
        ? ["Cash received: " + money(order.payments.reduce((sum, payment) => sum + (payment.cashReceivedMinor ?? 0), 0), order.currency),
          "Change due: " + money(order.payments.reduce((sum, payment) => sum + (payment.changeDueMinor ?? 0), 0), order.currency)]
        : [],
      ...(order.refunds.length ? ["REFUNDS", ...order.refunds.map((refund) =>
        refund.kind + " - " + money(refund.amountMinor, order.currency) + " - " + refund.reason
      )] : []),
      "",
      "Thank you for choosing Juice Shop!",
      "Please keep this receipt for your records.",
    ];
    const pdf = createTextPdf(lines);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="juice-shop-receipt-' + order.orderNumber + '.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Receipt PDF is unavailable." }, { status: 503 });
  }
}
