import type { EditorView } from "@codemirror/view";
import { ActionButton } from "./ui/ActionButton.tsx";
import { EditorSelection } from "@codemirror/state";
import { type FormEvent, useState } from "react";
import { api, ApiFailure, type PassageComment } from "../api.ts";
import { type Anchor, locate } from "./anchor.ts";

const failed = (err: unknown, fallback: string) =>
  err instanceof ApiFailure ? err.message : fallback;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …` : s);

/**
 * The comments on an entry: adding one on a passage, going to a passage, marking a comment done,
 * and, for a comment for the AI, a suggested change, shown in the writing help card under its
 * passage.
 */
export function CommentsPanel(p: {
  view: EditorView;
  path: string;
  comments: PassageComment[];
  /** A passage to comment on, when the panel was opened to add one. */
  adding: (Anchor & { from: number; to: number }) | null;
  /** Whether a model is chosen, so a comment can be for the AI. */
  canAi: boolean;
  /** Opens the writing help card on a comment's passage, with the change the comment asks for. */
  onSuggest: (c: PassageComment, at: { from: number; to: number }) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [forWhom, setForWhom] = useState<"me" | "ai">("me");
  const [adding, setAdding] = useState(p.adding);
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

  function suggest(c: PassageComment) {
    setError(null);
    const at = find(c);
    if (at) p.onSuggest(c, at);
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
            <ActionButton
              type="submit"
              className="primary"
              disabled={busy !== null || !text.trim()}
            >
              Keep the comment
            </ActionButton>
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
                  <ActionButton
                    type="button"
                    className="quiet"
                    disabled={busy !== null}
                    onClick={() => suggest(c)}
                  >
                    Suggest a change
                  </ActionButton>
                )}
                {(c.for === "ai" || p.canAi) && (
                  <ActionButton
                    type="button"
                    className="plain"
                    disabled={busy !== null}
                    onClick={() => void hand(c)}
                  >
                    {c.for === "ai" ? "Make it mine" : "Give to the AI"}
                  </ActionButton>
                )}
                <ActionButton
                  type="button"
                  className="plain"
                  disabled={busy !== null}
                  onClick={() => void done(c.id)}
                >
                  Done
                </ActionButton>
              </p>
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
