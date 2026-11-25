"use client";

import { useEffect, useMemo, useState } from "react";

type ProductVariant = { id: string; name: string; priceMinor: number };
type ModifierOption = { id: string; name: string; priceDeltaMinor: number };
type ModifierGroup = { id: string; name: string; required: boolean; minSelections: number; maxSelections: number; options: ModifierOption[] };
type Product = { id: string; name: string; category: string; priceMinor: number; currency: string; image: string; variants: ProductVariant[]; modifierGroups: ModifierGroup[] };
type SelectedModifier = { optionId: string; groupName: string; name: string; priceDeltaMinor: number };
type CartLine = { key: string; product: Product; quantity: number; variantId?: string; variantName?: string; modifierOptionIds: string[]; selectedModifiers: SelectedModifier[]; unitPriceMinor: number };
type SavedDraft = { id: string; orderNumber: number; customerName: string | null; notes: string | null; totalMinor: number; currency: string; lines: { productId: string; productName: string; quantity: number; variantName?: string | null; selectedModifiers?: { optionId?: string; groupName?: string; name?: string; priceDeltaMinor?: number }[] | null }[] };

const money = (amountMinor: number, currency = "AFN") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);

export default function Home() {
  const [category, setCategory] = useState("All");
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [configVariantId, setConfigVariantId] = useState("");
  const [configOptionIds, setConfigOptionIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [discount, setDiscount] = useState(0);
  const [discountApprovalId, setDiscountApprovalId] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [discountBusy, setDiscountBusy] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [catalogSource, setCatalogSource] = useState<"loading" | "database" | "demo">("loading");
  const [storeInfo, setStoreInfo] = useState({ countryName: "Afghanistan", timezone: "Asia/Kabul", currency: "AFN", taxRateBps: 0, taxLabel: "Tax" });
  const [staff, setStaff] = useState<{ id: string; name: string; email: string; role: string } | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [cashTender, setCashTender] = useState("");
  const [splitPayment, setSplitPayment] = useState(false);
  const [otherPaymentConfirmed, setOtherPaymentConfirmed] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState("");
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data) => setStaff(data.user ?? null)).catch(() => setStaff(null));
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active && data.settings) setStoreInfo(data.settings);
      })
      .catch(() => undefined);
    fetch("/api/products", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Products unavailable");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setProducts(
          data.products.map((item: {
            id: string;
            name: string;
            category: { name: string };
            priceMinor: number;
            currency: string;
            imageUrl: string | null;
            variants?: ProductVariant[];
            modifierGroups?: ModifierGroup[];
          }) => ({
            id: item.id,
            name: item.name,
            category: item.category.name,
            priceMinor: item.priceMinor,
            currency: item.currency,
            image: item.imageUrl || "",
            variants: item.variants ?? [],
            modifierGroups: item.modifierGroups ?? [],
          })),
        );
        setCategoryNames(data.categories.map((item: { name: string }) => item.name));
        setCatalogSource("database");
      })
      .catch(() => {
        if (!active) return;
        // Keep the preview usable while the first database migration is pending.
        setProducts([
          { id: "demo-orange", name: "Orange Juice", category: "Juices", priceMinor: 8000, currency: "AFN", image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-mango", name: "Mango Juice", category: "Juices", priceMinor: 9000, currency: "AFN", image: "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-pomegranate", name: "Pomegranate Juice", category: "Juices", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-berry", name: "Berry Blast", category: "Smoothies", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-strawberry", name: "Strawberry Smoothie", category: "Smoothies", priceMinor: 11000, currency: "AFN", image: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-banana", name: "Banana Smoothie", category: "Smoothies", priceMinor: 11000, currency: "AFN", image: "https://images.unsplash.com/photo-1570696516188-ade861b84a49?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-milkshake", name: "Classic Milkshake", category: "Milkshakes", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-chocolate-shake", name: "Chocolate Milkshake", category: "Milkshakes", priceMinor: 12000, currency: "AFN", image: "https://images.unsplash.com/photo-1577805947697-89e18249d767?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-cake", name: "Chocolate Cake", category: "Desserts", priceMinor: 13000, currency: "AFN", image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
          { id: "demo-fruit-dessert", name: "Fruit Dessert", category: "Desserts", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=700&q=85", variants: [], modifierGroups: [] },
        ]);
        setCategoryNames(["Juices", "Smoothies", "Milkshakes", "Desserts"]);
        setCatalogSource("demo");
        setNotice("DEMO CATALOGUE — the live catalogue could not be loaded. Orders are preview-only.");
      })
      .finally(() => {
        if (active) setLoadingProducts(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (category === "All" || product.category === category) &&
          product.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [category, products, search],
  );

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  // Tax stays at zero until the business jurisdiction and tax rules are configured.
  const tax = Math.round(Math.max(0, subtotal - discount) * storeInfo.taxRateBps / 10000);
  const total = Math.max(0, subtotal - discount) + tax;
  const tenderMatch = /^(?:\d+)(?:\.\d{1,2})?$/.test(cashTender.trim());
  const cashReceivedMinor = tenderMatch ? Math.round(Number(cashTender) * 100) : 0;
  const tenderValid = Number.isSafeInteger(cashReceivedMinor) && cashReceivedMinor <= 2_000_000_000 && (splitPayment ? cashReceivedMinor > 0 && cashReceivedMinor < total && otherPaymentConfirmed : cashReceivedMinor >= total);
  const changeDueMinor = tenderValid && !splitPayment ? cashReceivedMinor - total : 0;
  const otherPaymentMinor = splitPayment && tenderValid ? total - cashReceivedMinor : 0;

  useEffect(() => { setCashTender((total / 100).toFixed(2)); }, [total]);

  function addToCart(product: Product) {
    if (product.variants.length || product.modifierGroups.length) {
      setConfigProduct(product);
      setConfigVariantId(product.variants[0]?.id ?? "");
      setConfigOptionIds([]);
      return;
    }
    addConfiguredLine(product, undefined, []);
  }

  function addConfiguredLine(product: Product, variantId: string | undefined, optionIds: string[]) {
    const variant = product.variants.find((item) => item.id === variantId);
    const selectedModifiers = product.modifierGroups.flatMap((group) => group.options.filter((option) => optionIds.includes(option.id)).map((option) => ({ optionId: option.id, groupName: group.name, name: option.name, priceDeltaMinor: option.priceDeltaMinor })));
    const unitPriceMinor = (variant?.priceMinor ?? product.priceMinor) + selectedModifiers.reduce((sum, option) => sum + option.priceDeltaMinor, 0);
    const sortedIds = [...optionIds].sort();
    const key = JSON.stringify([product.id, variantId ?? null, sortedIds]);
    setNotice(""); setDiscount(0); setDiscountApprovalId(null);
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      return existing ? current.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { key, product, quantity: 1, variantId, variantName: variant?.name, modifierOptionIds: sortedIds, selectedModifiers, unitPriceMinor }];
    });
  }

  function changeQuantity(key: string, delta: number) {
    setDiscount(0);
    setDiscountApprovalId(null);
    setCart((current) =>
      current
        .map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + delta } : line,
        )
         .filter((line) => line.quantity > 0),
    );
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign-in failed.");
      setStaff(data.user);
      setLoginPassword("");
      setLoginOpen(false);
      setNotice(`Signed in as ${data.user.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setStaff(null);
    setNotice("You have signed out.");
  }

  async function requestDiscount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (discountBusy || cart.length === 0) return;
    const amountMatch = /^(?:\d+)(?:\.\d{1,2})?$/.test(discountAmount.trim());
    const discountMinor = amountMatch ? Math.round(Number(discountAmount) * 100) : 0;
    if (!Number.isSafeInteger(discountMinor) || discountMinor <= 0 || discountMinor >= subtotal) {
      setNotice("Enter a valid discount amount no greater than the cart subtotal.");
      return;
    }
    setDiscountBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/discounts/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerEmail, managerPassword, discountMinor, reason: discountReason, items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, ...(line.variantId ? { variantId: line.variantId } : {}), modifierOptionIds: line.modifierOptionIds })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Discount authorization failed.");
      setDiscount(data.approval.discountMinor);
      setDiscountApprovalId(data.approval.id);
      setDiscountOpen(false);
      setManagerPassword("");
      setNotice(`Discount approved by ${data.managerName}. It is valid for this cart for five minutes.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Discount authorization failed.");
    } finally {
      setDiscountBusy(false);
    }
  }

  async function saveDraft() {
    if (!staff || cart.length === 0 || draftBusy) return;
    if (cart.some((line) => line.product.id.startsWith("demo-"))) { setNotice("Drafts require the live database catalogue."); return; }
    setDraftBusy(true); setNotice("");
    try {
      const response = await fetch("/api/orders/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(draftId ? { id: draftId } : {}), items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, ...(line.variantId ? { variantId: line.variantId } : {}), modifierOptionIds: line.modifierOptionIds })), customerName, notes: orderNotes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save draft.");
      setDraftId(data.draft.id);
      setNotice(`Draft #${data.draft.orderNumber} saved. You can resume it later.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save draft."); }
    finally { setDraftBusy(false); }
  }

  async function openDrafts() {
    setDraftBusy(true); setNotice("");
    try {
      const response = await fetch("/api/orders/drafts", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load drafts.");
      setDrafts(data.drafts); setDraftsOpen(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load drafts."); }
    finally { setDraftBusy(false); }
  }

  function resumeDraft(draft: SavedDraft) {
    const lines: CartLine[] = [];
    for (const line of draft.lines) {
      const product = products.find((item) => item.id === line.productId);
      if (!product) { setNotice("Some products in this draft are no longer in the live catalogue. Review it in Orders."); return; }
      const variant = line.variantName ? product.variants.find((item) => item.name === line.variantName) : undefined;
      if (line.variantName && !variant) { setNotice("A saved size is no longer available. Review this draft before continuing."); return; }
      const optionIds = (line.selectedModifiers ?? []).map((item) => item.optionId).filter((id): id is string => typeof id === "string");
      const selectedModifiers = product.modifierGroups.flatMap((group) => group.options.filter((option) => optionIds.includes(option.id)).map((option) => ({ optionId: option.id, groupName: group.name, name: option.name, priceDeltaMinor: option.priceDeltaMinor })));
      if (selectedModifiers.length !== optionIds.length) { setNotice("A saved extra is no longer available. Review this draft before continuing."); return; }
      const unitPriceMinor = (variant?.priceMinor ?? product.priceMinor) + selectedModifiers.reduce((sum, option) => sum + option.priceDeltaMinor, 0);
      lines.push({ key: JSON.stringify([product.id, variant?.id ?? null, [...optionIds].sort()]), product, quantity: line.quantity, ...(variant ? { variantId: variant.id, variantName: variant.name } : {}), modifierOptionIds: optionIds, selectedModifiers, unitPriceMinor });
    }
    setCart(lines); setDraftId(draft.id); setCustomerName(draft.customerName || ""); setOrderNotes(draft.notes || "");
    setDiscount(0); setDiscountApprovalId(null); setCheckoutKey(""); setDraftsOpen(false);
    setNotice(`Draft #${draft.orderNumber} resumed. Prices are refreshed at checkout.`);
  }

  async function completeCheckout() {
    if (checkoutBusy) return;
    if (!staff) {
      setLoginOpen(true);
      setNotice("Staff sign-in is required before checkout.");
      return;
    }
    if (cart.some((line) => line.product.id.startsWith("demo-"))) {
      setNotice("The demo catalogue is preview-only. Apply the database migration and seed the catalogue before live checkout.");
      return;
    }
    setCheckoutBusy(true);
    const requestKey = checkoutKey || crypto.randomUUID();
    setCheckoutKey(requestKey);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, ...(line.variantId ? { variantId: line.variantId } : {}), modifierOptionIds: line.modifierOptionIds })),
          paymentMethod: "CASH",
          cashReceivedMinor,
          paymentTenders: splitPayment ? [{ method: "CASH", amountMinor: cashReceivedMinor }, { method: "OTHER", amountMinor: total - cashReceivedMinor }] : [{ method: "CASH", amountMinor: total }],
          idempotencyKey: requestKey,
          customerName,
          notes: orderNotes,
          ...(draftId ? { draftId } : {}),
          ...(discountApprovalId ? { discountApprovalId } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Checkout failed.");
      setNotice(`Order #${data.order.orderNumber} completed. ${splitPayment ? "Split payment" : "Cash payment"} recorded.`);
      setLastOrderId(data.order.id);
      setCart([]);
      setDraftId(null);
      setDiscount(0);
      setDiscountApprovalId(null);
      setCashTender("0.00");
      setSplitPayment(false);
      setOtherPaymentConfirmed(false);
      setCustomerName("");
      setOrderNotes("");
      setCheckoutKey("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Checkout failed.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  function action(label: string) {
    setNotice(`${label} is not connected yet.`);
  }

  return (
    <main className="pos-screen">
      <header className="pos-header">
        <a className="brand-lockup" href="#" aria-label="Juice Shop home">
          <img src="/juice-shop-logo.svg" alt="Juice Shop" />
          <span>Fresh · Healthy · Happy</span>
        </a>
        <label className="top-search">
          <svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 5 5"/></svg>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." />
        </label>
        <div className="header-date"><span>{storeInfo.countryName} · {storeInfo.timezone}</span><strong>{storeInfo.currency} · {storeInfo.currency === "AFN" ? "Afghan Afghani" : "Store currency"}</strong></div>
        <div className={catalogSource === "database" ? "online-state" : "online-state offline-state"}><span className="wifi">⌁</span><i/>{catalogSource === "database" ? "Database" : catalogSource === "demo" ? "Demo data" : "Connecting"}</div>
        <button className="cashier" onClick={() => staff ? void signOut() : setLoginOpen(true)}><span className="cashier-photo">{staff ? staff.name.slice(0, 1).toUpperCase() : "A"}</span><span><b>{staff ? staff.name : "Staff sign-in"}</b><small>{staff ? staff.role : "Not signed in · Tap to sign in"}</small></span><span className="chevron">⌄</span></button>
      </header>

      <div className="pos-layout">
        <aside className="sidebar">
          <button className="side-home" onClick={() => { setCategory("All"); setSearch(""); }}><span>⌂</span>Home</button>
          <nav className="side-nav" aria-label="Categories">
            {categoryNames.map((name) => (
              <button key={name} className={category === name ? "side-link selected" : "side-link"} onClick={() => setCategory(name)}>
                <span>🍹</span>{name}
              </button>
            ))}
          </nav>
          {staff && <button className="side-settings" onClick={() => { window.location.href = "/tables"; }}><span>▦</span>Tables & orders</button>}
          {(staff?.role === "OWNER" || staff?.role === "MANAGER") && <><button className="side-settings" onClick={() => { window.location.href = "/catalog"; }}><span>⚙</span>Manage menu</button><button className="side-settings" onClick={() => { window.location.href = "/inventory"; }}><span>◉</span>Inventory</button><button className="side-settings" onClick={() => { window.location.href = "/reports"; }}><span>▥</span>Reports</button><button className="side-settings" onClick={() => { window.location.href = "/staff"; }}><span>♙</span>Staff</button>{staff?.role === "OWNER" && <button className="side-settings" onClick={() => { window.location.href = "/settings"; }}><span>⚙</span>Store settings</button>}</>}
        </aside>

        <section className="menu-area">
          <div className="category-tabs">
            <button className={category === "All" ? "tab active" : "tab"} onClick={() => setCategory("All")}>All</button>
            {categoryNames.slice(0, 4).map((name) => (
              <button key={name} className={category === name ? "tab active" : "tab"} onClick={() => setCategory(name)}>{name}</button>
            ))}
          </div>
          <div className="product-grid">
            {loadingProducts && <div className="no-products">Loading products…</div>}
            {!loadingProducts && visibleProducts.map((product) => (
              <button className="product-tile" key={product.id} onClick={() => addToCart(product)}>
                <span className="tile-photo">
                  {product.image ? <img src={product.image} alt={product.name} loading="lazy"/> : <span>{product.name}</span>}
                </span>
                <span className="tile-bottom">
                  <span><b>{product.name}</b><strong>{money(product.priceMinor, product.currency)}</strong></span>
                  <i>+</i>
                </span>
              </button>
            ))}
            {!loadingProducts && visibleProducts.length === 0 && <div className="no-products">No products found in this category.</div>}
          </div>
          <div className="quick-actions">
            <button onClick={() => { window.location.href = "/shift"; }}><span>◷</span>Cash shift</button>
            <button onClick={() => { window.location.href = "/orders"; }}><span>▤</span>Orders</button>
            <button onClick={() => { if (cart.length === 0) { setNotice("Add products before requesting a discount."); return; } setDiscountAmount(""); setDiscountReason(""); setDiscountOpen(true); }}><span>%</span>Discount</button>
            <button onClick={() => setNotesOpen(true)}><span>▤</span>Notes</button>
            <button onClick={() => void openDrafts()}><span>▣</span>Drafts</button>
            <button onClick={() => lastOrderId ? window.location.assign(`/orders/${lastOrderId}/receipt`) : action("Print receipt (complete a sale first)")}><span>▣</span>Print Receipt</button>
          </div>
        </section>

        <aside className="order-card">
          <div className="order-title"><h2><span>🛒</span> Current Order ({itemCount})</h2><button aria-label="Clear order" onClick={() => setCart([])}>×</button></div>
          <div className="order-items">
            {cart.length === 0 ? (
              <div className="cart-empty"><span>🛍</span><b>Your order is empty</b><small>Add a drink to get started</small></div>
            ) : cart.map((line) => (
              <div className="order-item" key={line.key}>
                {line.product.image ? <img src={line.product.image} alt=""/> : <span className="order-image-fallback">🍹</span>}
                <div className="order-item-info">
                  <b>{line.product.name}</b>
                  <span>{money(line.unitPriceMinor, line.product.currency)}{line.variantName ? ` · ${line.variantName}` : ""}</span>
                  {line.selectedModifiers.length > 0 && <small>{line.selectedModifiers.map((item) => item.name).join(", ")}</small>}
                  <div className="stepper">
                    <button onClick={() => changeQuantity(line.key, -1)}>−</button>
                    <b>{line.quantity}</b>
                    <button onClick={() => changeQuantity(line.key, 1)}>+</button>
                  </div>
                </div>
                <strong>{money(line.unitPriceMinor * line.quantity, line.product.currency)}</strong>
                <button className="remove-line" aria-label="Remove item" onClick={() => changeQuantity(line.key, -line.quantity)}>×</button>
              </div>
            ))}
          </div>
          <div className="order-summary">
            <div><span>Subtotal:</span><b>{money(subtotal)}</b></div>
            <div><span>Discount:</span><b>− {money(discount)}</b></div>
            <div><span>{storeInfo.taxLabel}:</span><b>{money(tax)}</b></div>
          </div>
          <div className="order-total"><b>Total:</b><strong>{money(total)}</strong></div>
          <div className="cash-tender-panel">
            <label htmlFor="cash-tender">{splitPayment ? `Cash portion (${storeInfo.currency})` : `Cash received (${storeInfo.currency})`}</label>
            <input id="cash-tender" inputMode="decimal" autoComplete="off" value={cashTender} onChange={(event) => setCashTender(event.target.value)} disabled={checkoutBusy || cart.length === 0} aria-invalid={cashTender.length > 0 && !tenderValid}/>
            <label className="split-payment-toggle"><input type="checkbox" checked={splitPayment} onChange={(event) => { setSplitPayment(event.target.checked); setOtherPaymentConfirmed(false); setCashTender(event.target.checked ? (total / 2 / 100).toFixed(2) : (total / 100).toFixed(2)); }} disabled={checkoutBusy || cart.length === 0 || total < 2}/> Split payment</label>
            {!splitPayment && <div className="cash-tender-presets">
              <button type="button" onClick={() => setCashTender((total / 100).toFixed(2))} disabled={cart.length === 0}>Exact</button>
              {[5000, 10000, 20000].filter((extra) => total > 0 && total + extra <= 2_000_000_000).map((extra) => <button type="button" key={extra} onClick={() => setCashTender(((total + extra) / 100).toFixed(2))}>{money(total + extra, storeInfo.currency)}</button>)}
            </div>}
            {splitPayment && <><div className="cash-tender-change"><span>Other payment remaining</span><strong>{tenderValid ? money(otherPaymentMinor, storeInfo.currency) : "—"}</strong></div><label className="other-payment-confirm"><input type="checkbox" checked={otherPaymentConfirmed} onChange={(event) => setOtherPaymentConfirmed(event.target.checked)}/> I confirm the other payment has been received outside this POS.</label></>}
            {!splitPayment && <div className="cash-tender-change"><span>Change due</span><strong>{tenderValid ? money(changeDueMinor, storeInfo.currency) : "—"}</strong></div>}
            {cashTender.trim() !== "" && !tenderValid && <small className="cash-tender-error">{splitPayment ? "Enter a cash portion below the total and confirm the other payment." : "Enter a valid amount equal to or greater than the total."}</small>}
          </div>
          <div className="payment-actions">
            <button className="clear-order" onClick={() => { setCart([]); setDiscount(0); setDiscountApprovalId(null); setNotice(""); }}>♜ <span>Clear</span></button>
            <button className="pay-button" onClick={() => void completeCheckout()} disabled={cart.length === 0 || checkoutBusy || !tenderValid}>▣ <span>{checkoutBusy ? "Processing…" : splitPayment ? "Pay Split" : "Pay Cash"}</span></button>
          </div>
          <button className="place-order" onClick={() => void saveDraft()} disabled={cart.length === 0 || !staff || draftBusy}><span>▤</span>{draftBusy ? "Saving…" : draftId ? "Update draft" : "Save draft"}</button>
          {notice && <p className="pos-notice" role="status">{notice}</p>}
          <p className="preview-note">PREVIEW MODE · NOT FOR LIVE SALES</p>
        </aside>
      </div>
      {configProduct && (
        <div className="login-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfigProduct(null); }}>
          <section className="login-panel" aria-label={`Configure ${configProduct.name}`}>
            <button className="login-close" type="button" aria-label="Close options" onClick={() => setConfigProduct(null)}>×</button>
            <span className="catalog-eyebrow">CUSTOMIZE PRODUCT</span>
            <h2>{configProduct.name}</h2>
            {configProduct.variants.length > 0 && <fieldset className="modifier-fieldset"><legend>Size</legend>{configProduct.variants.map((variant) => <label key={variant.id} className="modifier-choice"><input type="radio" name="product-variant" checked={configVariantId === variant.id} onChange={() => setConfigVariantId(variant.id)}/><span>{variant.name}</span><b>{money(variant.priceMinor, configProduct.currency)}</b></label>)}</fieldset>}
            {configProduct.modifierGroups.map((group) => {
              const chosen = configOptionIds.filter((id) => group.options.some((option) => option.id === id));
              return <fieldset className="modifier-fieldset" key={group.id}><legend>{group.name} {group.minSelections > 0 ? `· choose at least ${group.minSelections}` : ""}</legend>{group.options.map((option) => {
                const checked = configOptionIds.includes(option.id);
                return <label className="modifier-choice" key={option.id}><input type="checkbox" checked={checked} onChange={(event) => setConfigOptionIds((current) => event.target.checked ? (chosen.length < group.maxSelections ? [...current, option.id] : current) : current.filter((id) => id !== option.id))}/><span>{option.name}</span><b>{option.priceDeltaMinor ? `+${money(option.priceDeltaMinor, configProduct.currency)}` : "Included"}</b></label>;
              })}</fieldset>;
            })}
            <p className="modifier-total">Unit price <strong>{money((configProduct.variants.find((item) => item.id === configVariantId)?.priceMinor ?? configProduct.priceMinor) + configProduct.modifierGroups.flatMap((group) => group.options.filter((option) => configOptionIds.includes(option.id))).reduce((sum, option) => sum + option.priceDeltaMinor, 0), configProduct.currency)}</strong></p>
            <button className="catalog-primary" disabled={configProduct.modifierGroups.some((group) => { const count = group.options.filter((option) => configOptionIds.includes(option.id)).length; return count < group.minSelections || count > group.maxSelections; }) || (configProduct.variants.length > 0 && !configVariantId)} onClick={() => { addConfiguredLine(configProduct, configVariantId || undefined, configOptionIds); setConfigProduct(null); }}>Add to order</button>
          </section>
        </div>
      )}
      {draftsOpen && (
        <div className="login-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraftsOpen(false); }}>
          <section className="login-panel" aria-label="Saved draft orders">
            <button className="login-close" type="button" aria-label="Close drafts" onClick={() => setDraftsOpen(false)}>×</button>
            <span className="login-kicker">SAVED SALES</span><h2>Draft orders</h2>
            <p>Saved carts can be resumed by their cashier or a manager.</p>
            {drafts.length === 0 ? <p>No saved drafts yet.</p> : drafts.map((draft) => (
              <article className="catalog-product" key={draft.id}>
                <div className="catalog-product-info"><b>Draft #{draft.orderNumber} · {draft.customerName || "Walk-in customer"}</b><span>{draft.lines.map((line) => `${line.quantity} × ${line.productName}`).join(" · ")}</span><small>{money(draft.totalMinor, draft.currency)}</small></div>
                <button type="button" onClick={() => resumeDraft(draft)}>Resume</button>
              </article>
            ))}
          </section>
        </div>
      )}
      {notesOpen && (
        <div className="login-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNotesOpen(false); }}>
          <form className="login-panel" onSubmit={(event) => { event.preventDefault(); setNotesOpen(false); setNotice("Customer details and order notes saved for this checkout."); }}>
            <button className="login-close" type="button" aria-label="Close order notes" onClick={() => setNotesOpen(false)}>×</button>
            <span className="login-kicker">CURRENT ORDER</span>
            <h2>Customer & order notes</h2>
            <p>Optional details are saved with the completed sale and shown on its receipt.</p>
            <label>Customer name<input maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Walk-in customer"/></label>
            <label>Order notes<textarea maxLength={1000} rows={4} value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} placeholder="Preparation requests or staff notes"/></label>
            <button className="login-submit" type="submit">Save details</button>
          </form>
        </div>
      )}
      {discountOpen && (
        <div className="login-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !discountBusy) setDiscountOpen(false); }}>
          <form className="login-panel" onSubmit={requestDiscount}>
            <button className="login-close" type="button" aria-label="Close discount approval" onClick={() => setDiscountOpen(false)}>×</button>
            <span className="login-kicker">MANAGER APPROVAL · ONE-TIME</span>
            <h2>Apply a discount</h2>
            <p>Manager or owner credentials are required. Approval is tied to this exact cart and expires in five minutes.</p>
            <label>Discount amount ({storeInfo.currency})<input inputMode="decimal" autoComplete="off" required value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} placeholder="0.00" /></label>
            <label>Reason<input required minLength={3} maxLength={200} value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} placeholder="e.g. Customer service recovery" /></label>
            <label>Manager email<input type="email" autoComplete="username" required value={managerEmail} onChange={(event) => setManagerEmail(event.target.value)} /></label>
            <label>Manager password<input type="password" autoComplete="current-password" required value={managerPassword} onChange={(event) => setManagerPassword(event.target.value)} /></label>
            <button className="login-submit" type="submit" disabled={discountBusy}>{discountBusy ? "Requesting approval…" : "Approve discount"}</button>
          </form>
        </div>
      )}
      {loginOpen && (
        <div className="login-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLoginOpen(false); }}>
          <form className="login-panel" onSubmit={signIn}>
            <button className="login-close" type="button" aria-label="Close sign-in" onClick={() => setLoginOpen(false)}>×</button>
            <span className="login-kicker">JUICE SHOP · STAFF ACCESS</span>
            <h2>Welcome back</h2>
            <p>Sign in with your staff account to process cash sales.</p>
            <label>Email address<input type="email" autoComplete="username" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete="current-password" required value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></label>
            <button className="login-submit" type="submit" disabled={loginBusy}>{loginBusy ? "Signing in…" : "Sign in"}</button>
          </form>
        </div>
      )}
    </main>
  );
}
