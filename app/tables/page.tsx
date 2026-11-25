"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type OpenOrder = { id: string; orderNumber: number; customerName: string | null; totalMinor: number; currency: string; cashier: { name: string } };
type DiningTable = { id: string; name: string; section: string | null; capacity: number; sortOrder: number; currentOrder: OpenOrder | null };
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);

export default function TablesPage() {
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [capacity, setCapacity] = useState("2");
  const [selectedOrders, setSelectedOrders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/tables", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load tables.");
      setTables(data.tables); setOrders(data.openOrders);
      setSelectedOrders(Object.fromEntries(data.tables.map((table: DiningTable) => [table.id, table.currentOrder?.id ?? ""])));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load tables."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function createTable(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/tables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, section, capacity: Number(capacity) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not create table.");
      setName(""); setSection(""); setCapacity("2"); setNotice("Table created."); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create table."); }
    finally { setBusy(false); }
  }

  async function moveOrder(orderId: string, tableId: string | null) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/table-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, tableId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not move order.");
      setNotice(tableId ? "Order assigned or transferred." : "Order removed from table."); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not move order."); }
    finally { setBusy(false); }
  }

  async function deactivate(table: DiningTable) {
    if (!window.confirm("Deactivate " + table.name + "? It will be hidden from the active table list.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/tables", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: table.id, active: false }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not deactivate table.");
      setNotice("Table deactivated."); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not deactivate table."); }
    finally { setBusy(false); }
  }

  return <main className="catalog-page"><header className="catalog-header"><div><span className="login-kicker">JUICE SHOP · FLOOR MANAGEMENT</span><h1>Tables & open orders</h1><p>Assign saved orders, transfer them between tables, and complete checkout from the POS.</p></div><Link className="catalog-back" href="/">← Back to POS</Link></header>
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="form-success">{notice}</p>}
    <section className="catalog-section"><h2>Add a table</h2><form className="catalog-form" onSubmit={createTable}><label>Table name<input required maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Table 1"/></label><label>Section<input maxLength={60} value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. Patio"/></label><label>Seats<input type="number" min="1" max="30" value={capacity} onChange={e => setCapacity(e.target.value)}/></label><button className="login-submit" disabled={busy}>Create table</button></form></section>
    <section className="catalog-section"><h2>Active tables</h2>{loading ? <p>Loading tables…</p> : tables.length === 0 ? <p>No active tables yet.</p> : <div className="catalog-grid">{tables.map(table => <article className="catalog-product" key={table.id}><div className="catalog-product-info"><b>{table.name}</b><span>{table.section || "Main floor"} · {table.capacity} seats</span>{table.currentOrder ? <><small>Occupied · Draft #{table.currentOrder.orderNumber} · {money(table.currentOrder.totalMinor, table.currentOrder.currency)}</small><span>{table.currentOrder.customerName || "Walk-in"} · {table.currentOrder.cashier.name}</span></> : <small>Available</small>}</div><label>Assign / transfer open order<select disabled={busy} value={selectedOrders[table.id] ?? ""} onChange={e => setSelectedOrders(prev => ({ ...prev, [table.id]: e.target.value }))}><option value="">Choose open order…</option>{orders.map(order => <option key={order.id} value={order.id}>#{order.orderNumber} · {order.customerName || "Walk-in"} · {money(order.totalMinor, order.currency)}</option>)}</select></label><button type="button" disabled={busy || !selectedOrders[table.id] || selectedOrders[table.id] === table.currentOrder?.id} onClick={() => void moveOrder(selectedOrders[table.id], table.id)}>Assign / transfer</button>{table.currentOrder && <button type="button" disabled={busy} onClick={() => void moveOrder(table.currentOrder!.id, null)}>Clear table assignment</button>}<button type="button" disabled={busy || !!table.currentOrder} onClick={() => void deactivate(table)}>Deactivate</button></article>)}</div>}</section>
    <section className="catalog-section"><h2>Unassigned open orders</h2>{orders.length === 0 ? <p>No unassigned drafts are visible to your account.</p> : <ul>{orders.map(order => <li key={order.id}>Draft #{order.orderNumber} · {order.customerName || "Walk-in"} · {order.cashier.name} · {money(order.totalMinor, order.currency)}</li>)}</ul>}<p>To close a table sale, resume its draft in the POS and complete checkout. Successful checkout releases the table automatically.</p></section>
  </main>;
}
