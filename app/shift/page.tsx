"use client";

import { FormEvent, useEffect, useState } from "react";

type Shift = { id: string; openingCashMinor: number; openedAt: string; closingCashMinor: number | null; expectedCashMinor: number | null };
type CashMovement = { id: string; type: "PAID_IN" | "PAID_OUT"; amountMinor: number; reason: string; createdAt: string };
const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "AFN" }).format(minor / 100);

export default function ShiftPage() {
  const [shift, setShift] = useState<Shift | null>(null);
  const [expected, setExpected] = useState(0);
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("0");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [movementType, setMovementType] = useState<"PAID_IN" | "PAID_OUT">("PAID_IN");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movements, setMovements] = useState<CashMovement[]>([]);
  async function load() {
    const response = await fetch("/api/shifts", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load shift.");
    setShift(data.shift);
    setExpected(data.expectedCashMinor ?? 0);
    setMovements(data.movements ?? []);
  }
  useEffect(() => { void load().catch((error) => setNotice(error.message)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>, action: "open" | "close") {
    event.preventDefault(); setBusy(true); setNotice("");
    const amount = Number(action === "open" ? opening : closing);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) { setNotice("Enter a valid non-negative cash amount."); setBusy(false); return; }
    try {
      const response = await fetch(action === "open" ? "/api/shifts" : "/api/shifts/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "open" ? { openingCashMinor: Math.round(amount * 100) } : { closingCashMinor: Math.round(amount * 100) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Shift update failed.");
      if (action === "close") setNotice(`Shift closed. Expected cash ${money(data.shift.expectedCashMinor)} · Variance ${money(data.shift.varianceMinor)}.`);
      else setNotice("Cash shift opened. You can now take sales.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Shift update failed."); }
    finally { setBusy(false); }
  }
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><a href="/" className="catalog-back">← Back to POS</a><div><span>JUICE SHOP · CASH MANAGEMENT</span><h1>Cash shift</h1><p>Open your drawer before sales and reconcile it at close.</p></div></header>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      <section className="shift-panel">
        {shift ? <>
          <div className="shift-status"><span>SHIFT OPEN</span><strong>Started {new Date(shift.openedAt).toLocaleString()}</strong></div>
          <div className="shift-metrics"><article><span>Opening float</span><b>{money(shift.openingCashMinor)}</b></article><article><span>Expected cash now</span><b>{money(expected)}</b></article></div>
          <form className="catalog-editor" onSubmit={(e) => void submit(e, "close")}><div className="catalog-section-head"><div><span>END OF SHIFT</span><h2>Close and reconcile</h2></div></div><label>Counted cash in drawer (AFN)<input required type="number" min="0" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)}/></label><p className="inventory-hint">Expected cash includes opening float, cash sales, refunds, and paid-in/paid-out movements. Non-cash tenders are excluded.</p><button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : "Close shift"}</button></form>
          <form className="catalog-editor cash-movement-form" onSubmit={(e) => void submitMovement(e)}>
            <div className="catalog-section-head"><div><span>DRAWER ADJUSTMENTS</span><h2>Paid in / paid out</h2></div></div>
            <label>Movement type<select value={movementType} onChange={(e) => setMovementType(e.target.value as "PAID_IN" | "PAID_OUT")}><option value="PAID_IN">Paid in · Add cash</option><option value="PAID_OUT">Paid out · Remove cash</option></select></label>
            <label>Amount (AFN)<input required type="number" min="0.01" step="0.01" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)}/></label>
            <label>Reason<input required minLength={3} maxLength={240} value={movementReason} onChange={(e) => setMovementReason(e.target.value)} placeholder="e.g. petty cash or cash top-up"/></label>
            <button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : movementType === "PAID_IN" ? "Record paid in" : "Record paid out"}</button>
          </form>
          <div className="catalog-list cash-movement-list"><div className="catalog-section-head"><div><span>SHIFT CASH LOG</span><h2>Recent movements</h2></div></div>{movements.map((movement) => <article className="report-row" key={movement.id}><b>{movement.type === "PAID_IN" ? "Paid in" : "Paid out"}</b><span>{movement.reason}</span><strong>{movement.type === "PAID_IN" ? "+" : "−"}{money(movement.amountMinor)}</strong></article>)}{!movements.length && <p>No cash movements recorded.</p>}</div>
        </> : <>
          <div className="shift-status closed"><span>NO OPEN SHIFT</span><strong>Open a drawer to enable checkout.</strong></div>
          <form className="catalog-editor" onSubmit={(e) => void submit(e, "open")}><div className="catalog-section-head"><div><span>START OF SHIFT</span><h2>Open cash drawer</h2></div></div><label>Opening float (AFN)<input required type="number" min="0" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)}/></label><button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : "Open shift"}</button></form>
        </>}
      </section>
    </main>
  );
}
