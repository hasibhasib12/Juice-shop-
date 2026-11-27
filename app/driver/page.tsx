"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "PENDING" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED" | "CANCELLED";
type Delivery = {
  id: string; orderNumber: number; createdAt: string; customerName: string | null;
  customerPhone: string | null; deliveryAddress: string | null; totalMinor: number;
  currency: string; deliveryStatus: Status; notes: string | null;
  lines: { id: string; productName: string; quantity: number; variantName: string | null }[];
};
const statusText: Record<Status,string> = {
  PENDING:"Waiting for dispatch", ASSIGNED:"Ready for pickup", PICKED_UP:"Out for delivery",
  DELIVERED:"Delivered", FAILED:"Delivery issue", CANCELLED:"Cancelled"
};
const money = (n:number,c:string) => new Intl.NumberFormat("en",{style:"currency",currency:c}).format(n/100);

export default function DriverPortal() {
  const [orders,setOrders] = useState<Delivery[]>([]);
  const [branch,setBranch] = useState<{name:string;code:string}|null>(null);
  const [onDuty,setOnDuty] = useState(false);
  const [busy,setBusy] = useState("");
  const [notice,setNotice] = useState("");
  const [updated,setUpdated] = useState<Date|null>(null);
  const watchId = useRef<number|null>(null);

  const load = useCallback(async () => {
    try {
      const r=await fetch("/api/dispatch/orders",{cache:"no-store"});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error || "Could not load your deliveries.");
      if(d.currentRole!=="DRIVER") { window.location.assign("/"); return; }
      setOrders(d.orders || []); setBranch(d.branch || null);
      setOnDuty(Boolean(d.driverSelf?.driverOnDuty)); setUpdated(new Date()); setNotice("");
    } catch(e) { setNotice(e instanceof Error ? e.message : "Unable to connect."); }
  },[]);

  useEffect(()=>{ void load(); const t=window.setInterval(()=>void load(),10000); return ()=>window.clearInterval(t); },[load]);

  useEffect(()=>{
    if(!onDuty || !navigator.geolocation) return;
    watchId.current=navigator.geolocation.watchPosition(async p=>{
      try {
        const r=await fetch("/api/dispatch/location",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          action:"update",latitude:p.coords.latitude,longitude:p.coords.longitude,accuracyMeters:p.coords.accuracy,
          headingDegrees:p.coords.heading,speedMetersPerSecond:p.coords.speed
        })});
        if(!r.ok) { const d=await r.json(); setNotice(d.error || "GPS update failed."); }
      } catch { setNotice("GPS update could not be sent. Check your connection."); }
    },e=>setNotice(e.code===e.PERMISSION_DENIED?"Location permission is off. Enable it in your phone settings.":"GPS signal unavailable. Keep this screen open."),{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
    return ()=>{ if(watchId.current!==null) navigator.geolocation.clearWatch(watchId.current); watchId.current=null; };
  },[onDuty]);

  async function startDuty() {
    if(!navigator.geolocation) { setNotice("This browser does not support GPS."); return; }
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(async p=>{
      try {
        const r=await fetch("/api/dispatch/location",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          action:"start",latitude:p.coords.latitude,longitude:p.coords.longitude,accuracyMeters:p.coords.accuracy,
          headingDegrees:p.coords.heading,speedMetersPerSecond:p.coords.speed
        })});
        const d=await r.json(); if(!r.ok) throw new Error(d.error || "Could not start duty.");
        setOnDuty(true); setNotice("You are on duty. Your branch can now see your location."); await load();
      } catch(e) { setNotice(e instanceof Error?e.message:"Could not start duty."); }
      finally { setBusy(""); }
    },e=>{setBusy("");setNotice(e.code===e.PERMISSION_DENIED?"Allow location access to start duty.":"Could not get GPS. Try again outdoors.");},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }

  async function stopDuty() {
    setBusy("gps");
    try {
      const r=await fetch("/api/dispatch/location",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"stop"})});
      const d=await r.json(); if(!r.ok) throw new Error(d.error || "Could not end duty.");
      setOnDuty(false); setNotice("You are off duty. Your saved live location has been cleared."); await load();
    } catch(e) { setNotice(e instanceof Error?e.message:"Could not end duty."); }
    finally { setBusy(""); }
  }

  async function update(order:Delivery,status:"PICKED_UP"|"DELIVERED"|"FAILED") {
    setBusy(order.id); setNotice("");
    try {
      const r=await fetch("/api/dispatch/orders",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:order.id,status})});
      const d=await r.json(); if(!r.ok) throw new Error(d.error || "Could not update order.");
      await load();
    } catch(e) { setNotice(e instanceof Error?e.message:"Update failed."); }
    finally { setBusy(""); }
  }

  async function signOut() { if(onDuty) { const ok=window.confirm("You are on duty. End duty and clear your live location before signing out?"); if(!ok)return; await stopDuty(); } await fetch("/api/auth/logout",{method:"POST"}); window.location.assign("/"); }

  const active=orders.filter(o=>o.deliveryStatus!=="DELIVERED" && o.deliveryStatus!=="CANCELLED");
  const picked=active.filter(o=>o.deliveryStatus==="PICKED_UP").length;

  return <main className="driver-app">
    <header className="topbar">
      <div className="brand"><img src="/1572434B-4E2C-4244-8EC4-E36B59E7E9D7.png" alt="ANAR & CO."/><div><span>ANAR & CO. · DRIVER</span><h1>My deliveries</h1><p>{branch?.name || "Your branch"}{branch?.code ? " · "+branch.code : ""}</p></div></div>
      <button className="signout" onClick={()=>void signOut()}>Sign out</button>
    </header>

    <section className={"duty "+(onDuty?"active":"")}>
      <div className="duty-indicator"><i/><div><strong>{onDuty?"You are on duty":"You are off duty"}</strong><p>{onDuty?"GPS sharing is active while this page stays open.":"Start duty when you are ready to receive deliveries."}</p></div></div>
      {onDuty?<button className="stop" disabled={busy==="gps"} onClick={()=>void stopDuty()}>{busy==="gps"?"Saving…":"End duty"}</button>:<button disabled={busy==="gps"} onClick={()=>void startDuty()}>{busy==="gps"?"Getting GPS…":"Start duty & share GPS"}</button>}
    </section>

    {notice&&<div className="notice" role="status">{notice}</div>}
    <section className="summary"><div><span>ACTIVE DELIVERIES</span><strong>{active.length}</strong></div><div><span>OUT FOR DELIVERY</span><strong>{picked}</strong></div><div><span>LAST UPDATED</span><strong className="time">{updated?updated.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}</strong></div></section>

    <div className="section-title"><div><span>YOUR WORK</span><h2>Assigned orders</h2></div><button onClick={()=>void load()}>↻ Refresh</button></div>
    {!active.length?<section className="empty"><div className="empty-icon">✓</div><h3>No active deliveries</h3><p>When Dispatch assigns an order to you, it will appear here automatically.</p></section>:
      <section className="orders">{active.map(o=><article className="order" key={o.id}>
        <div className="order-head"><div><span>ORDER</span><h3>#{o.orderNumber}</h3></div><b className={"pill "+o.deliveryStatus.toLowerCase()}>{statusText[o.deliveryStatus]}</b></div>
        <div className="amount">{money(o.totalMinor,o.currency)}</div>
        <div className="customer"><strong>{o.customerName || "Customer"}</strong><a href={o.customerPhone?"tel:"+o.customerPhone:undefined}>{o.customerPhone || "No phone number"}</a></div>
        <div className="address"><span>DELIVERY ADDRESS</span><p>{o.deliveryAddress || "No address supplied"}</p>{o.deliveryAddress&&<a target="_blank" rel="noreferrer" href={"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(o.deliveryAddress)}>Open directions in Maps ↗</a>}</div>
        <div className="items">{o.lines.map(l=><div key={l.id}><b>{l.quantity}×</b><span>{l.productName}{l.variantName?" · "+l.variantName:""}</span></div>)}</div>
        {o.notes&&<p className="notes">Order note: {o.notes}</p>}
        <div className="actions">
          {o.deliveryStatus==="ASSIGNED"&&<button disabled={busy===o.id} onClick={()=>void update(o,"PICKED_UP")}>{busy===o.id?"Updating…":"Confirm pickup"}</button>}
          {o.deliveryStatus==="PICKED_UP"&&<><button disabled={busy===o.id} onClick={()=>void update(o,"DELIVERED")}>{busy===o.id?"Updating…":"Mark delivered"}</button><button className="issue" disabled={busy===o.id} onClick={()=>void update(o,"FAILED")}>Report issue</button></>}
          {o.deliveryStatus==="FAILED"&&<p className="waiting">Dispatch has been notified. Contact your branch manager for reassignment.</p>}
        </div>
        <small className="received">Received {new Date(o.createdAt).toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}</small>
      </article>)}</section>}
    <footer>ANAR & CO. · Driver workspace <span>Refreshes automatically every 10 seconds</span></footer>

    <style jsx>{`
      .driver-app{min-height:100vh;background:#f6f3f0;color:#2b2524;padding:18px 16px 42px;font-family:inherit}
      .topbar,.duty,.summary,.section-title,.orders,.empty,footer,.notice{max-width:820px;margin-left:auto;margin-right:auto}
      .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
      .brand{display:flex;align-items:center;gap:12px}.brand img{width:66px;height:54px;object-fit:contain}.brand span,.section-title>div>span{font-size:9px;letter-spacing:.16em;color:#927b70;font-weight:850}.brand h1{font-size:24px;margin:2px 0;font-weight:800}.brand p{font-size:12px;color:#83746e;margin:0}
      button{border:0;border-radius:12px;background:#632d37;color:#fff;padding:13px 16px;font-weight:800;font-size:13px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.signout{background:#fff;color:#694d4c;border:1px solid #e8dfd9;padding:10px 13px}
      .duty{background:#fff;border:1px solid #eee6e0;border-radius:18px;padding:17px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.duty.active{border-color:#cfe5d4}.duty-indicator{display:flex;align-items:center;gap:11px}.duty-indicator i{width:11px;height:11px;border-radius:50%;background:#b7aaa3;flex:none}.duty.active i{background:#2d9b55;box-shadow:0 0 0 5px #e8f4eb}.duty strong{font-size:14px}.duty p{font-size:11px;color:#897a73;margin:4px 0 0;line-height:1.4}.duty .stop{background:#f3eeea;color:#694d4c}
      .notice{background:#fff0e9;color:#8c3e31;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:12px}
      .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:26px}.summary>div{background:#fff;border:1px solid #eee6e0;border-radius:15px;padding:13px}.summary span{display:block;font-size:8px;letter-spacing:.1em;color:#9b8981;font-weight:850}.summary strong{display:block;font-size:24px;margin-top:7px}.summary .time{font-size:16px}
      .section-title{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.section-title h2{font-size:20px;margin:3px 0 0}.section-title button{background:transparent;color:#713d46;padding:7px}
      .orders{display:grid;gap:13px}.order,.empty{background:#fff;border:1px solid #eee6e0;border-radius:19px;padding:17px;box-shadow:0 6px 22px #35201a08}.order-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.order-head>div>span,.address>span{font-size:9px;letter-spacing:.13em;color:#927b70;font-weight:850}.order-head h3{font-size:25px;margin:1px 0}.pill{font-size:9px;border-radius:30px;padding:7px 9px;background:#f3e8d9;color:#87602e}.pill.picked_up{background:#e7effb;color:#365e92}.pill.failed{background:#fff0ec;color:#a34b3e}
      .amount{font-size:16px;font-weight:850;margin:5px 0 13px}.customer{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.customer strong{font-size:15px}.customer a{color:#713d46;text-decoration:none;font-size:13px;font-weight:700}
      .address{background:#f8f5f2;border-radius:13px;padding:12px;margin:13px 0}.address p{font-size:13px;line-height:1.45;margin:5px 0 9px}.address a{color:#713d46;text-decoration:none;font-size:12px;font-weight:800}
      .items{border-top:1px solid #f0eae5;border-bottom:1px solid #f0eae5;padding:9px 0}.items div{display:flex;gap:10px;padding:4px 0;font-size:12px}.items b{color:#743d47;min-width:20px}.notes{font-size:11px;color:#826a53}.actions{display:flex;gap:8px;margin-top:13px}.actions button{flex:1}.actions .issue{background:#f3eeea;color:#694d4c}.waiting{font-size:12px;color:#8c5a3e}.received{display:block;color:#9b8e87;margin-top:13px;font-size:10px}
      .empty{text-align:center;padding:36px 22px}.empty-icon{margin:auto;width:42px;height:42px;border-radius:50%;background:#e8f4eb;color:#2e7044;display:grid;place-items:center;font-size:22px}.empty h3{margin:12px 0 5px}.empty p{font-size:12px;line-height:1.5;color:#897a73;max-width:360px;margin:auto}
      footer{padding:24px 3px 0;color:#9b8e87;font-size:10px;display:flex;justify-content:space-between;gap:8px}
      @media(max-width:480px){.driver-app{padding:14px 12px 32px}.brand img{width:52px;height:48px}.brand h1{font-size:21px}.duty{align-items:flex-start;flex-direction:column}.duty>button{width:100%}.summary>div{padding:11px}.summary strong{font-size:21px}.summary span{font-size:7px}.actions{flex-direction:column}.actions button{width:100%}footer{flex-direction:column}}
    `}</style>
  </main>;
}
