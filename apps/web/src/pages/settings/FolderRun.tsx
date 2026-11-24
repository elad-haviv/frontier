import type { FieldJobState } from "@frontier/schema";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, entryUrl } from "../../api.ts";
import { useRefresh } from "../../components/Shell.tsx";
import { eachFolder } from "../../components/tree/model.ts";
import { ActionButton } from "../../components/ui/ActionButton.tsx";
import { Combobox, type ComboboxOption } from "../../components/ui/Combobox.tsx";
import { useAsync } from "../../useAsync.ts";
import { message, usd, useSettingsData } from "./shared.tsx";

const WHOLE = "The whole library";

/** Proposing fields for every published entry of a folder, in the background. */
export function FolderRun() {
  const refresh = useRefresh();
  const { settings } = useSettingsData();
  const on = settings ? settings.ai.models.extraction !== null : false;
  const label = useId();
  const tree = useAsync(() => api.tree(), "settings-folders");
  const [folder, setFolder] = useState("");
  const [estimate, setEstimate] = useState<{ entries: number; estimateUsd: number | null } | null>(
    null,
  );
  const [job, setJob] = useState<FieldJobState>({ state: "none" });
  const [error, setError] = useState<string | null>(null);

  const options = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: WHOLE },
      ...(tree.state === "ready"
        ? eachFolder(tree.value).map((f) => ({ value: f.path, label: f.path }))
        : []),
    ],
    [tree],
  );

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
    setError(null);
    try {
      setEstimate(await api.estimateJob(folder));
    } catch (err) {
      setError(message(err));
    }
  }

  async function start() {
    setError(null);
    try {
      await api.startJob(folder);
      setEstimate(null);
      await poll();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <section className="settings-block">
      <p className="muted">
        Reads every published entry in a folder, one at a time, and puts what it finds in the inbox.
        Nothing is written to an entry until you accept it there.
      </p>
      {!on && (
        <p className="settings-note">
          <Link to="/settings/ai/models/extraction">
            Choose a model for proposing fields first.
          </Link>
        </p>
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
          <ActionButton
            type="button"
            className="quiet"
            disabled={!on || job.state === "running"}
            onClick={ask}
          >
            Estimate
          </ActionButton>
        ) : (
          <ActionButton
            type="button"
            className="primary"
            disabled={estimate.entries === 0}
            onClick={start}
          >
            Start
          </ActionButton>
        )}
        {job.state === "running" && (
          <ActionButton
            type="button"
            className="plain danger"
            onClick={() => api.cancelJob().then(poll)}
          >
            Cancel
          </ActionButton>
        )}
      </p>
      {job.state !== "none" && (
        <div className="job" role="status">
          <p>
            {job.state === "running" && "Running: "}
            {job.state === "done" && "Finished: "}
            {job.state === "cancelled" && "Cancelled: "}
            {job.state === "stopped" && "Stopped: "}
            {job.done} of {job.total} entries read in “{job.folder || "the whole library"}”,{" "}
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
