"use client";

import { useMemo, useState } from "react";

type Product = { id: number; name: string; category: string; price: number; image: string; description: string };
type CartLine = { product: Product; quantity: number };

const products: Product[] = [
  { id: 1, name: "Orange Sunrise", category: "Fresh Juices", price: 5.5, image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=900&q=85", description: "Freshly squeezed orange" },
  { id: 2, name: "Green Glow", category: "Fresh Juices", price: 6.5, image: "https://images.unsplash.com/photo-1654084982335-d404ccf9c6f5?auto=format&fit=crop&w=900&q=85", description: "Apple, spinach, cucumber" },
  { id: 3, name: "Berry Blast", category: "Smoothies", price: 7, image: "https://baci-a-tutti.al/image/gallery/Mixed%20Berry%20Tropical%20Smoothie.jpg", description: "Strawberry, blueberry, banana" },
  { id: 4, name: "Mango Dream", category: "Smoothies", price: 7.5, image: "https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?auto=format&fit=crop&w=900&q=85", description: "Mango, banana, yoghurt" },
  { id: 5, name: "Lemon Mint", category: "Fresh Juices", price: 4.5, image: "https://images.unsplash.com/photo-1513558161293-c9629dbd3c6a?auto=format&fit=crop&w=900&q=85", description: "Lemon, mint, sparkling water" },
  { id: 6, name: "Tropical Mix", category: "Smoothies", price: 7, image: "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=900&q=85", description: "Pineapple, mango, passion fruit" },
  { id: 7, name: "Watermelon Cooler", category: "Cold Drinks", price: 4, image: "https://images.unsplash.com/photo-1518843875459-f738682238a6?auto=format&fit=crop&w=900&q=85", description: "Fresh watermelon, lime" },
  { id: 8, name: "Iced Matcha", category: "Cold Drinks", price: 5, image: "https://images.unsplash.com/photo-1515823064-d6e0c04616a7?auto=format&fit=crop&w=900&q=85", description: "Matcha, milk, light sweetness" }
];

const categories = ["All items", "Fresh Juices", "Smoothies", "Cold Drinks"];
const money = (amount: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);

export default function Home() {
  const [category, setCategory] = useState("All items");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState("");

  const visibleProducts = useMemo(() => products.filter((product) =>
    (category === "All items" || product.category === category) &&
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
        <a className="brand" href="#" aria-label="Juice Shop home">
          <span className="brand-symbol"><img src="/juice-shop-logo.svg" alt="Juice Shop" /></span>
          <span className="brand-name">JUICE <span>SHOP</span><small>POINT OF SALE</small></span>
        </a>
        <div className="topbar-right"><span className="register-indicator"><i /> Register open</span><span className="staff-avatar">S</span><span className="staff-name">Staff</span></div>
      </header>

      <div className="workspace">
        <section className="catalog">
          <div className="page-heading"><div><p className="eyebrow">YOUR COUNTER</p><h1>Good morning <span>☀</span></h1><p className="muted">A fresh start. What are we making today?</p></div><div className="register-chip">REGISTER 01 <span>•</span> LIVE</div></div>
          <label className="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a drink..." /></label>
          <nav className="categories" aria-label="Product categories">{categories.map((item) => <button key={item} className={category === item ? "category active" : "category"} onClick={() => setCategory(item)}>{item}</button>)}</nav>
          <div className="menu-caption"><span>THE MENU</span><span>{visibleProducts.length} DRINKS</span></div>
          <div className="product-grid">
            {visibleProducts.map((product) => <button className="product-card" key={product.id} onClick={() => addToCart(product)}>
              <span className="product-photo"><img src={product.image} alt={product.name} loading="lazy" /><span className="add-badge" aria-hidden="true">+</span></span>
              <span className="product-info"><span className="product-category">{product.category}</span><strong>{product.name}</strong><span className="product-description">{product.description}</span><b>{money(product.price)}</b></span>
            </button>)}
            {visibleProducts.length === 0 && <p className="empty-products">No drinks found. Try another search.</p>}
          </div>
        </section>

        <aside className="order-panel">
          <div className="order-heading"><div><p className="eyebrow">YOUR ORDER</p><h2>Current sale</h2></div><span className="order-number">DRAFT</span></div>
          <div className="order-meta"><span>Walk-in customer</span><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>
          <div className="cart-lines">
            {cart.length === 0 ? <div className="empty-cart"><span className="basket-icon"><svg viewBox="0 0 24 24"><path d="M4 9h16l-1.5 11h-13L4 9Z"/><path d="m8 9 4-6 4 6"/></svg></span><strong>Nothing here yet</strong><p>Tap a drink to add it to the order.</p></div> : cart.map((line) => <div className="cart-line" key={line.product.id}>
              <img className="mini-art" src={line.product.image} alt="" /><div className="line-details"><strong>{line.product.name}</strong><span>{money(line.product.price)} each</span><div className="quantity-control"><button onClick={() => changeQuantity(line.product.id, -1)} aria-label={`Remove one ${line.product.name}`}>−</button><span>{line.quantity}</span><button onClick={() => changeQuantity(line.product.id, 1)} aria-label={`Add one ${line.product.name}`}>+</button></div></div><b className="line-total">{money(line.product.price * line.quantity)}</b>
            </div>)}
          </div>
          <div className="totals"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Tax</span><strong>Not configured</strong></div><div className="grand-total"><span>Total</span><strong>{money(subtotal)}</strong></div></div>
          <button className="checkout-button" disabled={cart.length === 0} onClick={() => setNotice("Checkout is not enabled yet. Payment and order-saving services must be implemented before taking real sales.")}>Continue <span>→</span></button>
          {notice && <p className="notice" role="status">{notice}</p>}
          <p className="safety-note">Preview mode · Orders and payments are not saved.</p>
        </aside>
      </div>
      <footer className="footer"><span>JUICE SHOP POS</span><span>MADE FOR THE COUNTER</span></footer>
    </main>
  );
}
