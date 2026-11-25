"use client";

import { useEffect, useState } from "react";

type Order = { id: string; orderNumber: number; status: string; totalMinor: number; currency: string; createdAt: string; cashier: { name: string }; lines: { productName: string; quantity: number }[]; payments: { method: string; status: string; amountMinor: number; currency: string }[] };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  async function load(next?: string | null, reset = false) {
    setLoading(true); setNotice("");
    try {
      const response = await fetch(`/api/orders?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load orders.");
      setOrders((current) => reset ? data.orders : [...current, ...data.orders]);
      setNextCursor(data.nextCursor);
      setCursor(next || null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load orders."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(null, true); }, []);
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><a href="/" className="catalog-back">← Back to POS</a><div><span>JUICE SHOP · SALES</span><h1>Order history</h1><p>Find completed sales and reprint receipts.</p></div></header>
      {notice && <p className="catalog-notice">{notice}</p>}
      <section className="catalog-list order-history">
        <div className="catalog-section-head"><div><span>TRANSACTION LOG</span><h2>Recent orders</h2></div></div>
        {orders.map((order) => <article className="history-order" key={order.id}><div className="history-order-main"><b>Order #{order.orderNumber}</b><span>{new Date(order.createdAt).toLocaleString()} · {order.cashier.name}</span><small>{order.lines.map((line) => `${line.quantity}× ${line.productName}`).join(" · ")}</small></div><div className="history-order-total"><strong>{money(order.totalMinor, order.currency)}</strong><span>{order.status}</span></div><a href={`/orders/${order.id}/receipt`}>Receipt ↗</a></article>)}
        {!orders.length && !loading && <p>No orders found.</p>}
        {loading && <p>Loading orders…</p>}
        {nextCursor && <button className="catalog-primary history-more" onClick={() => void load(nextCursor)} disabled={loading}>Load more</button>}
      </section>
    </main>
  );
}
