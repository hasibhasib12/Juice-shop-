"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StaffRow = { userId: string; name: string; email: string; role: string; currency: string; orderCount: number; grossSalesMinor: number; discountsMinor: number; averageOrderMinor: number; refundsProcessedMinor: number; refundsProcessedCount: number; shiftsOpened: number; shiftsClosed: number; openingCashMinor: number; closingCashMinor: number; paidInMinor: number; paidOutMinor: number };
type Report = { date: string; timezone: string; rows: StaffRow[] };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);

export default function StaffReportsPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Report | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setNotice("");
    try {
      const response = await fetch(`/api/reports/staff?date=${date}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load staff report.");
      setReport(data);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load staff report."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [date]);
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><Link href="/reports" className="catalog-back">← Sales reports</Link><div><span>JUICE SHOP · MANAGEMENT</span><h1>Staff performance</h1><p>Daily sales attribution, refund activity and shift operations by staff member.</p></div></header>
      <section className="report-controls"><label>Business date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh report"}</button><button type="button" onClick={() => window.print()} disabled={!report || loading}>Print / Save PDF</button><a href={`/api/reports/staff?date=${date}&format=csv`} className="catalog-cancel">Download staff CSV</a></section>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      {report && <>
        <p className="report-footnote">Business date: {report.date} · Timezone: {report.timezone}. Sales are attributed to the cashier on each completed order; refunds are attributed to the staff member who processed them. Different currencies are kept on separate rows.</p>
        <section className="catalog-list"><div className="catalog-section-head"><div><span>STAFF BREAKDOWN</span><h2>{report.rows.length} staff / currency rows</h2></div></div>
          <div className="report-row"><b>Staff member</b><span>Orders · shifts</span><strong>Gross sales</strong></div>
          {report.rows.map((row, index) => <article className="report-row" key={row.userId + row.currency + index}>
            <div><b>{row.name}</b><small>{row.email} · {row.role} · {row.currency}</small></div>
            <span>{row.orderCount} orders · {row.shiftsClosed}/{row.shiftsOpened} shifts closed</span>
            <strong>{money(row.grossSalesMinor, row.currency)}</strong>
            <small>Average {money(row.averageOrderMinor, row.currency)} · Discounts {money(row.discountsMinor, row.currency)} · Refunds processed {row.refundsProcessedCount} ({money(row.refundsProcessedMinor, row.currency)}) · Drawer in/out {money(row.paidInMinor, row.currency)} / {money(row.paidOutMinor, row.currency)}</small>
          </article>)}
          {!report.rows.length && <p>No active staff accounts found.</p>}
        </section>
      </>}
      <style jsx global>{`@media print { @page { size: A4 landscape; margin: 12mm; } body { background: #fff !important; color: #111 !important; } .catalog-admin { min-height: 0; padding: 0; background: #fff !important; color: #111 !important; } .catalog-admin-header { border: 0; padding: 0 0 12px; } .catalog-admin-header a, .report-controls, .catalog-back { display: none !important; } .catalog-admin-header h1, .catalog-admin-header p, .catalog-admin-header span, .report-footnote, .report-row, .report-row span, .report-row b, .report-row strong, .report-row small { color: #111 !important; } .catalog-list { background: #fff !important; color: #111 !important; border: 1px solid #bbb !important; box-shadow: none !important; break-inside: avoid; } .report-row { break-inside: avoid; } }`}</style>
    </main>
  );
}
