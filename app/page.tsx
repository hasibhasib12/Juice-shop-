"use client";

import { useMemo, useState } from "react";

type Product = { id: number; name: string; category: string; price: number; color: string; description: string };
type CartLine = { product: Product; quantity: number };

const products: Product[] = [
  { id: 1, name: "Orange Sunrise", category: "Fresh Juices", price: 5.5, color: "orange", description: "Fresh orange, squeezed to order" },
  { id: 2, name: "Green Glow", category: "Fresh Juices", price: 6.5, color: "green", description: "Apple, spinach, cucumber" },
  { id: 3, name: "Berry Blast", category: "Smoothies", price: 7, color: "berry", description: "Strawberry, blueberry, banana" },
  { id: 4, name: "Mango Dream", category: "Smoothies", price: 7.5, color: "mango", description: "Mango, banana, yoghurt" },
  { id: 5, name: "Lemon Mint", category: "Fresh Juices", price: 4.5, color: "lemon", description: "Lemon, mint, sparkling water" },
  { id: 6, name: "Tropical Mix", category: "Smoothies", price: 7, color: "tropical", description: "Pineapple, mango, passion fruit" },
  { id: 7, name: "Watermelon Cooler", category: "Cold Drinks", price: 4, color: "watermelon", description: "Fresh watermelon, lime" },
  { id: 8, name: "Iced Matcha", category: "Cold Drinks", price: 5, color: "matcha", description: "Matcha, milk, light sweetness" }
];

const categories = ["All Items", "Fresh Juices", "Smoothies", "Cold Drinks"];
const money = (amount: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(amount);

export default function Home() {
  const [category, setCategory] = useState("All Items");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState("");

  const visibleProducts = useMemo(() => products.filter((product) =>
    (category === "All Items" || product.category === category) &&
    (product.name.toLowerCase().includes(search.toLowerCase()) || product.description.toLowerCase().includes(search.toLowerCase()))
  ), [category, search]);

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  function addToCart(product: Product) {
    setNotice("");
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      return existing
        ? current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: number, delta: number) {
    setCart((current) => current
      .map((line) => line.product.id === productId ? { ...line, quantity: line.quantity + delta } : line)
      .filter((line) => line.quantity > 0));
  }

  return (
    <main className="pos-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Juice Shop home"><span className="brand-mark">J</span><span>juice<span className="brand-light">bar</span><small>POINT OF SALE</small></span></a>
        <div className="topbar-right"><span className="status-dot" /> <span>Register workspace</span><span className="staff-avatar">S</span><span className="staff-name">Staff</span></div>
      </header>

      <div className="workspace">
        <section className="catalog">
          <div className="page-heading"><div><p className="eyebrow">SALES / NEW ORDER</p><h1>Good day <span>☀</span></h1><p className="muted">Choose items to add to the current order.</p></div><div className="date-chip">REGISTER 01</div></div>
          <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." /></label>
          <nav className="categories" aria-label="Product categories">{categories.map((item) => <button key={item} className={category === item ? "category active" : "category"} onClick={() => setCategory(item)}>{item}</button>)}</nav>
          <div className="product-grid">
            {visibleProducts.map((product) => <button className="product-card" key={product.id} onClick={() => addToCart(product)}>
              <span className={`product-art ${product.color}`}><span className="glass">◒</span><span className="add-badge">+</span></span>
              <span className="product-info"><strong>{product.name}</strong><span>{product.description}</span><b>{money(product.price)}</b></span>
            </button>)}
            {visibleProducts.length === 0 && <p className="empty-products">No products match your search.</p>}
          </div>
        </section>

        <aside className="order-panel">
          <div className="order-heading"><div><p className="eyebrow">CURRENT SALE</p><h2>New order</h2></div><span className="order-number"># DRAFT</span></div>
          <div className="order-meta"><span>Walk-in sale</span><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>
          <div className="cart-lines">
            {cart.length === 0 ? <div className="empty-cart"><span className="basket-icon">＋</span><strong>Your order is empty</strong><p>Select a product to get started.</p></div> : cart.map((line) => <div className="cart-line" key={line.product.id}>
              <div className={`mini-art ${line.product.color}`}>◒</div><div className="line-details"><strong>{line.product.name}</strong><span>{money(line.product.price)} each</span><div className="quantity-control"><button onClick={() => changeQuantity(line.product.id, -1)} aria-label={`Remove one ${line.product.name}`}>−</button><span>{line.quantity}</span><button onClick={() => changeQuantity(line.product.id, 1)} aria-label={`Add one ${line.product.name}`}>+</button></div></div><b className="line-total">{money(line.product.price * line.quantity)}</b>
            </div>)}
          </div>
          <div className="totals"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Tax</span><strong>Not configured</strong></div><div className="grand-total"><span>Order total</span><strong>{money(subtotal)}</strong></div></div>
          <button className="checkout-button" disabled={cart.length === 0} onClick={() => setNotice("Checkout is not enabled yet. Payment and order-saving services must be implemented before taking real sales.")}>Continue to payment <span>→</span></button>
          {notice && <p className="notice" role="status">{notice}</p>}
          <p className="safety-note">Development workspace · No payments are processed or orders saved.</p>
        </aside>
      </div>
      <footer className="footer"><span>JUICEBAR POS · DEVELOPMENT BUILD</span><span>Sales workspace foundation</span></footer>
    </main>
  );
}
