import type { FromHereResponse, LinkItUndo, UnlinkedMention } from "@frontier/schema";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "../../nav.tsx";
import { api, ApiFailure, editUrl, entryUrl } from "../../api.ts";
import {
  backlinksLine,
  entries,
  folderName,
  MENTIONS_SHOWN,
  RULE_TAG,
  splitMention,
  type Backlink,
} from "../../keepGoing/strip.ts";
import { useCanWrite } from "../projectContext.ts";
import { useWriteIt } from "../WriteIt.tsx";
import { ActionButton } from "../ui/ActionButton.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useToast } from "../ui/Toast.tsx";
import { WhatsMissing } from "./WhatsMissing.tsx";
import "./FromHere.css";

/** A copy of a record without one key. */
function without<T>(from: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(from).filter(([k]) => k !== key));
}

/** Entries named in the text without a link: each with its sentence and "Link it". */
function Mentions({
  path,
  data,
}: {
  /** The entry the links would point at. */
  path: string;
  data: FromHereResponse;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** The mentions linked in this visit, with what Undo needs. */
  const [linked, setLinked] = useState<Record<string, LinkItUndo>>({});
  /** The mentions that turned out to be gone. */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState<Record<string, string>>({});

  const rows = data.unlinked.filter((m) => !gone.has(m.path));
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, MENTIONS_SHOWN);
  const hidden = rows.length - shown.length;

  async function linkIt(m: UnlinkedMention) {
    setBusy(m.path);
    setRefused((r) => without(r, m.path));
    try {
      const done = await api.linkIt(m.path, path);
      setLinked((l) => ({ ...l, [m.path]: done.undo }));
      toast({
        message: `Linked in ${m.title}. It is an unpublished edit.`,
        action: { label: "Undo", run: () => void undo(m, done.undo) },
      });
    } catch (err) {
      const said = err instanceof ApiFailure ? err : null;
      if (said?.status === 404) {
        // The text changed since this page was read: the mention is not there to link.
        setGone((g) => new Set(g).add(m.path));
        toast({
          message: `${m.title} no longer names it in the same words, so nothing was linked.`,
        });
      } else if (said?.status === 403) {
        const why = `${m.title} cannot be changed here: it is read-only, or has texts to compare.`;
        setRefused((r) => ({ ...r, [m.path]: why }));
        toast({ message: why });
      } else {
        toast({ message: said?.message ?? "The link could not be made." });
      }
    } finally {
      setBusy(null);
    }
  }

  async function undo(m: UnlinkedMention, undoing: LinkItUndo) {
    try {
      await api.undoLinkIt(undoing);
      setLinked((l) => without(l, m.path));
      toast({ message: `Took the link back out of ${m.title}.` });
    } catch (err) {
      const said = err instanceof ApiFailure ? err : null;
      if (said?.status === 403) {
        toast({
          message: `${m.title} was edited since. Undo the link in its editor.`,
          action: { label: "Open", run: () => navigate(editUrl(m.path)) },
        });
      } else if (said?.status === 404) {
        setLinked((l) => without(l, m.path));
        toast({ message: `The draft of ${m.title} is gone already.` });
      } else {
        toast({ message: said?.message ?? "The link could not be taken back." });
      }
    }
  }

  return (
    <section className="fh-card fh-mentions" aria-labelledby="fh-mentions">
      <h3 id="fh-mentions">
        Named here, not linked
        <span className="fh-count">
          {data.unlinkedMore ? `${rows.length}+ entries` : entries(rows.length)}
        </span>
      </h3>
      <ul className="fh-list">
        {shown.map((m) => {
          const [before, name, after] = splitMention(m.sentence, m.at);
          return (
            <li key={m.path} className="fh-mention">
              <Link className="fh-mention-title" to={entryUrl(m.path)}>
                {m.title}
              </Link>
              <p className="fh-sentence">
                “{before}
                <strong className="fh-at">{name}</strong>
                {after}”
              </p>
              {m.path in linked ? (
                <p className="fh-linked" role="status">
                  <Icon icon={CircleCheck} size="sm" /> Linked, in drafts
                </p>
              ) : (
                <ActionButton
                  type="button"
                  className="quiet fh-btn"
                  disabled={busy !== null}
                  onClick={() => void linkIt(m)}
                >
                  Link it
                </ActionButton>
              )}
              {refused[m.path] && <p className="fh-refused muted">{refused[m.path]}</p>}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" className="plain fh-more" onClick={() => setAll(true)}>
          Show the other {hidden}
        </button>
      )}
      {all && data.unlinkedMore && (
        <p className="muted fh-note">More entries than these name it; link these first.</p>
      )}
    </section>
  );
}

/**
 * The strip at the foot of an entry (stage 25): what is missing from it, who names it without a
 * link, thin neighbours, related entries and, when a model is chosen, what the AI thinks is
 * missing. Groups with nothing to show are left out, and so is the strip when all are.
 */
export function FromHere({
  path,
  title,
  data,
  ai,
}: {
  path: string;
  title: string;
  data: FromHereResponse | null;
  /** Whether a model is chosen for lore conversations; "What's missing" needs one. */
  ai: boolean;
}) {
  const { write, dialog } = useWriteIt();
  // Writing, linking and asking the AI what is missing change or draft the project: writers'.
  const canWrite = useCanWrite();
  const mentions = canWrite ? (data?.unlinked.length ?? 0) : 0;
  const empty =
    !data ||
    (data.missing.length === 0 &&
      mentions === 0 &&
      data.thin.length === 0 &&
      data.related.length === 0);
  if (empty && !(ai && canWrite)) return null;

  return (
    <section className="fh" aria-labelledby="fh-title">
      <h2 id="fh-title">From here</h2>
      <div className="fh-grid">
        {data && data.missing.length > 0 && (
          <section className="fh-card" aria-labelledby="fh-missing">
            <h3 id="fh-missing">
              Missing from this entry
              <span className="fh-count">{data.missing.length}</span>
            </h3>
            <ul className="fh-list">
              {data.missing.map((m) => (
                <li key={m.name} className="fh-row">
                  <span className="link-unresolved fh-name" title="No entry yet">
                    {m.name}
                  </span>
                  <span className="fh-when">{entries(m.mentions)}</span>
                  {canWrite && (
                    <button
                      type="button"
                      className="quiet fh-btn"
                      aria-label={`Write ${m.name}`}
                      onClick={() => write({ name: m.name, folder: m.folder })}
                    >
                      Write
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && canWrite && <Mentions path={path} data={data} />}
        {data && data.thin.length > 0 && (
          <section className="fh-card" aria-labelledby="fh-thin">
            <h3 id="fh-thin">Close by, and thin</h3>
            <ul className="fh-list">
              {data.thin.map((t) => (
                <li key={t.path} className="fh-row">
                  <Link
                    to={entryUrl(t.path)}
                    className="fh-name"
                    title={
                      t.direction === "both"
                        ? "Links both ways"
                        : t.direction === "links"
                          ? "This entry links to it"
                          : "It links here"
                    }
                  >
                    {t.title}
                  </Link>
                  <span className="fh-tags">
                    {t.reasons.map((r) => (
                      <span key={r.rule} className="fh-tag" title={r.text}>
                        {RULE_TAG[r.rule]}
                      </span>
                    ))}
                  </span>
                  <span className="fh-when">{t.words} words</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && data.related.length > 0 && (
          <section className="fh-card" aria-labelledby="fh-related">
            <h3 id="fh-related">
              Related<span className="fh-count">shared links</span>
            </h3>
            <ul className="fh-list">
              {data.related.map((r) => (
                <li key={r.path} className="fh-row">
                  <Link to={entryUrl(r.path)} className="fh-name">
                    {r.title}
                  </Link>
                  <span className="fh-when">{r.shared} shared</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {ai && canWrite && <WhatsMissing path={path} title={title} />}
      </div>
      {dialog}
    </section>
  );
}

/** Two links at the foot of an entry: the entries either side of it in its folder. */
export function FolderNeighbours({ path, data }: { path: string; data: FromHereResponse | null }) {
  if (!data || (!data.previous && !data.next)) return null;
  const folder = folderName(path);
  return (
    <nav className="fh-neighbours" aria-label={`In ${folder}`}>
      {data.previous ? (
        <Link className="fh-prev" to={entryUrl(data.previous.path)} rel="prev">
          <small>‹ Previous in {folder}</small>
          <b>{data.previous.title}</b>
        </Link>
      ) : (
        <span />
      )}
      {data.next ? (
        <Link className="fh-next" to={entryUrl(data.next.path)} rel="next">
          <small>Next in {folder} ›</small>
          <b>{data.next.title}</b>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/**
 * Who links here, in one line that opens to the full list when there are more than it names:
 * "Linked from 14 entries: A, B, C and 11 more".
 */
export function BacklinksLine({ backlinks }: { backlinks: readonly Backlink[] }) {
  const { all, named, more } = backlinksLine(backlinks);
  if (all.length === 0) return null;
  const list = (
    <ul>
      {all.map((b) => (
        <li key={b.path}>
          <Link to={entryUrl(b.path)}>{b.title}</Link>
          <span className="muted"> · {b.path.split("/").slice(0, -1).join(" › ")}</span>
        </li>
      ))}
    </ul>
  );
  const line = `Linked from ${entries(all.length)}: ${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  return (
    <footer className="backlinks">
      {more > 0 ? (
        <details>
          <summary>{line}</summary>
          {list}
        </details>
      ) : (
        <p>
          Linked from {entries(all.length)}:{" "}
          {all.map((b, i) => (
            <span key={b.path}>
              {i > 0 && ", "}
              <Link to={entryUrl(b.path)}>{b.title}</Link>
            </span>
          ))}
        </p>
      )}
    </footer>
  );
}
