import { useState } from "react";
import { Link } from "../../nav.tsx";
import { ApiFailure, downloadExport, type ExportKind } from "../../api.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { useWords } from "../Shell.tsx";
import "./ExportPanel.css";

/** The forms one entry can be exported in. JSON is for other tools, on the Export page. */
const KINDS: [ExportKind, string, string][] = [
  ["site", "Web page", "In Frontier's look, to open in any browser."],
  ["docx", "Word", "A .docx to edit or send."],
  ["pdf", "PDF", "To print or send as it is."],
  ["markdown", "Markdown", "The .md file, with its images."],
  ["slides", "Slides", "A .pptx, a slide per section."],
];

/**
 * The Export tab: the entry, as of the last saved version, in five forms. Changes not saved yet
 * are not in it, and the tab says so. Making an export needs the server.
 */
export function ExportPanel({
  path,
  name,
  unsaved,
}: {
  path: string;
  /** The entry's name, which titles the export and names the file. */
  name: string;
  /** Whether the entry has changes not yet in a saved version. */
  unsaved: boolean;
}) {
  const words = useWords();
  const offline = useNeedsConnection();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function make(kind: ExportKind) {
    setBusy(kind);
    setError(null);
    try {
      await downloadExport(kind, { title: name, paths: [path] });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The export could not be made.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="export-panel">
      {unsaved && (
        <p className="export-panel-note">
          This entry has {words.waiting.toLowerCase()} changes, which are not exported. The export
          is of the last saved version. <Link to="/unpublished">{words.review}</Link>
        </p>
      )}
      <ul className="export-panel-kinds">
        {KINDS.map(([kind, label, what]) => (
          <li key={kind}>
            <button
              type="button"
              className="quiet export-panel-make"
              disabled={busy !== null || offline !== undefined}
              onClick={() => void make(kind)}
            >
              {busy === kind ? "Making it…" : label}
            </button>
            <span className="muted">{what}</span>
          </li>
        ))}
      </ul>
      {offline && <p className="muted export-panel-offline">{offline}.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted export-panel-more">
        A folder, or JSON for other tools: <Link to="/export">the Export page</Link>.
      </p>
    </div>
  );
}
