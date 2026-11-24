"use client";

import { useMemo, useState } from "react";

type Product = { id: number; name: string; category: string; price: number; image: string };
type CartLine = { product: Product; quantity: number };

const products: Product[] = [
  { id: 1, name: "Orange Juice", category: "Juices", price: 80, image: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=700&q=85" },
  { id: 2, name: "Mango Juice", category: "Juices", price: 90, image: "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=700&q=85" },
  { id: 3, name: "Pomegranate Juice", category: "Juices", price: 100, image: "https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=700&q=85" },
  { id: 4, name: "Berry Blast", category: "Smoothies", price: 100, image: "https://images.unsplash.com/photo-1505252585461-04db1eb84625?auto=format&fit=crop&w=700&q=85" },
  { id: 5, name: "Strawberry Smoothie", category: "Smoothies", price: 110, image: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?auto=format&fit=crop&w=700&q=85" },
  { id: 6, name: "Banana Smoothie", category: "Smoothies", price: 110, image: "https://images.unsplash.com/photo-1570696516188-ade861b84a49?auto=format&fit=crop&w=700&q=85" },
  { id: 7, name: "Kiwi Fresh", category: "Juices", price: 90, image: "https://images.unsplash.com/photo-1610970881699-44a5587auto=format&fit=crop&w=700&q=85" },
  { id: 8, name: "Watermelon Juice", category: "Juices", price: 85, image: "https://images.unsplash.com/photo-1525385133512-2f3auto=format&fit=crop&w=700&q=85" },
  { id: 9, name: "Classic Milkshake", category: "Milkshakes", price: 100, image: "https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=700&q=85" },
  { id: 10, name: "Chocolate Milkshake", category: "Milkshakes", price: 120, image: "https://images.unsplash.com/photo-1577805947697-89e18249d767?auto=format&fit=crop&w=700&q=85" },
  { id: 11, name: "Chocolate Cake", category: "Desserts", price: 130, image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=700&q=85" },
  { id: 12, name: "Fruit Dessert", category: "Desserts", price: 100, image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=700&q=85" },
];

const categories = [
  { name: "All", icon: "⌂" },
  { name: "Juices", icon: "🍹" },
  { name: "Smoothies", icon: "🥤" },
  { name: "Milkshakes", icon: "🍦" },
  { name: "Desserts", icon: "🍰" },
  { name: "Special Offers", icon: "⭐" },
  { name: "Membership", icon: "♛" },
];
const money = (amount: number) => `AFN ${amount.toLocaleString("en-US")}`;

export default function Home() {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState("");
  const [customer, setCustomer] = useState("Walk-in customer");
  const [discount, setDiscount] = useState(0);

  const visibleProducts = useMemo(() => products.filter((p) =>
    (category === "All" || p.category === category || (category === "Special Offers" && p.id <= 4) || (category === "Membership" && p.id === 12)) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  ), [category, search]);

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const tax = Math.round((subtotal - discount) * 0.1);
  const total = Math.max(0, subtotal - discount) + tax;

  function addToCart(product: Product) {
    setNotice("");
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      return existing ? current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { product, quantity: 1 }];
    });
  }
  function changeQuantity(id: number, delta: number) {
    setCart((current) => current.map((line) => line.product.id === id ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  }
  function action(label: string) {
    setNotice(`${label} is a design preview control. This workflow will be connected when the POS operations are implemented.`);
  }

  return (
    <main className="pos-screen">
      <header className="pos-header">
        <a className="brand-lockup" href="#" aria-label="Juice Shop home">
          <img src="/juice-shop-logo.svg" alt="Juice Shop" />
          <span>Fresh · Healthy · Happy</span>
        </a>
        <label className="top-search"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 5 5"/></svg><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." /></label>
        <div className="header-date"><span>Tue, Nov 25, 2025</span><strong>10:24 AM</strong></div>
        <div className="online-state"><span className="wifi">⌁</span><i/>Online</div>
        <button className="cashier"><span className="cashier-photo">A</span><span><b>Ahmed Khan</b><small>Cashier</small></span><span className="chevron">⌄</span></button>
      </header>

      <div className="pos-layout">
        <aside className="sidebar">
          <button className="side-home" onClick={() => { setCategory("All"); setSearch(""); }}><span>⌂</span>Home</button>
          <nav className="side-nav" aria-label="Categories">
            {categories.slice(1).map((item) => <button key={item.name} className={category === item.name ? "side-link selected" : "side-link"} onClick={() => setCategory(item.name)}><span>{item.icon}</span>{item.name}</button>)}
          </nav>
          <button className="side-settings" onClick={() => action("Settings")}><span>⚙</span>Settings</button>
        </aside>

        <section className="menu-area">
          <div className="category-tabs">{categories.slice(0,5).map((item) => <button key={item.name} className={category === item.name ? "tab active" : "tab"} onClick={() => setCategory(item.name)}>{item.name}</button>)}<button className="tab more-tab" onClick={() => setCategory("Special Offers")}>More⌄</button></div>
          <div className="product-grid">
            {visibleProducts.map((product) => <button className="product-tile" key={product.id} onClick={() => addToCart(product)}>
              <span className="tile-photo"><img src={product.image} alt={product.name} loading="lazy"/></span>
              <span className="tile-bottom"><span><b>{product.name}</b><strong>{money(product.price)}</strong></span><i>+</i></span>
            </button>)}
            {visibleProducts.length === 0 && <div className="no-products">No products found in this category.</div>}
          </div>
          <div className="quick-actions">
            <button onClick={() => action("Table selection")}><span>♟</span>Table #5</button>
            <button onClick={() => { setCustomer(customer === "Walk-in customer" ? "Ahmed Khan" : "Walk-in customer"); action("Customer selection"); }}><span>♟</span>Customer</button>
            <button onClick={() => { setDiscount(discount ? 0 : 10); setNotice("A sample AFN 10 discount has been applied locally. Authorization and discount rules are not connected."); }}><span>%</span>Discount</button>
            <button onClick={() => action("Order notes")}><span>▤</span>Notes</button>
            <button onClick={() => action("Receipt printing")}><span>▣</span>Print Receipt</button>
          </div>
        </section>

        <aside className="order-card">
          <div className="order-title"><h2><span>🛒</span> Current Order ({itemCount})</h2><button aria-label="Clear order" onClick={() => setCart([])}>×</button></div>
          <div className="order-items">
            {cart.length === 0 ? <div className="cart-empty"><span>🛍</span><b>Your order is empty</b><small>Add a drink to get started</small></div> : cart.map((line) => <div className="order-item" key={line.product.id}>
              <img src={line.product.image} alt=""/><div className="order-item-info"><b>{line.product.name}</b><span>{money(line.product.price)}</span><div className="stepper"><button onClick={() => changeQuantity(line.product.id,-1)}>−</button><b>{line.quantity}</b><button onClick={() => changeQuantity(line.product.id,1)}>+</button></div></div><strong>{money(line.product.price * line.quantity)}</strong><button className="remove-line" aria-label="Remove item" onClick={() => changeQuantity(line.product.id,-line.quantity)}>×</button>
            </div>)}
          </div>
          <div className="order-summary">
            <div><span>Subtotal:</span><b>{money(subtotal)}</b></div>
            <div><span>Discount:</span><b>− {money(discount)}</b></div>
            <div><span>Tax (10%):</span><b>{money(tax)}</b></div>
          </div>
          <div className="order-total"><b>Total:</b><strong>{money(total)}</strong></div>
          <div className="payment-actions"><button className="clear-order" onClick={() => { setCart([]); setDiscount(0); setNotice(""); }}>♜ <span>Clear</span></button><button className="pay-button" onClick={() => action("Payment")} disabled={cart.length === 0}>▣ <span>Pay Now</span></button></div>
          <button className="place-order" onClick={() => action("Order")} disabled={cart.length === 0}><span>⚒</span>Order</button>
          {notice && <p className="pos-notice" role="status">{notice}</p>}
          <p className="preview-note">PREVIEW MODE · NOT FOR LIVE SALES</p>
        </aside>
      </div>
    </main>
  );
}
