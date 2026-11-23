import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure, entryUrl, type ImportResult } from "../api.ts";
import { useRefresh, useWords } from "../components/Shell.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { failureOf, useAsync } from "../useAsync.ts";

/** Every folder of the library, for choosing where imported notes go. */
function foldersOf(tree: { folders: { path: string; folders: unknown[] }[] }): string[] {
  const out: string[] = [];
  const walk = (list: { path: string; folders: unknown[] }[]) => {
    for (const f of list) {
      out.push(f.path);
      walk(f.folders as { path: string; folders: unknown[] }[]);
    }
  };
  walk(tree.folders);
  return out;
}

export function ImportPage() {
  const words = useWords();
  const refresh = useRefresh();
  const tree = useAsync(() => api.tree(), "import-tree");
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zip, setZip] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [vaultDone, setVaultDone] = useState<string | null>(null);

  async function run(chosen: File[], existing: "ask" | "replace" | "both") {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importFiles(chosen, folder.trim(), existing);
      setResult((before) =>
        existing === "ask" || !before
          ? r
          : {
              imported: [...before.imported, ...r.imported],
              clashes: [],
              refused: [...before.refused, ...r.refused],
            },
      );
      refresh();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The import did not go through.");
    } finally {
      setBusy(false);
    }
  }

  const clashing = () => files.filter((f) => result?.clashes.some((c) => c.name === f.name));

  async function importVault() {
    if (!zip) return;
    setBusy(true);
    setError(null);
    setVaultDone(null);
    try {
      const r = await api.importVault(zip, message.trim());
      setVaultDone(`${r.files} files were added or replaced, as one saved version.`);
      setZip(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The vault could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="entry wide settings">
      <header className="entry-head">
        <h1>Import</h1>
        <p className="muted lede">
          Bring notes and media into the library. <a href="/api/export/library.zip">Export</a> gives
          the whole library back as a zip that opens in Obsidian.
        </p>
      </header>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}

      <section className="settings-block">
        <h2>Notes and images</h2>
        <p className="muted">
          Markdown notes go into the folder you choose; images go with the other images. They arrive
          as {words.own ? "unsaved" : "unpublished"} changes for you to read first.
        </p>
        <label className="field">
          <span>Files</span>
          <input
            type="file"
            multiple
            accept=".md,text/markdown,image/*"
            onChange={(e) => {
              setFiles([...(e.target.files ?? [])]);
              setResult(null);
            }}
          />
        </label>
        <label className="field">
          <span>Folder for the notes</span>
          <input
            type="text"
            list="folder-list"
            value={folder}
            placeholder="Empty for the top of the library"
            onChange={(e) => setFolder(e.target.value)}
          />
          <datalist id="folder-list">
            {tree.state === "ready" &&
              foldersOf(tree.value).map((f) => <option key={f} value={f} />)}
          </datalist>
        </label>
        {failureOf(tree) && (
          <Problem
            reason={`The folders could not be listed. ${failureOf(tree)!.message}`}
            onRetry={tree.retry}
          />
        )}
        <p className="change-actions">
          <button
            type="button"
            className="primary"
            disabled={busy || files.length === 0}
            onClick={() => run(files, "ask")}
          >
            {busy
              ? "Importing…"
              : `Import ${files.length || ""} ${files.length === 1 ? "file" : "files"}`}
          </button>
        </p>

        {result && (
          <div className="import-result" role="status">
            {result.imported.length > 0 && (
              <>
                <p>
                  {result.imported.length} imported. <Link to="/unpublished">{words.review}</Link>
                </p>
                <ul>
                  {result.imported.map((i) => (
                    <li key={i.path}>
                      {i.kind === "note" ? <Link to={entryUrl(i.path)}>{i.path}</Link> : i.path}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.clashes.length > 0 && (
              <>
                <p>
                  {result.clashes.length === 1
                    ? "A note of this name exists"
                    : "Notes of these names exist"}{" "}
                  in that folder:
                </p>
                <ul>
                  {result.clashes.map((c) => (
                    <li key={c.path}>
                      <Link to={entryUrl(c.path)}>{c.path}</Link>
                    </li>
                  ))}
                </ul>
                <p className="change-actions">
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => run(clashing(), "replace")}
                  >
                    Replace with the imported text
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => run(clashing(), "both")}
                  >
                    Keep both
                  </button>
                </p>
              </>
            )}
            {result.refused.length > 0 && (
              <>
                <p>Not imported:</p>
                <ul>
                  {result.refused.map((r) => (
                    <li key={r.name}>
                      {r.name}: <span className="muted">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      <section className="settings-block">
        <h2>A whole vault</h2>
        <p className="muted">
          A zip of an Obsidian vault, or of a repository downloaded from GitHub. Its files are added
          to the library and saved as one version. Files that exist here are replaced; nothing is
          deleted, and what was replaced stays in each entry's history.
        </p>
        <label className="field">
          <span>Zip</span>
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => setZip(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="field">
          <span>What this version is, in a line</span>
          <input
            type="text"
            value={message}
            placeholder="Import a vault"
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <p className="change-actions">
          <button type="button" className="primary" disabled={busy || !zip} onClick={importVault}>
            {busy && zip ? "Importing…" : "Import the vault"}
          </button>
        </p>
        {vaultDone && (
          <p className="banner banner-ok" role="status">
            {vaultDone} <Link to="/versions">See the versions</Link>
          </p>
        )}
      </section>
    </article>
  );
}
