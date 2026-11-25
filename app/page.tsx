"use client";

import { useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  name: string;
  category: string;
  priceMinor: number;
  currency: string;
  image: string;
};
type CartLine = { product: Product; quantity: number };

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
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [customer, setCustomer] = useState("Walk-in customer");
  const [discount, setDiscount] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    let active = true;
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
          }) => ({
            id: item.id,
            name: item.name,
            category: item.category.name,
            priceMinor: item.priceMinor,
            currency: item.currency,
            image: item.imageUrl || "",
          })),
        );
        setCategoryNames(data.categories.map((item: { name: string }) => item.name));
      })
      .catch(() => {
        if (!active) return;
        // Keep the preview usable while the first database migration is pending.
        setProducts([
          { id: "demo-orange", name: "Orange Juice", category: "Juices", priceMinor: 8000, currency: "AFN", image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-mango", name: "Mango Juice", category: "Juices", priceMinor: 9000, currency: "AFN", image: "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-pomegranate", name: "Pomegranate Juice", category: "Juices", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-berry", name: "Berry Blast", category: "Smoothies", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-strawberry", name: "Strawberry Smoothie", category: "Smoothies", priceMinor: 11000, currency: "AFN", image: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-banana", name: "Banana Smoothie", category: "Smoothies", priceMinor: 11000, currency: "AFN", image: "https://images.unsplash.com/photo-1570696516188-ade861b84a49?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-milkshake", name: "Classic Milkshake", category: "Milkshakes", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-chocolate-shake", name: "Chocolate Milkshake", category: "Milkshakes", priceMinor: 12000, currency: "AFN", image: "https://images.unsplash.com/photo-1577805947697-89e18249d767?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-cake", name: "Chocolate Cake", category: "Desserts", priceMinor: 13000, currency: "AFN", image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=700&q=85" },
          { id: "demo-fruit-dessert", name: "Fruit Dessert", category: "Desserts", priceMinor: 10000, currency: "AFN", image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=700&q=85" },
        ]);
        setCategoryNames(["Juices", "Smoothies", "Milkshakes", "Desserts"]);
        setNotice("DEMO CATALOGUE — database tables are not installed yet. Orders are preview-only.");
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
  const subtotal = cart.reduce((sum, line) => sum + line.product.priceMinor * line.quantity, 0);
  // Tax stays at zero until the business jurisdiction and tax rules are configured.
  const tax = 0;
  const total = Math.max(0, subtotal - discount) + tax;

  function addToCart(product: Product) {
    setNotice("");
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      return existing
        ? current.map((line) =>
            line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [...current, { product, quantity: 1 }];
    });
  }

  function changeQuantity(id: string, delta: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.product.id === id ? { ...line, quantity: line.quantity + delta } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function action(label: string) {
    setNotice(`${label} is not connected yet. Checkout and staff permissions will be enabled after authentication is implemented.`);
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
        <div className="header-date"><span>Juice Shop POS</span><strong>Live catalogue</strong></div>
        <div className="online-state"><span className="wifi">⌁</span><i/>Database</div>
        <button className="cashier"><span className="cashier-photo">A</span><span><b>Staff preview</b><small>Not signed in</small></span><span className="chevron">⌄</span></button>
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
          <button className="side-settings" onClick={() => action("Settings")}><span>⚙</span>Settings</button>
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
            <button onClick={() => action("Table selection")}><span>♟</span>Table #5</button>
            <button onClick={() => { setCustomer(customer === "Walk-in customer" ? "Ahmed Khan" : "Walk-in customer"); action("Customer selection"); }}><span>♟</span>Customer</button>
            <button onClick={() => { setDiscount(discount ? 0 : 1000); setNotice("A sample AFN 10 discount is shown locally only. Manager approval is not connected."); }}><span>%</span>Discount</button>
            <button onClick={() => action("Order notes")}><span>▤</span>Notes</button>
            <button onClick={() => action("Receipt printing")}><span>▣</span>Print Receipt</button>
          </div>
        </section>

        <aside className="order-card">
          <div className="order-title"><h2><span>🛒</span> Current Order ({itemCount})</h2><button aria-label="Clear order" onClick={() => setCart([])}>×</button></div>
          <div className="order-items">
            {cart.length === 0 ? (
              <div className="cart-empty"><span>🛍</span><b>Your order is empty</b><small>Add a drink to get started</small></div>
            ) : cart.map((line) => (
              <div className="order-item" key={line.product.id}>
                {line.product.image ? <img src={line.product.image} alt=""/> : <span className="order-image-fallback">🍹</span>}
                <div className="order-item-info">
                  <b>{line.product.name}</b>
                  <span>{money(line.product.priceMinor, line.product.currency)}</span>
                  <div className="stepper">
                    <button onClick={() => changeQuantity(line.product.id, -1)}>−</button>
                    <b>{line.quantity}</b>
                    <button onClick={() => changeQuantity(line.product.id, 1)}>+</button>
                  </div>
                </div>
                <strong>{money(line.product.priceMinor * line.quantity, line.product.currency)}</strong>
                <button className="remove-line" aria-label="Remove item" onClick={() => changeQuantity(line.product.id, -line.quantity)}>×</button>
              </div>
            ))}
          </div>
          <div className="order-summary">
            <div><span>Subtotal:</span><b>{money(subtotal)}</b></div>
            <div><span>Discount:</span><b>− {money(discount)}</b></div>
            <div><span>Tax (not configured):</span><b>{money(tax)}</b></div>
          </div>
          <div className="order-total"><b>Total:</b><strong>{money(total)}</strong></div>
          <div className="payment-actions">
            <button className="clear-order" onClick={() => { setCart([]); setDiscount(0); setNotice(""); }}>♜ <span>Clear</span></button>
            <button className="pay-button" onClick={() => action("Payment")} disabled={cart.length === 0}>▣ <span>Pay Now</span></button>
          </div>
          <button className="place-order" onClick={() => action("Order")} disabled={cart.length === 0}><span>⚒</span>Order</button>
          {notice && <p className="pos-notice" role="status">{notice}</p>}
          <p className="preview-note">PREVIEW MODE · NOT FOR LIVE SALES</p>
        </aside>
      </div>
    </main>
  );
}
