import type { EditorView } from "@codemirror/view";
import { ActionButton } from "./ui/ActionButton.tsx";
import { EditorSelection } from "@codemirror/state";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiFailure, type PassageComment } from "../api.ts";
import { type Anchor, locate } from "./anchor.ts";
import { useDialogs } from "./Dialogs.tsx";
import { splitThreads } from "./comments/model.ts";
import { Message, sendsWith, Words } from "./comments/Thread.tsx";

const failed = (err: unknown, fallback: string) =>
  err instanceof ApiFailure ? err.message : fallback;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …` : s);

/** A passage to comment on: its words and the text around them; empty words are the whole entry. */
export type Adding = Anchor & { from?: number; to?: number };

/**
 * The comments on an entry, between the people of the project (stage 27e): each thread has its
 * writer's name and the time, replies under it, a reply box, and resolve or reopen. The words of a
 * comment can be edited and deleted by their writer (an owner may delete anyone's). Everyone, a
 * reader too, reads and adds; a comment for the AI (a writer's own, never shown to anyone else)
 * can also be given to the writing help, shown in its card under the passage. In the editor a
 * comment is started from a selection; on the entry's page, from a selection or for the whole entry.
 */
export function CommentsPanel(p: {
  /** The editor, or null on the entry's page. */
  view: EditorView | null;
  /** The entry's text, on the entry's page. */
  text?: string;
  /** Goes to a comment's passage on the entry's page. */
  onShow?: (c: PassageComment) => void;
  /** A comment to bring into view and mark, as when its bubble in the margin was pressed. */
  focus?: { id: string } | null;
  path: string;
  comments: PassageComment[];
  /** A passage to comment on, when the panel was opened to add one. */
  adding: Adding | null;
  /** Starts a comment on the whole entry (the entry's page). */
  onStart?: () => void;
  /** Whether this person may leave a comment for the AI: a writer with a model chosen. */
  canAi: boolean;
  /** Opens the writing help card on a comment's passage, with the change the comment asks for. */
  onSuggest?: (c: PassageComment, at: { from: number; to: number }) => void;
  /** Something changed on the server: read the comments again. */
  onChanged: () => void;
  /** The adding form was closed without a comment. */
  onCancelAdding?: () => void;
  onClose: () => void;
}) {
  const dialogs = useDialogs();
  const [text, setText] = useState("");
  const [forWhom, setForWhom] = useState<"me" | "ai">("me");
  const [adding, setAdding] = useState(p.adding);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const doc = () => (p.view ? p.view.state.doc.toString() : (p.text ?? ""));
  const list = useRef<HTMLUListElement>(null);
  const { open, resolved } = splitThreads(p.comments);

  // A comment asked for is brought into view in the list, and its passage shown.
  useEffect(() => {
    if (!p.focus) return;
    const id = p.focus.id;
    const c = p.comments.find((x) => x.id === id);
    if (c?.resolved) setShowResolved(true);
    list.current
      ?.querySelector(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
    if (c && locate(doc(), c)) show(c, false);
  }, [p.focus]);

  // A new passage to comment on (the panel opened, or another selection chosen) replaces the form.
  useEffect(() => {
    setAdding(p.adding);
    if (p.adding) setReplying(null);
  }, [p.adding]);

  /** Runs a change on the server, and says why when it fails. */
  async function run(id: string, work: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setBusy(id);
    setError(null);
    try {
      await work();
      p.onChanged();
      return true;
    } catch (err) {
      setError(failed(err, fallback));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!adding || !text.trim() || busy) return;
    const ok = await run(
      "add",
      () =>
        api.addComment({
          path: p.path,
          quote: adding.quote,
          prefix: adding.prefix,
          suffix: adding.suffix,
          text: text.trim(),
          for: forWhom,
        }),
      "The comment could not be kept.",
    );
    if (ok) {
      setAdding(null);
      setText("");
      setForWhom("me");
    }
  }

  function cancelAdding() {
    setAdding(null);
    setText("");
    p.onCancelAdding?.();
  }

  /** Where a comment's passage is in the text as it is now; the list may be a moment old. */
  function find(c: PassageComment): { from: number; to: number } | null {
    const at = locate(doc(), c);
    if (!at) setError("That passage is no longer in the text.");
    return at;
  }

  /** Goes to a comment's passage: selected in the editor, or scrolled to on the entry's page. */
  function show(c: PassageComment, focus = true) {
    const at = find(c);
    if (!at) return;
    if (!p.view) {
      p.onShow?.(c);
      return;
    }
    p.view.dispatch({
      selection: EditorSelection.single(at.from, at.to),
      scrollIntoView: true,
    });
    if (focus) p.view.focus();
  }

  async function remove(c: PassageComment) {
    if (c.replies.length > 0) {
      const ok = await dialogs.confirm({
        title: "Delete this comment and its replies?",
        body: "To keep the thread and mark it finished, resolve it instead.",
        action: "Delete",
        danger: true,
      });
      if (!ok) return;
    }
    await run(c.id, () => api.removeComment(c.id), "The comment could not be deleted.");
  }

  function suggest(c: PassageComment) {
    setError(null);
    const at = find(c);
    if (at) p.onSuggest?.(c, at);
  }

  const text_ = doc();

  function thread(c: PassageComment) {
    const at = c.quote ? locate(text_, c) : null;
    const mine = busy === c.id;
    return (
      <li
        key={c.id}
        data-id={c.id}
        aria-label={`Comment by ${c.author.name}${c.resolved ? ", resolved" : ""}`}
        className={`comment-thread${c.quote && !at ? " comment-lost" : ""}${
          c.resolved ? " is-resolved" : ""
        }${p.focus?.id === c.id ? " is-focused" : ""}`}
      >
        <p className="comment-quote">
          {!c.quote ? (
            <em>On the whole entry</em>
          ) : at ? (
            <button type="button" className="plain" onClick={() => show(c)}>
              “{short(c.quote, 100)}”
            </button>
          ) : (
            <>
              “{short(c.quote, 100)}” <em>(passage not found)</em>
            </>
          )}
          {c.for === "ai" && <span className="chip chip-quiet">for the AI, only you see it</span>}
        </p>
        <Message
          kind="comment"
          author={c.author}
          text={c.text}
          at={c.at}
          editedAt={c.editedAt}
          can={c.can}
          busy={mine}
          onEdit={async (words) => {
            if (
              !(await run(
                c.id,
                () => api.changeComment(c.id, { text: words }),
                "The comment could not be changed.",
              ))
            ) {
              throw new Error("not saved");
            }
          }}
          onDelete={() => void remove(c)}
        />
        {c.replies.length > 0 && (
          <ul className="comment-replies" aria-label={`Replies to ${c.author.name}`}>
            {c.replies.map((r) => (
              <li key={r.id} data-reply={r.id}>
                <Message
                  kind="reply"
                  author={r.author}
                  text={r.text}
                  at={r.at}
                  editedAt={r.editedAt}
                  can={r.can}
                  busy={mine}
                  onEdit={async (words) => {
                    if (
                      !(await run(
                        c.id,
                        () => api.changeReply(c.id, r.id, words),
                        "The reply could not be changed.",
                      ))
                    ) {
                      throw new Error("not saved");
                    }
                  }}
                  onDelete={() =>
                    void run(
                      c.id,
                      () => api.removeReply(c.id, r.id),
                      "The reply could not be deleted.",
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {c.resolved && <p className="muted comment-resolved">Resolved by {c.resolved.by.name}</p>}
        {replying === c.id ? (
          <Words
            label={`Reply to ${c.author.name}`}
            placeholder="Write a reply…"
            action="Reply"
            busy={mine}
            onCancel={() => setReplying(null)}
            onSend={(words) =>
              void run(
                c.id,
                () => api.replyToComment(c.id, words),
                "The reply could not be kept.",
              ).then((ok) => ok && setReplying(null))
            }
          />
        ) : (
          <p className="comment-actions">
            {c.for !== "ai" && (
              <ActionButton
                type="button"
                className="plain"
                disabled={busy !== null}
                aria-label={`Reply to ${c.author.name}`}
                onClick={() => {
                  setAdding(null);
                  setReplying(c.id);
                }}
              >
                Reply
              </ActionButton>
            )}
            {c.for === "ai" && p.canAi && at && p.view && (
              <ActionButton
                type="button"
                className="quiet"
                disabled={busy !== null}
                onClick={() => suggest(c)}
              >
                Suggest a change
              </ActionButton>
            )}
            {c.can.hand && (c.for === "ai" || p.canAi) && (
              <ActionButton
                type="button"
                className="plain"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    c.id,
                    () => api.changeComment(c.id, { for: c.for === "ai" ? "me" : "ai" }),
                    "The comment could not be changed.",
                  )
                }
              >
                {c.for === "ai" ? "Share it" : "Give to the AI"}
              </ActionButton>
            )}
            {c.can.resolve && (
              <ActionButton
                type="button"
                className="plain"
                disabled={busy !== null}
                aria-label={`${c.resolved ? "Reopen" : "Resolve"} the comment by ${c.author.name}`}
                onClick={() =>
                  void run(
                    c.id,
                    () => api.resolveComment(c.id, !c.resolved),
                    c.resolved
                      ? "The comment could not be reopened."
                      : "The comment could not be resolved.",
                  )
                }
              >
                {c.resolved ? "Reopen" : "Resolve"}
              </ActionButton>
            )}
          </p>
        )}
      </li>
    );
  }

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
          {adding.quote ? (
            <p className="muted writing-passage">{short(adding.quote, 160)}</p>
          ) : (
            <p className="muted writing-passage">On the whole entry</p>
          )}
          <textarea
            aria-label="Your comment"
            placeholder="What should change here, or what to remember…"
            value={text}
            maxLength={2000}
            rows={3}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelAdding();
              } else if (sendsWith(e)) void save(e);
            }}
          />
          {p.canAi && (
            <fieldset className="comment-for">
              <legend className="sr-only">Who it is for</legend>
              <label>
                <input
                  type="radio"
                  name="for"
                  checked={forWhom === "me"}
                  onChange={() => setForWhom("me")}
                />{" "}
                For the people here
              </label>
              <label>
                <input
                  type="radio"
                  name="for"
                  checked={forWhom === "ai"}
                  onChange={() => setForWhom("ai")}
                />{" "}
                For the AI (only you)
              </label>
            </fieldset>
          )}
          <p className="change-actions">
            <ActionButton
              type="submit"
              className="primary"
              disabled={busy !== null || !text.trim()}
            >
              Keep the comment
            </ActionButton>
            <button type="button" className="plain" onClick={cancelAdding}>
              Cancel
            </button>
            <span className="muted comment-hint">Ctrl+Enter sends</span>
          </p>
        </form>
      )}

      {!adding && p.onStart && (
        <p className="comment-actions">
          <ActionButton type="button" className="plain" onClick={p.onStart}>
            Comment on the whole entry
          </ActionButton>
        </p>
      )}

      {p.comments.length === 0 && !adding && (
        <p className="muted comments-empty">
          No comments yet.{" "}
          {p.view
            ? "Select a passage and press Comment in the toolbar to add one."
            : "Select a passage and press Comment, or comment on the whole entry."}
        </p>
      )}
      <ul className="comment-list" ref={list}>
        {open.map(thread)}
      </ul>
      {resolved.length > 0 && (
        <section className="comment-resolved-list">
          <button
            type="button"
            className="plain"
            aria-expanded={showResolved}
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
          </button>
          {showResolved && <ul className="comment-list">{resolved.map(thread)}</ul>}
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
