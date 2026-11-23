import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import {
  api,
  ApiFailure,
  downloadExport,
  entryUrl,
  type ExportKind,
  type ExportPick,
} from "../api.ts";

const KINDS = [
  ["site", "Web pages", "A zip of linked pages in Frontier's look, to open in any browser."],
  ["docx", "Word document", "One .docx, with headings and pictures, to edit or send."],
  ["pdf", "PDF", "One printable PDF, with a contents page."],
  ["slides", "Slides", "One .pptx: a title slide per entry and a slide per section, to edit."],
  ["markdown", "Markdown", "A zip of .md files linking to each other, with their images."],
  ["json", "JSON", "One file for other tools: each entry's properties, text and links."],
] as const;

/** Exports for reading and sharing: a folder or chosen entries, in six forms. */
export function ExportPage() {
  const [params] = useSearchParams();
  const onePath = params.get("path");
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("Avalymia");
  const [preview, setPreview] = useState<{
    entries: { path: string; title: string }[];
    unsaved: string[];
    skipped: string[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [foldersFailed, setFoldersFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setFoldersFailed(null);
    api.exportFolders().then(
      (r) => {
        setFolders(r.folders);
        if (!onePath) setFolder((f) => f || r.folders[0] || "");
      },
      (err: unknown) =>
        setFoldersFailed(
          err instanceof ApiFailure ? err.message : "The folders could not be read.",
        ),
    );
    if (onePath) setTitle(onePath.split("/").pop()!.replace(/\.md$/i, ""));
  }, [onePath, attempt]);

  const pick: ExportPick = onePath ? { title, paths: [onePath] } : { title, folder };

  const [looking, setLooking] = useState(false);
  useEffect(() => {
    if (!onePath && !folder) return;
    // A preview belongs to one folder: another folder's is not kept while this one is found.
    setPreview(null);
    setLooking(true);
    setError(null);
    api.exportPreview(pick).then(
      (found) => {
        setPreview(found);
        setLooking(false);
      },
      (err: unknown) => {
        setError(err instanceof ApiFailure ? err.message : "Nothing could be found there.");
        setLooking(false);
      },
    );
  }, [folder, onePath, attempt]);

  async function make(kind: ExportKind) {
    setBusy(kind);
    setError(null);
    try {
      await downloadExport(kind, pick);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The export could not be made.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="entry wide export">
      {looking && <Progress />}
      <header className="entry-head">
        <h1>Export</h1>
        <p className="muted lede">
          For reading and sharing: what is saved in the library, as of your last version. Links to
          entries left out stay as their words, marked as not shared. Appendices and notes waiting
          in quarantine are never exported. The whole library for Obsidian is on the{" "}
          <Link to="/status">Status</Link> page.
        </p>
      </header>
      {foldersFailed && (
        <Problem
          reason={`The folders could not be listed. ${foldersFailed}`}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}

      <div className="settings">
        {onePath ? (
          <p>
            One entry: <Link to={entryUrl(onePath)}>{onePath}</Link>
          </p>
        ) : (
          <label className="field">
            <span>Folder</span>
            <select aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      </div>

      {preview && (
        <section className="export-preview">
          <p>
            {preview.entries.length} {preview.entries.length === 1 ? "entry" : "entries"} will be
            exported.
          </p>
          {preview.unsaved.length > 0 && (
            <p className="banner">
              {preview.unsaved.length} of them {preview.unsaved.length === 1 ? "has" : "have"}{" "}
              unsaved changes, which are not exported. <Link to="/unpublished">Save a version</Link>{" "}
              first to include them.
            </p>
          )}
          <details>
            <summary>Which entries</summary>
            <ul>
              {preview.entries.map((e) => (
                <li key={e.path}>{e.title}</li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <ul className="export-kinds">
        {KINDS.map(([kind, label, what]) => (
          <li key={kind}>
            <button
              type="button"
              className="primary"
              disabled={busy !== null || !preview || !title.trim()}
              onClick={() => void make(kind)}
            >
              {busy === kind ? "Making it…" : label}
            </button>
            <span className="muted">{what}</span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
