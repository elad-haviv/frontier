import { type FormEvent, useState } from "react";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Link, useNavigate } from "../nav.tsx";
import { api, ApiFailure, chronicleUrl } from "../api.ts";
import { useRefresh } from "../components/Shell.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { failureOf, useAsync } from "../useAsync.ts";

const STATE: Record<string, string> = {
  new: "not saved as a version yet",
  unpublished: "unsaved changes",
};

/** The list of chronicles, and the form that makes a new one. */
export function ChroniclesPage() {
  const list = useAsync(() => api.chronicles(), "chronicles");
  const navigate = useNavigate();
  const refresh = useRefresh();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createChronicle(title.trim());
      refresh();
      navigate(chronicleUrl(id));
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The chronicle could not be made.");
      setBusy(false);
    }
  }

  return (
    <article className="entry wide maps">
      <header className="entry-head">
        <h1>Chronicles</h1>
        <p className="muted lede">
          A chronicle is a workbench for one version of a history: what comes before what, what
          overlaps, and roughly how long things last. Its numbers are working numbers, not lore.
        </p>
      </header>

      {list.state === "loading" && <p className="muted">Loading…</p>}
      {list.reloading && <Progress />}
      {failureOf(list) && <Problem reason={failureOf(list)!.message} onRetry={list.retry} />}
      {list.state === "ready" && (
        <>
          {list.value.chronicles.length === 0 && (
            <p className="empty">No chronicles yet. Make the first below.</p>
          )}
          <ul className="map-list">
            {list.value.chronicles.map((c) => (
              <li key={c.id}>
                <Link to={chronicleUrl(c.id)}>{c.title}</Link>
                <span className="muted">
                  {c.spans} {c.spans === 1 ? "span" : "spans"}
                  {c.main ? " · the main chronicle" : ""}
                  {STATE[c.state] ? ` · ${STATE[c.state]}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {list.value.problems.map((p) => (
            <p key={p.path} className="banner" role="alert">
              {p.path} is not shown as a chronicle. {p.message}
            </p>
          ))}
        </>
      )}

      <form className="settings-block new-map settings" onSubmit={create}>
        <h2>New chronicle</h2>
        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="change-actions">
          <ActionButton type="submit" className="primary" disabled={busy || !title.trim()}>
            Make the chronicle
          </ActionButton>
        </p>
      </form>
    </article>
  );
}
