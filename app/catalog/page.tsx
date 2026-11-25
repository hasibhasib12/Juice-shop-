"use client";

import Link from "next/link";

import { FormEvent, useEffect, useState } from "react";

type Category = { id: string; name: string; active: boolean };
type Product = { id: string; name: string; description: string | null; imageUrl: string | null; sku: string | null; priceMinor: number; currency: string; available: boolean; status: "ACTIVE" | "ARCHIVED"; category: { id: string; name: string } };

const empty = { name: "", description: "", imageUrl: "", sku: "", price: "80", currency: "AFN", categoryId: "", available: true };

export default function CataloguePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/products", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load catalogue.");
      setProducts(data.products);
      setCategories(data.categories);
      setForm((current) => ({ ...current, categoryId: current.categoryId || data.categories.find((c: Category) => c.active)?.id || "" }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load catalogue.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function startEdit(product: Product) {
    setEditing(product.id);
    setImageFile(null);
    setForm({
      name: product.name,
      description: product.description || "",
      imageUrl: product.imageUrl || "",
      sku: product.sku || "",
      price: (product.priceMinor / 100).toFixed(2),
      currency: product.currency,
      categoryId: product.category.id,
      available: product.available,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const amount = Number(form.price);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      setNotice("Enter a valid price greater than zero.");
      setBusy(false);
      return;
    }
    const payload = { ...form, priceMinor: Math.round(amount * 100) };
    delete (payload as Partial<typeof payload>).price;
    try {
      const response = await fetch(editing ? `/api/admin/products/${editing}` : "/api/admin/products", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save product.");
      if (imageFile) {
        const imageData = new FormData();
        imageData.set("image", imageFile);
        const upload = await fetch(`/api/admin/products/${data.product.id}/image`, { method: "POST", body: imageData });
        const uploadData = await upload.json();
        if (!upload.ok) throw new Error(uploadData.error || "Product saved, but image upload failed.");
      }
      setNotice(editing ? "Product updated." : "Product added.");
      setEditing(null);
      setImageFile(null);
      setForm({ ...empty, categoryId: categories.find((c) => c.active)?.id || "" });
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save product."); }
    finally { setBusy(false); }
  }

  async function archive(product: Product) {
    if (!window.confirm(`Archive “${product.name}”? It will disappear from the till but remain in order history.`)) return;
    const response = await fetch(`/api/admin/products/${product.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "Could not archive product.");
    else { setNotice(`${product.name} archived.`); await load(); }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: categoryName }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "Could not add category."); return; }
    setCategoryName("");
    setNotice("Category added.");
    await load();
    setForm((current) => ({ ...current, categoryId: data.category.id }));
  }

  async function updateCategory(category: Category) {
    const name = window.prompt("Category name", category.name);
    if (name === null) return;
    const response = await fetch("/api/admin/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: category.id, name }),
    });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "Could not rename category."); return; }
    setNotice("Category renamed.");
    await load();
  }

  async function toggleCategory(category: Category) {
    const action = category.active ? "archive" : "restore";
    if (!window.confirm(`${action === "archive" ? "Archive" : "Restore"} “${category.name}”?`)) return;
    const response = category.active
      ? await fetch("/api/admin/categories", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: category.id }) })
      : await fetch("/api/admin/categories", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: category.id, active: true }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || `Could not ${action} category.`); return; }
    setNotice(`Category ${action}d.`);
    await load();
  }

  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header">
        <Link href="/" className="catalog-back">← Back to POS</Link>
        <div><span>JUICE SHOP · MANAGEMENT</span><h1>Product catalogue</h1><p>Manage the menu that appears on the till.</p></div>
      </header>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      <section className="catalog-admin-grid">
        <form className="catalog-editor" onSubmit={save}>
          <div className="catalog-section-head"><div><span>{editing ? "EDIT ITEM" : "NEW ITEM"}</span><h2>{editing ? "Update product" : "Add a product"}</h2></div>{editing && <button type="button" className="catalog-cancel" onClick={() => { setEditing(null); setForm(empty); setImageFile(null); }}>Cancel</button>}</div>
          <label>Product name<input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Fresh orange juice"/></label>
          <label>Description<input maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short menu description"/></label>
          <div className="catalog-form-row">
            <label>Price<input required type="number" min="0.01" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}/></label>
            <label>Currency<input required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}/></label>
          </div>
          <label>Category<select required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Choose category</option>{categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Photo URL (HTTPS)<input type="url" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…"/></label>
          <label>Or upload product photo (JPEG, PNG, WebP · max 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}/>{imageFile && <small>Selected: {imageFile.name}</small>}</label>
          <label>SKU (optional)<input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="JUICE-001"/></label>
          <label className="catalog-check"><input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })}/> Available on the till</label>
          <button className="catalog-primary" disabled={busy || categories.filter((c) => c.active).length === 0}>{busy ? "Saving…" : editing ? "Save changes" : "Add product"}</button>
        </form>
        <div className="catalog-side">
          <form className="catalog-category-form" onSubmit={addCategory}>
            <div className="catalog-section-head"><div><span>MENU STRUCTURE</span><h2>Categories</h2></div></div>
            <div className="catalog-inline"><input required maxLength={60} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="New category name"/><button type="submit">Add</button></div>
            <div className="catalog-chips">{categories.map((c) => <span key={c.id} className={c.active ? "" : "muted"}>{c.name}<button type="button" onClick={() => void updateCategory(c)} aria-label={`Rename ${c.name}`}>Edit</button><button type="button" onClick={() => void toggleCategory(c)} aria-label={`${c.active ? "Archive" : "Restore"} ${c.name}`}>{c.active ? "Archive" : "Restore"}</button></span>)}</div>
          </form>
          <section className="catalog-list">
            <div className="catalog-section-head"><div><span>YOUR MENU</span><h2>Products <small>{products.length}</small></h2></div></div>
            {loading ? <p>Loading catalogue…</p> : products.map((p) => (
              <article className={p.status === "ARCHIVED" ? "catalog-product archived" : "catalog-product"} key={p.id}>
                {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <div className="catalog-placeholder">🍹</div>}
                <div className="catalog-product-info"><b>{p.name}</b><span>{p.category.name} · {p.currency} {(p.priceMinor / 100).toFixed(2)}</span><small>{p.status === "ARCHIVED" ? "Archived" : p.available ? "Available" : "Hidden from till"}</small></div>
                <div className="catalog-product-actions"><button type="button" onClick={() => startEdit(p)}>Edit</button><button type="button" onClick={() => { window.location.href = `/catalog/${p.id}/options`; }}>Sizes & extras</button>{p.status === "ACTIVE" && <button type="button" onClick={() => void archive(p)}>Archive</button>}</div>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
