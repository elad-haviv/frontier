import { type FormEvent, useState } from "react";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiFailure, entryUrl } from "../api.ts";
import { useRefresh } from "../components/Shell.tsx";

function pathFrom(pathname: string): string {
  return pathname
    .slice("/rename/".length)
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
}

/** Rename an entry or move it to another folder. Links to it are rewritten when it is published. */
export function RenamePage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const from = pathFrom(pathname);
  const slash = from.lastIndexOf("/");
  const [name, setName] = useState(from.slice(slash + 1).replace(/\.md$/i, ""));
  const [folder, setFolder] = useState(slash === -1 ? "" : from.slice(0, slash));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanName = name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\.md$/i, "")
    .trim();
  const cleanFolder = folder
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .join("/");
  const to = `${cleanFolder ? cleanFolder + "/" : ""}${cleanName}.md`;
  const unchanged = to === from || cleanName === "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.rename(from, to);
      refresh();
      navigate("/unpublished");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Could not rename.");
      setBusy(false);
    }
  }

  return (
    <article className="entry">
      <header className="entry-head">
        <p className="crumbs">{from}</p>
        <h1>Rename or move</h1>
        <p className="muted lede">
          Links to this entry are rewritten when you publish, as one commit with the rename. Files
          under 99 Appendices are never rewritten; links from them will show as unresolved.
        </p>
      </header>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Folder</span>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            spellCheck={false}
          />
        </label>
        <p className="muted small">
          It will be at <code>{to}</code>
        </p>
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <p className="plan-actions">
          <Link to={entryUrl(from)} className="quiet-link">
            Cancel
          </Link>
          <ActionButton type="submit" className="primary big" disabled={busy || unchanged}>
            {busy ? "Checking…" : "Rename"}
          </ActionButton>
        </p>
      </form>
    </article>
  );
}
