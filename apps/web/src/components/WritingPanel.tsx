import type { EditorView } from "@codemirror/view";
import { ActionButton } from "./ui/ActionButton.tsx";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiFailure, askUrl, type LoreTurn } from "../api.ts";
import { Diff } from "./Diff.tsx";

const HOWS = [
  ["shorter", "Shorter"],
  ["longer", "Longer"],
  ["simpler", "Simpler"],
  ["vivid", "More vivid"],
] as const;

/** The passage the panel works on: the selection, or else the paragraph the cursor is in. */
export function passageOf(view: EditorView): { from: number; to: number; text: string } {
  const { from, to } = view.state.selection.main;
  if (from !== to) return { from, to, text: view.state.sliceDoc(from, to) };
  const doc = view.state.doc;
  let first = doc.lineAt(from);
  let last = first;
  while (first.number > 1 && doc.line(first.number - 1).text.trim() !== "") {
    first = doc.line(first.number - 1);
  }
  while (last.number < doc.lines && doc.line(last.number + 1).text.trim() !== "") {
    last = doc.line(last.number + 1);
  }
  return { from: first.from, to: last.to, text: view.state.sliceDoc(first.from, last.to) };
}

const failed = (err: unknown, fallback: string) =>
  err instanceof ApiFailure ? err.message : fallback;

/**
 * Writing help: the passage rewritten as asked, shown as a difference before it replaces
 * anything; or a question about the passage, answered from the lore.
 */
export function WritingPanel(p: { view: EditorView; path: string; onClose: () => void }) {
  // The passage is fixed when the panel opens, so the text it replaces is the text shown.
  const [passage] = useState(() => passageOf(p.view));
  const [own, setOwn] = useState("");
  const [rewrite, setRewrite] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ id: string; turn: LoreTurn } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const around = (from: number, to: number) => ({
    before: p.view.state.sliceDoc(Math.max(0, from - 1200), from),
    after: p.view.state.sliceDoc(to, Math.min(p.view.state.doc.length, to + 1200)),
  });

  async function ask(how: string) {
    setBusy(how);
    setError(null);
    setRewrite(null);
    try {
      const { text } = await api.rewrite({
        path: p.path,
        passage: passage.text,
        ...around(passage.from, passage.to),
        how,
      });
      setRewrite(text);
    } catch (err) {
      setError(failed(err, "Nothing came back."));
    } finally {
      setBusy(null);
    }
  }

  /** Puts the rewrite in the text, if the passage is still there as it was. */
  function put(where: "replace" | "below") {
    if (rewrite === null) return;
    const now = p.view.state.sliceDoc(passage.from, passage.to);
    if (now !== passage.text) {
      setError(
        "The passage changed since the panel opened. Close it and select the passage again.",
      );
      return;
    }
    p.view.dispatch(
      where === "replace"
        ? { changes: { from: passage.from, to: passage.to, insert: rewrite } }
        : { changes: { from: passage.to, insert: `\n\n${rewrite}` } },
    );
    p.view.focus();
    p.onClose();
  }

  async function consult(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy("ask");
    setError(null);
    try {
      const title = p.path.split("/").pop()!.replace(/\.md$/i, "");
      const { conversation } = await api.ask(
        `About this passage of "${title}":\n"""\n${passage.text}\n"""\n${question.trim()}`,
      );
      setAnswer({ id: conversation.id, turn: conversation.turns.at(-1)! });
    } catch (err) {
      setError(failed(err, "The question could not be asked."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="writing-panel" aria-label="Writing help">
      <header>
        <h2>Writing help</h2>
        <button type="button" className="quiet" onClick={p.onClose}>
          Close
        </button>
      </header>
      <p className="muted writing-passage">
        {passage.text.length > 160 ? `${passage.text.slice(0, 160)} …` : passage.text}
      </p>
      <div className="writing-hows" role="group" aria-label="Rewrite it">
        {HOWS.map(([how, label]) => (
          <ActionButton
            key={how}
            type="button"
            className="quiet"
            disabled={busy !== null}
            onClick={() => void ask(how)}
          >
            {busy === how ? "Writing…" : label}
          </ActionButton>
        ))}
      </div>
      <form
        className="writing-own"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim()) void ask(own.trim());
        }}
      >
        <input
          type="text"
          aria-label="Rewrite it in your own words"
          placeholder="Or say how: as a legend told by an elder…"
          value={own}
          onChange={(e) => setOwn(e.target.value)}
        />
        <ActionButton type="submit" className="quiet" disabled={busy !== null || !own.trim()}>
          Rewrite
        </ActionButton>
      </form>
      {rewrite !== null && (
        <>
          <Diff before={passage.text} after={rewrite} />
          <p className="change-actions">
            <button type="button" className="primary" onClick={() => put("replace")}>
              Replace
            </button>
            <button type="button" className="quiet" onClick={() => put("below")}>
              Put below
            </button>
            <button type="button" className="plain" onClick={() => setRewrite(null)}>
              Discard
            </button>
          </p>
        </>
      )}
      <form className="writing-own" onSubmit={consult}>
        <input
          type="text"
          aria-label="Ask the lore about this passage"
          placeholder="Ask the lore about this passage…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <ActionButton type="submit" className="quiet" disabled={busy !== null || !question.trim()}>
          {busy === "ask" ? "Reading…" : "Ask"}
        </ActionButton>
      </form>
      {answer && (
        <div className="writing-answer">
          {answer.turn.answer.paragraphs.map((para, i) => (
            <p key={i} className={para.grounded ? "" : "guess-text"}>
              {para.text}
              {!para.grounded && <em> (a guess: no passage supports it)</em>}
            </p>
          ))}
          {answer.turn.answer.missing && (
            <p className="muted">Not in the lore: {answer.turn.answer.missing}</p>
          )}
          <Link to={askUrl(answer.id)}>Open the conversation, with its sources</Link>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
