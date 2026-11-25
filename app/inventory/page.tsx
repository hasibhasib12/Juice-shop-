"use client";

import { FormEvent, useEffect, useState } from "react";

type Ingredient = { id: string; name: string; unit: string; quantityOnHand: string; reorderLevel: string; recipeItems: { product: { id: string; name: string } }[] };
type Product = { id: string; name: string; recipeItems: { id: string; quantity: string; ingredient: { id: string; name: string; unit: string } }[] };

export default function InventoryPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ml");
  const [opening, setOpening] = useState("0");
  const [reorder, setReorder] = useState("0");
  const [ingredientId, setIngredientId] = useState("");
  const [movementType, setMovementType] = useState("PURCHASE");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [productId, setProductId] = useState("");
  const [recipeIngredientId, setRecipeIngredientId] = useState("");
  const [recipeQuantity, setRecipeQuantity] = useState("100");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [stockResponse, recipeResponse] = await Promise.all([fetch("/api/admin/inventory", { cache: "no-store" }), fetch("/api/admin/recipes", { cache: "no-store" })]);
    const stockData = await stockResponse.json();
    const recipeData = await recipeResponse.json();
    if (!stockResponse.ok) throw new Error(stockData.error || "Could not load inventory.");
    if (!recipeResponse.ok) throw new Error(recipeData.error || "Could not load recipes.");
    setIngredients(stockData.ingredients);
    setProducts(recipeData.products);
    setIngredientId((current) => current || stockData.ingredients[0]?.id || "");
    setProductId((current) => current || recipeData.products[0]?.id || "");
    setRecipeIngredientId((current) => current || stockData.ingredients[0]?.id || "");
  }

  useEffect(() => { void load().catch((error) => setNotice(error.message)); }, []);

  async function submit(url: string, method: string, body: object, success: string) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save.");
      setNotice(success);
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save."); }
    finally { setBusy(false); }
  }

  function createIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("/api/admin/inventory", "POST", { action: "create", name, unit, openingQuantity: opening, reorderLevel: reorder }, "Ingredient added.");
    setName("");
  }
  function recordMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("/api/admin/inventory", "POST", { action: "movement", ingredientId, type: movementType, quantity, reason }, "Stock movement recorded.");
    setReason("");
  }
  function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("/api/admin/recipes", "POST", { productId, ingredientId: recipeIngredientId, quantity: recipeQuantity }, "Recipe saved. Stock will be deducted when this product is sold.");
  }

  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header">
        <a href="/" className="catalog-back">← Back to POS</a>
        <div><span>JUICE SHOP · MANAGEMENT</span><h1>Inventory & recipes</h1><p>Track ingredients and define what each menu item consumes.</p></div>
      </header>
      {notice && <p className="catalog-notice" role="status">{notice}</p>}
      <section className="inventory-grid">
        <form className="catalog-editor" onSubmit={createIngredient}>
          <div className="catalog-section-head"><div><span>STOCK ITEMS</span><h2>Add ingredient</h2></div></div>
          <label>Ingredient name<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Fresh orange"/></label>
          <div className="catalog-form-row"><label>Unit<input required maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ml, g, piece"/></label><label>Opening stock<input type="number" min="0" step="0.001" value={opening} onChange={(e) => setOpening(e.target.value)}/></label></div>
          <label>Low-stock alert level<input type="number" min="0" step="0.001" value={reorder} onChange={(e) => setReorder(e.target.value)}/></label>
          <button className="catalog-primary" disabled={busy}>Add ingredient</button>
        </form>
        <form className="catalog-editor" onSubmit={recordMovement}>
          <div className="catalog-section-head"><div><span>STOCK LEDGER</span><h2>Record stock movement</h2></div></div>
          <label>Ingredient<select required value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>{ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
          <label>Movement<select value={movementType} onChange={(e) => setMovementType(e.target.value)}><option value="PURCHASE">Stock received</option><option value="WASTE">Waste / spoilage</option><option value="ADJUSTMENT">Set counted stock</option></select></label>
          <label>{movementType === "ADJUSTMENT" ? "Counted stock quantity" : "Quantity"}<input required type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)}/></label>
          <label>Reason (optional)<input maxLength={250} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Supplier delivery, damaged stock…"/></label>
          <button className="catalog-primary" disabled={busy || ingredients.length === 0}>Save movement</button>
        </form>
        <form className="catalog-editor" onSubmit={saveRecipe}>
          <div className="catalog-section-head"><div><span>RECIPE / BILL OF MATERIALS</span><h2>Link ingredient to product</h2></div></div>
          <label>Menu product<select required value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Ingredient<select required value={recipeIngredientId} onChange={(e) => setRecipeIngredientId(e.target.value)}>{ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
          <label>Quantity used per item<input required type="number" min="0.001" step="0.001" value={recipeQuantity} onChange={(e) => setRecipeQuantity(e.target.value)}/></label>
          <button className="catalog-primary" disabled={busy || !products.length || !ingredients.length}>Save recipe</button>
          <p className="inventory-hint">When a cashier completes a cash sale, the POS deducts these quantities in the same database transaction as the order and payment.</p>
        </form>
      </section>
      <section className="catalog-list inventory-list">
        <div className="catalog-section-head"><div><span>LIVE STOCK</span><h2>Ingredient levels <small>{ingredients.length} items</small></h2></div></div>
        {ingredients.map((item) => {
          const low = Number(item.quantityOnHand) <= Number(item.reorderLevel);
          return <article className="catalog-product" key={item.id}><div className="catalog-placeholder">◉</div><div className="catalog-product-info"><b>{item.name}</b><span>{item.recipeItems.map((r) => r.product.name).join(" · ") || "Not assigned to a recipe"}</span><small>{low ? "Low stock" : "Stock level healthy"} · Alert at {item.reorderLevel} {item.unit}</small></div><strong className="inventory-quantity">{item.quantityOnHand} {item.unit}</strong></article>;
        })}
        {!ingredients.length && <p>No ingredients yet. Add your first stock item above.</p>}
      </section>
    </main>
  );
}
