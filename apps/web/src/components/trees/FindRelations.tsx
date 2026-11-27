import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../../api.ts";
import { forgetRun, runFolder, type RunProgress } from "../../folderRun.ts";
import { useNavigate } from "../../nav.tsx";
import { projectWork } from "../../projectWork.ts";
import { reloadRelations } from "../../trees/data.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { useRefresh } from "../Shell.tsx";

const WHOLE = "";

type Shown = RunProgress & { end: "running" | "done" | "cancelled" | "stopped"; why?: string };

/**
 * Find relations (stage 33): has the AI read a folder (or the whole library) for relations, with
 * the number of entries and the cost said first. It is the run of Settings › Propose for a folder
 * (stage 31f), done by this browser one entry at a time with this device's key, so dates and types
 * are proposed too, and it goes on only while the dialog is open. What is left is kept on this
 * device and can be continued in Settings.
 */
export function FindRelations({ onClose, unread }: { onClose: () => void; unread: number }) {
  const refresh = useRefresh();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState(WHOLE);
  const [estimate, setEstimate] = useState<{
    paths: string[];
    entries: number;
    estimateUsd: number | null;
  } | null>(null);
  const [model, setModel] = useState<string | null | undefined>(undefined);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    api.tree().then(
      (t) => setFolders(t.folders.map((f) => f.path).filter((p) => !p.startsWith("99 "))),
      () => undefined,
    );
    api.settings().then(
      (s) => setModel(s.ai.models.extraction?.replace(/^[a-z]+:/, "") ?? null),
      () => setModel(null),
    );
    // Closing the dialog ends the run between two entries; the rest is kept for Settings.
    return () => stop.current?.abort();
  }, []);

  useEffect(() => {
    if (shown) return;
    setEstimate(null);
    api
      .listJob(folder)
      .then(setEstimate, (err: unknown) =>
        setError(err instanceof ApiFailure ? err.message : "The entries could not be counted."),
      );
  }, [folder, shown]);

  async function start() {
    if (!estimate || estimate.paths.length === 0) return;
    setError(null);
    const controller = new AbortController();
    stop.current = controller;
    const first: RunProgress = {
      folder,
      total: estimate.paths.length,
      done: 0,
      made: 0,
      failed: [],
    };
    setShown({ ...first, end: "running" });
    // Every entry is read in the project the run began in.
    const work = projectWork();
    const end = await runFolder(
      first,
      estimate.paths,
      (path) => work.api.proposeFields(path),
      controller.signal,
      (p) => setShown((now) => (now ? { ...now, ...p } : now)),
    );
    if (stop.current === controller) stop.current = null;
    setShown((now) =>
      now ? { ...now, end: end.state, ...(end.state === "stopped" ? { why: end.why } : {}) } : now,
    );
    refresh();
    await reloadRelations();
  }

  const n = estimate?.entries ?? 0;
  const running = shown?.end === "running";
  const on = model !== null;

  return (
    <DialogFrame
      title={
        shown && !running
          ? "Done reading"
          : running
            ? "Reading your entries…"
            : "Find relations in your entries"
      }
      onCancel={onClose}
      onSubmit={() => (shown ? onClose() : void start())}
      initialFocus={select}
      className="tr-find-dialog"
    >
      {!shown && (
        <>
          <p className="dialog-body">
            Frontier&rsquo;s AI reads each entry&rsquo;s published text and proposes the relations
            it states, with the sentence each came from. Nothing changes until you accept it.
          </p>
          {!on && model !== undefined && (
            <p className="error">Choose a model for proposing fields in Settings first.</p>
          )}
          <label className="dialog-field">
            Read the entries in
            <select ref={select} value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value={WHOLE}>The whole library</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <div className="tr-cost">
            <div>
              <b>{estimate ? n : "…"}</b>
              <span>
                entries to read.
                {unread > 0
                  ? " The first run reads all of them, even entries read before for dates."
                  : ""}
              </span>
            </div>
            <div>
              <b>
                {estimate?.estimateUsd != null
                  ? `about $${estimate.estimateUsd.toFixed(2)}`
                  : "price unknown"}
              </b>
              <span>
                {model
                  ? `with ${model}, on this device's key.`
                  : "with your Proposing fields model."}
              </span>
            </div>
          </div>
          <p className="tr-muted">
            Dates and types are proposed as well, as Propose fields does. Expect about{" "}
            {Math.round(n * 1.5)} proposals to review
            {n > 100 ? "; the inbox can show one folder or one tree at a time" : ""}. Keep this open
            while it reads.
          </p>
        </>
      )}
      {shown && (
        <>
          <div
            className="tr-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={shown.total}
            aria-valuenow={shown.done}
          >
            <i style={{ width: `${Math.round((shown.done / Math.max(1, shown.total)) * 100)}%` }} />
          </div>
          <p className="tr-muted" role="status">
            {running
              ? `${shown.done} of ${shown.total} · ${shown.made} proposals so far. Keep this open while it reads; if you close it, what is left can be continued in Settings › Propose for a folder.`
              : shown.end === "stopped"
                ? `Stopped after ${shown.done} of ${shown.total}: ${shown.why ?? "the run stopped"}.`
                : shown.end === "cancelled"
                  ? `Stopped after ${shown.done} of ${shown.total}. What is left can be continued in Settings › Propose for a folder.`
                  : shown.made === 0
                    ? `No relations or dates found in ${shown.total} entries.`
                    : `Found ${shown.made} proposals in ${shown.total} entries. They wait in the inbox, and show in your trees with a ? until you decide.`}
            {shown.failed.length > 0 && ` ${shown.failed.length} entries could not be read.`}
          </p>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="dialog-actions">
        {running && (
          <button type="button" className="quiet" onClick={() => stop.current?.abort()}>
            Stop
          </button>
        )}
        <button
          type="button"
          className="quiet"
          onClick={() => {
            if (shown && shown.end === "done") forgetRun();
            onClose();
          }}
        >
          {shown ? "Close" : "Cancel"}
        </button>
        {!shown && (
          <button type="submit" className="primary" disabled={!estimate || n === 0 || !on}>
            Read {n} {n === 1 ? "entry" : "entries"}
          </button>
        )}
        {shown && !running && shown.made > 0 && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              onClose();
              navigate("/inbox");
            }}
          >
            Review in the inbox
          </button>
        )}
      </p>
    </DialogFrame>
  );
}
