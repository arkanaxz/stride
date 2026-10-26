"use client";

import { useState } from "react";

export default function LoginForm({ destination }: { destination: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in.");
      window.location.assign(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="login-form" onSubmit={(event) => void submit(event)}><label>Username<input name="username" autoComplete="username" required/></label><label>Password<input type="password" name="password" autoComplete="current-password" required/></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form>;
}
