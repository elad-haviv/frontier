import { Link } from "react-router-dom";
import { api, historyUrl } from "../../api.ts";
import { failureOf, useAsync } from "../../useAsync.ts";
import { Problem } from "../ui/Problem.tsx";
import { useWords } from "../Shell.tsx";
import "./HistoryPanel.css";

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The History tab: the saved versions that changed the entry, newest first, each with its date
 * and the first line of what was said about it. Each opens the History page at that version,
 * where it can be compared and restored. Git follows the entry across saved renames; a rename
 * not yet saved is not in it.
 */
export function HistoryPanel({ path }: { path: string }) {
  const words = useWords();
  const history = useAsync(() => api.history(path), `history-${path}`);
  const failed = failureOf(history);
  return (
    <div className="history-panel">
      {history.state === "loading" && <p className="muted">Loading…</p>}
      {failed && <Problem reason={failed.message} onRetry={history.retry} />}
      {history.state === "ready" && history.value.versions.length === 0 && (
        <p className="muted">
          No saved version yet: it is in the history once you{" "}
          {words.own ? "save a version" : "publish"}.
        </p>
      )}
      {history.state === "ready" && history.value.versions.length > 0 && (
        <ol className="history-list">
          {history.value.versions.map((v) => (
            <li key={v.commit}>
              <Link className="history-item" to={`${historyUrl(path)}?v=${v.commit}`}>
                <span className="history-when">{when(v.at)}</span>
                <span className="history-what">{v.message.split("\n")[0]}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
