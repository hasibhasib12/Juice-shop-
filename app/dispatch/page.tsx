"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DeliveryStatus = "PENDING" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED" | "CANCELLED";
type LocationSummary = { latitude: number; longitude: number; accuracyMeters: number | null; capturedAt: string; updatedAt: string };
type Driver = { id: string; name: string; phone: string | null; driverOnDuty: boolean; driverLocation: LocationSummary | null };
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
  const [driverOnDuty, setDriverOnDuty] = useState(false);
  const [tracking, setTracking] = useState(false);
  const watchId = useRef<number | null>(null);
  const isManager = role === "OWNER" || role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dispatch/orders", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load dispatch queue.");
      setOrders(data.orders); setDrivers(data.drivers); setRole(data.currentRole); setBranch(data.branch); setUpdatedAt(new Date());
      if (data.currentRole === "DRIVER") { setDriverOnDuty(Boolean(data.driverSelf?.driverOnDuty)); setTracking(Boolean(data.driverSelf?.driverOnDuty)); }
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Dispatch is unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, [load]);

  useEffect(() => {
    if (!tracking || role !== "DRIVER" || !navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition(async position => {
      try {
        const response = await fetch("/api/dispatch/location", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update", latitude: position.coords.latitude, longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy, headingDegrees: position.coords.heading,
            speedMetersPerSecond: position.coords.speed,
          }),
        });
        if (!response.ok) {
          const data = await response.json();
          setNotice(data.error || "GPS update could not be saved.");
        }
      } catch { setNotice("GPS update could not be sent. Check your connection."); }
    }, error => {
      setNotice(error.code === error.PERMISSION_DENIED ? "Location permission was denied. Stop duty or enable location permission in your phone settings." : "GPS signal is unavailable. Keep the page open and try again.");
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); watchId.current = null; };
  }, [tracking, role]);

  async function startDuty() {
    if (!navigator.geolocation) { setNotice("This phone browser does not support GPS location."); return; }
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch("/api/dispatch/location", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start", latitude: position.coords.latitude, longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy, headingDegrees: position.coords.heading,
            speedMetersPerSecond: position.coords.speed,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not start duty.");
        setDriverOnDuty(true); setTracking(true); setNotice("Duty started. Your location is now shared with your branch Dispatch.");
        await load();
      } catch (error) { setNotice(error instanceof Error ? error.message : "Could not start duty."); }
      finally { setBusy(""); }
    }, error => {
      setBusy("");
      setNotice(error.code === error.PERMISSION_DENIED ? "Allow location access in your phone browser to start duty." : "Could not get a GPS fix. Move outdoors and try again.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  async function stopDuty() {
    setBusy("gps");
    try {
      const response = await fetch("/api/dispatch/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not stop duty.");
      setTracking(false); setDriverOnDuty(false); setNotice("Duty ended. Your saved live location has been cleared.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not stop duty."); }
    finally { setBusy(""); }
  }

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
    {role === "DRIVER" && <section className="dispatch-duty">
      <div><strong>{driverOnDuty ? "You are on duty" : "You are off duty"}</strong><p>{driverOnDuty ? "Your phone GPS is shared with your branch while this screen stays open." : "Start duty when you are ready to receive delivery assignments."}</p></div>
      {driverOnDuty
        ? <button className="dispatch-stop-duty" disabled={busy === "gps"} onClick={() => void stopDuty()}>{busy === "gps" ? "Saving…" : "Stop duty & hide location"}</button>
        : <button disabled={busy === "gps"} onClick={() => void startDuty()}>{busy === "gps" ? "Getting GPS…" : "Start duty & share location"}</button>}
    </section>}
    {isManager && <section className="dispatch-fleet">
      <div className="dispatch-fleet-heading"><div><strong>Driver availability · Kabul pilot</strong><p>Only approved drivers from this branch are shown. Location updates while drivers are on duty.</p></div><span>{drivers.filter(driver => driver.driverOnDuty).length} on duty / {drivers.length} drivers</span></div>
      {!drivers.length ? <p className="dispatch-fleet-empty">No approved drivers in this branch yet.</p> : <div className="dispatch-fleet-list">{drivers.map(driver => {
        const fresh = driver.driverLocation && Date.now() - new Date(driver.driverLocation.updatedAt).getTime() < 90000;
        return <article key={driver.id}>
          <div><strong>{driver.name}</strong><small>{driver.phone || "No phone recorded"}</small></div>
          <span className={driver.driverOnDuty ? "dispatch-live" : "dispatch-offline"}>{driver.driverOnDuty ? fresh ? "GPS live" : "On duty · GPS stale" : "Off duty"}</span>
          {driver.driverLocation && <a href={"https://www.google.com/maps?q=" + driver.driverLocation.latitude + "," + driver.driverLocation.longitude} target="_blank" rel="noreferrer">View location ↗</a>}
          {driver.driverLocation && <small>Updated {new Date(driver.driverLocation.updatedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small>}
        </article>;
      })}</div>}
    </section>}
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
      .dispatch-duty,.dispatch-fleet{max-width:1500px;margin:0 auto 18px;background:#fff;border:1px solid #eee6e0;border-radius:18px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:18px}
      .dispatch-duty strong,.dispatch-fleet-heading strong{font-size:15px}.dispatch-duty p,.dispatch-fleet-heading p{margin:5px 0 0;color:#887870;font-size:12px;line-height:1.5}
      .dispatch-duty button{border:0;border-radius:11px;background:#632d37;color:#fff;padding:12px 16px;font-weight:750;cursor:pointer}.dispatch-duty .dispatch-stop-duty{background:#f3eeea;color:#694d4c}
      .dispatch-fleet{display:block}.dispatch-fleet-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.dispatch-fleet-heading>span{font-size:12px;font-weight:800;color:#713d46;white-space:nowrap}
      .dispatch-fleet-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-top:14px}.dispatch-fleet-list article{border:1px solid #f0eae5;border-radius:13px;padding:12px;display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center}
      .dispatch-fleet-list article strong,.dispatch-fleet-list article small{display:block}.dispatch-fleet-list article small{font-size:11px;color:#91827b;margin-top:3px}.dispatch-fleet-list article a{font-size:11px;color:#713d46;font-weight:750;text-decoration:none}.dispatch-live,.dispatch-offline{font-size:10px;font-weight:850;border-radius:30px;padding:6px 8px;white-space:nowrap}.dispatch-live{background:#e8f4eb;color:#2e7044}.dispatch-offline{background:#f3eeea;color:#887870}.dispatch-fleet-empty{color:#8a7a73;font-size:13px}
      .dispatch-notice{max-width:1500px;margin:0 auto 16px;padding:12px 16px;background:#fff0e9;color:#8c3e31;border-radius:12px}.dispatch-empty{max-width:1500px;margin:30px auto;background:#fff;border:1px solid #eee6e0;border-radius:20px;padding:44px;text-align:center;color:#86766f}.dispatch-empty strong{display:block;color:#352b29;font-size:20px}.dispatch-empty p{margin-bottom:0}
      .dispatch-grid{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px}.dispatch-ticket{background:#fff;border:1px solid #eee6e0;border-radius:20px;padding:20px;box-shadow:0 7px 24px #35201a08}.dispatch-ticket-top{display:flex;align-items:flex-start;justify-content:space-between}.dispatch-ticket-top h2{font-size:25px;margin:2px 0 0}.dispatch-status{border-radius:30px;padding:7px 10px;font-size:10px;font-weight:800;background:#f4eee9;color:#806653}.dispatch-assigned{background:#f3e8d9;color:#87602e}.dispatch-picked_up{background:#e7effb;color:#365e92}.dispatch-failed{background:#fff0ec;color:#a34b3e}
      .dispatch-total{font-size:17px;font-weight:800;margin:8px 0}.dispatch-customer{font-size:17px;font-weight:750;margin:12px 0 2px}.dispatch-phone{display:inline-block;color:#713d46;font-weight:650;text-decoration:none;font-size:13px}.dispatch-address{background:#f8f5f2;padding:12px;border-radius:12px;margin:12px 0;font-size:13px;line-height:1.5}
      .dispatch-lines{border-top:1px solid #f0eae5;border-bottom:1px solid #f0eae5;padding:10px 0}.dispatch-lines div{display:flex;gap:10px;padding:4px 0;font-size:13px}.dispatch-lines b{color:#743d47;min-width:22px}.dispatch-notes{font-size:12px;color:#826a53}.dispatch-driver{display:flex;align-items:center;gap:8px;margin:14px 0;font-size:13px;flex-wrap:wrap}.dispatch-driver>span{width:100%}.dispatch-driver strong{font-size:14px}.dispatch-driver small{color:#897c75}
      .dispatch-assign{display:flex;gap:8px}.dispatch-assign select{min-width:0;flex:1;border:1px solid #e6ddd7;border-radius:10px;padding:10px;background:white;color:#423633}.dispatch-assign button{padding:10px 12px;font-size:12px}.dispatch-next{display:flex;gap:8px;margin-top:12px}.dispatch-next button{flex:1}.dispatch-next .dispatch-secondary{background:#f3eeea;color:#694d4c}.dispatch-next span{font-size:12px;color:#8a756d}.dispatch-time{display:block;color:#9b8e87;margin-top:15px}
      @media(max-width:700px){.dispatch-header{align-items:flex-start;flex-direction:column}.dispatch-actions{width:100%;flex-wrap:wrap}.dispatch-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.dispatch-brand img{width:70px;height:54px}.dispatch-brand h1{font-size:25px}}
    `}</style>
  </main>;
}
