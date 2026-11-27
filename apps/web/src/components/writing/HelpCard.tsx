/**
 * The writing help card, under the passage it works on (stage 17): say what should change, read
 * the suggestion as prose, then keep it, try again, change it further, or discard it. A comment
 * for the AI shows its suggestion in the same card. Loaded the first time help opens.
 */
import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "../../nav.tsx";
import { api, ApiFailure } from "../../api.ts";
import { useNeedsConnection } from "../../sync/connection.ts";
import { wordChanges, WordDiff } from "../Diff.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { useToast } from "../ui/Toast.tsx";
import { closeHelp, type Help } from "./helpCard.ts";

/** The ready-made requests; the server knows each by its first word. */
export const CHIPS = [
  ["shorter", "Shorter"],
  ["longer", "Longer"],
  ["simpler", "Simpler"],
  ["vivid", "More vivid"],
  ["fix", "Fix spelling and grammar"],
] as const;

/** The longest passage the server takes, about a page. */
export const MAX_PASSAGE = 6000;

/** How long "Passage replaced · Undo" stays. */
const UNDO_MS = 6000;

interface Request {
  how: string;
  label: string;
}

interface Suggestion {
  text: string;
  /** The passage as it was when this was asked, to see whether it changed since. */
  for: string;
  label: string;
}

type Phase =
  | { kind: "ask" }
  | { kind: "waiting"; label: string }
  | { kind: "failed"; message: string; retry: boolean };

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function HelpCard(p: {
  view: EditorView;
  help: Help;
  path: string;
  /** Whether a model is chosen; null while that is not known yet. */
  canWrite: boolean | null;
  /** Told when a comment's suggestion is kept, so its comment is marked done. */
  onCommentDone?: (id: string) => void;
}) {
  const { view, help } = p;
  const toast = useToast();
  const offline = useNeedsConnection();
  const comment = help.comment;
  const passage = view.state.sliceDoc(help.from, help.to);

  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [request, setRequest] = useState<Request | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState<"changes" | "clean">("changes");
  const [own, setOwn] = useState("");
  const [further, setFurther] = useState("");
  const stop = useRef<AbortController | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const furtherBox = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);

  const current = phase.kind === "ask" ? (suggestions[index] ?? null) : null;
  const stale = current !== null && current.for !== passage;
  const changes = useMemo(
    () => (current ? wordChanges(current.for, current.text) : null),
    [current],
  );

  const around = () => ({
    before: view.state.sliceDoc(Math.max(0, help.from - 1200), help.from),
    after: view.state.sliceDoc(help.to, Math.min(view.state.doc.length, help.to + 1200)),
  });

  /** Asks for a suggestion: a new request, another try at it, or a change to the one shown. */
  async function send(req: Request, how: "new" | "again" | "refine", words = "") {
    const text = view.state.sliceDoc(help.from, help.to);
    if (text.length > MAX_PASSAGE) {
      setPhase({
        kind: "failed",
        message: "Select a shorter passage (up to about a page).",
        retry: false,
      });
      return;
    }
    const earlier = how === "again" ? suggestions.filter((s) => s.label === req.label) : [];
    const base = how === "refine" ? current : null;
    stop.current?.abort();
    const control = new AbortController();
    stop.current = control;
    setRequest(req);
    const label = how === "refine" ? short(words, 40) : req.label;
    setPhase({ kind: "waiting", label });
    try {
      const { text: answer } =
        base !== null
          ? await api.rewrite(
              {
                path: p.path,
                passage: text,
                ...around(),
                how: req.how,
                refine: { suggestion: base.text, how: words },
              },
              control.signal,
            )
          : comment
            ? await api.workOnComment(
                comment.id,
                { ...around(), previous: earlier.map((s) => s.text) },
                control.signal,
              )
            : await api.rewrite(
                {
                  path: p.path,
                  passage: text,
                  ...around(),
                  how: req.how,
                  ...(earlier.length ? { previous: earlier.map((s) => s.text) } : {}),
                },
                control.signal,
              );
      if (control.signal.aborted) return;
      const next = [...suggestions, { text: answer, for: text, label: req.label }];
      setSuggestions(next);
      setIndex(next.length - 1);
      // Mostly rewritten, the changes are busy to read: the clean text comes first then.
      setShown(wordChanges(text, answer).share > 0.5 ? "clean" : "changes");
      setFurther("");
      setPhase({ kind: "ask" });
    } catch (err) {
      if (control.signal.aborted || (err instanceof ApiFailure && err.code === "stopped")) {
        return;
      }
      const code = err instanceof ApiFailure ? err.code : "";
      setPhase(
        code === "ai_failed" || code === "ai_bad_answer" || code === "unknown" || code === ""
          ? {
              kind: "failed",
              message: "The model did not answer this time. Nothing in your text changed.",
              retry: true,
            }
          : code === "offline"
            ? {
                kind: "failed",
                message:
                  "Writing help needs a connection. Your text is safe; try again when you are back online.",
                retry: true,
              }
            : { kind: "failed", message: (err as Error).message, retry: false },
      );
    } finally {
      if (stop.current === control) stop.current = null;
    }
  }

  function halt() {
    stop.current?.abort();
    stop.current = null;
    setPhase({ kind: "ask" });
  }

  function close() {
    stop.current?.abort();
    view.dispatch({ effects: closeHelp.of(null) });
    view.focus();
  }

  function put(where: "replace" | "below") {
    if (!current || stale) return;
    const { from, to } = help;
    const insert = where === "replace" ? current.text : `\n\n${current.text}`;
    const at = where === "replace" ? from : to;
    view.dispatch({
      changes: where === "replace" ? { from, to, insert } : { from: to, insert },
      selection: { anchor: at + insert.length },
      effects: closeHelp.of(null),
      userEvent: "input.ai",
      scrollIntoView: true,
    });
    view.focus();
    toast({
      message: where === "replace" ? "Passage replaced" : "Suggestion put below",
      action: {
        label: "Undo",
        run: () => {
          undo(view);
          view.focus();
        },
      },
      duration: UNDO_MS,
    });
    if (comment) {
      const id = comment.id;
      void api.removeComment(id).then(
        () => p.onCommentDone?.(id),
        () => p.onCommentDone?.(id),
      );
    }
  }

  // A comment's suggestion is asked for as the card opens; otherwise the box takes the focus.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    card.current?.scrollIntoView({ block: "nearest" });
    if (comment && p.canWrite !== false && !offline) {
      void send({ how: comment.text, label: "Suggest a change" }, "new");
    } else box.current?.focus({ preventScroll: true });
    // Once, as the card opens.
  }, []);

  // Pressing Help again with the card open puts the focus back in its box.
  useEffect(() => {
    if (help.focus === 0) return;
    (current ? furtherBox.current : box.current)?.focus();
    // Only when asked again.
  }, [help.focus]);

  // A new suggestion takes the focus to Keep, so Enter keeps it; waiting, to Stop, which also
  // closes the phone's keyboard so the suggestion has room.
  useEffect(() => {
    if (phase.kind === "ask" && current) keep.current?.focus({ preventScroll: true });
    if (phase.kind === "waiting") stopButton.current?.focus({ preventScroll: true });
  }, [phase.kind, suggestions.length]);

  useEffect(() => () => stop.current?.abort(), []);

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (phase.kind === "waiting") halt();
      else close();
    } else if (e.key.toLowerCase() === "j" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      (current ? furtherBox.current : box.current)?.focus();
    }
  }

  const title =
    phase.kind === "waiting"
      ? phase.label
      : current
        ? current.label
        : comment
          ? "Suggest a change"
          : "Help";

  let body;
  if (p.canWrite === false) {
    body = (
      <>
        <p className="help-card-note">
          Writing help needs an AI model. Choose one once in Settings and it works in every entry.
        </p>
        <p className="help-card-actions">
          <Link className="help-card-settings" to="/settings/you/ai-models/conversation">
            Open Settings
          </Link>
        </p>
      </>
    );
  } else if (offline && phase.kind !== "waiting") {
    body = (
      <p className="help-card-note">
        Writing help needs a connection. Your text is safe; try again when you are back online.
      </p>
    );
  } else if (help.to === help.from) {
    body = (
      <p className="help-card-note">
        Select some words, or put the cursor in a paragraph, then press Help.
      </p>
    );
  } else if (phase.kind === "waiting") {
    body = (
      <div className="help-card-wait" role="status">
        <span className="help-card-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Writing a suggestion…</span>
        <button ref={stopButton} type="button" className="quiet" onClick={halt}>
          Stop
        </button>
      </div>
    );
  } else if (phase.kind === "failed") {
    body = (
      <>
        <p className="help-card-note" role="alert">
          {phase.message}
        </p>
        {phase.retry && request && (
          <p className="help-card-actions">
            <button type="button" className="quiet" onClick={() => void send(request, "new")}>
              <Icon icon={RotateCcw} size="sm" /> Try again
            </button>
            <button type="button" className="plain" onClick={() => setPhase({ kind: "ask" })}>
              Back
            </button>
          </p>
        )}
        {!phase.retry && (
          <p className="help-card-actions">
            <button type="button" className="plain" onClick={() => setPhase({ kind: "ask" })}>
              Back
            </button>
          </p>
        )}
      </>
    );
  } else if (current && stale) {
    body = (
      <>
        <p className="help-card-note" role="alert">
          You changed this passage after asking. The suggestion is for the older wording.
        </p>
        <p className="help-card-actions">
          <button
            type="button"
            className="primary"
            onClick={() =>
              void send(request ?? { how: current.label, label: current.label }, "new")
            }
          >
            Ask again with the new wording
          </button>
          <button type="button" className="plain" onClick={close}>
            Discard
          </button>
        </p>
      </>
    );
  } else if (current && changes) {
    body = (
      <>
        <div className="help-card-suggestion" aria-label="The suggestion">
          {shown === "changes" ? <WordDiff parts={changes.parts} /> : current.text}
        </div>
        <div className="help-card-result-actions">
          <button
            ref={keep}
            type="button"
            className="primary help-card-keep"
            onClick={() => put("replace")}
          >
            Keep
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => request && void send(request, "again")}
          >
            <Icon icon={RotateCcw} size="sm" /> Try again
          </button>
          <button type="button" className="plain" onClick={close}>
            Discard
          </button>
          <Menu label="More choices" className="help-card-more" align="end">
            <MenuItem onSelect={() => put("below")}>Put it below the passage</MenuItem>
          </Menu>
        </div>
        <p className="help-card-rule muted">Keeps every name and fact. Adds nothing new.</p>
        <form
          className="help-card-ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (further.trim() && request) void send(request, "refine", further.trim());
          }}
        >
          <input
            ref={furtherBox}
            type="text"
            aria-label="Change it further"
            placeholder="Change it further… (keep the first sentence, less formal)"
            value={further}
            maxLength={400}
            onChange={(e) => setFurther(e.target.value)}
          />
        </form>
      </>
    );
  } else {
    body = (
      <>
        <form
          className="help-card-ask"
          onSubmit={(e) => {
            e.preventDefault();
            const words = own.trim();
            if (words) void send({ how: words, label: short(words, 40) }, "new");
          }}
        >
          <input
            ref={box}
            type="text"
            aria-label="What should change?"
            placeholder="What should change? For example: tell it as a legend an elder would…"
            value={own}
            maxLength={400}
            onChange={(e) => setOwn(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!own.trim()}>
            Go
          </button>
        </form>
        <div className="help-card-chips" role="group" aria-label="Ready-made requests">
          {CHIPS.map(([how, label]) => (
            <button
              key={how}
              type="button"
              className="help-card-chip"
              onClick={() => void send({ how, label }, "new")}
            >
              {label}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <div ref={card} className="help-card" role="region" aria-label="Writing help" onKeyDown={onKey}>
      <div className="help-card-head">
        <b>
          <Icon icon={Sparkles} size="sm" /> {title}
        </b>
        {comment && !current && phase.kind !== "waiting" && (
          <span className="muted help-card-comment">“{short(comment.text, 80)}”</span>
        )}
        {current && suggestions.length > 1 && phase.kind === "ask" && !stale && (
          <span className="help-card-count">
            <button
              type="button"
              className="plain"
              aria-label="Earlier suggestion"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              ‹
            </button>
            <span className="muted">
              {index + 1} of {suggestions.length}
            </span>
            <button
              type="button"
              className="plain"
              aria-label="Later suggestion"
              disabled={index === suggestions.length - 1}
              onClick={() => setIndex((i) => Math.min(suggestions.length - 1, i + 1))}
            >
              ›
            </button>
          </span>
        )}
        <span className="help-card-space" />
        {current && phase.kind === "ask" && !stale && (
          <span className="help-card-toggle" role="group" aria-label="How the suggestion is shown">
            <button
              type="button"
              aria-pressed={shown === "changes"}
              onClick={() => setShown("changes")}
            >
              Changes
            </button>
            <button
              type="button"
              aria-pressed={shown === "clean"}
              onClick={() => setShown("clean")}
            >
              Clean
            </button>
          </span>
        )}
        <IconButton label="Close" icon={X} size="sm" className="help-card-close" onClick={close} />
      </div>
      {body}
    </div>
  );
}
