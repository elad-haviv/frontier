/**
 * AI › Providers: the services connected, each with its key. A key is saved only through "Check
 * and save", which has the server list the provider's models with it (a free call) first. No key
 * comes back from the server, only a masked hint.
 */
import {
  AI_PROVIDER_KINDS,
  AiProviderKind,
  type AiProviderView,
  type ProviderCheckResponse,
} from "@frontier/schema";
import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.ts";
import { useDialogs } from "../../components/Dialogs.tsx";
import { useRefresh } from "../../components/Shell.tsx";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { IconButton } from "../../components/ui/IconButton.tsx";
import { useNeedsConnection } from "../../sync/connection.ts";
import {
  ago,
  kindLabel,
  message,
  ProviderMark,
  Saved,
  TASKS,
  taskTitle,
  useAutoSave,
  useSettingsData,
} from "./shared.tsx";

/** A key typed for a provider, checked on the server before it is stored. */
function KeyField({
  kind,
  label,
  withAddress,
  onCheck,
  onDone,
  disabledReason,
  submit = "Check and save",
}: {
  kind: AiProviderKind;
  label: string;
  /** Asks for the endpoint's address (and a name) too, for an OpenAI-compatible endpoint. */
  withAddress?: boolean;
  onCheck: (input: {
    key: string;
    baseUrl: string;
    name: string;
    saveAnyway: boolean;
  }) => Promise<ProviderCheckResponse>;
  onDone: (r: ProviderCheckResponse) => void;
  disabledReason?: string | undefined;
  submit?: string;
}) {
  const info = AI_PROVIDER_KINDS[kind];
  const id = useId();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProviderCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prefixWarning =
    key.trim() !== "" && info.keyPrefix && !key.trim().startsWith(info.keyPrefix)
      ? `${info.label} keys usually start with ${info.keyPrefix}.`
      : null;

  async function check(saveAnyway: boolean) {
    setError(null);
    if (info.keyRequired && key.trim() === "") return setError("Enter the key.");
    if (withAddress && !/^https?:\/\//.test(baseUrl.trim())) {
      return setError("Give the endpoint's address, starting with https://.");
    }
    setBusy(true);
    try {
      const r = await onCheck({
        key: key.trim(),
        baseUrl: baseUrl.trim(),
        name: name.trim(),
        saveAnyway,
      });
      setResult(r);
      if (r.saved) {
        // The key leaves the page as soon as it is stored.
        setKey("");
        onDone(r);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="key-field"
      onSubmit={(e) => {
        e.preventDefault();
        void check(false);
      }}
    >
      {withAddress && (
        <>
          <label className="field">
            <span>Address</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={baseUrl}
              placeholder="https://example.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              placeholder="Such as Home server"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </>
      )}
      <label className="field" htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="key-row">
        <input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={key}
          placeholder={
            info.keyPrefix
              ? `${info.keyPrefix}…`
              : info.keyRequired
                ? "Key"
                : "Key, if it needs one"
          }
          onChange={(e) => {
            setKey(e.target.value);
            setResult(null);
          }}
        />
        <IconButton
          type="button"
          label={shown ? "Hide the key" : "Show the key"}
          icon={shown ? EyeOff : Eye}
          size="sm"
          onClick={() => setShown(!shown)}
        />
        <ActionButton
          type="submit"
          className="primary"
          disabled={busy || disabledReason !== undefined}
          title={disabledReason}
        >
          {busy ? "Checking…" : submit}
        </ActionButton>
      </div>
      {prefixWarning && <p className="field-hint">{prefixWarning}</p>}
      {error && <p className="field-error">{error}</p>}
      {result && !result.saved && (
        <div className="field-error" role="alert">
          <p>{result.message}</p>
          {!result.refused && (
            <p>
              The provider could not be reached to check the key.{" "}
              <button type="button" className="plain" onClick={() => void check(true)}>
                Save anyway
              </button>
            </p>
          )}
        </div>
      )}
    </form>
  );
}

function ProviderRow({
  p,
  canStore,
  onChanged,
}: {
  p: AiProviderView;
  canStore: boolean;
  onChanged: () => Promise<void>;
}) {
  const dialogs = useDialogs();
  const saving = useAutoSave();
  const [replacing, setReplacing] = useState(false);
  const failing = p.keyUnreadable || p.check?.ok === false;
  const reports = AI_PROVIDER_KINDS[p.kind].reportsCost;

  async function remove() {
    const using = p.usedFor.map(taskTitle);
    const ok = await dialogs.confirm({
      title: `Remove ${p.name}?`,
      body:
        using.length > 0
          ? `${using.join(" and ")} ${using.length === 1 ? "uses" : "use"} ${p.name}. Removing it turns ${using.length === 1 ? "it" : "them"} off until you choose other models.`
          : "Its key is deleted from the server.",
      action: "Remove",
      danger: true,
    });
    if (!ok) return;
    await saving.run(() => api.removeProvider(p.id, true));
    await onChanged();
  }

  return (
    <li className={`provider-row ${failing ? "is-failing" : ""}`}>
      <ProviderMark kind={p.kind} />
      <div className="provider-body">
        <div className="provider-name">
          {p.name}
          {p.kind === "custom" && p.baseUrl && <span className="mono muted"> {p.baseUrl}</span>}
        </div>
        <div className="provider-status">
          {!p.enabled ? (
            <span className="status off">
              <span className="dot off" /> Switched off
            </span>
          ) : p.keyUnreadable ? (
            <span className="status bad">
              <span className="dot bad" /> The stored key can't be read. Enter it again.
            </span>
          ) : p.check?.ok === false ? (
            <span className="status bad">
              <span className="dot bad" /> Key refused
            </span>
          ) : p.keySet ? (
            <span className="status ok">
              <span className="dot ok" /> Connected
            </span>
          ) : (
            <span className="status off">
              <span className="dot off" /> No key
            </span>
          )}
          <span className="muted">
            {p.keyHint &&
              (p.keyFrom === "environment"
                ? ` · from the server's environment, ends ${p.keyHint}`
                : ` · key ${p.keyHint}`)}
            {p.check && ` · checked ${ago(p.check.at)}`}
            {` · ${reports ? "reports what each call costs" : "costs estimated from prices"}`}
          </span>
        </div>
        {p.check?.ok === false && p.check.message && (
          <p className="field-error">{p.check.message}</p>
        )}
        {failing && p.usedFor.length > 0 && (
          <p className="field-error">
            {p.usedFor.map(taskTitle).join(" and ")} {p.usedFor.length === 1 ? "is" : "are"} off
            until this works or you choose another model.
          </p>
        )}
        {p.usedFor.length > 0 && (
          <p className="provider-used">
            Used for{" "}
            {p.usedFor.map((t, i) => (
              <span key={t}>
                {i > 0 && ", "}
                <Link to={`/settings/ai/models/${t}`}>{taskTitle(t)}</Link>
              </span>
            ))}
          </p>
        )}
        {(replacing || failing) && p.keyFrom !== "environment" && (
          <KeyField
            kind={p.kind}
            label={`New key for ${p.name}`}
            disabledReason={
              canStore ? undefined : "The server has no SECRETS_KEY to store keys with."
            }
            onCheck={({ key, saveAnyway }) => api.providerKey(p.id, key, saveAnyway)}
            onDone={() => {
              setReplacing(false);
              void onChanged();
            }}
          />
        )}
        {saving.error && <p className="field-error">{saving.error}</p>}
      </div>
      <div className="provider-actions">
        <Saved at={saving.savedAt} />
        {p.keySet && p.enabled && (
          <ActionButton
            type="button"
            className="quiet"
            disabled={saving.busy}
            onClick={() =>
              void saving
                .run(async () => {
                  const r = await api.checkProvider(p.id);
                  if (!r.ok) throw new Error(r.message);
                })
                .then(onChanged)
            }
          >
            Check again
          </ActionButton>
        )}
        {p.keyFrom !== "environment" && !failing && canStore && (
          <button type="button" className="plain" onClick={() => setReplacing(!replacing)}>
            {replacing ? "Cancel" : p.keySet ? "Replace key" : "Add key"}
          </button>
        )}
        {p.stored && (
          <button
            type="button"
            className="plain"
            onClick={() =>
              void saving
                .run(() => api.updateProvider(p.id, { enabled: !p.enabled }))
                .then(onChanged)
            }
          >
            {p.enabled ? "Switch off" : "Switch on"}
          </button>
        )}
        {p.stored && (
          <button type="button" className="plain danger" onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/** The order providers are offered in: the five most asked for, then presets, then any. */
const OFFERED = AiProviderKind.options;

export function Providers() {
  const { settings, reload } = useSettingsData();
  const refresh = useRefresh();
  const offline = useNeedsConnection();
  const [adding, setAdding] = useState<AiProviderKind | null>(null);
  if (!settings) return null;
  const ai = settings.ai;
  const connected = new Set(ai.providers.map((p) => p.kind));
  const offer = OFFERED.filter((k) => AI_PROVIDER_KINDS[k].many || !connected.has(k));
  const changed = async () => {
    await reload();
    refresh();
  };

  return (
    <section className="settings-block">
      <p className="muted">
        Connect the services that run the AI, each with a key of yours. Keys stay on your server;
        only their last characters are shown here.
      </p>
      {!ai.canStoreKey && (
        <p className="banner" role="alert">
          A key cannot be stored here: the server has no SECRETS_KEY. Set SECRETS_KEY (32 bytes in
          base64) in the server's environment, or give keys there, such as OPENROUTER_API_KEY.
        </p>
      )}
      {ai.providers.length > 0 && (
        <ul className="provider-list">
          {ai.providers.map((p) => (
            <ProviderRow key={p.id} p={p} canStore={ai.canStoreKey} onChanged={changed} />
          ))}
        </ul>
      )}
      <h2>{ai.providers.length === 0 ? "Connect a provider" : "Add another provider"}</h2>
      <ul className="provider-offers">
        {offer.map((kind) => (
          <li key={kind} className={adding === kind ? "open" : undefined}>
            <button
              type="button"
              className="provider-offer"
              aria-expanded={adding === kind}
              disabled={!ai.canStoreKey && AI_PROVIDER_KINDS[kind].keyRequired}
              onClick={() => setAdding(adding === kind ? null : kind)}
            >
              <ProviderMark kind={kind} />
              <span>
                <strong>{kindLabel(kind)}</strong>
                <small>{AI_PROVIDER_KINDS[kind].blurb}</small>
              </span>
            </button>
            {adding === kind && (
              <KeyField
                kind={kind}
                label={`Key for ${kindLabel(kind)}`}
                withAddress={AI_PROVIDER_KINDS[kind].needsBaseUrl}
                disabledReason={offline}
                onCheck={({ key, baseUrl, name, saveAnyway }) =>
                  api.addProvider({
                    kind,
                    ...(key ? { key } : {}),
                    ...(baseUrl ? { baseUrl } : {}),
                    ...(name ? { name } : {}),
                    ...(saveAnyway ? { saveAnyway } : {}),
                  })
                }
                onDone={() => {
                  setAdding(null);
                  void changed();
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {TASKS.length} tasks use these: choose their models under{" "}
        <Link to="/settings/ai/models">Models</Link>.
      </p>
    </section>
  );
}
