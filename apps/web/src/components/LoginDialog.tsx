import { useEffect, useRef, useState } from "react";
import { Fingerprint } from "lucide-react";
import { api, ApiFailure } from "../api.ts";
import { loadMe, useMe } from "../me.ts";
import { noteSignedIn } from "../offline/start.ts";
import { connection, useConnection } from "../sync/connection.ts";
import { useLocation } from "../nav.tsx";
import { queue } from "../sync/queue.ts";
import { DialogFrame } from "./Dialogs.tsx";
import { Icon } from "./ui/Icon.tsx";
import "./LoginDialog.css";

const asked = new EventTarget();

/** Opens the login dialog again after the author closed it, as from the connection mark. */
export function askToLogIn(): void {
  asked.dispatchEvent(new Event("open"));
}

/** Who is waiting for a recent login, so the change that needed it can go on once it is made. */
let waiting: ((loggedIn: boolean) => void) | null = null;
const needed = new EventTarget();

/**
 * Asks the person to log in again while they are still logged in, for a change the server only
 * makes soon after a login (a passkey, a first password). Resolves true once they have, false when
 * they close the dialog. See `withRecentLogin`.
 */
export function askForRecentLogin(): Promise<boolean> {
  waiting?.(false);
  return new Promise((resolve) => {
    waiting = resolve;
    needed.dispatchEvent(new Event("open"));
  });
}

/**
 * Runs a change, and when the server says it needs a recent login, has the person log in again
 * in the dialog and then runs it once more. A closed dialog leaves the server's own message.
 */
export async function withRecentLogin<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (
      err instanceof ApiFailure &&
      err.code === "recent_login_needed" &&
      (await askForRecentLogin())
    ) {
      return work();
    }
    throw err;
  }
}

/**
 * The login form over the page, shown when the session ran out. Nothing on the page or in the
 * save queue is cleared: sending waits, and goes on once the author is logged in again. It is
 * also shown, with other words, to a person who is still logged in but must log in once more
 * for a change that needs a recent login.
 */
export function LoginDialog() {
  const { state } = useConnection();
  // The page that sets a new password has no use for a login: a reset ends this browser's own
  // session, and the 401 that follows must not put this form over the "Done" page, which has its
  // own Log in button.
  const onReset = useLocation().pathname.startsWith("/reset/");
  const [closed, setClosed] = useState(false);
  // The person who was logged in is the one logging in again: their email is already here.
  const known = useMe();
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? known?.email ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ways, setWays] = useState({ passkeys: false, password: true, emailless: false });
  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState(false);
  const out = state === "signed-out";

  useEffect(() => {
    if (!out) setClosed(false);
    if (!out && !recent) return;
    api.session().then(
      (s) => setWays({ passkeys: s.passkeys, password: s.password, emailless: s.emailless }),
      () => undefined,
    );
  }, [out, recent]);

  useEffect(() => {
    const open = () => setRecent(true);
    needed.addEventListener("open", open);
    return () => needed.removeEventListener("open", open);
  }, []);

  useEffect(() => {
    const open = () => setClosed(false);
    asked.addEventListener("open", open);
    return () => asked.removeEventListener("open", open);
  }, []);

  // Being signed out is shown until the person says "Not now"; the ask for a recent login is not.
  if (onReset && !recent) return null;
  if (out ? closed && !recent : !recent) return null;

  function finish(loggedIn: boolean) {
    setRecent(false);
    waiting?.(loggedIn);
    waiting = null;
  }

  function cancel() {
    setClosed(true);
    finish(false);
  }

  async function enter(how: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await how();
      setPassword("");
      void noteSignedIn(queue);
      void loadMe();
      await connection.loggedIn();
      finish(true);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogFrame
      title="Log in again"
      body={
        out
          ? "Your session has ended. Nothing you changed is lost: what is not sent yet stays on this device and goes as soon as you are back in."
          : "This change needs a login from the last few minutes. Log in again and it goes ahead."
      }
      className="login-dialog"
      onCancel={cancel}
      onSubmit={() => {
        if (ways.password && password) void enter(() => api.login(email, password));
      }}
      initialFocus={email === "" ? emailField : passwordField}
    >
      {ways.password && (
        <label className="dialog-field">
          <span>Email</span>
          <input
            ref={emailField}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setTyped(e.target.value)}
          />
          {ways.emailless && (
            <small className="login-hint">This account has no email yet. Leave this empty.</small>
          )}
        </label>
      )}
      {ways.password && (
        <label className="dialog-field">
          <span>Password</span>
          <input
            ref={passwordField}
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
        <button type="button" className="quiet" onClick={cancel}>
          Not now
        </button>
        {ways.passkeys && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void enter(() => api.loginWithPasskey())}
          >
            <Icon icon={Fingerprint} size="sm" /> Use a passkey
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
