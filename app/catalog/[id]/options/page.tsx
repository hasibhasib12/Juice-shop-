"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Config = { variants: { name: string; priceMinor: number; sku?: string | null; active?: boolean; recipeItems?: { ingredientId: string; quantity: number }[] }[]; modifierGroups: { name: string; required?: boolean; minSelections?: number; maxSelections?: number; active?: boolean; options: { name: string; priceDeltaMinor?: number; active?: boolean }[] }[] };

export default function ProductOptionsPage() {
  const params = useParams<{ id: string }>();
  const [productName, setProductName] = useState("Product options");
  const [variants, setVariants] = useState("[]");
  const [groups, setGroups] = useState("[]");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/products/${params.id}/options`, { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load product options."); return data; })
      .then(data => {
        setProductName(data.name || "Product options");
        setVariants(JSON.stringify(data.variants.map((v: {name:string;priceMinor:number;sku:string|null;active:boolean;recipeItems:{ingredientId:string;quantity:string|number}[]}) => ({ name: v.name, priceMinor: v.priceMinor, sku: v.sku, active: v.active, recipeItems: v.recipeItems.map(r => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity) })) })), null, 2));
        setGroups(JSON.stringify(data.modifierGroups.map((g: {name:string;required:boolean;minSelections:number;maxSelections:number;active:boolean;options:{name:string;priceDeltaMinor:number;active:boolean}[]}) => ({ name: g.name, required: g.required, minSelections: g.minSelections, maxSelections: g.maxSelections, active: g.active, options: g.options.map(o => ({ name: o.name, priceDeltaMinor: o.priceDeltaMinor, active: o.active })) })), null, 2));
      })
      .catch(error => setNotice(error instanceof Error ? error.message : "Could not load product options."));
  }, [params.id]);

  async function save() {
    setBusy(true); setNotice("");
    try {
      const config: Config = { variants: JSON.parse(variants), modifierGroups: JSON.parse(groups) };
      const response = await fetch(`/api/admin/products/${params.id}/options`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save product options.");
      setNotice("Sizes and modifiers saved. The POS menu will use the updated choices.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid options configuration."); }
    finally { setBusy(false); }
  }

  return <main className="catalog-admin">
    <header className="catalog-admin-header"><Link href="/catalog" className="catalog-back">← Back to catalogue</Link><div><span>JUICE SHOP · MENU CONFIGURATION</span><h1>{productName}</h1><p>Configure sizes, recipes and paid extras for this product.</p></div></header>
    {notice && <p className="catalog-notice" role="status">{notice}</p>}
    <section className="catalog-editor" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div className="catalog-section-head"><div><span>PRODUCT SIZES</span><h2>Variants</h2></div></div>
      <p>Each variant has its own price. Recipe items override the base product recipe when at least one ingredient is configured.</p>
      <label>Variants JSON<textarea rows={14} spellCheck={false} value={variants} onChange={e => setVariants(e.target.value)} /></label>
      <div className="catalog-section-head"><div><span>OPTIONAL EXTRAS</span><h2>Modifier groups</h2></div></div>
      <p>Each group defines the minimum and maximum number of choices. Prices are added per selected option.</p>
      <label>Modifier groups JSON<textarea rows={18} spellCheck={false} value={groups} onChange={e => setGroups(e.target.value)} /></label>
      <button className="catalog-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save sizes and modifiers"}</button>
    </section>
  </main>;
}
