import type { FieldJobState, ModelsResponse, SettingsResponse } from "@frontier/schema";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure, entryUrl } from "../api.ts";
import { useRefresh } from "../components/Shell.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useAsync } from "../useAsync.ts";
import { useDialogs } from "../components/Dialogs.tsx";

const usd = (n: number) => (n > 0 && n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);
const message = (err: unknown) =>
  err instanceof ApiFailure ? err.message : "Something went wrong.";

type Notice = { kind: "ok" | "error"; text: string } | null;

function Note({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p className={`banner ${notice.kind === "ok" ? "banner-ok" : ""}`} role="status">
      {notice.text}
    </p>
  );
}

function AiSettings({ ai, reload }: { ai: SettingsResponse["ai"]; reload: () => Promise<void> }) {
  const dialogs = useDialogs();
  const refresh = useRefresh();
  const [key, setKey] = useState("");
  const [model, setModel] = useState(ai.models.extraction ?? "");
  const [talker, setTalker] = useState(ai.models.conversation ?? "");
  const [painter, setPainter] = useState(ai.models.art ?? "");
  const [style, setStyle] = useState(ai.artStyle);
  const [cap, setCap] = useState(String(ai.monthlyCapUsd));
  const [onPublish, setOnPublish] = useState(ai.proposeOnPublish);
  const [models, setModels] = useState<ModelsResponse["models"] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.models().then(
      (m) => setModels(m.models),
      () => setModels([]),
    );
  }, []);

  async function run(work: () => Promise<Notice>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await work());
      await reload();
      refresh();
    } catch (err) {
      setNotice({ kind: "error", text: message(err) });
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const capUsd = Number(cap);
      if (!Number.isFinite(capUsd) || capUsd < 0) {
        return { kind: "error", text: "The cap is an amount in dollars, such as 10." };
      }
      await api.saveAi({
        ...(key.trim() ? { key: key.trim() } : {}),
        models: {
          extraction: model.trim() || null,
          conversation: talker.trim() || null,
          art: painter.trim() || null,
        },
        ...(style.trim() ? { artStyle: style.trim() } : {}),
        monthlyCapUsd: capUsd,
        proposeOnPublish: onPublish,
      });
      setKey("");
      return { kind: "ok", text: "Saved." };
    });

  const chosen = models?.find((m) => m.id === model.trim());

  return (
    <section className="settings-block">
      <h2>AI</h2>
      <p className="muted">
        Frontier's AI goes through OpenRouter with a key of yours. This month:{" "}
        <strong>{usd(ai.spentUsd)}</strong> of a cap of <strong>{usd(ai.monthlyCapUsd)}</strong>.
        The cap is Frontier's own; set a hard limit on the key at OpenRouter too.
      </p>
      <Note notice={notice} />

      <label className="field">
        <span>
          Provider key{" "}
          <em className="muted">
            {ai.keyFrom === "settings" && `set, ends in ${ai.keyLast4}`}
            {ai.keyFrom === "environment" &&
              `from the server's environment, ends in ${ai.keyLast4}`}
            {ai.keyFrom === "none" && "not set"}
          </em>
        </span>
        {ai.canStoreKey ? (
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={ai.keyFrom === "settings" ? "Enter a new key to replace it" : "sk-or-…"}
            onChange={(e) => setKey(e.target.value)}
          />
        ) : (
          <em className="muted">
            A key cannot be stored here: the server has no SECRETS_KEY. Set SECRETS_KEY (32 bytes in
            base64) in the server's environment, or give the key there as OPENROUTER_API_KEY.
          </em>
        )}
      </label>

      <label className="field">
        <span>Model for proposing fields</span>
        <input
          type="text"
          list="model-list"
          value={model}
          placeholder="Pick from the list or type a model name"
          onChange={(e) => setModel(e.target.value)}
        />
        <datalist id="model-list">
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · ${m.promptPrice} in, ${m.completionPrice} out per million tokens
            </option>
          ))}
        </datalist>
        <em className="muted">
          {chosen
            ? `${chosen.name}: $${chosen.promptPrice} in, $${chosen.completionPrice} out per million tokens.`
            : model.trim()
              ? "Not in the list of models that answer in a fixed form. It may still work; use Test."
              : "No model chosen: proposing fields is off."}
        </em>
      </label>

      <label className="field">
        <span>Model for lore conversations</span>
        <input
          type="text"
          list="model-list"
          value={talker}
          placeholder="Pick from the list or type a model name"
          onChange={(e) => setTalker(e.target.value)}
        />
        <em className="muted">
          {talker.trim()
            ? "Asking the lore and writing help send the question or passage, and the entries looked up for it, to this model."
            : "No model chosen: asking the lore is off."}
        </em>
      </label>

      <label className="field">
        <span>Model for concept art</span>
        <input
          type="text"
          value={painter}
          placeholder="An image model, such as google/gemini-2.5-flash-image"
          onChange={(e) => setPainter(e.target.value)}
        />
        <em className="muted">
          {painter.trim()
            ? "A picture is made only when you ask for one on a discovery. Each costs a few cents."
            : "No model chosen: discoveries have no pictures."}
        </em>
      </label>

      <label className="field">
        <span>Style of concept art</span>
        <textarea rows={3} value={style} onChange={(e) => setStyle(e.target.value)} />
      </label>

      <label className="field">
        <span>Monthly cap in US dollars</span>
        <input
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={onPublish}
          onChange={(e) => setOnPublish(e.target.checked)}
        />
        <span>Propose fields for the entries of each publish</span>
      </label>

      <p className="change-actions">
        <button type="button" className="primary" disabled={busy} onClick={save}>
          Save
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy || ai.keyFrom === "none" || !ai.models.extraction}
          onClick={() =>
            run(async () => {
              const r = await api.testAi();
              return {
                kind: r.ok ? "ok" : "error",
                text: `${r.message} Cost: ${usd(r.costUsd)}.`,
              };
            })
          }
        >
          Test
        </button>
        {ai.keyFrom === "settings" && (
          <button
            type="button"
            className="plain danger"
            disabled={busy}
            onClick={async () => {
              const ok = await dialogs.confirm({
                title: "Remove the provider key?",
                body: "AI features stop until a key is entered again.",
                action: "Remove",
                danger: true,
              });
              if (ok)
                void run(async () => {
                  await api.saveAi({ key: null });
                  return { kind: "ok", text: "The key was removed." };
                });
            }}
          >
            Remove the key
          </button>
        )}
      </p>
    </section>
  );
}

function SignIn({
  signIn,
  reload,
}: {
  signIn: SettingsResponse["signIn"];
  reload: () => Promise<void>;
}) {
  const dialogs = useDialogs();
  const [notice, setNotice] = useState<Notice>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

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
      <h2>Signing in</h2>
      <p className="muted">
        A passkey logs you in with this device's fingerprint, face or screen lock instead of the
        password. Once one works you can switch the password off.
      </p>
      <Note notice={notice} />
      {signIn.passkeys.length > 0 && (
        <ul className="passkeys">
          {signIn.passkeys.map((p) => (
            <li key={p.id}>
              <span>
                {p.name} <em className="muted">added {new Date(p.addedAt).toLocaleDateString()}</em>
              </span>
              <button
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
              </button>
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
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="change-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || name.trim() === ""}
          onClick={() =>
            run(async () => {
              await api.addPasskey(name.trim());
              setName("");
            }, "The passkey was added. Log out and try it before switching the password off.")
          }
        >
          Add a passkey
        </button>
      </p>
      {signIn.passkeys.length > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={signIn.passwordOff}
            disabled={busy}
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
    </section>
  );
}

function FolderRun({ on }: { on: boolean }) {
  const refresh = useRefresh();
  const [folder, setFolder] = useState("");
  const [estimate, setEstimate] = useState<{ entries: number; estimateUsd: number | null } | null>(
    null,
  );
  const [job, setJob] = useState<FieldJobState>({ state: "none" });
  const [notice, setNotice] = useState<Notice>(null);

  const poll = useCallback(async () => {
    const next = await api.fieldJob().catch(() => null);
    if (next) setJob(next);
    return next;
  }, []);
  useEffect(() => void poll(), [poll]);
  useEffect(() => {
    if (job.state !== "running") return;
    const timer = window.setInterval(async () => {
      const next = await poll();
      if (next && next.state !== "running") refresh();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job.state, poll, refresh]);

  async function ask() {
    setNotice(null);
    try {
      setEstimate(await api.estimateJob(folder.trim()));
    } catch (err) {
      setNotice({ kind: "error", text: message(err) });
    }
  }

  async function start() {
    setNotice(null);
    try {
      await api.startJob(folder.trim());
      setEstimate(null);
      await poll();
    } catch (err) {
      setNotice({ kind: "error", text: message(err) });
    }
  }

  return (
    <section className="settings-block">
      <h2>Propose fields for a folder</h2>
      <p className="muted">
        Reads every published entry in a folder, one at a time, and puts what it finds in the inbox.
        Nothing is written to an entry until you accept it there.
      </p>
      <Note notice={notice} />
      {!on && <p className="muted">Set a key and a model above first.</p>}
      <label className="field">
        <span>Folder</span>
        <input
          type="text"
          value={folder}
          placeholder="Such as 03 Gazetteer (Places & Locations); empty for the whole vault"
          onChange={(e) => {
            setFolder(e.target.value);
            setEstimate(null);
          }}
        />
      </label>
      {estimate && (
        <p>
          {estimate.entries} {estimate.entries === 1 ? "entry" : "entries"}. Estimated cost:{" "}
          {estimate.estimateUsd === null
            ? "unknown, because the model's price is not in the list"
            : `about ${usd(estimate.estimateUsd)}`}
          . Entries read before cost nothing again.
        </p>
      )}
      <p className="change-actions">
        {!estimate ? (
          <button
            type="button"
            className="quiet"
            disabled={!on || job.state === "running"}
            onClick={ask}
          >
            Estimate
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={estimate.entries === 0}
            onClick={start}
          >
            Start
          </button>
        )}
        {job.state === "running" && (
          <button type="button" className="plain danger" onClick={() => api.cancelJob().then(poll)}>
            Cancel
          </button>
        )}
      </p>
      {job.state !== "none" && (
        <div className="job" role="status">
          <p>
            {job.state === "running" && "Running: "}
            {job.state === "done" && "Finished: "}
            {job.state === "cancelled" && "Cancelled: "}
            {job.state === "stopped" && "Stopped: "}
            {job.done} of {job.total} entries read in “{job.folder || "the whole vault"}”,{" "}
            {job.made} proposed. {job.made ? <Link to="/inbox">Open the inbox</Link> : null}
          </p>
          {job.stoppedBy && <p className="error">{job.stoppedBy}</p>}
          {(job.failed ?? []).length > 0 && (
            <ul>
              {job.failed!.map((f) => (
                <li key={f.path}>
                  <Link to={entryUrl(f.path)}>{f.path}</Link>
                  <span className="muted">: {f.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Spending() {
  const log = useAsync(() => api.aiLog(), "ai-log");
  if (log.state === "failed") {
    return (
      <section className="settings-block">
        <h2>AI calls this month</h2>
        <Problem reason={log.error.message} onRetry={log.retry} />
      </section>
    );
  }
  if (log.state !== "ready" || log.value.calls.length === 0) return null;
  return (
    <section className="settings-block">
      <h2>AI calls this month</h2>
      {log.reloading && <Progress />}
      {log.error && <Problem reason={log.error.message} onRetry={log.retry} />}
      <div className="table-scroll">
        <table className="calls">
          <thead>
            <tr>
              <th>When</th>
              <th>Entry</th>
              <th>Model</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {log.value.calls.map((c, i) => (
              <tr key={i} className={c.ok ? "" : "failed"}>
                <td>{new Date(c.at).toLocaleString()}</td>
                <td>{c.entry ? c.entry.split("/").pop()!.replace(/\.md$/i, "") : c.task}</td>
                <td>{c.model}</td>
                <td title={c.error}>{c.ok ? usd(c.costUsd) : "failed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Schema() {
  const schema = useAsync(() => api.schema(), "schema");
  if (schema.state === "failed") {
    return (
      <section className="settings-block">
        <h2>Types and dates</h2>
        <Problem reason={schema.error.message} onRetry={schema.retry} />
      </section>
    );
  }
  if (schema.state !== "ready") return null;
  return (
    <section className="settings-block">
      <h2>Types and dates</h2>
      {schema.reloading && <Progress />}
      {schema.error && <Problem reason={schema.error.message} onRetry={schema.retry} />}
      <p className="muted">
        {schema.value.builtIn
          ? "Frontier's built-in list is in use. To change it, save this text in the vault as .frontier/schema.yaml and edit it there."
          : "The list comes from .frontier/schema.yaml in the vault."}
      </p>
      {schema.value.problem && <p className="error">{schema.value.problem}</p>}
      <details>
        <summary>Show the list</summary>
        <pre className="schema-text">{schema.value.text}</pre>
      </details>
    </section>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSettings(await api.settings());
    } catch (err) {
      setError(message(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (!settings) {
    return error ? (
      <div className="center">
        <Problem
          reason={error}
          onRetry={() => {
            setError(null);
            void load();
          }}
        />
      </div>
    ) : (
      <p className="center muted">Loading…</p>
    );
  }
  const on = settings.ai.keySet && settings.ai.models.extraction !== null;
  return (
    <article className="entry wide settings">
      <header className="entry-head">
        <h1>Settings</h1>
      </header>
      <AiSettings ai={settings.ai} reload={load} />
      <FolderRun on={on} />
      <Spending />
      <Schema />
      <SignIn signIn={settings.signIn} reload={load} />
    </article>
  );
}
