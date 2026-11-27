"use client";

import { useCallback, useEffect, useState } from "react";

type KitchenOrder = {
  id: string; orderNumber: number; kitchenStatus: "QUEUED" | "PREPARING" | "READY";
  createdAt: string; customerName: string | null; notes: string | null;
  table: { name: string } | null;
  lines: { id: string; productName: string; quantity: number; variantName: string | null; selectedModifiers: unknown }[];
};
const next: Record<string, { status: string; label: string }> = {
  QUEUED: { status: "PREPARING", label: "Start preparing" },
  PREPARING: { status: "READY", label: "Mark ready" },
  READY: { status: "SERVED", label: "Mark served" },
};
export default function KitchenPortal() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/kitchen/orders", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load kitchen orders.");
      setOrders(data.orders); setUpdatedAt(new Date()); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Kitchen orders unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, [load]);
  async function advance(order: KitchenOrder) {
    const action = next[order.kitchenStatus]; if (!action) return;
    setBusy(order.id); setNotice("");
    try {
      const response = await fetch("/api/kitchen/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, status: action.status }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update order.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update order."); }
    finally { setBusy(""); }
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/"); }
  const queued = orders.filter(o => o.kitchenStatus === "QUEUED").length;
  const preparing = orders.filter(o => o.kitchenStatus === "PREPARING").length;
  const ready = orders.filter(o => o.kitchenStatus === "READY").length;
  return <main className="kitchen-screen">
    <header className="kitchen-header"><div className="kitchen-brand"><img src="/ANAR-CO-logo-transparent-high-resolution.png" alt="ANAR & CO."/><div><span>ANAR & CO. · OPERATIONS</span><h1>Kitchen display</h1><p>Live preparation queue</p></div></div><div className="kitchen-head-actions"><span>{updatedAt ? "Updated " + updatedAt.toLocaleTimeString() : "Connecting…"}</span><button onClick={() => void load()}>Refresh</button><button onClick={() => void signOut()}>Sign out</button></div></header>
    <section className="kitchen-stats"><article><span>NEW</span><strong>{queued}</strong></article><article><span>PREPARING</span><strong>{preparing}</strong></article><article><span>READY</span><strong>{ready}</strong></article></section>
    {notice && <p className="kitchen-notice">{notice}</p>}
    {loading ? <p className="kitchen-empty">Loading live orders…</p> : !orders.length ? <section className="kitchen-empty"><strong>All caught up</strong><p>New paid orders will appear here automatically.</p></section> : <section className="kitchen-grid">{orders.map(order => <article className={"kitchen-ticket kitchen-" + order.kitchenStatus.toLowerCase()} key={order.id}>
      <header><div><span>ORDER</span><h2>#{order.orderNumber}</h2></div><span className="kitchen-status">{order.kitchenStatus}</span></header>
      <p className="kitchen-ticket-meta">{order.table?.name || "Takeaway"} · {new Date(order.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</p>
      {order.customerName && <p className="kitchen-customer">{order.customerName}</p>}
      <ul>{order.lines.map(line => <li key={line.id}><strong>{line.quantity}×</strong><div>{line.productName}{line.variantName && <small>{line.variantName}</small>}{Array.isArray(line.selectedModifiers) && line.selectedModifiers.length > 0 && <small>{(line.selectedModifiers as {name?:string}[]).map(x=>x.name).filter(Boolean).join(", ")}</small>}</div></li>)}</ul>
      {order.notes && <p className="kitchen-order-notes">Note: {order.notes}</p>}
      <button disabled={busy === order.id} onClick={() => void advance(order)}>{busy === order.id ? "Updating…" : next[order.kitchenStatus].label}</button>
    </article>)}</section>}
  </main>;
}
