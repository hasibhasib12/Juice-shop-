"use client";

import Link from "next/link";

import { FormEvent, useEffect, useState } from "react";

type Shift = { id: string; openingCashMinor: number; openedAt: string; closingCashMinor: number | null; expectedCashMinor: number | null; branch?: { id: string; name: string; code: string; timezone: string; currency: string } };
type CashMovement = { id: string; type: "PAID_IN" | "PAID_OUT"; amountMinor: number; reason: string; createdAt: string };
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
  const [currency, setCurrency] = useState("AFN");
  const [staffName, setStaffName] = useState("");
  const [staffBranchName, setStaffBranchName] = useState("");
  const [closedJustNow, setClosedJustNow] = useState(false);
  const formatMoney = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
  async function load() {
    const response = await fetch("/api/shifts", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load shift.");
    setShift(data.shift);
    setExpected(data.expectedCashMinor ?? 0);
    setMovements(data.movements ?? []);
  }
  useEffect(() => {
    void load().catch((error) => setNotice(error.message));
    fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (data.user?.name) { setStaffName(data.user.name); setStaffBranchName(data.user.branch?.name ?? "Assigned branch"); if (new URLSearchParams(window.location.search).get("welcome") === "1") setNotice(`Welcome, ${data.user.name}! You are assigned to ${data.user.branch?.name ?? "your branch"}. Please count the cash in your drawer to open your shift.`); } }).catch(() => undefined);
    fetch("/api/settings", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (typeof data.settings?.currency === "string") setCurrency(data.settings.currency); }).catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("welcome") === "1") {
      window.history.replaceState({}, "", "/shift");
    }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>, action: "open" | "close") {
    event.preventDefault(); setBusy(true); setNotice("");
    const amount = Number(action === "open" ? opening : closing);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) { setNotice("Enter a valid non-negative cash amount."); setBusy(false); return; }
    try {
      const response = await fetch(action === "open" ? "/api/shifts" : "/api/shifts/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "open" ? { openingCashMinor: Math.round(amount * 100) } : { closingCashMinor: Math.round(amount * 100) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Shift update failed.");
      if (action === "close") { setClosedJustNow(true); setNotice(`Good work, ${staffName || "team member"}. Your shift is closed. Expected cash ${formatMoney(data.shift.expectedCashMinor)} · Difference ${formatMoney(data.shift.varianceMinor)}.`); }
      else setNotice("Cash shift opened. You can now take sales.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Shift update failed."); }
    finally { setBusy(false); }
  }
  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const amount = Number(movementAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || movementReason.trim().length < 3) {
      setNotice("Enter a valid amount and a reason of at least 3 characters."); setBusy(false); return;
    }
    try {
      const response = await fetch("/api/shifts/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: movementType, amountMinor: Math.round(amount * 100), reason: movementReason.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Cash movement failed.");
      setNotice(`${movementType === "PAID_IN" ? "Paid in" : "Paid out"} recorded. Expected drawer: ${formatMoney(data.expectedCashMinor)}.`);
      setMovementAmount(""); setMovementReason(""); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Cash movement failed."); }
    finally { setBusy(false); }
  }
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><Link href="/" className="catalog-back">← Back to POS</Link><div><span>JUICE SHOP · CASH MANAGEMENT</span><h1>Cash shift</h1><p>Open your drawer before sales and reconcile it at close.</p></div></header>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      <section className="shift-panel">
        {shift ? <>
          <div className="shift-status"><span>SHIFT OPEN · {shift.branch?.name ?? "Assigned branch"}</span><strong>Started {new Date(shift.openedAt).toLocaleString()}</strong></div>
          <div className="shift-metrics"><article><span>Opening float</span><b>{formatMoney(shift.openingCashMinor)}</b></article><article><span>Expected cash now</span><b>{formatMoney(expected)}</b></article></div>
          <form className="catalog-editor" onSubmit={(e) => void submit(e, "close")}><div className="catalog-section-head"><div><span>END OF SHIFT</span><h2>Close and reconcile</h2></div></div><label>Counted cash in drawer ({currency})<input required type="number" min="0" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)}/></label><p className="inventory-hint">Expected cash includes opening float, cash sales, refunds, and paid-in/paid-out movements. Non-cash tenders are excluded.</p><button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : "Close shift"}</button></form>
          <form className="catalog-editor cash-movement-form" onSubmit={(e) => void submitMovement(e)}>
            <div className="catalog-section-head"><div><span>DRAWER ADJUSTMENTS</span><h2>Paid in / paid out</h2></div></div>
            <label>Movement type<select value={movementType} onChange={(e) => setMovementType(e.target.value as "PAID_IN" | "PAID_OUT")}><option value="PAID_IN">Paid in · Add cash</option><option value="PAID_OUT">Paid out · Remove cash</option></select></label>
            <label>Amount ({currency})<input required type="number" min="0.01" step="0.01" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)}/></label>
            <label>Reason<input required minLength={3} maxLength={240} value={movementReason} onChange={(e) => setMovementReason(e.target.value)} placeholder="e.g. petty cash or cash top-up"/></label>
            <button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : movementType === "PAID_IN" ? "Record paid in" : "Record paid out"}</button>
          </form>
          <div className="catalog-list cash-movement-list"><div className="catalog-section-head"><div><span>SHIFT CASH LOG</span><h2>Recent movements</h2></div></div>{movements.map((movement) => <article className="report-row" key={movement.id}><b>{movement.type === "PAID_IN" ? "Paid in" : "Paid out"}</b><span>{movement.reason}</span><strong>{movement.type === "PAID_IN" ? "+" : "−"}{formatMoney(movement.amountMinor)}</strong></article>)}{!movements.length && <p>No cash movements recorded.</p>}</div>
        </> : <>
          <div className="shift-status closed"><span>NO OPEN SHIFT</span><strong>Open a drawer for {staffBranchName || "your assigned branch"} to enable checkout.</strong></div>
          <form className="catalog-editor" onSubmit={(e) => void submit(e, "open")}><div className="catalog-section-head"><div><span>START OF SHIFT</span><h2>Open cash drawer</h2></div></div><label>Opening float ({currency})<input required type="number" min="0" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)}/></label><button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : "Open shift"}</button></form>
        </>}
      </section>
      {!shift && closedJustNow && <section className="catalog-editor shift-logout-panel"><h2>Shift completed</h2><p>Goodbye, {staffName || "team member"}! Your cash shift has been closed successfully.</p><button type="button" className="catalog-primary" onClick={async () => { const response = await fetch("/api/auth/logout", { method: "POST" }); const data = await response.json(); if (!response.ok) { setNotice(data.error || "Could not log out."); return; } window.location.assign("/"); }}>Log out safely</button></section>}
    </main>
  );
}
