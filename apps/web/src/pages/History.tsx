import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiFailure, entryUrl, historyUrl, newDraftId, type Version } from "../api.ts";
import { Diff } from "../components/Diff.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { useAsync } from "../useAsync.ts";

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** What one version did to a file, fetched when the author opens it, with a way to bring it back. */
function VersionRow({
  version,
  current,
  latest,
  onRestored,
}: {
  version: Version;
  /** The file's path today. */
  current: string;
  latest: boolean;
  onRestored: () => void;
}) {
  // The file may have had another name at this version.
  const then = version.paths.find((p) => p.endsWith(".md")) ?? current;
  const [texts, setTexts] = useState<{ text: string; before: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load(open: boolean) {
    if (!open || texts) return;
    api
      .versionText(then, version.commit)
      .then(setTexts, (err: unknown) =>
        setError(err instanceof ApiFailure ? err.message : "This version could not be read."),
      );
  }

  async function restore() {
    if (!texts) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await api.entry(current);
      if (entry.draft) {
        setError("This entry has unsaved changes. Save or discard them first.");
        return;
      }
      await api.saveDraft({
        id: newDraftId(),
        path: current,
        kind: "edit",
        text: texts.text,
        revision: 0,
      });
      onRestored();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The version could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <p className="change-head">
        <span className="version-when">{when(version.at)}</span>
        <span className="change-path">{version.message}</span>
      </p>
      {then !== current && <p className="muted">Then named {then}.</p>}
      <details onToggle={(e) => load(e.currentTarget.open)}>
        <summary>Show what changed</summary>
        {error && <p className="error">{error}</p>}
        {!texts && !error && <p className="muted">Loading…</p>}
        {texts && <Diff before={texts.before ?? ""} after={texts.text} />}
        {texts && !latest && (
          <p className="change-actions">
            <button type="button" className="quiet" disabled={busy} onClick={restore}>
              Restore this version
            </button>
          </p>
        )}
      </details>
    </li>
  );
}

/** Every saved version of one entry, newest first. */
export function HistoryPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const path = pathname
    .slice("/history/".length)
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
  const history = useAsync(() => api.history(path), `history-${path}`);
  const name = (path.split("/").pop() ?? path).replace(/\.md$/i, "");

  return (
    <article className="entry wide">
      <header className="entry-head">
        <h1>History of {name}</h1>
        <p className="muted lede">
          Every saved version that changed this entry. Restoring one puts its text into a draft;
          nothing in between is lost. <Link to={entryUrl(path)}>Back to the entry</Link>
        </p>
      </header>
      {history.state === "loading" && <p className="muted">Loading…</p>}
      {history.state === "failed" && <p className="error">{history.error.message}</p>}
      {history.state === "ready" && history.value.versions.length === 0 && (
        <p className="empty">This entry has no saved version yet.</p>
      )}
      {history.state === "ready" && (
        <ul className="changes versions">
          {history.value.versions.map((v, i) => (
            <VersionRow
              key={v.commit}
              version={v}
              current={path}
              latest={i === 0}
              onRestored={() => {
                refresh();
                navigate(entryUrl(path));
              }}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

/** The versions of the whole library, with the files each changed. */
export function LibraryHistoryPage() {
  const history = useAsync(() => api.history(), "library-history");
  return (
    <article className="entry wide">
      <header className="entry-head">
        <h1>Versions</h1>
        <p className="muted lede">
          The last hundred saved versions of the library.{" "}
          <a href="/api/export/library.zip">Export the library as a zip</a>
        </p>
      </header>
      {history.state === "loading" && <p className="muted">Loading…</p>}
      {history.state === "failed" && <p className="error">{history.error.message}</p>}
      {history.state === "ready" && (
        <ul className="changes versions">
          {history.value.versions.map((v) => (
            <li key={v.commit}>
              <p className="change-head">
                <span className="version-when">{when(v.at)}</span>
                <span className="change-path">{v.message}</span>
              </p>
              <details>
                <summary>
                  {v.paths.length} {v.paths.length === 1 ? "file" : "files"}
                </summary>
                <ul className="version-files">
                  {v.paths.slice(0, 200).map((p) => (
                    <li key={p}>{p.endsWith(".md") ? <Link to={historyUrl(p)}>{p}</Link> : p}</li>
                  ))}
                  {v.paths.length > 200 && (
                    <li className="muted">and {v.paths.length - 200} more</li>
                  )}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
