import type { MissingProposal, WhatsMissingResponse } from "@frontier/schema";
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, type EntryProposal } from "../../api.ts";
import { EntryDraft } from "../EntryDraft.tsx";
import { ActionButton } from "../ui/ActionButton.tsx";
import { Problem } from "../ui/Problem.tsx";
import { Progress } from "../ui/Progress.tsx";

type Reading =
  | { state: "idle" }
  | { state: "working" }
  | { state: "ready"; answer: WhatsMissingResponse }
  | { state: "failed"; reason: string; href: string | undefined };

/** One proposal's draft, as far as it has got. */
type Drafting =
  | { name: string; said: string; state: "working" }
  | { name: string; said: string; state: "ready"; proposal: EntryProposal }
  | { name: string; said: string; state: "failed"; reason: string; href: string | undefined };

const failure = (err: unknown, fallback: string) =>
  err instanceof ApiFailure
    ? { reason: err.message, href: err.href }
    : { reason: fallback, href: undefined };

/** What the draft is asked for: the name, and why the entry is wanted. */
const saidOf = (p: MissingProposal, title: string) =>
  `Write the entry “${p.name}”. ${p.reason} (Wanted by “${title}”.)`;

/**
 * "What's missing" in the From here strip (AI): a button that reads the entry and its neighbours
 * and proposes entries it implies and questions it leaves open. Nothing is saved; "Draft this
 * entry" goes through the same drafting as Ask the lore, and the draft is kept as an unsaved
 * change only when the author keeps it.
 */
export function WhatsMissing({ path, title }: { path: string; title: string }) {
  const [reading, setReading] = useState<Reading>({ state: "idle" });
  const [drafting, setDrafting] = useState<Drafting | null>(null);
  const run = useRef<AbortController | null>(null);
  // Leaving the entry stops what is still being asked.
  useEffect(() => () => run.current?.abort(), []);

  async function read() {
    run.current?.abort();
    const mine = new AbortController();
    run.current = mine;
    setReading({ state: "working" });
    try {
      const answer = await api.whatsMissing(path, mine.signal);
      setReading({ state: "ready", answer });
    } catch (err) {
      // Stop puts the button back; it is not a failure.
      if (mine.signal.aborted || (err instanceof ApiFailure && err.code === "ai_stopped")) {
        setReading({ state: "idle" });
      } else {
        setReading({ state: "failed", ...failure(err, "The entry could not be read.") });
      }
    }
  }

  async function draft(p: MissingProposal) {
    run.current?.abort();
    const mine = new AbortController();
    run.current = mine;
    const said = saidOf(p, title);
    setDrafting({ name: p.name, said, state: "working" });
    try {
      const { draft: proposal } = await api.draftEntry(said, mine.signal);
      setDrafting({ name: p.name, said, state: "ready", proposal });
    } catch (err) {
      setDrafting(
        mine.signal.aborted || (err instanceof ApiFailure && err.code === "ai_stopped")
          ? null
          : { name: p.name, said, state: "failed", ...failure(err, "The draft failed.") },
      );
    }
  }

  const working = reading.state === "working";
  const drafted = drafting?.state === "working";
  return (
    <>
      <section className="fh-card fh-ai" aria-labelledby="fh-ai">
        <h3 id="fh-ai">
          What's missing<span className="fh-ai-tag">AI</span>
        </h3>
        {reading.state === "idle" || reading.state === "failed" || working ? (
          <>
            {reading.state === "failed" && (
              <Problem reason={reading.reason} href={reading.href} onRetry={() => void read()} />
            )}
            {working ? (
              <>
                <Progress label="Reading this entry and its neighbours" />
                <p className="fh-working muted" role="status">
                  Reading this entry and its neighbours…{" "}
                  <button type="button" className="quiet" onClick={() => run.current?.abort()}>
                    Stop
                  </button>
                </p>
              </>
            ) : (
              <>
                <p className="muted fh-note">
                  Reads this entry and its neighbours and proposes up to five entries it implies,
                  and two open questions. Nothing is saved until you keep a draft.
                </p>
                {reading.state === "idle" && (
                  <ActionButton
                    type="button"
                    className="primary fh-btn"
                    onClick={() => void read()}
                  >
                    What's missing here?
                  </ActionButton>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {reading.answer.proposals.length === 0 && reading.answer.questions.length === 0 && (
              <p className="muted fh-note">Nothing stands out as missing.</p>
            )}
            <ul className="fh-list">
              {reading.answer.proposals.map((p) => (
                <li key={p.name} className="fh-mention">
                  <b className="fh-mention-title">{p.name}</b>
                  <p className="fh-sentence">{p.reason}</p>
                  <ActionButton
                    type="button"
                    className="quiet fh-btn"
                    disabled={drafted}
                    onClick={() => void draft(p)}
                  >
                    {drafting?.name === p.name && drafting.state === "ready"
                      ? "Draft ready below"
                      : "Draft this entry"}
                  </ActionButton>
                </li>
              ))}
            </ul>
            {reading.answer.questions.length > 0 && (
              <div className="fh-questions">
                <b>Open {reading.answer.questions.length === 1 ? "question" : "questions"}.</b>{" "}
                {reading.answer.questions.join(" ")}
              </div>
            )}
            <button type="button" className="plain fh-more" onClick={() => void read()}>
              Read it again
            </button>
          </>
        )}
      </section>
      {drafting?.state === "working" && (
        <div className="fh-wide">
          <Progress label="Drafting" />
          <p className="fh-working muted" role="status">
            Drafting “{drafting.name}”…{" "}
            <button type="button" className="quiet" onClick={() => run.current?.abort()}>
              Stop
            </button>
          </p>
        </div>
      )}
      {drafting?.state === "failed" && (
        <div className="fh-wide">
          <Problem reason={drafting.reason} href={drafting.href} />
        </div>
      )}
      {drafting?.state === "ready" && (
        <div className="fh-wide">
          <EntryDraft
            key={drafting.name}
            said={drafting.said}
            proposal={drafting.proposal}
            onClose={() => setDrafting(null)}
          />
        </div>
      )}
    </>
  );
}
