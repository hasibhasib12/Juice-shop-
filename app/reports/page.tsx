"use client";

import Link from "next/link";

import { useEffect, useState } from "react";

type CurrencyBreakdown = { currency: string; orderCount: number; refundCount: number; voidCount: number; voidTotalMinor: number; grossTotalMinor: number; refundTotalMinor: number; totalMinor: number; taxMinor: number; discountMinor: number; averageOrderMinor: number; tenders: { method: string; amountMinor: number }[]; topProducts: { name: string; quantity: number; salesMinor: number }[] };
type Report = { period: string; start: string; end: string; orderCount: number; refundCount: number; voidCount: number; voidTotalMinor: number | null; refundTotalMinor: number | null; currencies: string[]; totalMinor: number | null; taxMinor: number | null; discountMinor: number | null; averageOrderMinor: number | null; currencyBreakdown: CurrencyBreakdown[]; tenders: { method: string; amountMinor: number }[]; topProducts: { name: string; quantity: number; salesMinor: number }[]; recentOrders: { orderNumber: number; totalMinor: number; currency: string; cashier: string }[] };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);

export default function ReportsPage() {
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Report | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setNotice("");
    try {
      const response = await fetch(`/api/reports?period=${period}&date=${date}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load report.");
      setReport(data);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load report."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [period, date]);
  const currency = report?.currencies.length === 1 ? report.currencies[0] : "AFN";
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><Link href="/" className="catalog-back">← Back to POS</Link><Link href="/reports/staff" className="catalog-back">Staff performance →</Link><div><span>JUICE SHOP · MANAGEMENT</span><h1>Sales reports</h1><p>Review completed sales and payment mix.</p></div></header>
      <section className="report-controls">
        <label>Period<select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
        <label>Reference date<input type="date" value={date} onChange={(e) => setDate(e.target.value)}/></label>
        <button onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh report"}</button><button type="button" onClick={() => window.print()} disabled={!report || loading}>Print / Save PDF</button>
        <a href={`/api/reports/pdf?period=${period}&date=${date}`} className="catalog-cancel">Download server PDF</a><a href={`/api/reports?period=${period}&date=${date}&format=csv`} className="catalog-cancel">Download sales CSV</a><a href={`/api/reports/shifts/pdf?date=${date}`} className="catalog-cancel">Download shift PDF</a><a href={`/api/reports/shifts?date=${date}`} className="catalog-cancel">Download shift CSV</a>
      </section>
      {notice && <p className="catalog-notice">{notice}</p>}
      {report && <>
        {report.currencies.length > 1 ? report.currencyBreakdown.map((item) => <section className="catalog-list" key={item.currency}>
          <div className="catalog-section-head"><div><span>FINANCIAL SUMMARY</span><h2>{item.currency}</h2></div></div>
          <section className="report-metrics">
            <article><span>NET SALES</span><strong>{money(item.totalMinor, item.currency)}</strong></article>
            <article><span>ORDERS</span><strong>{item.orderCount}</strong></article>
            <article><span>AVERAGE ORDER</span><strong>{money(item.averageOrderMinor, item.currency)}</strong></article>
            <article><span>TAX RECORDED</span><strong>{money(item.taxMinor, item.currency)}</strong></article>
            <article><span>REFUNDS</span><strong>{item.refundCount} · {money(item.refundTotalMinor, item.currency)}</strong></article>
            <article><span>VOIDS</span><strong>{item.voidCount} · {money(item.voidTotalMinor, item.currency)}</strong></article>
          </section>
        </section>) : <section className="report-metrics">
          <article><span>NET SALES</span><strong>{money(report.totalMinor ?? 0, currency)}</strong></article>
          <article><span>ORDERS</span><strong>{report.orderCount}</strong></article>
          <article><span>AVERAGE ORDER</span><strong>{money(report.averageOrderMinor ?? 0, currency)}</strong></article>
          <article><span>TAX RECORDED</span><strong>{money(report.taxMinor ?? 0, currency)}</strong></article>
          <article><span>REFUNDS</span><strong>{report.refundCount} · {money(report.refundTotalMinor ?? 0, currency)}</strong></article>
          <article><span>VOIDS</span><strong>{report.voidCount} · {money(report.voidTotalMinor ?? 0, currency)}</strong></article>
        </section>}
        {report.currencies.length > 1 ? report.currencyBreakdown.map((item) => <section className="report-columns" key={item.currency}>
          <div className="catalog-list"><div className="catalog-section-head"><div><span>{item.currency} · PRODUCT MIX</span><h2>Top products</h2></div></div>{item.topProducts.map((p) => <article className="report-row" key={p.name}><b>{p.name}</b><span>{p.quantity} sold</span><strong>{money(p.salesMinor, item.currency)}</strong></article>)}{!item.topProducts.length && <p>No completed sales in this currency.</p>}</div>
          <div className="catalog-list"><div className="catalog-section-head"><div><span>{item.currency} · PAYMENT MIX</span><h2>Tenders</h2></div></div>{item.tenders.map((t) => <article className="report-row" key={t.method}><b>{t.method}</b><strong>{money(t.amountMinor, item.currency)}</strong></article>)}{!item.tenders.length && <p>No payments recorded.</p>}<div className="report-row"><span>Discounts</span><strong>{money(item.discountMinor, item.currency)}</strong></div></div>
        </section>) : <section className="report-columns">
          <div className="catalog-list"><div className="catalog-section-head"><div><span>PRODUCT MIX</span><h2>Top products</h2></div></div>{report.topProducts.map((p) => <article className="report-row" key={p.name}><b>{p.name}</b><span>{p.quantity} sold</span><strong>{money(p.salesMinor, currency)}</strong></article>)}{!report.topProducts.length && <p>No completed sales in this period.</p>}</div>
          <div className="catalog-list"><div className="catalog-section-head"><div><span>PAYMENT MIX</span><h2>Tenders</h2></div></div>{report.tenders.map((t) => <article className="report-row" key={t.method}><b>{t.method}</b><strong>{money(t.amountMinor, currency)}</strong></article>)}{!report.tenders.length && <p>No payments recorded.</p>}<div className="report-row"><span>Discounts</span><strong>{money(report.discountMinor ?? 0, currency)}</strong></div></div>
        </section>}
        <section className="catalog-list"><div className="catalog-section-head"><div><span>TRANSACTION LOG</span><h2>Recent orders</h2></div></div>{report.recentOrders.map((o) => <article className="report-row" key={o.orderNumber}><b>#{o.orderNumber}</b><span>{o.cashier}</span><strong>{money(o.totalMinor, o.currency)}</strong></article>)}{!report.recentOrders.length && <p>No orders to show.</p>}</section>
        <p className="report-footnote">Report window: {new Date(report.start).toLocaleString()} – {new Date(report.end).toLocaleString()}. Refunds and voids are deducted on the date they are processed; average order and product mix reflect gross sales.</p>
      </>}
      <style jsx global>{`@media print { @page { size: A4; margin: 14mm; } body { background: #fff !important; color: #111 !important; } .catalog-admin { min-height: 0; padding: 0; background: #fff !important; color: #111 !important; } .catalog-admin-header { border: 0; padding: 0 0 12px; } .catalog-admin-header a, .report-controls, .catalog-back { display: none !important; } .catalog-admin-header h1, .catalog-admin-header p, .catalog-admin-header span, .report-footnote, .report-row, .report-row span, .report-row b, .report-row strong { color: #111 !important; } .report-metrics article, .catalog-list { background: #fff !important; color: #111 !important; border: 1px solid #bbb !important; box-shadow: none !important; break-inside: avoid; } .report-metrics { grid-template-columns: repeat(3, 1fr); } .report-columns { grid-template-columns: 1fr 1fr; } }`}</style>
    </main>
  );
}
