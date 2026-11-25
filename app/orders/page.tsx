"use client";

import { useEffect, useState } from "react";

type Order = { id: string; orderNumber: number; status: string; totalMinor: number; currency: string; createdAt: string; cashier: { name: string }; lines: { productName: string; quantity: number }[]; payments: { method: string; status: string; amountMinor: number; currency: string }[]; refunds: { kind: string; amountMinor: number; reason: string; createdAt: string }[] };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("");
  const [reversalBusy, setReversalBusy] = useState<string | null>(null);
  async function load(next?: string | null, reset = false) {
    setLoading(true);
    try {
      const response = await fetch(`/api/orders?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load orders.");
      setOrders((current) => reset ? data.orders : [...current, ...data.orders]);
      if (data.currentRole) setRole(data.currentRole);
      setNextCursor(data.nextCursor);
      setCursor(next || null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load orders."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(null, true); }, []);
  async function reverseOrder(order: Order, kind: "REFUND" | "VOID") {
    const reason = window.prompt(`Reason for ${kind.toLowerCase()} of order #${order.orderNumber}:`);
    if (!reason || reason.trim().length < 3) return;
    if (!window.confirm(`${kind === "VOID" ? "Void" : "Refund"} the full ${money(order.totalMinor, order.currency)} for order #${order.orderNumber}? This cannot be undone. Any non-cash portion must also be returned outside the POS.`)) return;
    setReversalBusy(order.id); setNotice("");
    try {
      const response = await fetch(`/api/orders/${order.id}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, reason, amountMinor }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reversal failed.");
      setNotice(`Order #${order.orderNumber}: ${money(amountMinor, order.currency)} ${kind === "VOID" ? "voided" : "refunded"} successfully.`);
      await load(null, true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Reversal failed."); }
    finally { setReversalBusy(null); }
  }
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><a href="/" className="catalog-back">← Back to POS</a><div><span>JUICE SHOP · SALES</span><h1>Order history</h1><p>Find completed sales and reprint receipts.</p></div></header>
      {notice && <p className="catalog-notice">{notice}</p>}
      <section className="catalog-list order-history">
        <div className="catalog-section-head"><div><span>TRANSACTION LOG</span><h2>Recent orders</h2></div></div>
        {orders.map((order) => <article className="history-order" key={order.id}><div className="history-order-main"><b>Order #{order.orderNumber}</b><span>{new Date(order.createdAt).toLocaleString()} · {order.cashier.name}</span><small>{order.lines.map((line) => `${line.quantity}× ${line.productName}`).join(" · ")}</small></div><div className="history-order-total"><strong>{money(order.totalMinor, order.currency)}</strong><span>{order.status}</span></div><div className="history-order-actions"><a href={`/orders/${order.id}/receipt`}>Receipt ↗</a>{(role === "OWNER" || role === "MANAGER") && order.status === "COMPLETED" && <><button onClick={() => void reverseOrder(order, "REFUND")} disabled={reversalBusy === order.id}>Refund</button><button onClick={() => void reverseOrder(order, "VOID")} disabled={reversalBusy === order.id}>Void remaining</button></>}</div>{order.refunds.length > 0 && <small className="history-reversal-note">Refunded {money(order.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0), order.currency)} · {order.refunds.length} transaction(s) · Latest: {order.refunds[0].reason}</small>}</article>)}
        {!orders.length && !loading && <p>No orders found.</p>}
        {loading && <p>Loading orders…</p>}
        {nextCursor && <button className="catalog-primary history-more" onClick={() => void load(nextCursor)} disabled={loading}>Load more</button>}
      </section>
    </main>
  );
}
