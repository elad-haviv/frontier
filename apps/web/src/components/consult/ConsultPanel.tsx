/**
 * Consult (stage 24): the AI's opinion of the entry being edited, in the right side bar. It reads
 * the author's unsaved changes against the published text, or the entry as a whole, and lists
 * findings anchored to passages. It advises only: nothing changes unless he presses Apply.
 */
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { Check, Scale } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  ApiFailure,
  type ConsultChange,
  type ConsultFinding,
  type ConsultReview,
  entryUrl,
} from "../../api.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { anchorAt } from "../anchor.ts";
import { ActionButton } from "../ui/ActionButton.tsx";
import { useToast } from "../ui/Toast.tsx";
import { findAnchor } from "./anchor.ts";
import { showFinding } from "./marks.ts";
import "./Consult.css";

const LOOKS = [
  ["lore", "Lore"],
  ["clarity", "Clarity"],
  ["gaps", "Gaps"],
  ["voice", "Voice"],
  ["structure", "Structure"],
] as const;

const KIND: Record<ConsultFinding["kind"], string> = {
  contradiction: "Contradicts lore",
  rule: "Breaks a rule",
  dependency: "Others rely on this",
  clarity: "Unclear",
  gap: "Gap",
  voice: "Voice",
  structure: "Structure",
};

const VERDICT = { better: "Better", neutral: "Neutral", worse: "Worse", risky: "Risky" } as const;

/** The most of a selection that can be looked at alone, as for writing help. */
const MAX_PASSAGE = 6000;
const UNDO_MS = 6000;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

type Phase = { kind: "idle" } | { kind: "waiting" } | { kind: "failed"; message: string };
type View = { kind: "latest" } | { kind: "history" } | { kind: "past"; id: string };

/** What the author is typing to ask more about a finding. */
interface Ask {
  open: boolean;
  question: string;
  busy: boolean;
}

const SCOPE = { edits: "My changes", content: "Whole entry", passage: "Selected passage" } as const;

/** "25 Nov, 13:40". */
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const firstLine = (s: string) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);

/** How a review's findings ended, as the chips on its row. */
function tally(r: ConsultReview) {
  const count = (f: (x: ConsultFinding) => boolean) => r.findings.filter(f).length;
  return {
    open: count((f) => f.state === "open"),
    applied: count((f) => f.state === "applied"),
    dismissed: count((f) => f.state === "dismissed"),
    commented: count((f) => f.commented),
  };
}

const merge = (f: ConsultFinding, c: ConsultChange): ConsultFinding => ({
  ...f,
  ...(c.state === undefined ? {} : { state: c.state }),
  ...(c.commented === undefined ? {} : { commented: c.commented }),
  ...(c.applied === undefined ? {} : { applied: c.applied }),
  ...(c.ask ? { asks: [...f.asks, c.ask] } : {}),
});

export function ConsultPanel(p: {
  view: EditorView;
  path: string;
  /** Whether a model is chosen; null while that is not known yet. */
  canWrite: boolean | null;
  /** Whether the text differs from the published entry, so "My changes" has something to read. */
  hasChanges: boolean;
  /** Changes whenever the text does, so the list sees what is still where. */
  textTick: number;
  /** Changes each time the author asks, as by the menu or the key, to run a review at once. */
  runRequest: number;
  /** Takes the request, if there is one still waiting: true once, for the panel that opens for it. */
  takeRun: () => { scope?: "content" } | null;
  /** A finding's passage was shown; on a phone the sheet closes and a pill brings it back. */
  onJump: () => void;
  /** A comment was made from a finding. */
  onCommented: () => void;
}) {
  const { view } = p;
  const toast = useToast();
  const offline = useNeedsConnection();
  const [scope, setScope] = useState<"edits" | "content">(p.hasChanges ? "edits" : "content");
  const [looks, setLooks] = useState<Set<string>>(() => new Set(LOOKS.map(([id]) => id)));
  const [how, setHow] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** The entry's saved reviews, newest first; null until they are read. */
  const [reviews, setReviews] = useState<ConsultReview[] | null>(null);
  const [shown, setShown] = useState<View>({ kind: "latest" });
  const [confirm, setConfirm] = useState<"delete" | "clear" | null>(null);
  /** The text as it was when this page last asked, to see whether it was edited since. */
  const [ranOn, setRanOn] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [asks, setAsks] = useState<Record<string, Ask>>({});
  const stop = useRef<AbortController | null>(null);
  const seen = useRef(new Map<string, number>());

  // The reviews kept from before come back when the tab opens.
  useEffect(() => {
    let live = true;
    api.consultReviews(p.path).then(
      (r) => live && setReviews((now) => now ?? r.reviews),
      () => live && setReviews((now) => now ?? []),
    );
    return () => {
      live = false;
    };
  }, [p.path]);

  // Without changes there is nothing for "My changes" to read.
  const edits = p.hasChanges ? scope : "content";
  const selected = view.state.sliceDoc(
    view.state.selection.main.from,
    view.state.selection.main.to,
  );
  const passage = selected.trim() !== "" ? selected : null;
  const text = view.state.doc.toString();

  const all = reviews ?? [];
  const review =
    shown.kind === "past" ? (all.find((r) => r.id === shown.id) ?? null) : (all[0] ?? null);
  const editedSince = shown.kind === "latest" && ranOn !== null && text !== ranOn;

  async function run(force?: "edits" | "content") {
    if (phase.kind === "waiting") return;
    const focus = p.hasChanges ? (force ?? scope) : "content";
    if (offline || p.canWrite === false) return;
    if (passage && passage.length > MAX_PASSAGE) {
      setPhase({ kind: "failed", message: "Select a shorter part (up to about a page)." });
      return;
    }
    if (text.replace(/\s/g, "") === "") {
      setPhase({ kind: "failed", message: "Write something first." });
      return;
    }
    stop.current?.abort();
    const control = new AbortController();
    stop.current = control;
    setPhase({ kind: "waiting" });
    try {
      const r = await api.consult(
        {
          path: p.path,
          text,
          focus,
          ...(passage && focus === "content" ? { passage } : {}),
          looks: [...looks],
          ...(how.trim() ? { how: how.trim() } : {}),
        },
        control.signal,
      );
      // The server keeps only the last twenty; the list here follows.
      setReviews((now) => [r, ...(now ?? [])].slice(0, 20));
      setShown({ kind: "latest" });
      setConfirm(null);
      setRanOn(text);
      setAsks({});
      setCurrent(null);
      seen.current.clear();
      view.dispatch({ effects: showFinding.of(null) });
      setPhase({ kind: "idle" });
    } catch (err) {
      if (control.signal.aborted) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({
        kind: "failed",
        message:
          err instanceof ApiFailure && err.code !== "ai_bad_answer"
            ? err.message
            : "The model did not answer this time. Nothing in your text changed.",
      });
    }
  }

  function halt() {
    stop.current?.abort();
    setPhase({ kind: "idle" });
  }

  // Asked for by the menu or the key, including the press that opened the panel.
  useEffect(() => {
    const asked = p.takeRun();
    if (!asked) return;
    if (asked.scope) setScope(asked.scope);
    setShown({ kind: "latest" });
    void run(asked.scope);
    // On opening, and each time it is asked again.
  }, [p.runRequest]);
  useEffect(() => () => stop.current?.abort(), []);
  // Esc stops a request in flight.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && halt();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase.kind]);

  /** Where each finding's passage is in the text now. */
  const places = useMemo(() => {
    const out = new Map<string, { from: number; to: number } | null>();
    for (const f of review?.findings ?? []) {
      const at = findAnchor(text, f.anchor, seen.current.get(f.id) ?? 0);
      if (at) seen.current.set(f.id, at.from);
      out.set(f.id, at);
    }
    return out;
    // The text is read again whenever it changes.
  }, [review, p.textTick, text]);

  /** Keeps what the author did: shown at once, sent to the server, and put back if that fails. */
  function change(r: ConsultReview, f: ConsultFinding, c: ConsultChange) {
    const apply = (list: ConsultReview[] | null, fn: (x: ConsultFinding) => ConsultFinding) =>
      (list ?? []).map((x) =>
        x.id === r.id ? { ...x, findings: x.findings.map((y) => (y.id === f.id ? fn(y) : y)) } : x,
      );
    setReviews((now) => apply(now, (x) => merge(x, c)));
    void api.consultChange(r.id, f.id, c).catch(() => {
      setReviews((now) => apply(now, () => f));
      toast({ message: "That could not be kept. Try again." });
    });
  }

  function jump(f: ConsultFinding) {
    setCurrent(f.id);
    const at = places.get(f.id);
    if (!at) {
      view.dispatch({ effects: showFinding.of(null) });
      return;
    }
    view.dispatch({
      effects: [showFinding.of(at), EditorView.scrollIntoView(at.from, { y: "center" })],
    });
    p.onJump();
  }

  function apply(r: ConsultReview, f: ConsultFinding) {
    const at = places.get(f.id);
    if (!at || f.suggestion === "") return;
    const before = view.state.sliceDoc(at.from, at.to);
    view.dispatch({
      changes: { from: at.from, to: at.to, insert: f.suggestion },
      selection: { anchor: at.from + f.suggestion.length },
      effects: showFinding.of(null),
      userEvent: "input.ai",
      scrollIntoView: true,
    });
    change(r, f, { state: "applied", applied: { before, after: f.suggestion } });
    view.focus();
    toast({
      message: "Passage replaced",
      action: {
        label: "Undo",
        run: () => {
          undo(view);
          change(r, { ...f, state: "applied" }, { state: "open", applied: null });
          view.focus();
        },
      },
      duration: UNDO_MS,
    });
  }

  async function makeComment(r: ConsultReview, f: ConsultFinding) {
    const at = places.get(f.id);
    if (!at) return;
    try {
      await api.addComment({
        path: p.path,
        ...anchorAt(view.state.doc.toString(), at.from, at.to),
        text: f.comment,
        for: "me",
      });
      change(r, f, { commented: true });
      p.onCommented();
    } catch {
      toast({ message: "The comment could not be kept." });
    }
  }

  function dismiss(r: ConsultReview, f: ConsultFinding) {
    change(r, f, { state: "dismissed" });
    if (current === f.id) {
      setCurrent(null);
      view.dispatch({ effects: showFinding.of(null) });
    }
  }

  const patch = (id: string, c: Partial<Ask>) =>
    setAsks((a) => ({
      ...a,
      [id]: { open: false, question: "", busy: false, ...a[id], ...c },
    }));

  async function ask(r: ConsultReview, f: ConsultFinding) {
    const question = (asks[f.id]?.question ?? "").trim();
    if (!question) return;
    patch(f.id, { busy: true });
    let reply = { reply: "No answer this time. Try again.", checked: false };
    let ok = false;
    try {
      const a = await api.consultAsk({
        path: p.path,
        text: view.state.doc.toString(),
        question,
        finding: { kind: f.kind, anchor: f.anchor, comment: f.comment },
      });
      reply = { reply: a.text, checked: a.sources.length > 0 };
      ok = true;
    } catch {
      // The message above is shown, and not kept.
    }
    patch(f.id, { busy: false, ...(ok ? { question: "" } : {}) });
    if (ok) change(r, f, { ask: { question, ...reply } });
    else toast({ message: reply.reply });
  }

  async function remove(r: ConsultReview) {
    try {
      await api.consultDelete(r.id);
      setReviews((now) => (now ?? []).filter((x) => x.id !== r.id));
      setShown({ kind: "history" });
      setConfirm(null);
      view.dispatch({ effects: showFinding.of(null) });
    } catch {
      toast({ message: "The review could not be deleted. Try again." });
    }
  }

  async function clearAll() {
    try {
      await api.consultClear(p.path);
      setReviews([]);
      setShown({ kind: "latest" });
      setConfirm(null);
      view.dispatch({ effects: showFinding.of(null) });
    } catch {
      toast({ message: "The history could not be cleared. Try again." });
    }
  }

  // ----- what the panel says -----
  const form =
    p.canWrite === false ? (
      <>
        <p className="consult-note">
          Consult needs an AI model. Choose one once in Settings and it works in every entry.
        </p>
        <Link className="consult-go" to="/settings/ai/models/conversation">
          Open Settings
        </Link>
      </>
    ) : (
      <>
        <div className="consult-seg" role="group" aria-label="What to look at">
          <button
            type="button"
            aria-pressed={edits === "edits"}
            disabled={!p.hasChanges}
            onClick={() => setScope("edits")}
          >
            My changes
          </button>
          <button
            type="button"
            aria-pressed={edits === "content"}
            onClick={() => setScope("content")}
          >
            Whole entry
          </button>
        </div>
        <p className="consult-scope">
          {edits === "edits"
            ? "Compares your text with the published entry."
            : !p.hasChanges
              ? "No edits since published. Change something, or review the whole entry."
              : passage
                ? `Selected passage, ${words(passage)} words.`
                : "The whole entry."}
        </p>
        <div className="consult-chips" role="group" aria-label="Look for">
          {LOOKS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="consult-chip"
              aria-pressed={looks.has(id)}
              onClick={() =>
                setLooks((s) => {
                  const next = new Set(s);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next.size === 0 ? s : next;
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="consult-say"
          value={how}
          placeholder="Anything specific? e.g. does the timeline still work?"
          aria-label="Anything specific"
          maxLength={400}
          onChange={(e) => setHow(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
        />
        {offline ? (
          <p className="consult-note">
            Consult needs a connection. Your text is safe; try again when you are back online.
          </p>
        ) : phase.kind === "waiting" ? (
          <div className="consult-wait" role="status">
            <span className="consult-spin" aria-hidden="true" />
            Reading your entry…
            <button type="button" className="consult-ghost" onClick={halt}>
              Stop
            </button>
          </div>
        ) : (
          <ActionButton type="button" className="consult-go" onClick={() => void run()}>
            {all.length > 0 ? "Consult again" : "Consult"}
          </ActionButton>
        )}
        {phase.kind === "failed" && (
          <p className="consult-note" role="alert">
            {phase.message}
          </p>
        )}
      </>
    );

  function card(r: ConsultReview, f: ConsultFinding) {
    const at = places.get(f.id);
    const a = asks[f.id];
    const open = f.state === "open";
    return (
      <article
        key={f.id}
        className={`consult-card${f.state === "dismissed" ? " is-dismissed" : ""}`}
        aria-current={current === f.id}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button,input,details,a")) jump(f);
        }}
      >
        <div className="consult-row">
          <span className={`consult-kind is-${f.severity}`}>{KIND[f.kind]}</span>
          <span className="consult-tags">
            {f.state === "applied" && <span className="consult-state is-applied">✓ Applied</span>}
            {f.state === "dismissed" && <span className="consult-state">Dismissed</span>}
            {f.commented && <span className="consult-state">Comment added</span>}
            <span className={`consult-cert is-${f.certainty}`}>
              {f.certainty === "checked" && (
                <>
                  <Check size={12} aria-hidden="true" /> Checked
                </>
              )}
              {f.certainty === "opinion" && "Opinion"}
              {f.certainty === "unverified" && "Unverified"}
            </span>
          </span>
        </div>
        <p className="consult-head">{f.comment}</p>
        <p className="consult-quote">{f.anchor}</p>
        {f.applied && (
          <p className="consult-suggest">
            <del>{f.applied.before}</del> <ins>{f.applied.after}</ins>
          </p>
        )}
        {!at && <p className="consult-scope">Passage changed, so it can't be shown in the text.</p>}
        {f.sources.length > 0 && (
          <details>
            <summary>Where this comes from</summary>
            {f.sources.map((s) => (
              <p key={s.path + s.quote} className="consult-source">
                {s.title}: <q>{s.quote}</q> ·{" "}
                <Link to={entryUrl(s.path)}>{s.path.replace(/\.md$/i, "")}</Link>
              </p>
            ))}
          </details>
        )}
        {open && f.suggestion && at && (
          <p className="consult-suggest">
            Suggested: <ins>{f.suggestion}</ins>
          </p>
        )}
        <div className="consult-acts">
          {open && f.suggestion && at && (
            <button type="button" className="consult-apply" onClick={() => apply(r, f)}>
              Apply
            </button>
          )}
          {at && f.state !== "dismissed" && (
            <button type="button" className="consult-ghost" onClick={() => jump(f)}>
              Show in the text
            </button>
          )}
          {open && !at && shown.kind === "latest" && (
            <button type="button" className="consult-ghost" onClick={() => void run()}>
              Re-check
            </button>
          )}
          {f.state === "dismissed" ? (
            <button
              type="button"
              className="consult-ghost"
              onClick={() => change(r, f, { state: "open" })}
            >
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                className="consult-ghost"
                onClick={() => patch(f.id, { open: !a?.open })}
              >
                Ask more
              </button>
              {at && !f.commented && (
                <button
                  type="button"
                  className="consult-ghost"
                  onClick={() => void makeComment(r, f)}
                >
                  Make a comment
                </button>
              )}
              {open && (
                <button type="button" className="consult-ghost" onClick={() => dismiss(r, f)}>
                  Dismiss
                </button>
              )}
            </>
          )}
        </div>
        {f.asks.map((x, i) => (
          <div key={i} className="consult-thread">
            <p className="consult-question">{x.question}</p>
            <p className="consult-reply">
              {x.reply} <i>{x.checked ? "Checked against the lore." : "Opinion, not checked."}</i>
            </p>
          </div>
        ))}
        {a?.open && (
          <form
            className="consult-follow"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(r, f);
            }}
          >
            <input
              className="consult-say"
              aria-label="Ask about this finding"
              placeholder="Ask about this finding"
              value={a.question}
              maxLength={600}
              onChange={(e) => patch(f.id, { question: e.target.value })}
            />
            <button type="submit" className="consult-go" disabled={a.busy}>
              {a.busy ? "…" : "Ask"}
            </button>
          </form>
        )}
      </article>
    );
  }

  /** A saved review, with its summary, its edits and its findings. */
  function reviewView(r: ConsultReview, latest: boolean) {
    const live = r.findings.filter((f) => f.state !== "dismissed");
    const dismissed = r.findings.filter((f) => f.state === "dismissed");
    return (
      <>
        <div className="consult-top">
          <span>
            <b>{latest ? "Latest review" : when(r.at)}</b>
            <small>
              {latest && `${when(r.at)} · `}
              {SCOPE[r.scope]} · {r.findings.length}{" "}
              {r.findings.length === 1 ? "finding" : "findings"}
            </small>
          </span>
          {latest && all.length > 0 && (
            <button
              type="button"
              className="consult-ghost"
              onClick={() => setShown({ kind: "history" })}
            >
              History ({all.length})
            </button>
          )}
        </div>
        {editedSince && <p className="consult-edited">Edited since this review.</p>}
        {r.focus !== r.scope && r.scope === "content" && p.hasChanges && (
          <p className="consult-scope">
            Nothing had changed since the entry was published, so the whole entry was read.
          </p>
        )}
        <p className="consult-summary">
          {r.summary}
          <small>
            Read {r.given.length} {r.given.length === 1 ? "entry" : "entries"}
            {r.given.length > 0 && `: ${r.given.map((g) => g.title).join(", ")}`}
            {r.partial && " · Partial review: the entry is long."}
            {r.typos > 0 && ` · Typo-level changes: ${r.typos}.`}
          </small>
        </p>
        {r.edits.length > 0 && (
          <>
            <h3 className="consult-sec">Your edits</h3>
            <ul className="consult-edits">
              {r.edits.map((e) => (
                <li key={e.hunk}>
                  <span className={`consult-verdict is-${e.verdict}`}>{VERDICT[e.verdict]}</span>
                  <span>
                    <q>{e.after.length >= 140 ? `${e.after}…` : e.after || "(removed)"}</q>{" "}
                    {e.reason}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <h3 className="consult-sec">Findings</h3>
        {r.findings.length === 0 && (
          <p className="consult-scope">
            No concerns found. The AI looked at {r.given.length}{" "}
            {r.given.length === 1 ? "entry" : "entries"} besides this one.
          </p>
        )}
        {live.map((f) => card(r, f))}
        {dismissed.length > 0 && (
          <details className="consult-dismissed">
            <summary>Dismissed ({dismissed.length})</summary>
            {dismissed.map((f) => card(r, f))}
          </details>
        )}
        {!latest && (
          <>
            <button type="button" className="consult-ghost" onClick={() => void run(r.focus)}>
              Consult again
            </button>
            {confirm === "delete" ? (
              <div className="consult-confirm">
                Delete this review?
                <span className="consult-acts">
                  <button type="button" className="consult-ghost" onClick={() => void remove(r)}>
                    Delete
                  </button>
                  <button type="button" className="consult-ghost" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </span>
              </div>
            ) : (
              <button type="button" className="consult-link" onClick={() => setConfirm("delete")}>
                Delete this review
              </button>
            )}
          </>
        )}
      </>
    );
  }

  let body;
  if (shown.kind === "history") {
    body = (
      <>
        <div className="consult-top">
          <button
            type="button"
            className="consult-link"
            onClick={() => setShown({ kind: "latest" })}
          >
            ← Latest review
          </button>
          {all.length > 0 && (
            <button type="button" className="consult-link" onClick={() => setConfirm("clear")}>
              Clear history
            </button>
          )}
        </div>
        <h3 className="consult-sec">History</h3>
        <p className="consult-scope">Kept on the server, not in the library.</p>
        {confirm === "clear" && (
          <div className="consult-confirm">
            Delete all {all.length} {all.length === 1 ? "review" : "reviews"} of this entry? This
            can't be undone.
            <span className="consult-acts">
              <button type="button" className="consult-ghost" onClick={() => void clearAll()}>
                Delete all
              </button>
              <button type="button" className="consult-ghost" onClick={() => setConfirm(null)}>
                Keep
              </button>
            </span>
          </div>
        )}
        {all.length === 0 && <p className="consult-scope">No reviews yet.</p>}
        {all.map((r) => {
          const t = tally(r);
          return (
            <button
              key={r.id}
              type="button"
              className="consult-row-btn"
              onClick={() => {
                setShown({ kind: "past", id: r.id });
                setConfirm(null);
              }}
            >
              <span className="consult-hrow-top">
                <span>{when(r.at)}</span>
                {t.open > 0 && <span className="consult-state is-open">{t.open} open</span>}
              </span>
              <span className="consult-scope">
                {SCOPE[r.scope]} · {firstLine(r.summary)}
              </span>
              <span className="consult-tags">
                {r.findings.length === 0 && <span className="consult-state">No findings</span>}
                {t.applied > 0 && (
                  <span className="consult-state is-applied">{t.applied} applied</span>
                )}
                {t.commented > 0 && <span className="consult-state">{t.commented} commented</span>}
                {t.dismissed > 0 && <span className="consult-state">{t.dismissed} dismissed</span>}
              </span>
            </button>
          );
        })}
        <p className="consult-scope">The last 20 reviews of each entry are kept.</p>
      </>
    );
  } else if (shown.kind === "past") {
    body = (
      <>
        <div className="consult-top">
          <button
            type="button"
            className="consult-link"
            onClick={() => setShown({ kind: "history" })}
          >
            ← History
          </button>
        </div>
        {review ? reviewView(review, false) : <p className="consult-scope">That review is gone.</p>}
      </>
    );
  } else {
    body = (
      <>
        {form}
        {review && p.canWrite !== false && reviewView(review, true)}
      </>
    );
  }

  return (
    <aside className="consult-panel" aria-label="Consult">
      <div className="consult-pane">{body}</div>
      <div className="consult-foot">
        <span>
          <Scale size={12} aria-hidden="true" /> Advice only. Nothing is saved or blocked.
        </span>
        <Link
          to="/ask"
          state={{
            question: `About the entry "${p.path.split("/").pop()?.replace(/\.md$/i, "")}":\n`,
          }}
        >
          Ask the lore
        </Link>
      </div>
    </aside>
  );
}
