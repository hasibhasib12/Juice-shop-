"use client";

import Link from "next/link";

import { FormEvent, useEffect, useState } from "react";

type Branch = { id: string; name: string; code: string; currency: string; timezone: string };
type Settings = { countryCode: string; countryName: string; currency: string; timezone: string; locale: string; taxRateBps: number; taxLabel: string; maxDiscountPercentBps: number };
const defaults: Settings = { countryCode: "AF", countryName: "Afghanistan", currency: "AFN", timezone: "Asia/Kabul", locale: "en-AF", taxRateBps: 0, taxLabel: "Tax", maxDiscountPercentBps: 10000 };
export default function SettingsPage() {
  const [settings, setSettings] = useState(defaults);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [maxDiscountPercent, setMaxDiscountPercent] = useState("100");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/admin/branches", { cache: "no-store" }).then((r) => r.json()),
    ]).then(async ([me, branchData]) => {
      if (!active) return;
      if (!branchData.branches?.length) throw new Error(branchData.error || "No active branches available.");
      setBranches(branchData.branches);
      const initialBranchId = branchData.branches.some((branch: Branch) => branch.id === me.user?.branchId)
        ? me.user.branchId : branchData.branches[0].id;
      setBranchId(initialBranchId);
      const response = await fetch("/api/settings?branchId=" + encodeURIComponent(initialBranchId), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load store settings.");
      if (!active) return;
      if (data.settings) {
        setSettings({ ...defaults, ...data.settings });
        setTaxPercent((Number(data.settings.taxRateBps ?? 0) / 100).toString());
        setMaxDiscountPercent((Number(data.settings.maxDiscountPercentBps ?? 10000) / 100).toString());
      }
    }).catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "Could not load store settings."); });
    return () => { active = false; };
  }, []);
  async function changeBranch(nextBranchId: string) {
    setBranchId(nextBranchId); setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/settings?branchId=" + encodeURIComponent(nextBranchId), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load branch settings.");
      setSettings({ ...defaults, ...data.settings });
      setTaxPercent((Number(data.settings.taxRateBps ?? 0) / 100).toString());
      setMaxDiscountPercent((Number(data.settings.maxDiscountPercentBps ?? 10000) / 100).toString());
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load branch settings."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const rate = Number(taxPercent);
    const discountLimit = Number(maxDiscountPercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { setNotice("Tax rate must be between 0% and 100%."); setBusy(false); return; }
    if (!Number.isFinite(discountLimit) || discountLimit < 0.01 || discountLimit > 100) { setNotice("Maximum discount must be between 0.01% and 100%."); setBusy(false); return; }
    try {
      const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, branchId, taxRateBps: Math.round(rate * 100), maxDiscountPercentBps: Math.round(discountLimit * 100) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Settings could not be saved.");
      setSettings({ ...defaults, ...data.settings });
      setNotice("Store settings saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Settings could not be saved."); }
    finally { setBusy(false); }
  }
  function field<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings((current) => ({ ...current, [key]: value })); }
  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header"><Link href="/" className="catalog-back">← Back to POS</Link><div><span>JUICE SHOP · OWNER SETTINGS</span><h1>Store settings</h1><p>Configure the store region, currency, time zone and tax rule.</p></div></header>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      <form className="catalog-editor settings-editor" onSubmit={save}>
        <div className="catalog-section-head"><div><span>BRANCH CONFIGURATION</span><h2>Choose a branch</h2></div></div>
        <label>Branch<select value={branchId} onChange={(e) => void changeBranch(e.target.value)} disabled={busy || branches.length === 0}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code} · {branch.currency}</option>)}</select></label>
        <p className="inventory-hint">Tax and discount limits are saved separately for the selected branch. Regional store identity remains shared across the store.</p>
        <div className="catalog-section-head settings-subhead"><div><span>REGIONAL SETTINGS</span><h2>Store location & currency</h2></div></div>
        <div className="catalog-form-row"><label>Country code<input required maxLength={2} value={settings.countryCode} onChange={(e) => field("countryCode", e.target.value.toUpperCase())}/></label><label>Country name<input required maxLength={80} value={settings.countryName} onChange={(e) => field("countryName", e.target.value)}/></label></div>
        <div className="catalog-form-row"><label>Currency (ISO 4217)<input required maxLength={3} value={settings.currency} onChange={(e) => field("currency", e.target.value.toUpperCase())}/></label><label>Locale<input required maxLength={24} value={settings.locale} onChange={(e) => field("locale", e.target.value)}/></label></div>
        <label>Time zone (IANA)<input required maxLength={80} value={settings.timezone} onChange={(e) => field("timezone", e.target.value)} placeholder="Asia/Kabul"/></label>
        <div className="catalog-section-head settings-subhead"><div><span>TAX CONFIGURATION</span><h2>Sales tax</h2></div></div>
        <div className="catalog-form-row"><label>Tax label<input required maxLength={30} value={settings.taxLabel} onChange={(e) => field("taxLabel", e.target.value)}/></label><label>Tax rate (%)<input required type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)}/></label></div>
        <p className="inventory-hint">Tax defaults to 0%. Set the legally applicable rate only after confirming the rules for your business location. This POS currently adds the configured rate to the subtotal (tax-exclusive pricing).</p>
        <div className="catalog-section-head settings-subhead"><div><span>DISCOUNT CONTROL</span><h2>Manager approval limit</h2></div></div>
        <label>Maximum discount (%)<input required type="number" min="0.01" max="100" step="0.01" value={maxDiscountPercent} onChange={(e) => setMaxDiscountPercent(e.target.value)}/></label>
        <p className="inventory-hint">Discounts still require manager or owner password approval. This limit caps the percentage that can be approved on an order. Default: 100% (discount must still be less than the subtotal).</p>
      <button className="catalog-primary" disabled={busy || !branchId}>{busy ? "Saving…" : "Save branch settings"}</button>
      </form>
    </main>
  );
}
