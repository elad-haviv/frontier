import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "../../nav.tsx";
import { api, entryUrl } from "../../api.ts";
import { useRefresh } from "../../components/Shell.tsx";
import { eachFolder } from "../../components/tree/model.ts";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { Combobox, type ComboboxOption } from "../../components/ui/Combobox.tsx";
import { forgetRun, runFolder, runLeft, type RunLeft, type RunProgress } from "../../folderRun.ts";
import { useAsync } from "../../useAsync.ts";
import { message, usd, useSettingsData } from "./shared.tsx";
import { projectWork } from "../../projectWork.ts";

const WHOLE = "The whole library";

/** What the page shows of a run: how far it is, and how it ended. */
interface Shown extends RunProgress {
  end: "running" | "done" | "cancelled" | "stopped" | "left";
  why?: string;
}

/**
 * Proposing fields for every published entry of a folder. The browser does the run, one entry at a
 * time with this device's key, so it goes on only while this page is open. Leave the page and it
 * stops; what was left is kept on this device, and offered again here to carry on.
 */
export function FolderRun() {
  const refresh = useRefresh();
  const { settings } = useSettingsData();
  const on = settings ? settings.ai.models.extraction !== null : false;
  const label = useId();
  const tree = useAsync(() => api.tree(), "settings-folders");
  const [folder, setFolder] = useState("");
  const [estimate, setEstimate] = useState<{
    paths: string[];
    entries: number;
    estimateUsd: number | null;
  } | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [left, setLeft] = useState<RunLeft | null>(() => runLeft());
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);

  const options = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: WHOLE },
      ...(tree.state === "ready"
        ? eachFolder(tree.value).map((f) => ({ value: f.path, label: f.path }))
        : []),
    ],
    [tree],
  );

  // Leaving the page ends the run between two entries; the rest is kept for next time.
  useEffect(() => () => stop.current?.abort(), []);

  async function ask() {
    setError(null);
    try {
      setEstimate(await api.listJob(folder));
    } catch (err) {
      setError(message(err));
    }
  }

  async function go(start: RunProgress, paths: string[]) {
    setError(null);
    setEstimate(null);
    setLeft(null);
    const controller = new AbortController();
    stop.current = controller;
    setShown({ ...start, end: "running" });
    // Every entry is read in the project the run began in, however long it takes.
    const work = projectWork();
    const end = await runFolder(
      start,
      paths,
      (path) => work.api.proposeFields(path),
      controller.signal,
      (p) => setShown((now) => (now ? { ...now, ...p } : now)),
    );
    if (stop.current === controller) stop.current = null;
    setShown((now) =>
      now ? { ...now, end: end.state, ...(end.state === "stopped" ? { why: end.why } : {}) } : now,
    );
    setLeft(runLeft());
    refresh();
  }

  const start = () =>
    estimate &&
    void go({ folder, total: estimate.paths.length, done: 0, made: 0, failed: [] }, estimate.paths);

  const running = shown?.end === "running";

  return (
    <section className="settings-block">
      <p className="muted">
        Reads every published entry in a folder, one at a time, and puts what it finds in the inbox.
        Nothing is written to an entry until you accept it there. It goes on only while this page is
        open.
      </p>
      {!on && (
        <p className="settings-note">
          <Link to="/settings/you/ai-models/extraction">
            Choose a model for proposing fields first.
          </Link>
        </p>
      )}
      {left && !running && (
        <div className="settings-note" role="status">
          <p>
            A run over “{left.folder || "the whole library"}” was left at {left.done} of{" "}
            {left.total} entries.
          </p>
          <p className="change-actions">
            <ActionButton
              type="button"
              className="primary"
              disabled={!on}
              onClick={() => void go(left, left.remaining)}
            >
              Continue ({left.remaining.length} left)
            </ActionButton>
            <button
              type="button"
              className="plain"
              onClick={() => {
                forgetRun();
                setLeft(null);
              }}
            >
              Forget it
            </button>
          </p>
        </div>
      )}
      <div className="field">
        <span id={label}>Folder</span>
        <Combobox
          labelledBy={label}
          options={options}
          value={folder}
          onChange={(v) => {
            setFolder(v);
            setEstimate(null);
          }}
          findLabel="Find a folder"
          empty="No folder has that name."
        />
      </div>
      {error && <p className="field-error">{error}</p>}
      {estimate && (
        <p>
          {estimate.entries} {estimate.entries === 1 ? "entry" : "entries"}. Estimated cost:{" "}
          {estimate.estimateUsd === null
            ? "unknown, because the model's price is not known"
            : `about ${usd(estimate.estimateUsd)}`}
          . Entries read before cost nothing again.
        </p>
      )}
      <p className="change-actions">
        {!estimate ? (
          <ActionButton type="button" className="quiet" disabled={!on || running} onClick={ask}>
            Estimate
          </ActionButton>
        ) : (
          <ActionButton
            type="button"
            className="primary"
            disabled={estimate.entries === 0 || running}
            onClick={start}
          >
            Start
          </ActionButton>
        )}
        {running && (
          <ActionButton
            type="button"
            className="plain danger"
            onClick={() => stop.current?.abort()}
          >
            Stop
          </ActionButton>
        )}
      </p>
      {shown && (
        <div className="job" role="status">
          <p>
            {shown.end === "running" && "Running: "}
            {shown.end === "done" && "Finished: "}
            {shown.end === "cancelled" && "Stopped: "}
            {shown.end === "stopped" && "Stopped: "}
            {shown.done} of {shown.total} entries read in “{shown.folder || "the whole library"}”,{" "}
            {shown.made} proposed. {shown.made ? <Link to="/inbox">Open the inbox</Link> : null}
          </p>
          {shown.end === "running" && (
            <p className="muted">Keep this page open: the run stops when you leave it.</p>
          )}
          {shown.why && <p className="error">{shown.why}</p>}
          {shown.failed.length > 0 && (
            <ul>
              {shown.failed.map((f) => (
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
