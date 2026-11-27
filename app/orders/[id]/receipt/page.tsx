"use client";

import Link from "next/link";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Order = { id: string; orderNumber: number; status: string; orderType?: "TAKEAWAY" | "DINE_IN"; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; currency: string; customerName?: string | null; notes?: string | null; completedAt: string | null; cashier: { name: string }; lines: { id: string; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; variantName?: string | null; selectedModifiers?: { name?: string; groupName?: string; priceDeltaMinor?: number }[] | null }[]; payments: { method: string; amountMinor: number; status: string; cashReceivedMinor?: number | null; changeDueMinor?: number | null; currency?: string }[]; refunds: { kind: string; amountMinor: number; reason: string; id: string; createdAt: string; cashRefundMinor: number; otherRefundMinor: number; taxRefundMinor: number }[] };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [notice, setNotice] = useState("");
  const autoPrintStarted = useRef(false);
  useEffect(() => {
    fetch(`/api/orders/${params.id}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Receipt unavailable.");
      setOrder(data.order);
    }).catch((error) => setNotice(error.message));
  }, [params.id]);

  useEffect(() => {
    if (!order || autoPrintStarted.current) return;
    const shouldAutoPrint = new URLSearchParams(window.location.search).get("autoPrint") === "1";
    if (!shouldAutoPrint) return;
    autoPrintStarted.current = true;
    // Wait for the receipt DOM to paint so the print dialog contains the full receipt.
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [order]);

  if (!order) return <main className="receipt-screen"><p>{notice || "Loading receipt…"}</p><Link href="/">Back to POS</Link></main>;
  return (
    <main className="receipt-screen">
      <div className="receipt-toolbar"><Link href="/">← Back to POS</Link><div className="receipt-actions"><a href={`/api/orders/${order.id}/receipt/pdf`}>Download PDF</a><button onClick={() => window.print()}>Print receipt</button></div></div>
      <article className="receipt-paper">
        <div className="receipt-brand"><img src="/ANAR-CO-logo-transparent-high-resolution.png" alt="ANAR & CO."/></div>
        <div className="receipt-rule"/>
        <div className="receipt-meta"><span>Receipt <b>#{order.orderNumber}</b></span><span>Service: <b>{order.orderType === "DINE_IN" ? "Eat here" : "Takeaway"}</b></span><span>Status: <b>{order.status}</b></span><span>{order.completedAt ? new Date(order.completedAt).toLocaleString() : "Pending"}</span><span>Cashier: {order.cashier.name}</span>{order.customerName && <span>Customer: {order.customerName}</span>}</div>{order.notes && <div className="receipt-refund-note"><b>Order notes</b><p>{order.notes}</p></div>}
        <div className="receipt-rule"/>
        <div className="receipt-lines">{order.lines.map((line) => <div className="receipt-line" key={line.id}><div><b>{line.productName}</b><small>{line.quantity} × {money(line.unitPriceMinor, order.currency)}{line.variantName ? ` · ${line.variantName}` : ""}</small>{line.selectedModifiers && line.selectedModifiers.length > 0 && <small>{line.selectedModifiers.map((option) => option.name).filter(Boolean).join(", ")}</small>}</div><strong>{money(line.lineTotalMinor, order.currency)}</strong></div>)}</div>
        <div className="receipt-rule"/>
        <div className="receipt-total"><span>Subtotal</span><b>{money(order.subtotalMinor, order.currency)}</b><span>Discount</span><b>− {money(order.discountMinor, order.currency)}</b><span>Tax</span><b>{money(order.taxMinor, order.currency)}</b><strong>Total</strong><strong>{money(order.totalMinor, order.currency)}</strong></div>
        <div className="receipt-rule"/>
        <div className="receipt-payments"><b>Payment</b>{order.payments.map((payment, index) => <span key={index}>{payment.method === "OTHER" ? "Other (manual)" : payment.method} · {payment.status} <strong>{money(payment.amountMinor, payment.currency || order.currency)}</strong></span>)}{order.payments.some((payment) => payment.cashReceivedMinor != null) && <><span>Cash received <strong>{money(order.payments.reduce((sum, payment) => sum + (payment.cashReceivedMinor ?? 0), 0), order.currency)}</strong></span><span>Change due <strong>{money(order.payments.reduce((sum, payment) => sum + (payment.changeDueMinor ?? 0), 0), order.currency)}</strong></span></>}</div>
        {order.refunds.length > 0 && <div className="receipt-refund-note"><b>Refund history</b>{order.refunds.map((refund) => <div key={refund.id}>{refund.kind} · {money(refund.amountMinor, order.currency)} · {new Date(refund.createdAt).toLocaleString()}<br/>Reason: {refund.reason}</div>)}<strong>Total refunded: {money(order.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0), order.currency)}</strong></div>}<p className="receipt-thanks">Thank you for choosing ANAR & CO.!</p>
        <small className="receipt-footer">Please keep this receipt for your records.</small>
      </article>
    </main>
  );
}
