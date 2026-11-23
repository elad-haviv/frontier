import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiFailure, askUrl } from "../api.ts";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { failureOf, useAsync } from "../useAsync.ts";

/** Ask the lore: the conversations so far, and a box to start one. */
export function AskPage() {
  const list = useAsync(() => api.conversations(), "conversations");
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await api.ask(question.trim());
      navigate(askUrl(conversation.id));
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "The question could not be asked.");
      setBusy(false);
    }
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
          <Link to="/settings">Choose one in Settings</Link>.
        </p>
      )}

      <form className="ask-box" onSubmit={ask}>
        <label className="field">
          <span>A question</span>
          <textarea
            rows={3}
            value={question}
            disabled={!ready || busy}
            placeholder="How do the Nirani keep time?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="change-actions">
          <button type="submit" className="primary" disabled={!ready || busy || !question.trim()}>
            {busy ? "Reading the entries…" : "Ask"}
          </button>
        </p>
      </form>

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
