import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FieldJobState } from "@frontier/schema";
import { api, ApiFailure } from "../../api.ts";
import { reloadRelations } from "../../trees/data.ts";
import { DialogFrame } from "../Dialogs.tsx";
import { useRefresh } from "../Shell.tsx";

const WHOLE = "";

/**
 * Find relations (stage 31): has the AI read a folder (or the whole library) for relations, with
 * the number of entries and the cost said first. It is the same run as Settings › Propose for a
 * folder, so dates and types are proposed too; it keeps going if the dialog is closed.
 */
export function FindRelations({ onClose, unread }: { onClose: () => void; unread: number }) {
  const refresh = useRefresh();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState(WHOLE);
  const [estimate, setEstimate] = useState<{ entries: number; estimateUsd: number | null } | null>(
    null,
  );
  const [money, setMoney] = useState<{ model: string | null; left: number | null }>({
    model: null,
    left: null,
  });
  const [job, setJob] = useState<FieldJobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    api.tree().then(
      (t) => {
        const top = t.folders.map((f) => f.path).filter((p) => !p.startsWith("99 "));
        setFolders(top);
      },
      () => undefined,
    );
    api.settings().then(
      (s) =>
        setMoney({
          model: s.ai.models.extraction?.replace(/^[a-z]+:/, "") ?? null,
          left: s.ai.monthlyCapUsd > 0 ? Math.max(0, s.ai.monthlyCapUsd - s.ai.spentUsd) : null,
        }),
      () => undefined,
    );
    // A run already going is shown as it is.
    api.fieldJob().then(
      (j) => {
        if (j.state === "running") {
          setJob(j);
          setStarted(true);
        }
      },
      () => undefined,
    );
    return () => window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (started) return;
    setEstimate(null);
    api
      .estimateJob(folder)
      .then(setEstimate, (err: unknown) =>
        setError(err instanceof ApiFailure ? err.message : "The entries could not be counted."),
      );
  }, [folder, started]);

  useEffect(() => {
    if (!started) return;
    const poll = async () => {
      try {
        const j = await api.fieldJob();
        setJob(j);
        if (j.state === "running") timer.current = window.setTimeout(() => void poll(), 1000);
        else {
          refresh();
          await reloadRelations();
        }
      } catch {
        timer.current = window.setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => window.clearTimeout(timer.current);
  }, [started]);

  async function start() {
    setError(null);
    try {
      await api.startJob(folder);
      setStarted(true);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The run could not start.");
    }
  }

  const n = estimate?.entries ?? 0;
  const running = job?.state === "running";
  const done = started && job && !running;

  return (
    <DialogFrame
      title={
        done ? "Done reading" : running ? "Reading your entries…" : "Find relations in your entries"
      }
      onCancel={onClose}
      onSubmit={() => (started ? onClose() : void start())}
      initialFocus={select}
      className="tr-find-dialog"
    >
      {!started && (
        <>
          <p className="dialog-body">
            Frontier&rsquo;s AI reads each entry&rsquo;s published text and proposes the relations
            it states, with the sentence each came from. Nothing changes until you accept it.
          </p>
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
                {money.model ? `with ${money.model}` : "with your Proposing fields model"}
                {money.left !== null
                  ? `. $${money.left.toFixed(2)} of this month's cap is left.`
                  : "."}
              </span>
            </div>
          </div>
          <p className="tr-muted">
            Dates and types are proposed as well, as Propose fields does. Expect about{" "}
            {Math.round(n * 1.5)} proposals to review
            {n > 100 ? "; the inbox can show one folder or one tree at a time" : ""}.
          </p>
        </>
      )}
      {started && job && (
        <>
          <div
            className="tr-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={job.total ?? 1}
            aria-valuenow={job.done ?? 0}
          >
            <i
              style={{
                width: `${Math.round(((job.done ?? 0) / Math.max(1, job.total ?? 1)) * 100)}%`,
              }}
            />
          </div>
          <p className="tr-muted" role="status">
            {running
              ? `${job.done ?? 0} of ${job.total ?? "?"} · ${job.made ?? 0} proposals so far. You can close this; it keeps going, and Settings › Propose for a folder shows it too.`
              : job.state === "stopped"
                ? `Stopped after ${job.done ?? 0} of ${job.total ?? "?"}: ${job.stoppedBy ?? "the run stopped"}.`
                : (job.made ?? 0) === 0
                  ? `No relations or dates found in ${job.total ?? 0} entries.`
                  : `Found ${job.made} proposals in ${job.total ?? 0} entries. They wait in the inbox, and show in your trees with a ? until you decide.`}
            {(job.failed?.length ?? 0) > 0 && ` ${job.failed!.length} entries could not be read.`}
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
          <button
            type="button"
            className="quiet"
            onClick={() => void api.cancelJob().then(() => undefined)}
          >
            Stop
          </button>
        )}
        <button type="button" className="quiet" onClick={onClose}>
          {started ? "Close" : "Cancel"}
        </button>
        {!started && (
          <button type="submit" className="primary" disabled={!estimate || n === 0}>
            Read {n} {n === 1 ? "entry" : "entries"}
          </button>
        )}
        {done && (job.made ?? 0) > 0 && (
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
