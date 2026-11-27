import { ActionButton } from "../components/ui/ActionButton.tsx";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, askUrl, type EntryProposal } from "../api.ts";
import { DictateButton, ListeningBar } from "../components/DictateButton.tsx";
import { EntryDraft } from "../components/EntryDraft.tsx";
import { LiveTurn, useLoreAsk } from "../components/LoreWork.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useDictation } from "../hooks/useDictation.ts";
import { failureOf, useAsync } from "../useAsync.ts";

/** A new entry being drafted from the box: at work, ready to edit, or why it could not be made. */
type Drafting =
  | { state: "working" }
  | { state: "ready"; said: string; proposal: EntryProposal }
  | { state: "failed"; reason: string };

/** Ask the lore: the conversations so far, and a box to start one, by typing or by voice. */
export function AskPage() {
  const list = useAsync(() => api.conversations(), "conversations");
  const navigate = useNavigate();
  // The editor's "Ask the lore about this…" comes with the passage quoted, ready for a question.
  const quoted = (useLocation().state as { question?: string } | null)?.question;
  const [question, setQuestion] = useState(quoted ?? "");
  const [drafting, setDrafting] = useState<Drafting | null>(null);
  const drafted = useRef<AbortController | null>(null);
  const voice = useDictation(setQuestion);
  const {
    live,
    ask: askLive,
    stop,
  } = useLoreAsk(({ conversation }) => navigate(askUrl(conversation.id)));
  const busy = live?.state === "working" || live?.state === "stopping";
  const drafting_ = drafting?.state === "working";

  function toggleVoice() {
    if (voice.listening) voice.stop();
    else voice.start(question);
  }

  function ask(e?: FormEvent) {
    e?.preventDefault();
    if (!question.trim() || busy || voice.listening) return;
    void askLive(question.trim());
  }

  async function draftEntry() {
    const said = question.trim();
    if (!said || busy || voice.listening || drafting_) return;
    const run = new AbortController();
    drafted.current = run;
    setDrafting({ state: "working" });
    try {
      const { draft } = await api.draftEntry(said, run.signal);
      setDrafting({ state: "ready", said, proposal: draft });
    } catch (e) {
      setDrafting(
        run.signal.aborted
          ? null
          : { state: "failed", reason: e instanceof Error ? e.message : "The draft failed." },
      );
    }
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "m" || e.key === "M") {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && voice.supported) {
        e.preventDefault();
        toggleVoice();
      }
    } else if (e.key === "Escape" && voice.listening) {
      voice.stop();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ask();
    }
  }

  const ready = list.state === "ready" && list.value.ready;
  const locked = !ready || busy || drafting_;
  const empty = !question.trim();
  return (
    <article className="entry wide ask">
      <header className="entry-head">
        <h1>Ask the lore</h1>
        <p className="muted lede">
          Answers come from the published entries of your library, each paragraph with the entries
          and passages it rests on. A paragraph that no passage supports is marked as a guess. Or
          talk through a new idea and have it drafted as an unsaved change.
        </p>
      </header>

      {list.state === "ready" && !list.value.ready && (
        <p className="banner">
          No model is chosen for lore conversations.{" "}
          <Link to="/settings/you/ai-models/conversation">Choose one in Settings</Link>.
        </p>
      )}

      <form className="ask-box" onSubmit={ask}>
        <label className="field">
          <span>A question or an idea</span>
          <textarea
            rows={3}
            value={question}
            disabled={locked}
            ref={(box) => {
              // Once it can be typed in, the cursor waits after the quoted passage.
              if (box && quoted && ready && !box.dataset.placed) {
                box.dataset.placed = "1";
                box.focus();
                box.setSelectionRange(box.value.length, box.value.length);
              }
            }}
            placeholder="How do the Nirani keep time? Or start talking about a new entry."
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={keys}
          />
        </label>
        <p className="change-actions ask-actions">
          {voice.supported && (
            <DictateButton listening={voice.listening} onToggle={toggleVoice} disabled={locked} />
          )}
          <span
            className={`muted ask-status${voice.listening ? " is-listening" : ""}`}
            aria-live="polite"
          >
            {voice.listening
              ? "Listening. Tap to stop."
              : voice.supported
                ? ""
                : "Dictation is not available in this browser. You can type."}
          </span>
          <span className="ask-go">
            <ActionButton
              type="submit"
              className="quiet"
              disabled={locked || voice.listening || empty}
            >
              Ask
            </ActionButton>
            <ActionButton
              type="button"
              className="primary"
              disabled={locked || voice.listening || empty}
              onClick={() => void draftEntry()}
            >
              Draft entry
            </ActionButton>
          </span>
        </p>
        {voice.problem && (
          <p className="muted ask-problem" role="status">
            {voice.problem}
          </p>
        )}
      </form>
      {voice.listening && <ListeningBar onStop={voice.stop} />}

      {drafting?.state === "working" && (
        <p className="muted lore-writing" aria-live="polite">
          Drafting an entry from what you said…{" "}
          <button type="button" className="quiet" onClick={() => drafted.current?.abort()}>
            Stop
          </button>
        </p>
      )}
      {drafting?.state === "failed" && <Problem reason={drafting.reason} />}
      {drafting?.state === "ready" && (
        <EntryDraft
          said={drafting.said}
          proposal={drafting.proposal}
          onClose={() => {
            setDrafting(null);
            setQuestion("");
          }}
        />
      )}

      {live && (
        <ol className="turns">
          <LiveTurn live={live} onStop={stop} />
        </ol>
      )}

      {list.state === "ready" && list.value.conversations.length > 0 && (
        <section>
          <h2>Conversations</h2>
          <ul className="map-list">
            {list.value.conversations.map((c) => (
              <li key={c.id}>
                <Link to={askUrl(c.id)}>{c.title}</Link>
                <span className="muted">
                  {c.turns} {c.turns === 1 ? "question" : "questions"} ·{" "}
                  {new Date(c.at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {list.reloading && <Progress />}
      {failureOf(list) && <Problem reason={failureOf(list)!.message} onRetry={list.retry} />}
    </article>
  );
}
