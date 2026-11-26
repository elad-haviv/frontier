import { Fingerprint } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiFailure } from "../api.ts";
import { Icon } from "../components/ui/Icon.tsx";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [ways, setWays] = useState({ passkeys: false, password: true, emailless: false });

  useEffect(() => {
    api.session().then(
      (s) => setWays({ passkeys: s.passkeys, password: s.password, emailless: s.emailless }),
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
      await api.login(email, password);
      entered();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const problem = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  return (
    <main className="login">
      <div className="login-card">
        <h1 className="wordmark">Frontier</h1>
        <p className="muted">The atlas of Avalymia.</p>
        {ways.passkeys && (
          <>
            <button type="button" className="login-passkey" disabled={busy} onClick={passkey}>
              <Icon icon={Fingerprint} size="md" />
              Use a passkey
            </button>
            {ways.password && <p className="login-or">or</p>}
          </>
        )}
        {ways.password ? (
          <form onSubmit={submit} className="login-form">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus={!ways.passkeys}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {ways.emailless && (
              <p className="login-hint">This account has no email yet. Leave this empty.</p>
            )}
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {problem}
            <button
              type="submit"
              className={ways.passkeys ? "secondary" : undefined}
              disabled={busy || password === ""}
            >
              {busy ? "Checking…" : "Log in"}
            </button>
          </form>
        ) : (
          problem
        )}
        <p className="muted login-note">
          No account? You need an invite link from a project's owner.
        </p>
      </div>
    </main>
  );
}
