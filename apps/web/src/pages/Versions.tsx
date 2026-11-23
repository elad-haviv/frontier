import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { KeptCopyText } from "@frontier/schema";
import { api, ApiFailure } from "../api.ts";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { Diff } from "../components/Diff.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { queue } from "../sync/queue.ts";
import "./Versions.css";

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The name a kept copy is shown under. */
function deviceLabel(copy: KeptCopyText, self: string | undefined): string {
  if (copy.device === self) return "This device";
  if (copy.deviceName) return copy.deviceName;
  if (copy.device === "earlier") return "A device, before this version of Frontier";
  return "Another device";
}

/**
 * A draft and the texts kept beside it from devices that started from older text. The author
 * compares the draft with each in turn and keeps one, or combines them by hand. Keeping clears
 * every kept copy.
 */
export function VersionsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [data, setData] = useState<{ current: string; others: KeptCopyText[] } | null>(null);
  const [chosen, setChosen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = useRef("");
  const self = queue.device?.id;

  useEffect(() => {
    api.versions(id).then(
      (v) => {
        text.current = v.current.text;
        setData({ current: v.current.text, others: v.others });
      },
      (err: unknown) => setError(err instanceof ApiFailure ? err.message : "Could not load."),
    );
  }, [id]);

  async function keep(kept: string) {
    setBusy(true);
    setError(null);
    try {
      await api.mergeVersions(id, kept);
      refresh();
      navigate("/unpublished");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  if (error && !data) return <p className="center error">{error}</p>;
  if (!data) return <p className="center muted">Loading…</p>;
  const copy = data.others[chosen] ?? data.others[0]!;
  const count = data.others.length + 1;
  const from = deviceLabel(copy, self);

  return (
    <article className="entry wide versions-page">
      <header className="entry-head">
        <h1>{count === 2 ? "Two texts to compare" : `${count} texts to compare`}</h1>
        <p className="muted lede">
          This entry was changed on more than one device, and a device's text started from an older
          one. Nothing was lost: each device's text is kept beside the draft. Keep one, or combine
          them below; the kept texts are then cleared.
        </p>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data.others.length > 1 && (
        <div className="kept-copies" role="group" aria-label="Kept texts">
          {data.others.map((o, i) => (
            <button
              key={o.device}
              type="button"
              className="quiet"
              aria-pressed={i === chosen}
              onClick={() => setChosen(i)}
            >
              {deviceLabel(o, self)} <span className="muted">{when(o.savedAt)}</span>
            </button>
          ))}
        </div>
      )}
      <h3>
        The text from {from === "This device" ? "this device" : from},{" "}
        <span className="muted">{when(copy.savedAt)}</span>, compared with the draft
      </h3>
      <Diff before={data.current} after={copy.text} />
      <p className="plan-actions">
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => void keep(copy.text)}
        >
          Keep this one
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => void keep(data.current)}
        >
          Keep the draft
        </button>
      </p>
      <h3>Or combine them by hand</h3>
      <div className="boxed">
        <CodeEditor initial={data.current} onChange={(t) => (text.current = t)} />
      </div>
      <p className="plan-actions">
        <button
          type="button"
          className="primary big"
          disabled={busy}
          onClick={() => void keep(text.current)}
        >
          Keep this text
        </button>
      </p>
    </article>
  );
}
