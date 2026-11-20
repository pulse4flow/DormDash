"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function SecretField({
  label,
  name,
  autoComplete,
}: {
  label: string;
  name: "password" | "registrationKey";
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label>
      {label}
      <span className="password-field">
        <input
          name={name}
          type={visible ? "text" : "password"}
          minLength={name === "password" ? 8 : undefined}
          required
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}

export function AdminAuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/auth/${register ? "register" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setBusy(false);
    if (response.ok) {
      router.push("/admin");
    } else {
      setError((await response.json()).error ?? "Unable to continue.");
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <SecretField
        label="Password"
        name="password"
        autoComplete={register ? "new-password" : "current-password"}
      />
      {register && <SecretField label="Registration key" name="registrationKey" />}
      {error && <p className="form-error">{error}</p>}
      <button className="button" disabled={busy}>
        {busy ? "Please wait…" : register ? "Create admin account" : "Log in"}
      </button>
    </form>
  );
}
