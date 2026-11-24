import { ActionButton } from "../components/ui/ActionButton.tsx";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, askUrl } from "../api.ts";
import { LiveTurn, useLoreAsk } from "../components/LoreWork.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { failureOf, useAsync } from "../useAsync.ts";

/** Ask the lore: the conversations so far, and a box to start one. */
export function AskPage() {
  const list = useAsync(() => api.conversations(), "conversations");
  const navigate = useNavigate();
  // The editor's "Ask the lore about this…" comes with the passage quoted, ready for a question.
  const quoted = (useLocation().state as { question?: string } | null)?.question;
  const [question, setQuestion] = useState(quoted ?? "");
  const {
    live,
    ask: askLive,
    stop,
  } = useLoreAsk(({ conversation }) => navigate(askUrl(conversation.id)));
  const busy = live?.state === "working" || live?.state === "stopping";

  function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    void askLive(question.trim());
  }

  const ready = list.state === "ready" && list.value.ready;
  return (
    <article className="entry wide ask">
      <header className="entry-head">
        <h1>Ask the lore</h1>
        <p className="muted lede">
          Answers come from the published entries of your library, each paragraph with the entries
          and passages it rests on. A paragraph that no passage supports is marked as a guess.
        </p>
      </header>

      {list.state === "ready" && !list.value.ready && (
        <p className="banner">
          No model is chosen for lore conversations.{" "}
          <Link to="/settings/ai/models/conversation">Choose one in Settings</Link>.
        </p>
      )}

      <form className="ask-box" onSubmit={ask}>
        <label className="field">
          <span>A question</span>
          <textarea
            rows={3}
            value={question}
            disabled={!ready || busy}
            ref={(box) => {
              // Once it can be typed in, the cursor waits after the quoted passage.
              if (box && quoted && ready && !box.dataset.placed) {
                box.dataset.placed = "1";
                box.focus();
                box.setSelectionRange(box.value.length, box.value.length);
              }
            }}
            placeholder="How do the Nirani keep time?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <p className="change-actions">
          <ActionButton
            type="submit"
            className="primary"
            disabled={!ready || busy || !question.trim()}
          >
            Ask
          </ActionButton>
        </p>
      </form>

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
