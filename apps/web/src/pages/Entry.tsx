import { aliasesOf, splitFrontmatter } from "@frontier/vault";
import { useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, editUrl, entryUrl } from "../api.ts";
import { HoverPreview } from "../components/HoverPreview.tsx";
import { LightboxProvider } from "../components/Lightbox.tsx";
import { currentEntryPath } from "../components/Shell.tsx";
import { Markdown } from "../render/Markdown.tsx";
import { useAsync } from "../useAsync.ts";

function Crumbs({ path }: { path: string }) {
  const folders = path.split("/").slice(0, -1);
  if (folders.length === 0) return null;
  return (
    <p className="crumbs">
      {folders.map((f, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> › </span>}
          {f}
        </span>
      ))}
    </p>
  );
}

export function EntryPage({ onSessionLost }: { onSessionLost: () => void }) {
  const { pathname, hash, key } = useLocation();
  const path = currentEntryPath(pathname);
  // Keyed by the visit as well as the path, so coming back from the editor shows the new draft.
  const entry = useAsync(() => api.entry(path), `${path}@${key}`);

  useEffect(() => {
    if (entry.state === "failed" && entry.error.status === 401) onSessionLost();
  }, [entry, onSessionLost]);

  const view = useMemo(() => {
    if (entry.state !== "ready") return null;
    const { body } = splitFrontmatter(entry.value.text);
    const name = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
    // The page title is the note's name, as in Obsidian. A first heading that only repeats the
    // name is left out of the text; any other heading is a section and stays.
    const opening = /^\s*#[ \t]+([^\n]*)\n?/.exec(body);
    const repeats = opening !== null && opening[1]!.trim().toLowerCase() === name.toLowerCase();
    const text = repeats ? body.slice(opening[0].length) : body;
    return { text, title: name, aliases: aliasesOf(entry.value.text) };
  }, [entry, path]);

  // Jump to the heading named in the address, once the text is on the page.
  useEffect(() => {
    if (!view) return;
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const wanted = decodeURIComponent(hash.slice(1)).trim().toLowerCase();
    const heading = [
      ...document.querySelectorAll(
        ".prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6",
      ),
    ].find((h) => h.textContent?.trim().toLowerCase() === wanted);
    heading?.scrollIntoView({ block: "start" });
  }, [view, hash]);

  if (entry.state === "loading") return <p className="center muted">Opening…</p>;
  if (entry.state === "failed") {
    return (
      <div className="center">
        <p className="error">{entry.error.message}</p>
        <p>
          <Link to="/">Back to the start</Link>
        </p>
      </div>
    );
  }

  const e = entry.value;
  return (
    <article className="entry">
      <header className="entry-head">
        <Crumbs path={e.path} />
        <div className="title-row">
          <h1>{view!.title}</h1>
          {!e.readOnly && e.draft?.kind !== "delete" && (
            <span className="entry-actions">
              <Link
                to={"/rename/" + e.path.split("/").map(encodeURIComponent).join("/")}
                className="edit-link subtle"
              >
                Rename
              </Link>
              <Link to={editUrl(e.path)} className="edit-link">
                Edit
              </Link>
            </span>
          )}
        </div>
        {e.state === "unpublished" && (
          <p className="draft-note">
            {e.draft?.kind === "delete"
              ? "Marked for deletion. "
              : e.draft?.kind === "create"
                ? "A new entry, not published yet. "
                : "You are reading your unpublished draft. "}
            <Link to="/unpublished">Review and publish</Link>
          </p>
        )}
        {(view!.aliases.length > 0 || e.readOnly) && (
          <p className="chips">
            {view!.aliases.map((a) => (
              <span className="chip" key={a} title="Also known as">
                {a}
              </span>
            ))}
            {e.readOnly && (
              <span
                className="chip chip-quiet"
                title={
                  e.lineEnding === "mixed"
                    ? "This file mixes two kinds of line endings"
                    : "Appendix files are append-only"
                }
              >
                read-only
              </span>
            )}
          </p>
        )}
      </header>

      {e.headings.filter((h) => h.level <= 3).length >= 3 && (
        <details className="outline">
          <summary>On this page</summary>
          <ul>
            {e.headings
              .filter((h) => h.level <= 3)
              .map((h) => (
                <li key={h.line} className={`outline-${h.level}`}>
                  <a href={`#${encodeURIComponent(h.text)}`}>{h.text}</a>
                </li>
              ))}
          </ul>
        </details>
      )}

      <div className="prose">
        {view!.text.trim() === "" ? (
          <p className="muted">This entry is empty.</p>
        ) : (
          <LightboxProvider scope=".prose">
            <Markdown text={view!.text} links={e.links} />
          </LightboxProvider>
        )}
      </div>

      <HoverPreview scope=".prose" />

      {e.backlinks.length > 0 && (
        <footer className="backlinks">
          <h2>Mentioned in</h2>
          <ul>
            {[...new Map(e.backlinks.map((b) => [b.path, b])).values()].map((b) => (
              <li key={b.path}>
                <Link to={entryUrl(b.path)}>{b.title}</Link>
                <span className="muted"> · {b.path.split("/").slice(0, -1).join(" › ")}</span>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}
