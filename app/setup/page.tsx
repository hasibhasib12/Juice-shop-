"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function InitialSetupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, setupKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Setup could not be completed.");
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup-screen">
      <form className="setup-panel" onSubmit={submit}>
        <span className="setup-kicker">JUICE SHOP · FIRST-TIME SETUP</span>
        <h1>Create your owner account</h1>
        <p>This one-time setup creates the first store owner. Keep your setup key private.</p>
        <label>Setup key<input required type="password" autoComplete="off" value={setupKey} onChange={(event) => setSetupKey(event.target.value)} /></label>
        <label>Your name<input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
        {error && <div className="setup-error" role="alert">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? "Creating account…" : "Create owner account"}</button>
      </form>
    </main>
  );
}
