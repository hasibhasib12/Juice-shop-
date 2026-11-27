"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type KitchenOrder = {
  id: string; orderNumber: number; kitchenStatus: "QUEUED" | "PREPARING" | "READY"; orderType: "TAKEAWAY" | "DINE_IN";
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

  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEnabledRef = useRef(false);
  const previousOrderIds = useRef<Set<string> | null>(null);
  const lastAlertAt = useRef<Map<string, number>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const playAlert = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    [740, 988].forEach((frequency, index) => {
      const start = now + index * 0.16;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + 0.15);
    });
  }, []);
  async function toggleSound() {
    if (soundEnabledRef.current) { soundEnabledRef.current = false; setSoundEnabled(false); return; }
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return;
      const context = audioContextRef.current ?? new Ctx();
      audioContextRef.current = context;
      await context.resume();
      soundEnabledRef.current = true; setSoundEnabled(true); playAlert();
    } catch { setNotice("Sound could not be enabled. Check your browser audio settings."); }
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/kitchen/orders", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load kitchen orders.");
      const incoming = data.orders as KitchenOrder[];
      const ids = new Set(incoming.map((order) => order.id));
      const previous = previousOrderIds.current;
      const now = Date.now();
      if (soundEnabledRef.current) {
        for (const order of incoming) {
          if (order.kitchenStatus !== "QUEUED") {
            lastAlertAt.current.delete(order.id);
            continue;
          }
          const isNew = previous !== null && !previous.has(order.id);
          const lastPlayed = lastAlertAt.current.get(order.id) ?? 0;
          // Alert immediately for a new queued order, then repeat every 20 seconds
          // until a team member starts preparing it.
          if (isNew || now - lastPlayed >= 20000) {
            playAlert();
            lastAlertAt.current.set(order.id, now);
          }
        }
      }
      for (const id of lastAlertAt.current.keys()) {
        if (!ids.has(id)) lastAlertAt.current.delete(id);
      }
      previousOrderIds.current = ids;
      setOrders(incoming); setUpdatedAt(new Date()); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Kitchen orders unavailable."); }
    finally { setLoading(false); }
  }, [playAlert]);
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
    <header className="kitchen-header"><div className="kitchen-brand"><img src="/ANAR-CO-logo-transparent-high-resolution.png" alt="ANAR & CO."/><div><span>ANAR & CO. · OPERATIONS</span><h1>Kitchen display</h1><p>Live preparation queue</p></div></div><div className="kitchen-head-actions"><span>{updatedAt ? "Updated " + updatedAt.toLocaleTimeString() : "Connecting…"}</span><button className="screen-sound-toggle" aria-pressed={soundEnabled} onClick={() => void toggleSound()}>{soundEnabled ? "Sound on" : "Enable sound"}</button><button onClick={() => void load()}>Refresh</button><button onClick={() => void signOut()}>Sign out</button></div></header>
    <section className="kitchen-stats"><article><span>NEW</span><strong>{queued}</strong></article><article><span>PREPARING</span><strong>{preparing}</strong></article><article><span>READY</span><strong>{ready}</strong></article></section>
    {notice && <p className="kitchen-notice">{notice}</p>}
    {loading ? <p className="kitchen-empty">Loading live orders…</p> : !orders.length ? <section className="kitchen-empty"><strong>All caught up</strong><p>New paid orders will appear here automatically.</p></section> : <section className="kitchen-grid">{orders.map(order => <article className={"kitchen-ticket kitchen-" + order.kitchenStatus.toLowerCase()} key={order.id}>
      <header><div><span>ORDER</span><h2>#{order.orderNumber}</h2></div><span className="kitchen-status">{order.kitchenStatus}</span></header>
      <p className="kitchen-ticket-meta"><strong className="kitchen-order-type">{order.orderType === "DINE_IN" ? "EAT HERE" : "TAKEAWAY"}</strong>{order.table?.name ? `${order.table.name} · ` : ""}{new Date(order.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</p>
      {order.customerName && <p className="kitchen-customer">{order.customerName}</p>}
      <ul>{order.lines.map(line => <li key={line.id}><strong>{line.quantity}×</strong><div>{line.productName}{line.variantName && <small>{line.variantName}</small>}{Array.isArray(line.selectedModifiers) && line.selectedModifiers.length > 0 && <small>{(line.selectedModifiers as {name?:string}[]).map(x=>x.name).filter(Boolean).join(", ")}</small>}</div></li>)}</ul>
      {order.notes && <p className="kitchen-order-notes">Note: {order.notes}</p>}
      <button disabled={busy === order.id} onClick={() => void advance(order)}>{busy === order.id ? "Updating…" : next[order.kitchenStatus].label}</button>
    </article>)}</section>}
  </main>;
}
