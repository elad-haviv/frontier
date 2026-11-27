import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { CommentPerson } from "../../api.ts";
import { whenText } from "../../people/model.ts";
import { ActionButton } from "../ui/ActionButton.tsx";
import { Avatar } from "../ui/Avatar.tsx";
import { roleTag } from "./model.ts";

/** Ctrl or Cmd with Enter sends, as in the Ask box; Enter alone starts a new line. */
export const sendsWith = (e: KeyboardEvent): boolean =>
  e.key === "Enter" && (e.ctrlKey || e.metaKey);

/** A box to write in, for a reply or an edit: Ctrl+Enter sends, Escape leaves. */
export function Words(p: {
  label: string;
  initial?: string;
  placeholder?: string;
  action: string;
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(p.initial ?? "");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const ready = text.trim() !== "" && text.trim() !== (p.initial ?? "").trim();
  return (
    <form
      className="comment-write"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !p.busy) p.onSend(text.trim());
      }}
    >
      <textarea
        ref={box}
        aria-label={p.label}
        placeholder={p.placeholder}
        value={text}
        maxLength={2000}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Leaves the box and nothing else: the panel and the page keep what they have.
            e.preventDefault();
            e.stopPropagation();
            p.onCancel();
          } else if (sendsWith(e)) {
            e.preventDefault();
            if (ready && !p.busy) p.onSend(text.trim());
          }
        }}
      />
      <p className="comment-actions">
        <ActionButton type="submit" className="primary" disabled={!ready || p.busy}>
          {p.action}
        </ActionButton>
        <button type="button" className="plain" onClick={p.onCancel}>
          Cancel
        </button>
        <span className="muted comment-hint">Ctrl+Enter sends</span>
      </p>
    </form>
  );
}

/** One comment or reply: who wrote it and when, the words, and the things its writer may do. */
export function Message(p: {
  author: CommentPerson;
  text: string;
  at: string;
  editedAt: string | null;
  can: { edit: boolean; delete: boolean };
  busy: boolean;
  /** What the message is called to a screen reader: "comment" or "reply". */
  kind: "comment" | "reply";
  onEdit: (text: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const tag = roleTag(p.author);
  return (
    <div className={`comment-message comment-${p.kind}`}>
      <p className="comment-who">
        <Avatar name={p.author.name} size="sm" />
        <b>{p.author.name}</b>
        {tag && <span className="chip chip-quiet">{tag}</span>}
        <time dateTime={p.at} className="muted">
          {whenText(p.at)}
        </time>
        {p.editedAt && (
          <span className="muted comment-edited" title={`Edited ${whenText(p.editedAt)}`}>
            edited
          </span>
        )}
      </p>
      {editing ? (
        <Words
          label={`Edit your ${p.kind}`}
          initial={p.text}
          action="Save"
          busy={p.busy}
          onCancel={() => setEditing(false)}
          onSend={(text) =>
            void p.onEdit(text).then(
              () => setEditing(false),
              () => undefined,
            )
          }
        />
      ) : (
        <p className="comment-text">{p.text}</p>
      )}
      {!editing && (p.can.edit || p.can.delete) && (
        <p className="comment-actions">
          {p.can.edit && (
            <ActionButton
              type="button"
              className="plain"
              disabled={p.busy}
              aria-label={`Edit your ${p.kind}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </ActionButton>
          )}
          {p.can.delete && (
            <ActionButton
              type="button"
              className="plain"
              disabled={p.busy}
              aria-label={`Delete ${p.author.name}'s ${p.kind}`}
              onClick={p.onDelete}
            >
              Delete
            </ActionButton>
          )}
        </p>
      )}
    </div>
  );
}
