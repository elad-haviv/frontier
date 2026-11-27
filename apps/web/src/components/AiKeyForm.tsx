/**
 * The field that puts an AI key on this device (stage 31f): a provider, the key, and "Test and
 * keep on this device". It is used in two places, so people meet the same words both times: in
 * Settings › AI keys, and in place in the dialog that opens when a feature needs a key.
 *
 * The key is tested for real, through the server, with the key in that one request. It is kept
 * only if the provider accepts it, and only in this browser. The server never saves it.
 */
import { AI_PROVIDER_KINDS, AiProviderKind, keyProblem } from "@frontier/schema";
import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { setDeviceKey } from "../aiKeys.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { ActionButton } from "./ui/ActionButton.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import "./AiKeyForm.css";

/** What the key entry is doing, for the fields and for whoever holds the buttons. */
export interface KeyEntry {
  kind: AiProviderKind;
  setKind(kind: AiProviderKind): void;
  key: string;
  setKey(key: string): void;
  busy: boolean;
  error: string | null;
  /** The provider could not be reached to test the key: it may be kept untested. */
  unreached: string | null;
  /** Tests the key, and keeps it on this device when the provider accepts it. */
  submit(): Promise<void>;
  /** Keeps a key that could not be tested because the provider was out of reach. */
  keepUntested(): void;
  /** Why testing cannot happen now (no connection), or undefined. */
  blocked: string | undefined;
}

export function useKeyEntry(
  initial: AiProviderKind,
  onKept: (kind: AiProviderKind) => void,
): KeyEntry {
  const [kind, setKindState] = useState<AiProviderKind>(initial);
  const [key, setKeyState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreached, setUnreached] = useState<string | null>(null);
  const offline = useNeedsConnection();

  const clear = () => {
    setError(null);
    setUnreached(null);
  };

  function keep(check: { ok: boolean; message: string | null }) {
    setDeviceKey(kind, key, { at: new Date().toISOString(), ...check });
    // The key leaves the field as soon as it is on the device.
    setKeyState("");
    clear();
    onKept(kind);
  }

  return {
    kind,
    setKind: (k) => {
      setKindState(k);
      clear();
    },
    key,
    setKey: (k) => {
      setKeyState(k);
      clear();
    },
    busy,
    error,
    unreached,
    blocked: offline ? "Testing a key needs a connection." : undefined,
    async submit() {
      clear();
      const problem = keyProblem(key);
      if (problem) return setError(problem);
      if (offline) return setError("Testing a key needs a connection.");
      setBusy(true);
      try {
        const r = await api.checkKey(kind, key.trim());
        if (r.ok) keep({ ok: true, message: null });
        else if (r.refused) setError(r.message);
        else setUnreached(r.message);
      } catch (err) {
        setError(err instanceof ApiFailure ? err.message : "The key could not be tested.");
      } finally {
        setBusy(false);
      }
    },
    keepUntested() {
      keep({ ok: false, message: unreached });
    },
  };
}

/** The provider select and the key field, with what went wrong under them. No form of its own. */
export function KeyEntryFields({ entry }: { entry: KeyEntry }) {
  const kindId = useId();
  const keyId = useId();
  const [shown, setShown] = useState(false);
  const info = AI_PROVIDER_KINDS[entry.kind];
  const prefixWarning =
    entry.key.trim() !== "" && info.keyPrefix && !entry.key.trim().startsWith(info.keyPrefix)
      ? `${info.label} keys usually start with ${info.keyPrefix}.`
      : null;
  return (
    <div className="ai-key-fields">
      <label htmlFor={kindId}>Provider</label>
      <select
        id={kindId}
        value={entry.kind}
        onChange={(e) => entry.setKind(AiProviderKind.parse(e.target.value))}
      >
        {AiProviderKind.options.map((k) => (
          <option key={k} value={k}>
            {AI_PROVIDER_KINDS[k].label}
          </option>
        ))}
      </select>
      <p className="ai-key-hint">{info.blurb}</p>
      <label htmlFor={keyId}>Key</label>
      <div className="ai-key-row">
        <input
          id={keyId}
          type={shown ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={entry.key}
          placeholder={info.keyPrefix ? `${info.keyPrefix}…` : "Key"}
          onChange={(e) => entry.setKey(e.target.value)}
        />
        <IconButton
          type="button"
          label={shown ? "Hide the key" : "Show the key"}
          icon={shown ? EyeOff : Eye}
          size="sm"
          onClick={() => setShown(!shown)}
        />
      </div>
      {prefixWarning && <p className="ai-key-hint">{prefixWarning}</p>}
      {entry.error && (
        <p className="ai-key-error" role="alert">
          {entry.error}
        </p>
      )}
      {entry.unreached && (
        <p className="ai-key-error" role="alert">
          {entry.unreached}{" "}
          <button type="button" className="plain" onClick={entry.keepUntested}>
            Keep it anyway
          </button>
        </p>
      )}
    </div>
  );
}

/** The submit button, with the same words wherever the field appears. */
export function KeepKeyButton({ entry }: { entry: KeyEntry }) {
  return (
    <ActionButton
      type="submit"
      className="primary"
      disabled={entry.busy || entry.blocked !== undefined}
      title={entry.blocked}
    >
      {entry.busy ? "Testing…" : "Test and keep on this device"}
    </ActionButton>
  );
}

/** The field as its own form, for Settings › AI keys. */
export function AiKeyForm({
  initial = "openrouter",
  onKept,
  onCancel,
}: {
  initial?: AiProviderKind;
  onKept: (kind: AiProviderKind) => void;
  onCancel?: () => void;
}) {
  const entry = useKeyEntry(initial, onKept);
  return (
    <form
      className="ai-key-form"
      onSubmit={(e) => {
        e.preventDefault();
        void entry.submit();
      }}
    >
      <KeyEntryFields entry={entry} />
      <p className="ai-key-actions">
        <KeepKeyButton entry={entry} />
        {onCancel && (
          <button type="button" className="quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </p>
    </form>
  );
}
