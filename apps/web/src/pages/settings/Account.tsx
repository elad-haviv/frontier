import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiFailure, googleStartUrl } from "../../api.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { askForRecentLogin, withRecentLogin } from "../../components/LoginDialog.tsx";
import { useLogout } from "../../components/Shell.tsx";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { loadMe, useMe } from "../../me.ts";
import { useLocation, useNavigate } from "../../nav.tsx";
import { googleProblem } from "../joinModel.ts";
import { NoMe } from "./NoMe.tsx";
import { useNeedsConnection } from "../../sync/connection.ts";

type Notice = { kind: "ok" | "error"; text: string } | null;

/** The shortest password the server takes. */
const MIN_PASSWORD = 12;

/** Why Google cannot be unlinked while it is the only way in, in plain words. */
export const GOOGLE_LAST_WAY =
  "Google is the only way this account logs in. Add a password or a passkey first, then Google can be unlinked.";

/** The address the Google trip comes back to: this section, opened with no project. */
const BACK_HERE = "/settings/account";

/** Passkeys, Google, the password, the switch that turns it off, and Log out. */
export function Account() {
  const me = useMe();
  const dialogs = useDialogs();
  const logout = useLogout();
  const [notice, setNotice] = useState<Notice>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [passwordProblem, setPasswordProblem] = useState<{
    field: "current" | "next";
    text: string;
  } | null>(null);
  const offline = useNeedsConnection();
  const location = useLocation();
  const navigate = useNavigate();
  const problem = new URLSearchParams(location.search).get("problem");
  const handled = useRef<string | null>(null);

  // Back from a Google trip that did not work, or one that asked for a recent login: said in
  // words, and the address cleaned. A recent login is asked for here, as when adding a passkey,
  // and the link goes ahead once it is made.
  useEffect(() => {
    if (!problem || handled.current === problem) return;
    handled.current = problem;
    void navigate({ pathname: location.pathname, search: "" }, { replace: true });
    if (problem === "recent_login_needed") {
      setNotice({
        kind: "error",
        text: "Linking Google asks for a login from the last few minutes. Log in again and it goes ahead.",
      });
      void askForRecentLogin().then((ok) => {
        if (ok) window.location.assign(googleStartUrl({ link: true, returnTo: BACK_HERE }));
      });
      return;
    }
    const words = googleProblem(problem);
    if (words) setNotice({ kind: "error", text: words });
  }, [problem]);
  if (!me) return <NoMe />;
  const google = me.signingIn?.google ?? null;
  const googleAvailable = me.signingIn?.googleAvailable ?? false;
  // How many other ways in there are besides Google: a password that works, and passkeys.
  const otherWays = (me.passwordSet && !me.passwordOff ? 1 : 0) + me.passkeys.length;
  const googleIsLast = google !== null && googleAvailable && otherWays === 0;

  async function run(work: () => Promise<unknown>, done: string, failed: string) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      setNotice({ kind: "ok", text: done });
      await loadMe();
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof ApiFailure ? err.message : failed });
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (me!.passwordSet && current === "") {
      setPasswordProblem({ field: "current", text: "Type your current password." });
      return;
    }
    if (next.length < MIN_PASSWORD) {
      setPasswordProblem({
        field: "next",
        text: `Use at least ${MIN_PASSWORD} characters.`,
      });
      return;
    }
    setPasswordProblem(null);
    setBusy(true);
    setNotice(null);
    try {
      await withRecentLogin(() => api.setPassword(next, current));
      setCurrent("");
      setNext("");
      setNotice({
        kind: "ok",
        text: me!.passwordSet ? "The password was changed." : "The password was set.",
      });
      await loadMe();
    } catch (err) {
      const text = err instanceof ApiFailure ? err.message : "The password was not changed.";
      // The server says which of the two was wrong; a wrong current password goes under its field.
      if (/current password/i.test(text)) setPasswordProblem({ field: "current", text });
      else setNotice({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  }

  async function unlinkGoogle() {
    const ok = await dialogs.confirm({
      title: "Unlink Google?",
      body: "You will not be able to log in with Google any more. Your other ways of logging in stay as they are, and other devices are logged out.",
      action: "Unlink",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.unlinkGoogle();
      setNotice({ kind: "ok", text: "Google was unlinked." });
      await loadMe();
    } catch (err) {
      setNotice({
        kind: "error",
        text:
          err instanceof ApiFailure && err.code === "not_allowed"
            ? GOOGLE_LAST_WAY
            : err instanceof ApiFailure
              ? err.message
              : "Google was not unlinked. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-block">
      {notice && (
        <p
          className={`banner ${notice.kind === "ok" ? "banner-ok" : ""}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {(googleAvailable || google) && (
        <>
          <h2>Google</h2>
          {google ? (
            <>
              <p>
                Linked: <b>{google.email}</b>{" "}
                <em className="muted">added {new Date(google.addedAt).toLocaleDateString()}</em>
              </p>
              {googleIsLast && <p className="muted">{GOOGLE_LAST_WAY}</p>}
              <p className="change-actions">
                <ActionButton
                  type="button"
                  className="quiet danger"
                  disabled={busy || googleIsLast}
                  onClick={() => void unlinkGoogle()}
                >
                  Unlink Google
                </ActionButton>
              </p>
            </>
          ) : (
            <>
              <p className="muted">
                Link a Google account to log in with “Continue with Google”. It only says who you
                are: it does not give anyone else a way in.
              </p>
              <p className="change-actions">
                <ActionButton
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    window.location.assign(googleStartUrl({ link: true, returnTo: BACK_HERE }))
                  }
                >
                  Link a Google account
                </ActionButton>
              </p>
            </>
          )}
        </>
      )}
      <h2>Passkeys</h2>
      <p className="muted">
        A passkey logs you in with this device's fingerprint, face or screen lock instead of the
        password. Once one works you can switch the password off.
      </p>
      {me.passkeys.length > 0 && (
        <ul className="passkeys">
          {me.passkeys.map((p) => (
            <li key={p.id}>
              <span>
                {p.name} <em className="muted">added {new Date(p.addedAt).toLocaleDateString()}</em>
              </span>
              <ActionButton
                type="button"
                className="plain danger"
                disabled={busy}
                onClick={async () => {
                  const ok = await dialogs.confirm({
                    title: `Remove the passkey "${p.name}"?`,
                    action: "Remove",
                    danger: true,
                  });
                  if (ok)
                    void run(
                      () => api.removePasskey(p.id),
                      "The passkey was removed.",
                      "The passkey was not removed.",
                    );
                }}
              >
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        <span>Add a passkey on this device</span>
        <input
          type="text"
          value={name}
          placeholder="A name for it, such as Phone"
          aria-invalid={nameError ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        {nameError && <em className="field-error">{nameError}</em>}
      </label>
      <p className="change-actions">
        <ActionButton
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            if (name.trim() === "") {
              setNameError("Give the passkey a name first, such as Phone.");
              return;
            }
            void run(
              async () => {
                await withRecentLogin(() => api.addPasskey(name.trim()));
                setName("");
              },
              "The passkey was added. Log out and try it before switching the password off.",
              "The passkey was not added. Try again.",
            );
          }}
        >
          Add a passkey
        </ActionButton>
      </p>

      <h2>Password</h2>
      <p className="muted">
        {me.passwordSet
          ? "Change the password you log in with."
          : "This account has no password. Set one to log in with an email and password too."}
      </p>
      <form onSubmit={changePassword} noValidate>
        {me.passwordSet && (
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              aria-invalid={passwordProblem?.field === "current" ? true : undefined}
              onChange={(e) => {
                setCurrent(e.target.value);
                setPasswordProblem(null);
              }}
            />
            {passwordProblem?.field === "current" && (
              <em className="field-error">{passwordProblem.text}</em>
            )}
          </label>
        )}
        <label className="field">
          <span>{me.passwordSet ? "New password" : "Password"}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={passwordProblem?.field === "next" ? true : undefined}
            onChange={(e) => {
              setNext(e.target.value);
              setPasswordProblem(null);
            }}
          />
          {passwordProblem?.field === "next" ? (
            <em className="field-error">{passwordProblem.text}</em>
          ) : (
            <em className="muted">At least {MIN_PASSWORD} characters.</em>
          )}
        </label>
        <p className="change-actions">
          <ActionButton type="submit" className="primary" disabled={busy}>
            {me.passwordSet ? "Change the password" : "Set the password"}
          </ActionButton>
        </p>
      </form>
      {me.passkeys.length > 0 && me.passwordSet && (
        <label className="check">
          <input
            type="checkbox"
            checked={me.passwordOff}
            disabled={busy || offline !== undefined}
            onChange={(e) =>
              run(
                () => api.passwordOff(e.target.checked),
                e.target.checked
                  ? "The password no longer logs in. The set-password command on the server switches it back on."
                  : "The password logs in again.",
                "The password was not switched.",
              )
            }
          />
          <span>
            Switch the password off
            {me.method === "password" && !me.passwordOff && (
              <em className="muted"> (log in with a passkey or Google first)</em>
            )}
          </span>
        </label>
      )}
      <p className="muted">The last way to log in cannot be removed.</p>

      <h2>This session</h2>
      <p>
        <button type="button" className="quiet danger" onClick={logout}>
          Log out
        </button>
      </p>
    </section>
  );
}
