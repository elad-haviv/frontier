import { type FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiFailure } from "../api.ts";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [ways, setWays] = useState({ passkeys: false, password: true });

  useEffect(() => {
    api.session().then(
      (s) => setWays({ passkeys: s.passkeys, password: s.password }),
      () => undefined,
    );
  }, []);

  const entered = () => {
    onLoggedIn();
    navigate(from && from !== "/login" ? from : "/", { replace: true });
  };

  async function passkey() {
    setBusy(true);
    setError(null);
    try {
      await api.loginWithPasskey();
      entered();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The passkey was not used. Try again.");
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      entered();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <h1 className="wordmark">Frontier</h1>
        <p className="muted">The atlas of Avalymia.</p>
        {ways.password && (
          <>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {ways.password && (
          <button type="submit" disabled={busy || password === ""}>
            {busy ? "Checking…" : "Log in"}
          </button>
        )}
        {ways.passkeys && (
          <button
            type="button"
            className={ways.password ? "quiet" : ""}
            disabled={busy}
            onClick={passkey}
          >
            Use a passkey
          </button>
        )}
      </form>
    </main>
  );
}
