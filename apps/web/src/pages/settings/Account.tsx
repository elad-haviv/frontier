import { useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { useLogout } from "../../components/Shell.tsx";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { useNeedsConnection } from "../../sync/connection.ts";
import { useSettingsData } from "./shared.tsx";

type Notice = { kind: "ok" | "error"; text: string } | null;

/** Passkeys, the password switch, and Log out. */
export function Account() {
  const { settings, reload } = useSettingsData();
  const dialogs = useDialogs();
  const logout = useLogout();
  const [notice, setNotice] = useState<Notice>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offline = useNeedsConnection();
  if (!settings) return null;
  const signIn = settings.signIn;

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      setNotice({ kind: "ok", text: done });
      await reload();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof ApiFailure ? err.message : "The passkey was not added. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-block">
      <p className="muted">
        A passkey logs you in with this device's fingerprint, face or screen lock instead of the
        password. Once one works you can switch the password off.
      </p>
      {notice && (
        <p className={`banner ${notice.kind === "ok" ? "banner-ok" : ""}`} role="status">
          {notice.text}
        </p>
      )}
      {signIn.passkeys.length > 0 && (
        <ul className="passkeys">
          {signIn.passkeys.map((p) => (
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
                  if (ok) void run(() => api.removePasskey(p.id), "The passkey was removed.");
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
            void run(async () => {
              await api.addPasskey(name.trim());
              setName("");
            }, "The passkey was added. Log out and try it before switching the password off.");
          }}
        >
          Add a passkey
        </ActionButton>
      </p>
      {signIn.passkeys.length > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={signIn.passwordOff}
            disabled={busy || offline !== undefined}
            onChange={(e) =>
              run(
                () => api.passwordOff(e.target.checked),
                e.target.checked
                  ? "The password no longer logs in. The set-password command on the server switches it back on."
                  : "The password logs in again.",
              )
            }
          />
          <span>
            Switch the password off
            {signIn.method !== "passkey" && !signIn.passwordOff && (
              <em className="muted"> (log in with a passkey first)</em>
            )}
          </span>
        </label>
      )}
      <h2>This session</h2>
      <p>
        <button type="button" className="quiet danger" onClick={logout}>
          Log out
        </button>
      </p>
    </section>
  );
}
