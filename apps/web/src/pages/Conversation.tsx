import { ActionButton } from "../components/ui/ActionButton.tsx";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Link, useNavigate } from "../nav.tsx";
import { api, ApiFailure, askUrl, entryUrl, type LoreConversation, type LoreTurn } from "../api.ts";
import { Diff } from "../components/Diff.tsx";
import { useDialogs } from "../components/Dialogs.tsx";
import { LiveTurn, TurnWork, useLoreAsk } from "../components/LoreWork.tsx";
import { useCanWrite } from "../components/projectContext.ts";
import { useRefresh } from "../components/Shell.tsx";
import { projectWork } from "../projectWork.ts";

const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
const failed = (err: unknown, fallback: string) =>
  err instanceof ApiFailure ? err.message : fallback;

/** A link to an entry, or its name struck through when the entry is gone. */
function EntryLink({ path, gone }: { path: string; gone: ReadonlySet<string> }) {
  if (gone.has(path)) return <s title="This entry is no longer in the library.">{titleOf(path)}</s>;
  return <Link to={entryUrl(path)}>{titleOf(path)}</Link>;
}

/** The addition drafted from one answer: where it goes, the difference, and keeping it. */
function Addition(p: {
  id: string;
  n: number;
  turn: LoreTurn;
  onChange: (c: LoreConversation) => void;
}) {
  const refresh = useRefresh();
  const addition = p.turn.addition!;
  const grounded = p.turn.answer.paragraphs.filter((x) => x.grounded).flatMap((x) => x.sources);
  const choices = [
    ...(addition.newPath ? [addition.newPath] : []),
    ...[...new Set([...grounded, ...p.turn.given])],
  ];
  const [path, setPath] = useState(choices[0] ?? "");
  const [preview, setPreview] = useState<{
    before: string;
    after: string;
    base: string;
    isNew: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = async () => {
    setError(null);
    setPreview(null);
    if (!path) return;
    try {
      setPreview(await api.previewAddition(p.id, p.n, path));
    } catch (err) {
      setError(failed(err, "The difference could not be shown."));
    }
  };
  useEffect(() => void look(), [path, addition.at]);

  async function keep() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await api.keepAddition(p.id, p.n, path, preview.base);
      refresh();
      p.onChange(conversation);
    } catch (err) {
      setError(failed(err, "The addition could not be kept."));
      if (err instanceof ApiFailure && err.code === "changed") void look();
    } finally {
      setBusy(false);
    }
  }

  async function again() {
    setBusy(true);
    try {
      const { conversation } = await api.draftAddition(p.id, p.n, true);
      p.onChange(conversation);
    } catch (err) {
      setError(failed(err, "Nothing could be drafted."));
    } finally {
      setBusy(false);
    }
  }

  if (p.turn.kept) {
    return (
      <p className="banner banner-ok">
        Kept as a draft of <Link to={entryUrl(p.turn.kept.path)}>{titleOf(p.turn.kept.path)}</Link>.
        Read it among the <Link to="/unpublished">unsaved changes</Link> before you save a version.
      </p>
    );
  }
  return (
    <section className="addition" aria-label="Drafted addition">
      <h3>Drafted addition</h3>
      <p className="muted">
        Written by the AI. Nothing enters the library until you keep it and save a version.
      </p>
      <label className="field">
        <span>Where it goes</span>
        <select
          aria-label="Where the addition goes"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        >
          {choices.map((c) => (
            <option key={c} value={c}>
              {c === addition.newPath ? `A new entry: ${c}` : titleOf(c)}
            </option>
          ))}
        </select>
      </label>
      {preview && <Diff before={preview.before} after={preview.after} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="change-actions">
        <ActionButton
          type="button"
          className="primary"
          disabled={!preview || busy}
          onClick={() => void keep()}
        >
          Keep as a draft
        </ActionButton>
        <ActionButton type="button" className="quiet" disabled={busy} onClick={() => void again()}>
          Draft again
        </ActionButton>
      </p>
    </section>
  );
}

function Answer(p: {
  id: string;
  n: number;
  turn: LoreTurn;
  gone: ReadonlySet<string>;
  onChange: (c: LoreConversation) => void;
}) {
  const { answer } = p.turn;
  // Drafting text into an entry is for writers (stage 31c); a reader asks and reads.
  const canWrite = useCanWrite();
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = answer.paragraphs.some((x) => x.grounded);
  const notInLore = answer.missing !== "" || !supported;

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      const { conversation } = await api.draftAddition(p.id, p.n);
      p.onChange(conversation);
    } catch (err) {
      setError(failed(err, "Nothing could be drafted."));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <li className="turn">
      <p className="turn-question">{p.turn.question}</p>
      {p.turn.trace && <TurnWork turn={p.turn} gone={p.gone} />}
      {answer.paragraphs.map((para, i) => (
        <div key={i} className={"answer-para" + (para.grounded ? "" : " is-guess")}>
          {/* The model's words are shown as plain text: never as markup, links or pictures. */}
          <p className="answer-text">{para.text}</p>
          {!para.grounded && (
            <p className="guess">A guess: no passage of the entries was found to support this.</p>
          )}
          {para.quotes.map((q, j) => (
            <blockquote key={j}>
              “{q.text}”{" "}
              <span className="muted">
                — <EntryLink path={q.path} gone={p.gone} />
              </span>
            </blockquote>
          ))}
          {para.sources.length > 0 && (
            <p className="sources muted">
              From{" "}
              {para.sources.map((s, j) => (
                <span key={s}>
                  {j > 0 && ", "}
                  <EntryLink path={s} gone={p.gone} />
                </span>
              ))}
            </p>
          )}
        </div>
      ))}
      {notInLore && (
        <div className="not-in-lore">
          <p>
            <strong>This is not in the lore.</strong>{" "}
            {answer.missing && (
              <span className="muted">The AI says it lacks: {answer.missing}</span>
            )}
          </p>
          {canWrite && !p.turn.addition && (
            <p className="change-actions">
              <ActionButton
                type="button"
                className="quiet"
                disabled={drafting}
                onClick={() => void draft()}
              >
                {drafting ? "Drafting…" : "Draft an addition"}
              </ActionButton>
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {canWrite && p.turn.addition && (
        <Addition id={p.id} n={p.n} turn={p.turn} onChange={p.onChange} />
      )}
      {answer.related.length > 0 && (
        <p className="related">
          <span className="muted">Also related:</span>{" "}
          {answer.related.map((r, j) => (
            <span key={r.path}>
              {j > 0 && " · "}
              <EntryLink path={r.path} gone={p.gone} />
              {r.why && <span className="muted"> ({r.why})</span>}
            </span>
          ))}
        </p>
      )}
      {!p.turn.trace && (
        <details className="turn-meta">
          <summary>
            Read {p.turn.given.length} {p.turn.given.length === 1 ? "entry" : "entries"} · $
            {p.turn.costUsd.toFixed(3)}
          </summary>
          <p className="muted">
            {p.turn.given.map((g, j) => (
              <span key={g}>
                {j > 0 && ", "}
                <EntryLink path={g} gone={p.gone} />
              </span>
            ))}
            {answer.droppedQuotes > 0 &&
              ` · ${answer.droppedQuotes} quoted ${answer.droppedQuotes === 1 ? "passage was" : "passages were"} not found in the entries and left out.`}
          </p>
        </details>
      )}
    </li>
  );
}

/** One lore conversation: its questions and answers, and a box to ask again. */
export function ConversationPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const [conversation, setConversation] = useState<LoreConversation | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const {
    live,
    ask: askLive,
    stop,
  } = useLoreAsk((r) => {
    setConversation(r.conversation);
    setGone(new Set(r.gone));
    setQuestion("");
  });
  const busy = live?.state === "working" || live?.state === "stopping";

  useEffect(() => {
    api.conversation(id).then(
      (r) => {
        setConversation(r.conversation);
        setGone(new Set(r.gone));
      },
      (err: unknown) => setError(failed(err, "The conversation could not be opened.")),
    );
  }, [id]);

  function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setError(null);
    void askLive(question.trim(), id);
  }

  async function remove() {
    const work = projectWork();
    const ok = await dialogs.confirm({
      title: "Delete this conversation?",
      body: "Its questions and answers are removed. Additions you kept stay among your drafts.",
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
    await work.api.deleteConversation(id).catch(() => undefined);
    if (work.open()) navigate(askUrl());
  }

  if (!conversation) {
    return error ? (
      <p className="center error">{error}</p>
    ) : (
      <p className="center muted">Opening…</p>
    );
  }
  return (
    <article className="entry wide ask">
      <header className="entry-head">
        <p className="muted">
          <Link to={askUrl()}>Ask the lore</Link>
        </p>
        <h1>{conversation.title}</h1>
      </header>
      <ol className="turns">
        {conversation.turns.map((turn, n) => (
          <Answer key={n} id={id} n={n} turn={turn} gone={gone} onChange={setConversation} />
        ))}
        {live && <LiveTurn live={live} onStop={stop} />}
      </ol>
      <form className="ask-box" onSubmit={ask}>
        <label className="field">
          <span>Ask again</span>
          <textarea
            rows={2}
            value={question}
            disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="change-actions">
          <ActionButton type="submit" className="primary" disabled={busy || !question.trim()}>
            Ask
          </ActionButton>
          <ActionButton type="button" className="plain danger" onClick={() => void remove()}>
            Delete the conversation
          </ActionButton>
        </p>
      </form>
    </article>
  );
}
