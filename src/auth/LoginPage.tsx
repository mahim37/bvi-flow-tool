import { useId, useState } from "react";

import { ApiError } from "../api/client";
import croppedLogo from "../assets/predmind-logo - cropped.webp";
import { useAuth } from "./useAuth";

export function LoginPage() {
  const { signIn } = useAuth();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (caught) {
      // The backend answers a wrong password and an unknown address with
      // the same message on purpose, so there is nothing to add here --
      // passing its wording through keeps this screen from inventing a
      // distinction the API deliberately refuses to make.
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={onSubmit} noValidate>
        <div className="login__brand">
          <img className="login__logo" src={croppedLogo} alt="" />
          <div>
            <h1 className="login__title">Flow Tool</h1>
            <p className="login__subtitle">Internal tool. Staff sign-in required.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error !== null && (
          <p className="banner banner--error" id={errorId} role="alert">
            {error}
          </p>
        )}

        <button
          className="button button--primary"
          type="submit"
          disabled={busy}
          aria-describedby={error !== null ? errorId : undefined}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
