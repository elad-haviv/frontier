import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { type FormEvent, useState } from "react";
import { api, ApiFailure, type PassageComment } from "../api.ts";
import { type Anchor, locate } from "./anchor.ts";
import { Diff } from "./Diff.tsx";

const failed = (err: unknown, fallback: string) =>
  err instanceof ApiFailure ? err.message : fallback;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …` : s);

/**
 * The comments on an entry: adding one on a passage, going to a passage, marking a comment done,
 * and, for a comment for the AI, its rewrite of the passage, shown as a difference first.
 */
export function CommentsPanel(p: {
  view: EditorView;
  path: string;
  comments: PassageComment[];
  /** A passage to comment on, when the panel was opened to add one. */
  adding: (Anchor & { from: number; to: number }) | null;
  /** Whether a model is chosen, so a comment can be for the AI. */
  canAi: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [forWhom, setForWhom] = useState<"me" | "ai">("me");
  const [adding, setAdding] = useState(p.adding);
  const [work, setWork] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doc = () => p.view.state.doc.toString();

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!adding || !text.trim()) return;
    setBusy("add");
    setError(null);
    try {
      await api.addComment({
        path: p.path,
        quote: adding.quote,
        prefix: adding.prefix,
        suffix: adding.suffix,
        text: text.trim(),
        for: forWhom,
      });
      setAdding(null);
      setText("");
      p.onChanged();
    } catch (err) {
      setError(failed(err, "The comment could not be kept."));
    } finally {
      setBusy(null);
    }
  }

  /** Where a comment's passage is in the text as it is now; the list may be a moment old. */
  function find(c: PassageComment): { from: number; to: number } | null {
    const at = locate(doc(), c);
    if (!at) setError("That passage is no longer in the text.");
    return at;
  }

  function show(c: PassageComment) {
    const at = find(c);
    if (!at) return;
    p.view.dispatch({
      selection: EditorSelection.single(at.from, at.to),
      scrollIntoView: true,
    });
    p.view.focus();
  }

  async function done(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.removeComment(id);
      if (work?.id === id) setWork(null);
      p.onChanged();
    } catch (err) {
      setError(failed(err, "The comment could not be marked done."));
    } finally {
      setBusy(null);
    }
  }

  async function hand(c: PassageComment) {
    setBusy(c.id);
    setError(null);
    try {
      await api.changeComment(c.id, { for: c.for === "ai" ? "me" : "ai" });
      p.onChanged();
    } catch (err) {
      setError(failed(err, "The comment could not be changed."));
    } finally {
      setBusy(null);
    }
  }

  async function workOn(c: PassageComment) {
    setError(null);
    setWork(null);
    const at = find(c);
    if (!at) return;
    setBusy(c.id);
    const text = doc();
    try {
      const res = await api.workOnComment(c.id, {
        before: text.slice(Math.max(0, at.from - 1200), at.from),
        after: text.slice(at.to, at.to + 1200),
      });
      setWork({ id: c.id, text: res.text });
    } catch (err) {
      setError(failed(err, "Nothing came back."));
    } finally {
      setBusy(null);
    }
  }

  /** Puts the AI's work in place of the passage, if the passage is still there, and closes it. */
  async function replace(c: PassageComment) {
    if (!work || work.id !== c.id) return;
    const at = find(c);
    if (!at) return;
    p.view.dispatch({ changes: { from: at.from, to: at.to, insert: work.text } });
    setWork(null);
    await done(c.id);
  }

  const text_ = doc();
  return (
    <aside className="writing-panel comments-panel" aria-label="Comments">
      <header>
        <h2>Comments</h2>
        <button type="button" className="quiet" onClick={p.onClose}>
          Close
        </button>
      </header>

      {adding && (
        <form className="comment-new" onSubmit={save}>
          <p className="muted writing-passage">{short(adding.quote, 160)}</p>
          <textarea
            aria-label="Your comment"
            placeholder="What should change here, or what to remember…"
            value={text}
            maxLength={2000}
            rows={3}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
          <fieldset className="comment-for">
            <legend className="sr-only">Who it is for</legend>
            <label>
              <input
                type="radio"
                name="for"
                checked={forWhom === "me"}
                onChange={() => setForWhom("me")}
              />{" "}
              For me
            </label>
            <label title={p.canAi ? "" : "Choose a model for conversations in Settings first"}>
              <input
                type="radio"
                name="for"
                disabled={!p.canAi}
                checked={forWhom === "ai"}
                onChange={() => setForWhom("ai")}
              />{" "}
              For the AI
            </label>
          </fieldset>
          <p className="change-actions">
            <button type="submit" className="primary" disabled={busy !== null || !text.trim()}>
              Keep the comment
            </button>
            <button type="button" className="plain" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </p>
        </form>
      )}

      {p.comments.length === 0 && !adding && (
        <p className="muted">
          No comments. Select a passage and press Comment in the toolbar to add one.
        </p>
      )}
      <ul className="comment-list">
        {p.comments.map((c) => {
          const at = locate(text_, c);
          return (
            <li key={c.id} className={at ? "" : "comment-lost"}>
              <p className="comment-quote">
                {at ? (
                  <button type="button" className="plain" onClick={() => show(c)}>
                    “{short(c.quote, 100)}”
                  </button>
                ) : (
                  <>
                    “{short(c.quote, 100)}” <em>(passage not found)</em>
                  </>
                )}
              </p>
              <p className="comment-text">{c.text}</p>
              <p className="comment-actions">
                <span className="chip chip-quiet">{c.for === "ai" ? "for the AI" : "for me"}</span>
                {c.for === "ai" && p.canAi && at && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy !== null}
                    onClick={() => void workOn(c)}
                  >
                    {busy === c.id ? "Working…" : "Work on it"}
                  </button>
                )}
                {(c.for === "ai" || p.canAi) && (
                  <button
                    type="button"
                    className="plain"
                    disabled={busy !== null}
                    onClick={() => void hand(c)}
                  >
                    {c.for === "ai" ? "Make it mine" : "Give to the AI"}
                  </button>
                )}
                <button
                  type="button"
                  className="plain"
                  disabled={busy !== null}
                  onClick={() => void done(c.id)}
                >
                  Done
                </button>
              </p>
              {work?.id === c.id && (
                <div className="comment-work">
                  <Diff before={c.quote} after={work.text} />
                  <p className="change-actions">
                    <button type="button" className="primary" onClick={() => void replace(c)}>
                      Replace
                    </button>
                    <button type="button" className="plain" onClick={() => setWork(null)}>
                      Discard
                    </button>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
