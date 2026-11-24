/**
 * A new entry drafted from what the author said (stage 19). It is a working draft, not a result:
 * the title, the folder and every paragraph can be changed in place, a changed paragraph is
 * checked against the lore again, and a line that an entry contradicts must be decided before the
 * draft can be kept. "Change this…" asks for a rewrite of one paragraph in the author's words,
 * said or typed. Keeping makes an unsaved change; nothing is in the library until it is published.
 */
import { Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure, entryUrl, type EntryDraftConflict, type EntryProposal } from "../api.ts";
import { useDictation } from "../hooks/useDictation.ts";
import { ActionButton } from "./ui/ActionButton.tsx";
import { wordChanges, WordDiff } from "./Diff.tsx";
import { DictateButton, ListeningBar } from "./DictateButton.tsx";
import { Icon } from "./ui/Icon.tsx";
import { Problem } from "./ui/Problem.tsx";
import "./EntryDraft.css";

const reasonOf = (e: unknown): string =>
  e instanceof ApiFailure || e instanceof Error ? e.message : "Something went wrong.";

/** The ready-made requests the server knows by name. */
const CHIPS = [
  ["shorter", "Shorter"],
  ["simpler", "Simpler"],
  ["vivid", "More vivid"],
] as const;

/** A quote from an entry as it reads: [[links]] as their words. */
const plain = (text: string): string =>
  text.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]#|]*)(?:#[^\]]*)?\]\]/g, "$1");

const folderLabel = (f: string) => f.split("/").join(" › ");
const stemOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

/** A paragraph's box: as tall as its text, so it reads as prose until it is clicked. */
function Para({
  value,
  label,
  onChange,
  onBlur,
  boxRef,
}: {
  value: string;
  label: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  boxRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      className="ed-para"
      rows={1}
      value={value}
      aria-label={label}
      ref={(el) => {
        own.current = el;
        boxRef(el);
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}

/** Where the author says or types what to change in a paragraph. */
function ChangePrompt({
  working,
  onSuggest,
  onCancel,
}: {
  working: boolean;
  onSuggest: (how: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const voice = useDictation(setText);
  return (
    <div className="ed-prompt">
      <DictateButton
        small
        listening={voice.listening}
        onToggle={() => {
          if (voice.listening) voice.stop();
          else voice.start(text);
        }}
      />
      <input
        type="text"
        value={text}
        maxLength={400}
        placeholder="Say or type a change, e.g. make her the eldest warden"
        aria-label="What to change"
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) onSuggest(text.trim());
          if (e.key === "Escape") onCancel();
        }}
      />
      <ActionButton
        className="primary"
        disabled={working || voice.listening || !text.trim()}
        onClick={() => onSuggest(text.trim())}
      >
        {working ? "Working…" : "Suggest"}
      </ActionButton>
      <button type="button" className="quiet" onClick={onCancel}>
        Cancel
      </button>
      <div className="ed-chips">
        {CHIPS.map(([how, label]) => (
          <button
            key={how}
            type="button"
            className="lore-chip"
            disabled={working}
            onClick={() => onSuggest(how)}
          >
            {label}
          </button>
        ))}
      </div>
      {voice.problem && <p className="muted ed-problem">{voice.problem}</p>}
      {voice.listening && <ListeningBar onStop={voice.stop} />}
    </div>
  );
}

interface Suggestion {
  i: number;
  how: string;
  text: string;
}

export function EntryDraft({
  said,
  proposal,
  onClose,
}: {
  said: string;
  proposal: EntryProposal;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(proposal.title);
  const [folder, setFolder] = useState(proposal.folders[0] ?? "");
  const [paras, setParas] = useState(proposal.paragraphs);
  const [conflicts, setConflicts] = useState<EntryDraftConflict[]>(proposal.conflicts);
  const [links, setLinks] = useState(proposal.links);
  const [existing, setExisting] = useState(proposal.existing);
  /** Paragraphs the author kept against an entry, by the path of the entry. */
  const [against, setAgainst] = useState<Record<number, string>>({});
  const [checking, setChecking] = useState<number | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [kept, setKept] = useState(false);
  const boxes = useRef<(HTMLTextAreaElement | null)[]>([]);
  const checked = useRef(proposal.paragraphs);
  const seq = useRef(0);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  const open = conflicts.filter((c) => !(c.paragraph in against));
  const edited = (i: number) => paras[i] !== proposal.paragraphs[i];
  const canKeep =
    open.length === 0 && title.trim() !== "" && folder !== "" && checking === null && !saving;

  /** Looks again at a paragraph whose words changed since it was last checked. */
  const recheck = (i: number, next: string[]) => {
    if (next[i] === checked.current[i]) return;
    const mine = ++seq.current;
    setChecking(i);
    api
      .checkEntryDraft({ title, paragraphs: next, changed: i })
      .then((res) => {
        if (mine !== seq.current) return;
        checked.current = checked.current.map((t, k) => (k === i ? next[i]! : t));
        setConflicts((c) => [...c.filter((x) => x.paragraph !== i), ...res.conflicts]);
        setAgainst((a) => Object.fromEntries(Object.entries(a).filter(([p]) => Number(p) !== i)));
        setLinks(res.links);
        setExisting(res.existing);
        setFailure(null);
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setFailure(`Could not recheck the paragraph. ${reasonOf(e)}`);
      })
      .finally(() => {
        if (mine === seq.current) setChecking(null);
      });
  };

  const setPara = (i: number, text: string) =>
    setParas((p) => p.map((t, k) => (k === i ? text : t)));

  const undo = (i: number) => {
    const next = paras.map((t, k) => (k === i ? proposal.paragraphs[i]! : t));
    setParas(next);
    recheck(i, next);
  };

  /** Asks for a rewrite of one paragraph, as the author said or as the lore needs. */
  const suggest = async (i: number, how: string) => {
    stop.current?.abort();
    const ask = new AbortController();
    stop.current = ask;
    setWorking(true);
    setFailure(null);
    try {
      const out = await api.rewrite(
        {
          path: `${folder || "Untitled"}/${title.trim() || "Untitled"}.md`,
          passage: paras[i]!,
          before: paras.slice(0, i).join("\n\n").slice(-1500),
          after: paras
            .slice(i + 1)
            .join("\n\n")
            .slice(0, 1500),
          how,
        },
        ask.signal,
      );
      setSuggestion({ i, how, text: out.text });
    } catch (e) {
      if (!ask.signal.aborted) setFailure(reasonOf(e));
    } finally {
      setWorking(false);
    }
  };

  const accept = (focus: boolean) => {
    if (!suggestion) return;
    const next = paras.map((t, k) => (k === suggestion.i ? suggestion.text : t));
    setParas(next);
    recheck(suggestion.i, next);
    if (focus) setTimeout(() => boxes.current[suggestion.i]?.focus(), 0);
    setSuggestion(null);
    setAsking(null);
  };

  const keep = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await api.keepEntryDraft({
        title,
        folder,
        paragraphs: paras,
        againstLore: Object.entries(against).map(([p, path]) => ({ paragraph: Number(p), path })),
      });
      setKept(true);
    } catch (e) {
      setFailure(reasonOf(e));
    } finally {
      setSaving(false);
    }
  };

  const fixFor = (c: EntryDraftConflict) =>
    `Change it as little as possible so that it agrees with the entry "${c.title}", which says: "${c.quote.slice(0, 160)}"`;

  if (kept) {
    return (
      <section className="turn ed" aria-live="polite">
        <p className="banner banner-ok">
          Kept as an unsaved change
          {Object.keys(against).length > 0 ? ", with a line marked as kept against the lore" : ""}.
          Find it under <Link to="/unpublished">Unpublished</Link>. Nothing is in the library until
          you publish.
        </p>
        <p className="change-actions">
          <button type="button" className="quiet" onClick={onClose}>
            Ask another
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="turn ed" aria-label="Draft entry">
      <p className="turn-question">Draft an entry</p>
      <p className="ed-said">{said}</p>
      {proposal.given.length > 0 && (
        <p className="ed-read muted">
          Looked up the lore:{" "}
          <span className="lore-chips">
            {proposal.given.slice(0, 6).map((p) => (
              <Link key={p} className="lore-chip" to={entryUrl(p)} title={p}>
                {stemOf(p)}
              </Link>
            ))}
          </span>
        </p>
      )}

      <div className="boxed ed-card">
        <p className="crumbs">
          <select
            className="ed-folder"
            value={folder}
            aria-label="Folder"
            onChange={(e) => setFolder(e.target.value)}
          >
            {proposal.folders.map((f) => (
              <option key={f} value={f}>
                {folderLabel(f)}
              </option>
            ))}
          </select>
          <span className="tag tag-create">New entry</span>
        </p>
        <input
          className="ed-title"
          value={title}
          aria-label="Title"
          onChange={(e) => {
            setTitle(e.target.value);
            setExisting(null);
          }}
        />
        {existing && (
          <p className="banner">
            An entry called “{stemOf(existing)}” exists.{" "}
            <Link to={entryUrl(existing)}>Open it</Link>, or choose another title.
          </p>
        )}

        {paras.map((text, i) => {
          const here = open.filter((c) => c.paragraph === i);
          const mine = i in against;
          return (
            <div key={i} className={`ed-block${here.length ? " has-conflict" : ""}`}>
              <Para
                value={text}
                label={`Paragraph ${i + 1}, editable`}
                boxRef={(el) => {
                  boxes.current[i] = el;
                }}
                onChange={(v) => setPara(i, v)}
                onBlur={() => recheck(i, paras)}
              />
              {here.map((c) => (
                <div key={c.path} className="ed-conflict">
                  <p className="guess">Conflicts with the lore</p>
                  <blockquote>{plain(c.quote)}</blockquote>
                  <Link className="lore-chip" to={entryUrl(c.path)}>
                    {c.title}
                  </Link>
                  <p className="change-actions">
                    <ActionButton
                      className="quiet"
                      disabled={working}
                      onClick={() => void suggest(i, fixFor(c))}
                    >
                      {working ? "Working…" : "Fix it for me"}
                    </ActionButton>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setAgainst((a) => ({ ...a, [i]: c.path }))}
                    >
                      Keep mine anyway
                    </button>
                  </p>
                </div>
              ))}
              <p className="ed-meta">
                {checking === i && <span className="muted">Checking against the lore…</span>}
                {mine && (
                  <span className="ed-mark">Kept against the lore. The file will say so.</span>
                )}
                {edited(i) && !mine && checking !== i && here.length === 0 && (
                  <span className="ed-mark">Edited by you. Rechecked.</span>
                )}
                {(edited(i) || mine) && (
                  <button type="button" className="lore-chip" onClick={() => undo(i)}>
                    Undo
                  </button>
                )}
                {asking !== i && (
                  <button
                    type="button"
                    className="lore-chip"
                    onClick={() => {
                      setAsking(i);
                      setSuggestion(null);
                    }}
                  >
                    <Icon icon={Sparkles} size="sm" /> Change this…
                  </button>
                )}
              </p>
              {asking === i && !suggestion && (
                <ChangePrompt
                  working={working}
                  onSuggest={(how) => void suggest(i, how)}
                  onCancel={() => setAsking(null)}
                />
              )}
              {suggestion?.i === i && (
                <div className="ed-sug">
                  <p className="crumbs">Suggested change</p>
                  <p className="ed-sug-text">
                    <WordDiff parts={wordChanges(paras[i]!, suggestion.text).parts} />
                  </p>
                  <p className="change-actions">
                    <button type="button" className="primary" onClick={() => accept(false)}>
                      Accept
                    </button>
                    <button type="button" className="quiet" onClick={() => accept(true)}>
                      Edit first
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        setSuggestion(null);
                        setAsking(null);
                      }}
                    >
                      Dismiss
                    </button>
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {proposal.notSaid.length > 0 && (
          <>
            <p className="crumbs">Not said yet</p>
            <ul className="ed-not-said muted">
              {proposal.notSaid.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </>
        )}
        {links.length > 0 && (
          <>
            <p className="crumbs">Links</p>
            <p className="lore-chips">
              {links.map((l) => (
                <span key={l.title} className={`lore-chip${l.exists ? "" : " is-new"}`}>
                  {l.title}
                  {l.exists ? "" : " · would be new"}
                </span>
              ))}
            </p>
          </>
        )}
      </div>

      {failure && <Problem reason={failure} />}
      <p className="change-actions">
        <ActionButton className="primary" disabled={!canKeep} onClick={() => void keep()}>
          {saving ? "Keeping…" : "Keep as unsaved change"}
        </ActionButton>
        <button type="button" className="quiet" onClick={onClose}>
          Discard
        </button>
      </p>
      <p className="muted ed-note">
        {open.length > 0
          ? "Decide how to handle each conflict to keep the draft. "
          : paras.some((_, i) => edited(i))
            ? "Your edits are included. "
            : ""}
        Nothing enters the library until you publish a version.
      </p>
    </section>
  );
}
