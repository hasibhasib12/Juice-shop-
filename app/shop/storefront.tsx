"use client";

import { useEffect, useMemo, useState } from "react";

type Variant = { id: string; name: string; priceMinor: number };
type Product = { id: string; name: string; description: string | null; imageUrl: string | null; priceMinor: number; currency: string; category: string; variants: Variant[] };
type StoreData = { store: { name: string; currency: string; timezone: string }; categories: { id: string; name: string }[]; products: Product[] };
type CartLine = { key: string; product: Product; quantity: number; variantId?: string; variantName?: string; unitPriceMinor: number };

const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat("en-AF", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount / 100); }
  catch { return `${(amount / 100).toFixed(2)} ${currency}`; }
};

export default function Storefront() {
  const [data, setData] = useState<StoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [variantId, setVariantId] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/storefront/products", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load products.");
        return body as StoreData;
      })
      .then((body) => { if (active) setData(body); })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "Shop is temporarily unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const products = data?.products ?? [];
  const categories = ["All", ...(data?.categories.map((item) => item.name) ?? [])];
  const visible = useMemo(() => products.filter((product) =>
    (category === "All" || product.category === category) &&
    (product.name.toLowerCase().includes(search.trim().toLowerCase()) || (product.description ?? "").toLowerCase().includes(search.trim().toLowerCase()))
  ), [products, category, search]);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
  const currency = data?.store.currency ?? "AFN";

  function add(product: Product, chosenVariantId?: string) {
    const variant = product.variants.find((item) => item.id === chosenVariantId);
    const unitPriceMinor = variant?.priceMinor ?? product.priceMinor;
    const key = `${product.id}:${chosenVariantId ?? "base"}`;
    setCart((current) => {
      const existing = current.find((line) => line.key === key);
      return existing
        ? current.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { key, product, quantity: 1, variantId: chosenVariantId, variantName: variant?.name, unitPriceMinor }];
    });
    setSelected(null);
    setNotice(`${product.name} added to your basket.`);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function updateQuantity(key: string, delta: number) {
    setCart((current) => current.map((line) => line.key === key ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  }

  return (
    <main className="storefront">
      <div className="store-topline"><span>FRESHLY MADE · ALWAYS DELICIOUS</span><span>Made fresh. Served with love.</span></div>
      <header className="store-header">
        <a className="store-brand" href="/shop" aria-label="ANAR & CO. home">
          <img src="/juice-shop-logo.svg" alt="ANAR & CO." />
        </a>
        <nav className="store-nav" aria-label="Main navigation">
          <a href="#menu">Our menu</a><a href="#story">Our promise</a><a href="#footer">Contact</a>
        </nav>
        <button className="store-cart-button" onClick={() => setCartOpen(true)} aria-label={`Open basket, ${count} items`}>
          <span aria-hidden="true">♧</span> Basket <b>{count}</b>
        </button>
      </header>

      <section className="store-hero">
        <div className="store-hero-copy">
          <span className="store-eyebrow">A LITTLE FRESHNESS GOES A LONG WAY</span>
          <h1>Good days<br />start <em>fresh.</em></h1>
          <p>Bright flavours, feel-good ingredients and a little joy in every glass. Find your new favourite in our menu.</p>
          <a className="store-primary-link" href="#menu">Explore the menu <span>↗</span></a>
          <div className="store-hero-note"><span>✳</span> Freshly prepared, made for you</div>
        </div>
        <div className="store-hero-art" aria-label="Fresh juice and citrus fruit">
          <div className="store-art-circle"></div>
          <div className="store-art-orbit"></div>
          <div className="store-art-glass"><div className="store-art-juice"></div><div className="store-art-straw"></div><div className="store-art-leaf">✦</div></div>
          <div className="store-art-orange"></div><div className="store-art-lime"></div>
          <span className="store-art-caption">SIP INTO<br />SOMETHING GOOD</span>
        </div>
        <div className="store-hero-index">01 <i></i> FRESHNESS, REIMAGINED</div>
      </section>

      <section className="store-benefits" id="story">
        <div><span>✳</span><p><b>Fresh by nature</b><small>Flavours made to brighten your day</small></p></div>
        <div><span>◌</span><p><b>Made with care</b><small>Thoughtful ingredients, every time</small></p></div>
        <div><span>♡</span><p><b>A little joy</b><small>Your daily moment of goodness</small></p></div>
      </section>

      <section className="store-menu-section" id="menu">
        <div className="store-section-heading">
          <div><span className="store-eyebrow">FIND YOUR FAVOURITE</span><h2>The good stuff.</h2></div>
          <p>Explore the menu and choose something<br className="desktop-only" /> delicious for right now.</p>
        </div>
        <div className="store-menu-tools">
          <div className="store-categories" role="group" aria-label="Filter products by category">
            {categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <label className="store-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find something lovely…" aria-label="Search products" /></label>
        </div>
        {notice && <p className="store-notice" role="status">{notice}</p>}
        {loading ? <div className="store-empty">Preparing something fresh for you…</div> : visible.length ? (
          <div className="store-product-grid">
            {visible.map((product, index) => <article className="store-product-card" key={product.id}>
              <button className="store-product-image" onClick={() => { setSelected(product); setVariantId(product.variants[0]?.id ?? ""); }} aria-label={`View ${product.name}`}>
                {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading={index > 3 ? "lazy" : "eager"} /> : <span className="store-image-placeholder">✳</span>}
                <span className="store-image-arrow">↗</span>
              </button>
              <div className="store-product-meta"><span>{product.category}</span>{product.variants.length > 0 && <span>{product.variants.length} sizes</span>}</div>
              <h3>{product.name}</h3>
              <p>{product.description || "A fresh favourite, prepared with care."}</p>
              <div className="store-product-bottom"><strong>{money(product.priceMinor, product.currency || currency)}</strong><button onClick={() => product.variants.length ? (setSelected(product), setVariantId(product.variants[0].id)) : add(product)}>Add to basket <span>+</span></button></div>
            </article>)}
          </div>
        ) : <div className="store-empty">{products.length ? "No products match that search. Try another flavour." : "Our menu is being prepared. Please check back soon."}</div>}
      </section>

      <section className="store-callout">
        <div><span className="store-eyebrow">YOUR NEXT HAPPY MOMENT</span><h2>Take a little<br /><em>time to refresh.</em></h2></div>
        <a href="#menu">Find your fresh favourite <span>↗</span></a>
      </section>
      <footer className="store-footer" id="footer">
        <div className="store-footer-brand"><img src="/juice-shop-logo.svg" alt="ANAR & CO." /></div>
        <p>Good things are better when shared.</p><span>© {new Date().getFullYear()} ANAR & CO.</span>
      </footer>

      {selected && <div className="store-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <section className="store-product-modal" role="dialog" aria-modal="true" aria-labelledby="store-modal-title">
          <button className="store-modal-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
          <div className="store-modal-image">{selected.imageUrl ? <img src={selected.imageUrl} alt={selected.name} /> : <span>✳</span>}</div>
          <div className="store-modal-content"><span className="store-eyebrow">{selected.category}</span><h2 id="store-modal-title">{selected.name}</h2><p>{selected.description || "A fresh favourite, prepared with care."}</p>
            {selected.variants.length > 0 && <label className="store-variant-select">Choose your size<select value={variantId} onChange={(event) => setVariantId(event.target.value)}>{selected.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} — {money(variant.priceMinor, selected.currency || currency)}</option>)}</select></label>}
            <button className="store-modal-add" onClick={() => add(selected, variantId || undefined)}>Add to basket · {money(selected.variants.find((item) => item.id === variantId)?.priceMinor ?? selected.priceMinor, selected.currency || currency)}</button>
          </div>
        </section>
      </div>}

      {cartOpen && <div className="store-cart-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
        <aside className="store-cart-drawer" aria-label="Your basket">
          <div className="store-cart-heading"><div><span className="store-eyebrow">YOUR GOODIES</span><h2>Your basket <small>({count})</small></h2></div><button onClick={() => setCartOpen(false)} aria-label="Close basket">×</button></div>
          <div className="store-cart-lines">{cart.length ? cart.map((line) => <div className="store-cart-line" key={line.key}>
            <div className="store-cart-thumb">{line.product.imageUrl ? <img src={line.product.imageUrl} alt="" /> : "✳"}</div>
            <div className="store-cart-line-info"><b>{line.product.name}</b>{line.variantName && <small>{line.variantName}</small>}<strong>{money(line.unitPriceMinor * line.quantity, line.product.currency || currency)}</strong>
              <div className="store-qty"><button onClick={() => updateQuantity(line.key, -1)} aria-label={`Remove one ${line.product.name}`}>−</button><span>{line.quantity}</span><button onClick={() => updateQuantity(line.key, 1)} aria-label={`Add one ${line.product.name}`}>+</button></div>
            </div>
          </div>) : <div className="store-cart-empty"><span>♡</span><b>Your basket is looking fresh and empty.</b><small>Add something delicious from the menu.</small></div>}</div>
          <div className="store-cart-total"><span>Subtotal</span><b>{money(subtotal, currency)}</b></div>
          <p className="store-cart-hint">This is a shopping basket preview. Online ordering and payment will be connected in a later stage.</p>
          <button className="store-continue" onClick={() => setCartOpen(false)}>Continue exploring</button>
        </aside>
      </div>}
    </main>
  );
}
