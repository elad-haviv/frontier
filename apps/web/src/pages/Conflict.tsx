import type { PublishPlan } from "@frontier/schema";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiFailure } from "../api.ts";
import { CodeEditor } from "../components/CodeEditor.tsx";
import { Diff } from "../components/Diff.tsx";

type Conflict = PublishPlan["conflicts"][number];

/** The author's version beside the vault's, for him to combine by hand. Nothing is merged for him. */
export function ConflictPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const conflict = (useLocation().state as { conflict?: Conflict } | null)?.conflict;
  const text = useRef(conflict?.mine ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(0);

  if (!conflict) {
    return (
      <div className="center">
        <p className="muted">Open this from the review of your unpublished changes.</p>
        <Link to="/unpublished">Unpublished changes</Link>
      </div>
    );
  }

  async function save() {
    setBusy(true);
    try {
      await api.resolve(id, text.current);
      navigate("/unpublished");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Could not save.");
      setBusy(false);
    }
  }

  async function discard() {
    if (!window.confirm("Discard your version and keep what is in the vault?")) return;
    await api.discardDraft(id).catch(() => undefined);
    navigate("/unpublished");
  }

  return (
    <article className="entry wide">
      <header className="entry-head">
        <p className="crumbs">{conflict.path}</p>
        <h1>Resolve</h1>
        <p className="muted lede">
          Edit your version below until it is the text you want, taking what you need from the
          vault's version. Saving does not publish; it marks your text as building on the vault's.
        </p>
      </header>
      {error && <p className="banner">{error}</p>}

      <h3>In the vault now, compared with your version</h3>
      {conflict.theirs === null ? (
        <p className="muted">The file no longer exists in the vault. Saving will add it back.</p>
      ) : (
        <Diff before={conflict.mine} after={conflict.theirs} />
      )}

      <h3>Your version</h3>
      <div className="boxed">
        <CodeEditor key={seed} initial={text.current} onChange={(t) => (text.current = t)} />
      </div>

      <p className="plan-actions">
        <button type="button" className="quiet" onClick={discard}>
          Discard mine
        </button>
        {conflict.theirs !== null && (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              text.current = conflict.theirs!;
              setSeed(seed + 1);
            }}
          >
            Start from the vault's
          </button>
        )}
        <button type="button" className="primary big" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save as resolved"}
        </button>
      </p>
    </article>
  );
}
