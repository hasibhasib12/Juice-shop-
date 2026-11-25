"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Order = { id: string; orderNumber: number; status: string; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; currency: string; completedAt: string | null; cashier: { name: string }; lines: { id: string; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[]; payments: { method: string; amountMinor: number; status: string; cashReceivedMinor?: number | null; changeDueMinor?: number | null; currency?: string }[] };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch(`/api/orders/${params.id}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Receipt unavailable.");
      setOrder(data.order);
    }).catch((error) => setNotice(error.message));
  }, [params.id]);
  if (!order) return <main className="receipt-screen"><p>{notice || "Loading receipt…"}</p><a href="/">Back to POS</a></main>;
  return (
    <main className="receipt-screen">
      <div className="receipt-toolbar"><a href="/">← Back to POS</a><button onClick={() => window.print()}>Print receipt</button></div>
      <article className="receipt-paper">
        <div className="receipt-brand"><img src="/juice-shop-logo.svg" alt="Juice Shop"/><h1>JUICE SHOP</h1><p>Fresh · Healthy · Happy</p></div>
        <div className="receipt-rule"/>
        <div className="receipt-meta"><span>Receipt <b>#{order.orderNumber}</b></span><span>{order.completedAt ? new Date(order.completedAt).toLocaleString() : "Pending"}</span><span>Cashier: {order.cashier.name}</span></div>
        <div className="receipt-rule"/>
        <div className="receipt-lines">{order.lines.map((line) => <div className="receipt-line" key={line.id}><div><b>{line.productName}</b><small>{line.quantity} × {money(line.unitPriceMinor, order.currency)}</small></div><strong>{money(line.lineTotalMinor, order.currency)}</strong></div>)}</div>
        <div className="receipt-rule"/>
        <div className="receipt-total"><span>Subtotal</span><b>{money(order.subtotalMinor, order.currency)}</b><span>Discount</span><b>− {money(order.discountMinor, order.currency)}</b><span>Tax</span><b>{money(order.taxMinor, order.currency)}</b><strong>Total</strong><strong>{money(order.totalMinor, order.currency)}</strong></div>
        <div className="receipt-rule"/>
        <div className="receipt-payments"><b>Payment</b>{order.payments.map((payment, index) => <span key={index}>{payment.method} · {payment.status} <strong>{money(payment.amountMinor, payment.currency || order.currency)}</strong></span>)}</div>
        <p className="receipt-thanks">Thank you for choosing Juice Shop!</p>
        <small className="receipt-footer">Please keep this receipt for your records.</small>
      </article>
    </main>
  );
}
