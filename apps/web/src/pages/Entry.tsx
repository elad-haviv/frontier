import { aliasesOf, splitFrontmatter } from "@frontier/vault";
import { useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, chronicleUrl, editUrl, entryUrl, historyUrl, mapUrl, talkUrl } from "../api.ts";
import { HoverPreview } from "../components/HoverPreview.tsx";
import { LightboxProvider } from "../components/Lightbox.tsx";
import { currentEntryPath, useWords } from "../components/Shell.tsx";
import { Fields } from "../components/Fields.tsx";
import { ProposeFields } from "../components/ProposeFields.tsx";
import { Markdown } from "../render/Markdown.tsx";
import { Menu, MenuLink } from "../components/ui/Menu.tsx";
import { FileDown, FolderInput, History } from "lucide-react";
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
  const words = useWords();
  const { pathname, hash, key } = useLocation();
  const path = currentEntryPath(pathname);
  // Keyed by the visit as well as the path, so coming back from the editor shows the new draft.
  const entry = useAsync(() => api.entry(path), `${path}@${key}`);
  // Talking with a character is offered once a model for conversations is chosen.
  const ai = useAsync(() => api.conversations(), "conversations-ready");
  const canTalk = ai.state === "ready" && ai.value.ready;
  const comments = useAsync(() => api.commentCount(path), `comments:${path}@${key}`);
  const openComments = comments.state === "ready" ? comments.value.open : 0;

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
              <Link to={editUrl(e.path)} className="edit-link">
                Edit
              </Link>
              {/* One clear action; the rest wait behind "⋯", as the review asked. */}
              <Menu label="More actions">
                <MenuLink
                  icon={FolderInput}
                  to={"/rename/" + e.path.split("/").map(encodeURIComponent).join("/")}
                >
                  Rename
                </MenuLink>
                <MenuLink icon={History} to={historyUrl(e.path)}>
                  History
                </MenuLink>
                <MenuLink icon={FileDown} to={`/export?path=${encodeURIComponent(e.path)}`}>
                  Export
                </MenuLink>
              </Menu>
            </span>
          )}
        </div>
        {e.quarantine && (
          <p className="draft-note quarantine-note" role="status">
            This note arrived unreviewed, pushed by {e.quarantine.pushedBy}. It is kept out of the
            memory bank until you decide. <Link to="/inbox">Accept or revert it in the inbox</Link>
          </p>
        )}
        {e.state === "unpublished" && (
          <p className="draft-note">
            {e.draft?.kind === "delete"
              ? "Marked for deletion. "
              : e.draft?.kind === "create"
                ? "A new entry, not published yet. "
                : "You are reading your unpublished draft. "}
            <Link to="/unpublished">{words.review}</Link>
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
        <Fields fields={e.fields} />
        {canTalk && (e.fields.type === "person" || e.fields.type === "deity") && (
          <p className="talk-with">
            <Link to={talkUrl(e.path)}>
              Talk with {e.path.split("/").pop()!.replace(/\.md$/i, "")}
            </Link>
          </p>
        )}
        {openComments > 0 && !e.readOnly && (
          <p className="on-maps">
            <Link to={`${editUrl(e.path)}?comments=1`}>
              {openComments} open {openComments === 1 ? "comment" : "comments"}
            </Link>
          </p>
        )}
        {e.maps.length > 0 && (
          <p className="on-maps">
            On maps:{" "}
            {e.maps.map((m, i) => (
              <span key={m.id}>
                {i > 0 && ", "}
                <Link to={mapUrl(m.id, m.feature)}>{m.title}</Link>
              </span>
            ))}
          </p>
        )}
        {e.chronicles.length > 0 && (
          <p className="on-maps">
            On chronicles:{" "}
            {e.chronicles.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <Link to={`${chronicleUrl(c.id)}?span=${encodeURIComponent(c.span)}`}>
                  {c.title}
                </Link>
              </span>
            ))}
          </p>
        )}
        {e.state === "published" && !e.readOnly && <ProposeFields path={e.path} />}
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
