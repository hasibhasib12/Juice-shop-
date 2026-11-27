"use client";

import { useCallback, useEffect, useState } from "react";

type DeliveryStatus = "PENDING" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED" | "CANCELLED";
type Driver = { id: string; name: string; phone: string | null };
type DeliveryOrder = {
  id: string; orderNumber: number; createdAt: string; customerName: string | null; customerPhone: string | null;
  deliveryAddress: string | null; deliveryFeeMinor: number; deliveryStatus: DeliveryStatus; dispatchedAt: string | null;
  notes: string | null; totalMinor: number; currency: string; driver: Driver | null;
  lines: { id: string; productName: string; quantity: number; variantName: string | null }[];
};
const money = (value: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(value / 100);
const label: Record<DeliveryStatus, string> = { PENDING: "Awaiting driver", ASSIGNED: "Driver assigned", PICKED_UP: "On the way", DELIVERED: "Delivered", FAILED: "Delivery issue", CANCELLED: "Cancelled" };

export default function DispatchPage() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [role, setRole] = useState("");
  const [branch, setBranch] = useState<{ name: string; code: string } | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const isManager = role === "OWNER" || role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dispatch/orders", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load dispatch queue.");
      setOrders(data.orders); setDrivers(data.drivers); setRole(data.currentRole); setBranch(data.branch); setUpdatedAt(new Date()); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Dispatch is unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, [load]);

  async function mutate(order: DeliveryOrder, body: { driverId?: string; status?: DeliveryStatus }) {
    setBusy(order.id); setNotice("");
    try {
      const response = await fetch("/api/dispatch/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, ...body }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update delivery.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not update delivery."); }
    finally { setBusy(""); }
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/"); }

  const pending = orders.filter(o => o.deliveryStatus === "PENDING").length;
  const assigned = orders.filter(o => o.deliveryStatus === "ASSIGNED").length;
  const onRoad = orders.filter(o => o.deliveryStatus === "PICKED_UP").length;
  const failed = orders.filter(o => o.deliveryStatus === "FAILED").length;

  return <main className="dispatch-screen">
    <header className="dispatch-header">
      <div className="dispatch-brand"><img src="/1572434B-4E2C-4244-8EC4-E36B59E7E9D7.png" alt="ANAR & CO."/><div><span>ANAR & CO. · OPERATIONS</span><h1>Dispatch</h1><p>{branch?.name || "Branch"} · {branch?.code || ""}</p></div></div>
      <div className="dispatch-actions"><span>{updatedAt ? "Updated " + updatedAt.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "Connecting…"}</span><button onClick={() => void load()}>Refresh</button><button onClick={() => void signOut()}>Sign out</button></div>
    </header>
    <section className="dispatch-stats"><article><span>AWAITING DRIVER</span><strong>{pending}</strong></article><article><span>ASSIGNED</span><strong>{assigned}</strong></article><article><span>ON THE WAY</span><strong>{onRoad}</strong></article><article><span>DELIVERY ISSUES</span><strong>{failed}</strong></article></section>
    {notice && <p className="dispatch-notice">{notice}</p>}
    {loading ? <p className="dispatch-empty">Loading delivery queue…</p> : !orders.length ? <section className="dispatch-empty"><strong>No active deliveries</strong><p>Paid delivery orders from this branch will appear here automatically.</p></section> :
      <section className="dispatch-grid">{orders.map(order => <article className="dispatch-ticket" key={order.id}>
        <div className="dispatch-ticket-top"><div><span>ORDER</span><h2>#{order.orderNumber}</h2></div><span className={"dispatch-status dispatch-" + order.deliveryStatus.toLowerCase()}>{label[order.deliveryStatus]}</span></div>
        <div className="dispatch-total">{money(order.totalMinor, order.currency)}</div>
        <p className="dispatch-customer">{order.customerName || "Customer not named"}</p>
        <a className="dispatch-phone" href={order.customerPhone ? "tel:" + order.customerPhone : undefined}>{order.customerPhone || "No phone number"}</a>
        <p className="dispatch-address">{order.deliveryAddress || "No delivery address provided"}</p>
        <div className="dispatch-lines">{order.lines.map(line => <div key={line.id}><b>{line.quantity}×</b><span>{line.productName}{line.variantName ? " · " + line.variantName : ""}</span></div>)}</div>
        {order.notes && <p className="dispatch-notes">Order note: {order.notes}</p>}
        <div className="dispatch-driver"><span>DRIVER</span><strong>{order.driver?.name || "Not assigned"}</strong>{order.driver?.phone && <small>{order.driver.phone}</small>}</div>
        {isManager && <div className="dispatch-assign"><select aria-label={"Assign driver for order " + order.orderNumber} value={assignments[order.id] || order.driver?.id || ""} onChange={event => setAssignments(current => ({...current, [order.id]: event.target.value}))}><option value="">Choose driver…</option>{drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}{driver.phone ? " · " + driver.phone : ""}</option>)}</select><button disabled={busy === order.id || !(assignments[order.id] || order.driver?.id)} onClick={() => void mutate(order, { driverId: assignments[order.id] || order.driver!.id })}>{busy === order.id ? "Saving…" : "Assign driver"}</button></div>}
        <div className="dispatch-next">
          {order.deliveryStatus === "ASSIGNED" && <button disabled={busy === order.id} onClick={() => void mutate(order, { status: "PICKED_UP" })}>{busy === order.id ? "Updating…" : "Confirm pickup"}</button>}
          {order.deliveryStatus === "PICKED_UP" && <><button disabled={busy === order.id} onClick={() => void mutate(order, { status: "DELIVERED" })}>Mark delivered</button><button className="dispatch-secondary" disabled={busy === order.id} onClick={() => void mutate(order, { status: "FAILED" })}>Report issue</button></>}
          {order.deliveryStatus === "FAILED" && isManager && <span>Reassign this delivery above to retry.</span>}
          {order.deliveryStatus === "PENDING" && !isManager && <span>Waiting for dispatch to assign a driver.</span>}
        </div>
        <small className="dispatch-time">Received {new Date(order.createdAt).toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}</small>
      </article>)}</section>}
    <style jsx>{`
      .dispatch-screen{min-height:100vh;background:#f6f3f0;color:#2b2524;padding:28px clamp(16px,3vw,44px) 48px;font-family:inherit}
      .dispatch-header{display:flex;align-items:center;justify-content:space-between;gap:20px;max-width:1500px;margin:0 auto 28px}
      .dispatch-brand{display:flex;align-items:center;gap:18px}.dispatch-brand img{width:94px;height:66px;object-fit:contain}.dispatch-brand span,.dispatch-ticket-top span:first-child,.dispatch-driver>span{font-size:10px;letter-spacing:.16em;color:#927b70;font-weight:800}.dispatch-brand h1{font-size:30px;margin:3px 0;font-weight:750}.dispatch-brand p{margin:0;color:#83746e;font-size:13px}
      .dispatch-actions{display:flex;align-items:center;gap:10px;color:#83746e;font-size:12px}.dispatch-actions button,.dispatch-assign button,.dispatch-next button{border:0;border-radius:11px;background:#632d37;color:#fff;padding:11px 16px;font-weight:700;cursor:pointer}.dispatch-actions button:last-child{background:#fff;color:#553b3c;border:1px solid #e6ded8}
      .dispatch-stats{max-width:1500px;margin:0 auto 22px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.dispatch-stats article{background:#fff;border:1px solid #eee6e0;border-radius:18px;padding:18px 20px;box-shadow:0 5px 20px #35201a08}.dispatch-stats span{display:block;font-size:10px;letter-spacing:.12em;color:#9b8981;font-weight:800}.dispatch-stats strong{display:block;font-size:30px;margin-top:8px}
      .dispatch-notice{max-width:1500px;margin:0 auto 16px;padding:12px 16px;background:#fff0e9;color:#8c3e31;border-radius:12px}.dispatch-empty{max-width:1500px;margin:30px auto;background:#fff;border:1px solid #eee6e0;border-radius:20px;padding:44px;text-align:center;color:#86766f}.dispatch-empty strong{display:block;color:#352b29;font-size:20px}.dispatch-empty p{margin-bottom:0}
      .dispatch-grid{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px}.dispatch-ticket{background:#fff;border:1px solid #eee6e0;border-radius:20px;padding:20px;box-shadow:0 7px 24px #35201a08}.dispatch-ticket-top{display:flex;align-items:flex-start;justify-content:space-between}.dispatch-ticket-top h2{font-size:25px;margin:2px 0 0}.dispatch-status{border-radius:30px;padding:7px 10px;font-size:10px;font-weight:800;background:#f4eee9;color:#806653}.dispatch-assigned{background:#f3e8d9;color:#87602e}.dispatch-picked_up{background:#e7effb;color:#365e92}.dispatch-failed{background:#fff0ec;color:#a34b3e}
      .dispatch-total{font-size:17px;font-weight:800;margin:8px 0}.dispatch-customer{font-size:17px;font-weight:750;margin:12px 0 2px}.dispatch-phone{display:inline-block;color:#713d46;font-weight:650;text-decoration:none;font-size:13px}.dispatch-address{background:#f8f5f2;padding:12px;border-radius:12px;margin:12px 0;font-size:13px;line-height:1.5}
      .dispatch-lines{border-top:1px solid #f0eae5;border-bottom:1px solid #f0eae5;padding:10px 0}.dispatch-lines div{display:flex;gap:10px;padding:4px 0;font-size:13px}.dispatch-lines b{color:#743d47;min-width:22px}.dispatch-notes{font-size:12px;color:#826a53}.dispatch-driver{display:flex;align-items:center;gap:8px;margin:14px 0;font-size:13px;flex-wrap:wrap}.dispatch-driver>span{width:100%}.dispatch-driver strong{font-size:14px}.dispatch-driver small{color:#897c75}
      .dispatch-assign{display:flex;gap:8px}.dispatch-assign select{min-width:0;flex:1;border:1px solid #e6ddd7;border-radius:10px;padding:10px;background:white;color:#423633}.dispatch-assign button{padding:10px 12px;font-size:12px}.dispatch-next{display:flex;gap:8px;margin-top:12px}.dispatch-next button{flex:1}.dispatch-next .dispatch-secondary{background:#f3eeea;color:#694d4c}.dispatch-next span{font-size:12px;color:#8a756d}.dispatch-time{display:block;color:#9b8e87;margin-top:15px}
      @media(max-width:700px){.dispatch-header{align-items:flex-start;flex-direction:column}.dispatch-actions{width:100%;flex-wrap:wrap}.dispatch-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.dispatch-brand img{width:70px;height:54px}.dispatch-brand h1{font-size:25px}}
    `}</style>
  </main>;
}
