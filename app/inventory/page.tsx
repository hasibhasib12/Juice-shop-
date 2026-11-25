"use client";

import Link from "next/link";

import { FormEvent, useEffect, useState } from "react";

type Ingredient = { id: string; name: string; unit: string; quantityOnHand: string; reorderLevel: string; averageCostMinor: number; recipeItems: { product: { id: string; name: string } }[] };
type Supplier = { id: string; name: string; active: boolean; phone?: string | null; email?: string | null };
type PurchaseOrder = { id: string; orderNumber: number; status: "DRAFT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED"; currency: string; subtotalMinor: number; supplier: { name: string }; lines: { id: string; ingredientName: string; quantity: string; receivedQuantity: string; unitCostMinor: number; lineTotalMinor: number }[] };
type Product = { id: string; name: string; recipeItems: { id: string; quantity: string; ingredient: { id: string; name: string; unit: string } }[] };

export default function InventoryPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({});
  const [storeCurrency, setStoreCurrency] = useState("AFN");
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [poSupplierId, setPoSupplierId] = useState("");
  const [poIngredientId, setPoIngredientId] = useState("");
  const [poQuantity, setPoQuantity] = useState("1");
  const [poUnitCost, setPoUnitCost] = useState("0");
  const [poNotes, setPoNotes] = useState("");
  const [poLines, setPoLines] = useState<{ ingredientId: string; quantity: string; unitCostMinor: number; name: string; unit: string }[]>([]);
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
    const [stockResponse, recipeResponse, purchasingResponse, settingsResponse] = await Promise.all([fetch("/api/admin/inventory", { cache: "no-store" }), fetch("/api/admin/recipes", { cache: "no-store" }), fetch("/api/admin/purchase-orders", { cache: "no-store" }), fetch("/api/settings", { cache: "no-store" })]);
    const stockData = await stockResponse.json();
    const recipeData = await recipeResponse.json();
    const purchasingData = await purchasingResponse.json();
    const settingsData = await settingsResponse.json();
    if (!stockResponse.ok) throw new Error(stockData.error || "Could not load inventory.");
    if (!recipeResponse.ok) throw new Error(recipeData.error || "Could not load recipes.");
    if (!purchasingResponse.ok) throw new Error(purchasingData.error || "Could not load purchasing records.");
    setIngredients(stockData.ingredients);
    setProducts(recipeData.products);
    setSuppliers(purchasingData.suppliers);
    setPurchaseOrders(purchasingData.orders);
    setStoreCurrency(settingsData.settings?.currency || "AFN");
    setIngredientId((current) => current || stockData.ingredients[0]?.id || "");
    setProductId((current) => current || recipeData.products[0]?.id || "");
    setRecipeIngredientId((current) => current || stockData.ingredients[0]?.id || "");
    setPoIngredientId((current) => current || stockData.ingredients[0]?.id || "");
    setPoSupplierId((current) => current || purchasingData.suppliers[0]?.id || "");
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

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: supplierName, phone: supplierPhone, email: supplierEmail }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create supplier.");
      setSupplierName(""); setSupplierPhone(""); setSupplierEmail(""); setNotice("Supplier added.");
      await load(); setPoSupplierId(data.supplier.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create supplier."); }
    finally { setBusy(false); }
  }

  function addPurchaseLine() {
    const ingredient = ingredients.find((item) => item.id === poIngredientId);
    const quantityValue = Number(poQuantity);
    const costValue = Number(poUnitCost);
    if (!ingredient || !Number.isFinite(quantityValue) || quantityValue <= 0 || !Number.isFinite(costValue) || costValue < 0) { setNotice("Enter a valid ingredient, quantity and unit cost."); return; }
    if (poLines.some((line) => line.ingredientId === ingredient.id)) { setNotice("Each ingredient can appear once per purchase order."); return; }
    setPoLines((current) => [...current, { ingredientId: ingredient.id, quantity: poQuantity, unitCostMinor: Math.round(costValue * 100), name: ingredient.name, unit: ingredient.unit }]);
    setNotice("");
  }

  async function createPurchaseOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!poSupplierId || !poLines.length) { setNotice("Choose a supplier and add at least one ingredient line."); return; }
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId: poSupplierId, currency: storeCurrency, notes: poNotes, lines: poLines.map(({ ingredientId, quantity, unitCostMinor }) => ({ ingredientId, quantity, unitCostMinor })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create purchase order.");
      setPoLines([]); setPoNotes(""); setNotice(`Purchase order #${data.order.orderNumber} created as a draft.`);
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create purchase order."); }
    finally { setBusy(false); }
  }

  async function processPurchaseOrder(order: PurchaseOrder, action: "receive" | "cancel") {
    if (!window.confirm(action === "receive" ? `Receive all items on purchase order #${order.orderNumber} into stock?` : `Cancel purchase order #${order.orderNumber}?`)) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/purchase-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: order.id, action, ...(action === "receive" ? { receipts: order.lines.map((line) => ({ lineId: line.id, quantity: receiptQuantities[line.id] ?? (Number(line.quantity) - Number(line.receivedQuantity)).toString() })).filter((line) => Number(line.quantity) > 0) } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not process purchase order.");
      setNotice(action === "receive" ? `Purchase order #${order.orderNumber} receipt recorded and stock updated.` : `Purchase order #${order.orderNumber} cancelled.`);
      if (action === "receive") setReceiptQuantities((current) => { const next = { ...current }; for (const line of order.lines) delete next[line.id]; return next; });
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not process purchase order."); }
    finally { setBusy(false); }
  }

  return (
    <main className="catalog-admin">
      <header className="catalog-admin-header">
        <Link href="/" className="catalog-back">← Back to POS</Link><Link href="/purchasing/invoices" className="catalog-back">Supplier invoices & payments →</Link><a href="/api/reports/stock-valuation" className="catalog-back">Export stock valuation CSV ↓</a>
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
      <section className="inventory-grid">
        <form className="catalog-editor" onSubmit={createSupplier}>
          <div className="catalog-section-head"><div><span>SUPPLIER DIRECTORY</span><h2>Add supplier</h2></div></div>
          <label>Supplier name<input required maxLength={120} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier or wholesaler"/></label>
          <label>Phone<input maxLength={40} value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} placeholder="Contact number"/></label>
          <label>Email<input type="email" maxLength={254} value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} placeholder="orders@example.com"/></label>
          <button className="catalog-primary" disabled={busy}>Add supplier</button>
          <p className="inventory-hint">{suppliers.length} active supplier(s) available for purchasing.</p>
        </form>
        <form className="catalog-editor" onSubmit={createPurchaseOrder}>
          <div className="catalog-section-head"><div><span>PROCUREMENT</span><h2>Create purchase order</h2></div></div>
          <label>Supplier<select required value={poSupplierId} onChange={(e) => setPoSupplierId(e.target.value)}><option value="">Choose supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <div className="catalog-form-row"><label>Ingredient<select value={poIngredientId} onChange={(e) => setPoIngredientId(e.target.value)}>{ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label><label>Quantity<input type="number" min="0.001" step="0.001" value={poQuantity} onChange={(e) => setPoQuantity(e.target.value)}/></label></div>
          <label>Unit cost ({storeCurrency})<input type="number" min="0" step="0.01" value={poUnitCost} onChange={(e) => setPoUnitCost(e.target.value)}/></label>
          <button type="button" className="catalog-cancel" disabled={busy || !ingredients.length} onClick={addPurchaseLine}>Add ingredient line</button>
          {poLines.map((line) => <div className="catalog-product" key={line.ingredientId}><div className="catalog-product-info"><b>{line.name}</b><span>{line.quantity} {line.unit} · {storeCurrency} {(line.unitCostMinor / 100).toFixed(2)} / unit</span></div><button type="button" onClick={() => setPoLines((current) => current.filter((item) => item.ingredientId !== line.ingredientId))}>Remove</button></div>)}
          <label>Notes (optional)<input maxLength={1000} value={poNotes} onChange={(e) => setPoNotes(e.target.value)}/></label>
          <button className="catalog-primary" disabled={busy || !suppliers.length || !poLines.length}>Save draft purchase order</button>
          <p className="inventory-hint">Drafts do not change stock. Receive an order below to add quantities and update weighted-average ingredient cost.</p>
        </form>
      </section>
      <section className="catalog-list inventory-list">
        <div className="catalog-section-head"><div><span>SUPPLIER ORDERS</span><h2>Purchase orders <small>{purchaseOrders.length}</small></h2></div></div>
        {purchaseOrders.map((order) => <article className="catalog-product" key={order.id}><div className="catalog-placeholder">PO</div><div className="catalog-product-info"><b>#{order.orderNumber} · {order.supplier.name}</b><span>{order.lines.map((line) => `${line.ingredientName}: ${line.receivedQuantity} / ${line.quantity} received`).join(" · ")}</span><small>{order.status} · {order.currency} {(order.subtotalMinor / 100).toFixed(2)}</small>{(order.status === "DRAFT" || order.status === "PARTIALLY_RECEIVED") && <div className="catalog-form-row">{order.lines.filter((line) => Number(line.quantity) > Number(line.receivedQuantity)).map((line) => <label key={line.id}>{line.ingredientName} to receive<input type="number" min="0" max={Number(line.quantity) - Number(line.receivedQuantity)} step="0.001" value={receiptQuantities[line.id] ?? (Number(line.quantity) - Number(line.receivedQuantity)).toString()} onChange={(event) => setReceiptQuantities((current) => ({ ...current, [line.id]: event.target.value }))}/></label>)}</div>}</div>{(order.status === "DRAFT" || order.status === "PARTIALLY_RECEIVED") && <div className="catalog-product-actions"><button type="button" disabled={busy} onClick={() => void processPurchaseOrder(order, "receive")}>Receive</button><button type="button" disabled={busy} onClick={() => void processPurchaseOrder(order, "cancel")}>Cancel</button></div>}</article>)}
        {!purchaseOrders.length && <p>No purchase orders yet.</p>}
      </section>
      <section className="catalog-list inventory-list">
        <div className="catalog-section-head"><div><span>LIVE STOCK</span><h2>Ingredient levels <small>{ingredients.length} items</small></h2></div></div>
        <p className="inventory-hint">Estimated ingredient stock value: <strong>{storeCurrency} {(ingredients.reduce((total, item) => total + Math.round(Number(item.quantityOnHand) * item.averageCostMinor), 0) / 100).toFixed(2)}</strong>. This uses weighted-average unit cost and excludes tax and supplier liabilities.</p>
        {ingredients.map((item) => {
          const low = Number(item.quantityOnHand) <= Number(item.reorderLevel);
          return <article className="catalog-product" key={item.id}><div className="catalog-placeholder">◉</div><div className="catalog-product-info"><b>{item.name}</b><span>{item.recipeItems.map((r) => r.product.name).join(" · ") || "Not assigned to a recipe"}</span><small>{low ? "Low stock" : "Stock level healthy"} · Alert at {item.reorderLevel} {item.unit}</small></div><strong className="inventory-quantity">{item.quantityOnHand} {item.unit}<small>Avg cost: {storeCurrency} {(item.averageCostMinor / 100).toFixed(2)} / unit</small></strong></article>;
        })}
        {!ingredients.length && <p>No ingredients yet. Add your first stock item above.</p>}
      </section>
    </main>
  );
}
