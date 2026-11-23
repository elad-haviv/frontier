import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { connection, useConnection } from "../sync/connection.ts";
import { DialogFrame } from "./Dialogs.tsx";
import "./LoginDialog.css";

const asked = new EventTarget();

/** Opens the login dialog again after the author closed it, as from the connection mark. */
export function askToLogIn(): void {
  asked.dispatchEvent(new Event("open"));
}

/**
 * The login form over the page, shown when the session ran out. Nothing on the page or in the
 * save queue is cleared: sending waits, and goes on once the author is logged in again.
 */
export function LoginDialog() {
  const { state } = useConnection();
  const [closed, setClosed] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ways, setWays] = useState({ passkeys: false, password: true });
  const field = useRef<HTMLInputElement>(null);
  const out = state === "signed-out";

  useEffect(() => {
    if (!out) {
      setClosed(false);
      return;
    }
    api.session().then(
      (s) => setWays({ passkeys: s.passkeys, password: s.password }),
      () => undefined,
    );
  }, [out]);

  useEffect(() => {
    const open = () => setClosed(false);
    asked.addEventListener("open", open);
    return () => asked.removeEventListener("open", open);
  }, []);

  if (!out || closed) return null;

  async function enter(how: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await how();
      setPassword("");
      await connection.loggedIn();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogFrame
      title="Log in again"
      body="Your session has ended. Nothing you changed is lost: what is not sent yet stays on this device and goes as soon as you are back in."
      className="login-dialog"
      onCancel={() => setClosed(true)}
      onSubmit={() => {
        if (ways.password && password) void enter(() => api.login(password));
      }}
      initialFocus={field}
    >
      {ways.password && (
        <label className="dialog-field">
          <span>Password</span>
          <input
            ref={field}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={() => setClosed(true)}>
          Not now
        </button>
        {ways.passkeys && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void enter(() => api.loginWithPasskey())}
          >
            Use a passkey
          </button>
        )}
        {ways.password && (
          <button type="submit" className="primary" disabled={busy || password === ""}>
            {busy ? "Checking…" : "Log in"}
          </button>
        )}
      </p>
    </DialogFrame>
  );
}
