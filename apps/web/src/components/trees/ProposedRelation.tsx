import { type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure, entryUrl } from "../../api.ts";
import { reloadRelations } from "../../trees/data.ts";
import { EntryCombobox } from "../EntryCombobox.tsx";
import { useRefresh } from "../Shell.tsx";
import { useToast } from "../ui/Toast.tsx";
import "./ProposedRelation.css";

/**
 * A relation the AI read in an entry's text (stage 31), as the inbox, a tree's panel, the phone's
 * sheet and the Relations tab all show it: the relation in words with how its person was matched,
 * the sentence(s) with the words that state it marked, what is unclear about it, and Accept, Edit
 * and Reject.
 */
export interface RelProposal {
  proposal: string;
  op: string;
  /** The entry whose text it was read in, where it is saved unless another is chosen. */
  path: string;
  word: string;
  who: string;
  whoPath: string | null;
  match: "title" | "alias" | "none";
  maybe: string | null;
  with: string | null;
  how: string | null;
  when: string | null;
  quote: string;
  words: string;
  stated: boolean;
  also: { path: string; quote: string; words: string }[];
  warning: string | null;
  applies?: boolean;
}

const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

/** Clear: stated outright, matched to an entry, and breaking no check. Accept all takes only these. */
export const isClear = (p: RelProposal): boolean =>
  p.stated && p.match !== "none" && !p.warning && p.applies !== false;

/** The quote with the words that state the relation marked. */
export function Marked({ quote, words }: { quote: string; words: string }) {
  const at = quote.toLowerCase().indexOf(words.toLowerCase());
  if (at < 0 || !words) return <>{quote}</>;
  return (
    <>
      {quote.slice(0, at)}
      <mark>{quote.slice(at, at + words.length)}</mark>
      {quote.slice(at + words.length)}
    </>
  );
}

export function RelationLine({
  p,
  who,
  onMaybe,
  tag = true,
}: {
  p: RelProposal;
  who: { path: string | null; name: string };
  onMaybe?: (path: string) => void;
  tag?: boolean;
}) {
  const extra = [p.with ? `with ${p.with}` : null, p.how, p.when].filter(Boolean).join(" · ");
  return (
    <p className="rp-line">
      {tag && <span className="tag rp-tag">Relation</span>}
      <strong>{p.word}</strong>:{" "}
      <span className={`rp-who${who.path ? "" : " is-name"}`}>
        {who.path ? <Link to={entryUrl(who.path)}>{titleOf(who.path)}</Link> : who.name}
      </span>{" "}
      {who.path ? (
        <span
          className="rp-match"
          title={
            p.match === "alias"
              ? "Matched by another name the entry goes by"
              : "Matched to the entry by its title"
          }
        >
          → entry{p.match === "alias" && who.path === p.whoPath ? `, as “${p.who}”` : ""}
        </span>
      ) : (
        <>
          <span className="rp-match is-none">no entry yet</span>
          {p.maybe && onMaybe && (
            <button type="button" className="quiet rp-mini" onClick={() => onMaybe(p.maybe!)}>
              Is this {titleOf(p.maybe)}?
            </button>
          )}
        </>
      )}
      {extra && <span className="rp-extra"> · {extra}</span>}
    </p>
  );
}

/** The sentence(s), and what is unclear. */
export function Evidence({ p }: { p: RelProposal }) {
  const sources = [{ path: p.path, quote: p.quote, words: p.words }, ...p.also];
  return (
    <>
      {sources.map((s) => (
        <blockquote key={s.path} className="operation-quote rp-quote">
          {sources.length > 1 && <span className="rp-src">{titleOf(s.path)}: </span>}
          <Marked quote={s.quote} words={s.words} />
        </blockquote>
      ))}
      {!p.stated && (
        <p className="rp-flag">
          Not said directly: the sentence only lets it be worked out. Check it before you accept.
        </p>
      )}
      {p.warning && <p className="rp-flag is-warn">⚠ {p.warning}</p>}
      {p.applies === false && (
        <p className="blocked">No longer applies: this sentence is not in the entry any more.</p>
      )}
    </>
  );
}

const WORDS = [
  "parent",
  "child",
  "partner",
  "descends from",
  "gave rise to",
  "serves",
  "served by",
  "rival",
];

/**
 * One proposed relation, decided where it is shown. `onDecided` runs after a decision, with the
 * key of the person it names (for a tree to select).
 */
export function ProposedRelation({
  p,
  tag = true,
  compact = false,
  current = false,
  onDecided,
  heading,
}: {
  p: RelProposal;
  tag?: boolean;
  compact?: boolean;
  current?: boolean;
  onDecided?: (key: string | null) => void;
  heading?: ReactNode;
}) {
  const toast = useToast();
  const refresh = useRefresh();
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState(p.word);
  const [who, setWho] = useState<{ path: string | null; name: string }>({
    path: p.whoPath,
    name: p.who,
  });
  const [withWho, setWith] = useState<{ path: string | null; name: string } | null>(
    p.with ? { path: null, name: p.with } : null,
  );
  const [how, setHow] = useState(p.how ?? "");
  const [when, setWhen] = useState(p.when ?? "");
  const [saveOn, setSaveOn] = useState(p.path);
  const changedWho = who.path !== p.whoPath || who.name !== p.who;
  // Where two entries state it, either may hold it.
  const canSaveOnOther = !!who.path && p.also.length > 0;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const edits = {
        ...(word !== p.word ? { what: word } : {}),
        ...(changedWho ? { who: who.path ?? who.name } : {}),
        ...(editing
          ? {
              with: withWho ? (withWho.path ?? withWho.name) : null,
              how: how.trim() || null,
              when: when.trim() || null,
            }
          : {}),
        ...(saveOn !== p.path ? { saveOn } : {}),
      };
      await api.acceptRelations(p.proposal, [
        { op: p.op, ...(Object.keys(edits).length ? { edits } : {}) },
      ]);
      refresh();
      await reloadRelations();
      toast({
        message: `Saved on ${titleOf(saveOn)}'s entry: ${word} [[${who.path ? titleOf(who.path) : who.name}]].`,
        action: {
          label: "Undo",
          run: () =>
            void api.undoRelations().then(async (r) => {
              refresh();
              await reloadRelations();
              onDecided?.(null);
              if (!r.undone) toast({ message: "It could not be undone: the entry changed since." });
            }),
        },
      });
      onDecided?.(who.path ?? `?${who.name}`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "It could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision: "reject" | "dismiss") {
    setBusy(true);
    try {
      await api.decideOperation(p.proposal, p.op, { decision });
      refresh();
      await reloadRelations();
      if (decision === "reject")
        toast({ message: "Rejected. It is not proposed again while its sentence stays the same." });
      onDecided?.(null);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "It could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rp${compact ? " is-compact" : ""}${current ? " is-current" : ""}${isClear(p) ? "" : " is-unclear"}`}
      data-op={p.op}
    >
      {heading}
      <RelationLine
        p={{ ...p, word }}
        who={who}
        tag={tag}
        onMaybe={(path) => setWho({ path, name: titleOf(path) })}
      />
      <Evidence p={p} />
      {editing && (
        <div className="rp-edit">
          <label>
            Relation
            <select value={word} onChange={(e) => setWord(e.target.value)}>
              {[...new Set([p.word, ...WORDS])].map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </label>
          <div className="rp-field">
            <span id={`${ids}-who`}>Who</span>
            <EntryCombobox
              labelledBy={`${ids}-who`}
              value={who.path}
              allowNone
              onChange={(path, t) => setWho(path ? { path, name: t } : { path: null, name: p.who })}
            />
            {!who.path && <small>Kept as the name “{who.name}”, with no entry yet.</small>}
          </div>
          {(word === "child" || word === "son" || word === "daughter") && (
            <div className="rp-field">
              <span id={`${ids}-with`}>With (other parent)</span>
              <EntryCombobox
                labelledBy={`${ids}-with`}
                value={withWho?.path ?? null}
                allowNone
                onChange={(path, t) => setWith(path ? { path, name: t } : null)}
              />
            </div>
          )}
          <label>
            How
            <input
              value={how}
              placeholder="adopted, ended…"
              onChange={(e) => setHow(e.target.value)}
            />
          </label>
          <label>
            When
            <input
              value={when}
              placeholder="married 265…"
              onChange={(e) => setWhen(e.target.value)}
            />
          </label>
        </div>
      )}
      {canSaveOnOther && who.path && (
        <p className="rp-save">
          {p.also.length > 0 ? "Stated in both entries: one proposal. " : ""}Saved on{" "}
          <select aria-label="Saved on" value={saveOn} onChange={(e) => setSaveOn(e.target.value)}>
            <option value={p.path}>{titleOf(p.path)}</option>
            <option value={who.path}>{titleOf(who.path)}</option>
          </select>
          ’s entry.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="change-actions">
        {p.applies === false ? (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => void decide("dismiss")}
          >
            Dismiss
          </button>
        ) : (
          <>
            <button
              type="button"
              className="primary"
              data-act="accept"
              disabled={busy}
              onClick={() => void accept()}
            >
              {editing ? "Accept as edited" : "Accept"}
            </button>
            <button
              type="button"
              className="quiet"
              data-act="edit"
              disabled={busy}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button
              type="button"
              className="plain danger"
              data-act="reject"
              disabled={busy}
              onClick={() => void decide("reject")}
            >
              Reject
            </button>
            {!compact && !canSaveOnOther && (
              <span className="muted rp-saved">Saved on {titleOf(saveOn)}’s entry</span>
            )}
          </>
        )}
      </p>
    </div>
  );
}

/** Accepts every clear relation of one entry's proposal in one change, with Undo. */
export function useAcceptClear(): (items: RelProposal[]) => Promise<void> {
  const toast = useToast();
  const refresh = useRefresh();
  return async (items) => {
    const clear = items.filter(isClear);
    if (clear.length === 0) return;
    const proposal = clear[0]!.proposal;
    try {
      await api.acceptRelations(
        proposal,
        clear.map((c) => ({ op: c.op })),
      );
      refresh();
      await reloadRelations();
      toast({
        message: `Saved ${clear.length} relations on ${titleOf(clear[0]!.path)}'s entry. The unclear ones still wait.`,
        action: {
          label: "Undo",
          run: () =>
            void api.undoRelations().then(async () => {
              refresh();
              await reloadRelations();
            }),
        },
      });
    } catch (err) {
      toast({ message: err instanceof ApiFailure ? err.message : "They could not be saved." });
    }
  };
}

const unlink = (s: string) =>
  s.replace(
    /\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (_m, t: string, shown?: string) => shown ?? t,
  );
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Marks the sentences proposals came from in the entry's text on the page (the reader's
 * `.prose`), while the component that asks is shown. Uses the browser's highlights, so the text
 * itself is not changed; where they are not supported nothing is marked.
 */
export function useMarkInProse(quotes: string[]): void {
  const key = quotes.join("\n");
  useEffect(() => {
    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    const root = document.querySelector(".prose");
    if (!registry || typeof Highlight === "undefined" || !root || quotes.length === 0) return;
    const nodes: { node: Text; start: number }[] = [];
    let all = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      nodes.push({ node, start: all.length });
      all += node.data;
    }
    const at = (offset: number) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i]!.start <= offset)
          return { node: nodes[i]!.node, offset: offset - nodes[i]!.start };
      }
      return null;
    };
    const ranges: Range[] = [];
    for (const q of quotes) {
      const pattern = escapeRe(unlink(q).trim()).replace(/\s+/g, "\\s+");
      if (!pattern) continue;
      const m = new RegExp(pattern).exec(all);
      if (!m) continue;
      const a = at(m.index);
      const b = at(m.index + m[0].length);
      if (!a || !b) continue;
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, Math.min(b.offset, b.node.length));
      ranges.push(range);
    }
    if (ranges.length === 0) return;
    registry.set("rel-proposed", new Highlight(...ranges));
    return () => void registry.delete("rel-proposed");
  }, [key]);
}
