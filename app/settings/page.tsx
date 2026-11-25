"use client";

import { FormEvent, useEffect, useState } from "react";

type Settings = { countryCode: string; countryName: string; currency: string; timezone: string; locale: string; taxRateBps: number; taxLabel: string };
const defaults: Settings = { countryCode: "AF", countryName: "Afghanistan", currency: "AFN", timezone: "Asia/Kabul", locale: "en-AF", taxRateBps: 0, taxLabel: "Tax" };
export default function SettingsPage() {
  const [settings, setSettings] = useState(defaults);
  const [taxPercent, setTaxPercent] = useState("0");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (data.settings) {
        setSettings({ ...defaults, ...data.settings });
        setTaxPercent((Number(data.settings.taxRateBps ?? 0) / 100).toString());
      }
    }).catch(() => setNotice("Could not load store settings."));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const rate = Number(taxPercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) { setNotice("Tax rate must be between 0% and 100%."); setBusy(false); return; }
    try {
      const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, taxRateBps: Math.round(rate * 100) }) });
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
      <header className="catalog-admin-header"><a href="/" className="catalog-back">← Back to POS</a><div><span>JUICE SHOP · OWNER SETTINGS</span><h1>Store settings</h1><p>Configure the store region, currency, time zone and tax rule.</p></div></header>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      <form className="catalog-editor settings-editor" onSubmit={save}>
        <div className="catalog-section-head"><div><span>REGIONAL SETTINGS</span><h2>Store location & currency</h2></div></div>
        <div className="catalog-form-row"><label>Country code<input required maxLength={2} value={settings.countryCode} onChange={(e) => field("countryCode", e.target.value.toUpperCase())}/></label><label>Country name<input required maxLength={80} value={settings.countryName} onChange={(e) => field("countryName", e.target.value)}/></label></div>
        <div className="catalog-form-row"><label>Currency (ISO 4217)<input required maxLength={3} value={settings.currency} onChange={(e) => field("currency", e.target.value.toUpperCase())}/></label><label>Locale<input required maxLength={24} value={settings.locale} onChange={(e) => field("locale", e.target.value)}/></label></div>
        <label>Time zone (IANA)<input required maxLength={80} value={settings.timezone} onChange={(e) => field("timezone", e.target.value)} placeholder="Asia/Kabul"/></label>
        <div className="catalog-section-head settings-subhead"><div><span>TAX CONFIGURATION</span><h2>Sales tax</h2></div></div>
        <div className="catalog-form-row"><label>Tax label<input required maxLength={30} value={settings.taxLabel} onChange={(e) => field("taxLabel", e.target.value)}/></label><label>Tax rate (%)<input required type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)}/></label></div>
        <p className="inventory-hint">Tax defaults to 0%. Set the legally applicable rate only after confirming the rules for your business location. This POS currently adds the configured rate to the subtotal (tax-exclusive pricing).</p>
        <button className="catalog-primary" disabled={busy}>{busy ? "Saving…" : "Save store settings"}</button>
      </form>
    </main>
  );
}
