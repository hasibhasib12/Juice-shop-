"use client";

import Link from "next/link";

import { useEffect, useState } from "react";

type Order = { id: string; orderNumber: number; status: string; totalMinor: number; currency: string; createdAt: string; cashier: { name: string }; lines: { id: string; productName: string; quantity: number; returns: { quantity: number; condition: string; disposition: string; reason: string; createdAt: string }[] }[]; payments: { method: string; status: string; amountMinor: number; currency: string }[]; refunds: { kind: string; amountMinor: number; reason: string; createdAt: string }[] };
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
  async function recordItemReturn(order: Order) {
    if (!order.lines.length) return;
    const options = order.lines.map((line, index) => {
      const returned = line.returns.reduce((sum, entry) => sum + entry.quantity, 0);
      return `${index + 1}. ${line.productName} — sold ${line.quantity}, already returned ${returned}, remaining ${line.quantity - returned}`;
    }).join("\n");
    const choice = window.prompt(`Choose the line number to return:\n${options}`);
    if (choice === null) return;
    const index = Number(choice) - 1;
    const line = order.lines[index];
    if (!Number.isInteger(index) || !line) { setNotice("Choose a valid order line number."); return; }
    const alreadyReturned = line.returns.reduce((sum, entry) => sum + entry.quantity, 0);
    const remaining = line.quantity - alreadyReturned;
    if (remaining <= 0) { setNotice("This line has already been fully returned."); return; }
    const quantityInput = window.prompt(`Quantity to return (maximum ${remaining}):`, "1");
    if (quantityInput === null) return;
    const quantity = Number(quantityInput);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > remaining) { setNotice("Enter a valid quantity within the remaining returnable amount."); return; }
    const condition = window.prompt("Condition: SEALED_UNUSED, OPENED, PREPARED, or DAMAGED", "PREPARED");
    if (condition === null) return;
    const normalized = condition.trim().toUpperCase();
    if (!["SEALED_UNUSED", "OPENED", "PREPARED", "DAMAGED"].includes(normalized)) { setNotice("Choose a valid return condition."); return; }
    const reason = window.prompt("Reason for return:");
    if (!reason || reason.trim().length < 3) return;
    const disposition = normalized === "SEALED_UNUSED" ? "NOT_RESTOCKABLE" : "WASTE";
    if (!window.confirm(`Record ${quantity} × ${line.productName} as ${normalized}. This records the physical return only; it does not issue money or restock ingredients.`)) return;
    setReversalBusy(order.id); setNotice("");
    try {
      const response = await fetch(`/api/orders/${order.id}/returns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ orderLineId: line.id, quantity, condition: normalized, disposition, reason: reason.trim() }] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Item return could not be recorded.");
      setNotice(`Recorded ${quantity} returned item(s) for order #${order.orderNumber}. No inventory was restocked and no monetary refund was issued.`);
      await load(null, true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Item return could not be recorded."); }
    finally { setReversalBusy(null); }
  }
  async function reverseOrder(order: Order, kind: "REFUND" | "VOID") {
    const alreadyRefunded = order.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
    const remainingMinor = order.totalMinor - alreadyRefunded;
    if (remainingMinor <= 0) return;
    const defaultAmount = (remainingMinor / 100).toFixed(2);
    const amountInput = kind === "VOID"
      ? defaultAmount
      : window.prompt(`Refund amount in ${order.currency} (maximum ${money(remainingMinor, order.currency)}):`, defaultAmount);
    if (amountInput === null) return;
    const amountMinor = Math.round(Number(amountInput) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > remainingMinor) {
      setNotice("Enter a valid refund amount within the remaining refundable balance.");
      return;
    }
    const reason = window.prompt(`Reason for ${kind.toLowerCase()} of order #${order.orderNumber}:`);
    if (!reason || reason.trim().length < 3) return;
    if (!window.confirm(`${kind === "VOID" ? "Void" : "Refund"} ${money(amountMinor, order.currency)} for order #${order.orderNumber}? This cannot be undone. Any non-cash portion must also be returned outside the POS.`)) return;
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
      <header className="catalog-admin-header"><Link href="/" className="catalog-back">← Back to POS</Link><div><span>JUICE SHOP · SALES</span><h1>Order history</h1><p>Find completed sales and reprint receipts.</p></div></header>
      {notice && <p className="catalog-notice">{notice}</p>}
      <section className="catalog-list order-history">
        <div className="catalog-section-head"><div><span>TRANSACTION LOG</span><h2>Recent orders</h2></div></div>
        {orders.map((order) => <article className="history-order" key={order.id}><div className="history-order-main"><b>Order #{order.orderNumber}</b><span>{new Date(order.createdAt).toLocaleString()} · {order.cashier.name}</span><small>{order.lines.map((line) => `${line.quantity}× ${line.productName}`).join(" · ")}</small></div><div className="history-order-total"><strong>{money(order.totalMinor, order.currency)}</strong><span>{order.status}</span></div><div className="history-order-actions"><a href={`/orders/${order.id}/receipt`}>Receipt ↗</a>{(role === "OWNER" || role === "MANAGER") && order.status !== "DRAFT" && <><button onClick={() => void recordItemReturn(order)} disabled={reversalBusy === order.id}>Record item return</button>{order.status === "COMPLETED" && <><button onClick={() => void reverseOrder(order, "REFUND")} disabled={reversalBusy === order.id}>Refund</button><button onClick={() => void reverseOrder(order, "VOID")} disabled={reversalBusy === order.id}>Void remaining</button></>}</>}</div>{order.lines.some((line) => line.returns.length > 0) && <small className="history-reversal-note">Returns: {order.lines.flatMap((line) => line.returns).reduce((sum, entry) => sum + entry.quantity, 0)} item(s) recorded · no automatic restock</small>}{order.refunds.length > 0 && <small className="history-reversal-note">Refunded {money(order.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0), order.currency)} · {order.refunds.length} transaction(s) · Latest: {order.refunds[0].reason}</small>}</article>)}
        {!orders.length && !loading && <p>No orders found.</p>}
        {loading && <p>Loading orders…</p>}
        {nextCursor && <button className="catalog-primary history-more" onClick={() => void load(nextCursor)} disabled={loading}>Load more</button>}
      </section>
    </main>
  );
}
