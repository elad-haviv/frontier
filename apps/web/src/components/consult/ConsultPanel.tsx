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
import { api, ApiFailure, type ConsultFinding, type ConsultResult, entryUrl } from "../../api.ts";
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

interface Ask {
  open: boolean;
  question: string;
  busy: boolean;
  reply: { text: string; checked: boolean } | null;
}

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
  const [result, setResult] = useState<ConsultResult | null>(null);
  /** The text as it was when the review was asked, to see whether it was edited since. */
  const [ranOn, setRanOn] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const [asks, setAsks] = useState<Record<string, Ask>>({});
  const [commented, setCommented] = useState<Set<string>>(new Set());
  const stop = useRef<AbortController | null>(null);
  const seen = useRef(new Map<string, number>());
  const list = useRef<HTMLDivElement>(null);

  // Without changes there is nothing for "My changes" to read.
  const edits = p.hasChanges ? scope : "content";
  const selected = view.state.sliceDoc(
    view.state.selection.main.from,
    view.state.selection.main.to,
  );
  const passage = selected.trim() !== "" ? selected : null;
  const text = view.state.doc.toString();
  const editedSince = result !== null && text !== ranOn;

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
      setResult(r);
      setRanOn(text);
      setHidden(new Set());
      setAsks({});
      setCommented(new Set());
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
    for (const f of result?.findings ?? []) {
      const at = findAnchor(text, f.anchor, seen.current.get(f.id) ?? 0);
      if (at) seen.current.set(f.id, at.from);
      out.set(f.id, at);
    }
    return out;
    // The text is read again whenever it changes.
  }, [result, p.textTick, text]);

  const open = (result?.findings ?? []).filter((f) => !hidden.has(f.id));

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

  function apply(f: ConsultFinding) {
    const at = places.get(f.id);
    if (!at || f.suggestion === "") return;
    view.dispatch({
      changes: { from: at.from, to: at.to, insert: f.suggestion },
      selection: { anchor: at.from + f.suggestion.length },
      effects: showFinding.of(null),
      userEvent: "input.ai",
      scrollIntoView: true,
    });
    setHidden((h) => new Set(h).add(f.id));
    view.focus();
    toast({
      message: "Passage replaced",
      action: {
        label: "Undo",
        run: () => {
          undo(view);
          setHidden((h) => {
            const next = new Set(h);
            next.delete(f.id);
            return next;
          });
          view.focus();
        },
      },
      duration: UNDO_MS,
    });
  }

  async function makeComment(f: ConsultFinding) {
    const at = places.get(f.id);
    if (!at) return;
    try {
      await api.addComment({
        path: p.path,
        ...anchorAt(view.state.doc.toString(), at.from, at.to),
        text: f.comment,
        for: "me",
      });
      setCommented((c) => new Set(c).add(f.id));
      p.onCommented();
    } catch {
      toast({ message: "The comment could not be kept." });
    }
  }

  function dismiss(f: ConsultFinding) {
    setHidden((h) => new Set(h).add(f.id));
    if (current === f.id) {
      setCurrent(null);
      view.dispatch({ effects: showFinding.of(null) });
    }
  }

  const patch = (id: string, change: Partial<Ask>) =>
    setAsks((a) => ({
      ...a,
      [id]: { open: false, question: "", busy: false, reply: null, ...a[id], ...change },
    }));

  async function ask(f: ConsultFinding) {
    const question = (asks[f.id]?.question ?? "").trim();
    if (!question) return;
    patch(f.id, { busy: true });
    try {
      const r = await api.consultAsk({
        path: p.path,
        text: view.state.doc.toString(),
        question,
        finding: { kind: f.kind, anchor: f.anchor, comment: f.comment },
      });
      patch(f.id, { busy: false, reply: { text: r.text, checked: r.sources.length > 0 } });
    } catch {
      patch(f.id, {
        busy: false,
        reply: { text: "No answer this time. Try again.", checked: false },
      });
    }
  }

  // ----- what the panel says -----
  let top;
  if (p.canWrite === false) {
    top = (
      <>
        <p className="consult-note">
          Consult needs an AI model. Choose one once in Settings and it works in every entry.
        </p>
        <Link className="consult-go" to="/settings/ai/models/conversation">
          Open Settings
        </Link>
      </>
    );
  } else {
    top = (
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
            {result ? "Consult again" : "Consult"}
          </ActionButton>
        )}
        {phase.kind === "failed" && (
          <p className="consult-note" role="alert">
            {phase.message}
          </p>
        )}
      </>
    );
  }

  return (
    <aside className="consult-panel" aria-label="Consult">
      <div className="consult-pane" ref={list}>
        {top}
        {result && p.canWrite !== false && (
          <>
            {editedSince && <p className="consult-edited">Edited since this review.</p>}
            {result.focus !== edits && edits === "edits" && (
              <p className="consult-scope">
                Nothing has changed since the entry was published, so the whole entry was read.
              </p>
            )}
            <p className="consult-summary">
              {result.summary}
              <small>
                Read {result.given.length} {result.given.length === 1 ? "entry" : "entries"}
                {result.given.length > 0 && `: ${result.given.map((g) => g.title).join(", ")}`}
                {result.partial && " · Partial review: the entry is long."}
                {result.typos > 0 && ` · Typo-level changes: ${result.typos}.`}
              </small>
            </p>
            {result.edits.length > 0 && (
              <>
                <h3 className="consult-sec">Your edits</h3>
                <ul className="consult-edits">
                  {result.edits.map((e) => (
                    <li key={e.hunk}>
                      <span className={`consult-verdict is-${e.verdict}`}>
                        {VERDICT[e.verdict]}
                      </span>
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
            {open.length === 0 && (
              <p className="consult-scope">
                {result.findings.length === 0
                  ? `No concerns found. The AI looked at ${result.given.length} ${result.given.length === 1 ? "entry" : "entries"} besides this one.`
                  : "All findings dismissed."}
              </p>
            )}
            {open.map((f) => {
              const at = places.get(f.id);
              const a = asks[f.id];
              return (
                <article
                  key={f.id}
                  className="consult-card"
                  aria-current={current === f.id}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest("button,input,details,a")) jump(f);
                  }}
                >
                  <div className="consult-row">
                    <span className={`consult-kind is-${f.severity}`}>{KIND[f.kind]}</span>
                    <span className={`consult-cert is-${f.certainty}`}>
                      {f.certainty === "checked" && (
                        <>
                          <Check size={12} aria-hidden="true" /> Checked
                        </>
                      )}
                      {f.certainty === "opinion" && "Opinion"}
                      {f.certainty === "unverified" && "Unverified"}
                      {!at && " · Passage changed"}
                    </span>
                  </div>
                  <p className="consult-head">{f.comment}</p>
                  <p className="consult-quote">{f.anchor}</p>
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
                  {f.suggestion && at && (
                    <p className="consult-suggest">
                      Suggested: <ins>{f.suggestion}</ins>
                    </p>
                  )}
                  <div className="consult-acts">
                    {f.suggestion && at && (
                      <button type="button" className="consult-apply" onClick={() => apply(f)}>
                        Apply
                      </button>
                    )}
                    {!at && (
                      <button type="button" className="consult-ghost" onClick={() => void run()}>
                        Re-check
                      </button>
                    )}
                    <button
                      type="button"
                      className="consult-ghost"
                      onClick={() => patch(f.id, { open: !a?.open })}
                    >
                      Ask more
                    </button>
                    {at && (
                      <button
                        type="button"
                        className="consult-ghost"
                        disabled={commented.has(f.id)}
                        onClick={() => void makeComment(f)}
                      >
                        {commented.has(f.id) ? "Comment added" : "Make a comment"}
                      </button>
                    )}
                    <button type="button" className="consult-ghost" onClick={() => dismiss(f)}>
                      Dismiss
                    </button>
                  </div>
                  {a?.open && (
                    <form
                      className="consult-follow"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void ask(f);
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
                  {a?.reply && (
                    <p className="consult-reply">
                      {a.reply.text}{" "}
                      <i>
                        {a.reply.checked ? "Checked against the lore." : "Opinion, not checked."}
                      </i>
                    </p>
                  )}
                </article>
              );
            })}
          </>
        )}
      </div>
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
