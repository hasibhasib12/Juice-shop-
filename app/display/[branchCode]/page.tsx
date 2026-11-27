"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type DisplayOrder = { orderNumber: number; status: "QUEUED" | "PREPARING" | "READY"; createdAt: string };
type DisplayPayload = { branch: { name: string; code: string }; orders: DisplayOrder[]; updatedAt: string };

export default function CustomerOrderDisplay() {
  const params = useParams<{ branchCode: string }>();
  const branchCode = params.branchCode;
  const [payload, setPayload] = useState<DisplayPayload | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(new Date());

  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEnabledRef = useRef(false);
  const previousReadyNumbers = useRef<Set<number> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playReadyChime = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    [587.33, 739.99, 880].forEach((frequency, index) => {
      const start = now + index * 0.13;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine"; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + 0.35);
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
      soundEnabledRef.current = true; setSoundEnabled(true); playReadyChime();
    } catch { setError("Sound could not be enabled. Check your browser audio settings."); }
  }


  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/display/${encodeURIComponent(branchCode)}/orders`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load order display.");
      const nextPayload = data as DisplayPayload;
      const readyNumbers = new Set(nextPayload.orders.filter((order) => order.status === "READY").map((order) => order.orderNumber));
      const previous = previousReadyNumbers.current;
      if (previous && [...readyNumbers].some((number) => !previous.has(number)) && soundEnabledRef.current) playReadyChime();
      previousReadyNumbers.current = readyNumbers;
      setPayload(nextPayload);
      setError("");
      setConnected(true);
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Connection unavailable.");
    }
  }, [branchCode, playReadyChime]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 5000);
    const tick = window.setInterval(() => setClock(new Date()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [refresh]);

  const preparing = useMemo(() => payload?.orders.filter((order) => order.status !== "READY") ?? [], [payload]);
  const ready = useMemo(() => payload?.orders.filter((order) => order.status === "READY") ?? [], [payload]);

  if (error && !payload) {
    return <main className="customer-display"><section className="display-error"><img src="/ANAR-CO-logo-transparent-high-resolution.png" alt="ANAR & CO."/><h1>Order display unavailable</h1><p>{error}</p><button onClick={() => void refresh()}>Try again</button></section></main>;
  }

  return (
    <main className="customer-display">
      <header className="customer-display-header">
        <div className="customer-display-brand">
          <img src="/ANAR-CO-logo-transparent-high-resolution.png" alt="ANAR & CO."/>
          <div><span>ANAR & CO. · ORDER STATUS</span><h1>{payload?.branch.name || "Order display"}</h1></div>
        </div>
        <div className="customer-display-clock">
          <span className={connected ? "display-live-dot" : "display-live-dot is-offline"}/>
          <span>{connected ? "LIVE UPDATES" : "RECONNECTING"}</span>
          <button className="screen-sound-toggle" aria-pressed={soundEnabled} onClick={() => void toggleSound()}>{soundEnabled ? "Sound on" : "Enable sound"}</button>
          <strong>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
        </div>
      </header>

      <section className="customer-display-welcome">
        <p>THANK YOU FOR ORDERING WITH US</p>
        <h2>Your order is on its way.</h2>
        <span>Please watch the screen for your order number.</span>
      </section>

      {error && <div className="display-connection-warning">{error} · Trying to reconnect…</div>}

      <section className="customer-display-columns">
        <article className="customer-display-column">
          <header><div><span className="display-column-icon">◷</span><div><h2>Preparing</h2><p>We’re making your order fresh</p></div></div><b>{preparing.length}</b></header>
          <div className="display-order-grid">
            {preparing.length ? preparing.map((order) => <div className="display-order-number is-preparing" key={order.orderNumber}><span>ORDER</span><strong>#{order.orderNumber}</strong><small>{order.status === "QUEUED" ? "JUST PLACED" : "IN PROGRESS"}</small></div>) : <div className="display-column-empty"><span>✦</span><b>Nothing in preparation</b><small>New orders will appear here</small></div>}
          </div>
        </article>

        <article className="customer-display-column ready-column">
          <header><div><span className="display-column-icon">✓</span><div><h2>Ready for collection</h2><p>Your order is ready — please collect it</p></div></div><b>{ready.length}</b></header>
          <div className="display-order-grid">
            {ready.length ? ready.map((order) => <div className="display-order-number is-ready" key={order.orderNumber}><span>ORDER</span><strong>#{order.orderNumber}</strong><small>PLEASE COLLECT</small></div>) : <div className="display-column-empty"><span>✓</span><b>No orders ready just yet</b><small>We’ll let you know when yours is ready</small></div>}
          </div>
        </article>
      </section>

      <footer className="customer-display-footer"><span>Freshly made. Made with care.</span><span>ANAR & CO. <i>•</i> {payload?.branch.code || branchCode}</span></footer>
    </main>
  );
}
