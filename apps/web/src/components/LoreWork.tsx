/**
 * The work behind a lore answer, shown as it happens: each step (a search, the entries read, the
 * model asked, the quotes checked) with the entries it found, and the model's reasoning when the
 * model reasons. Once the answer is in, the steps fold to one line that opens again.
 */
import {
  Ban,
  BookOpen,
  CircleAlert,
  History,
  Link2,
  ListChecks,
  LoaderCircle,
  type LucideIcon,
  Search,
  Sparkles,
  Square,
  Tag,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "../nav.tsx";
import {
  api,
  ApiFailure,
  entryUrl,
  type LoreConversation,
  type LoreStep,
  type LoreTurn,
} from "../api.ts";
import { Icon } from "./ui/Icon.tsx";
import "./LoreWork.css";

const ICONS: Record<string, LucideIcon> = {
  names: Tag,
  earlier: History,
  search: Search,
  links: Link2,
  read: BookOpen,
  unread: Ban,
  model: Sparkles,
  check: ListChecks,
};

const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

/** "12s", "1 min 4s". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${s % 60}s`;
}

/** The steps, in order; the one still working shows a turning mark. */
function Steps({
  steps,
  gone,
}: {
  steps: { step: LoreStep; active: boolean }[];
  gone?: ReadonlySet<string>;
}) {
  return (
    <ol className="lore-steps">
      {steps.map(({ step, active }, i) => (
        <li key={i} className={"lore-step" + (active ? " is-active" : "")}>
          <Icon
            icon={active ? LoaderCircle : (ICONS[step.kind] ?? Sparkles)}
            size="sm"
            {...(active ? { className: "lore-spin" } : {})}
          />
          <div className="lore-step-body">
            <span className="lore-step-text">{step.text}</span>
            {step.detail && <span className="lore-step-detail muted"> · {step.detail}</span>}
            {step.entries && step.entries.length > 0 && (
              <span className="lore-chips">
                {step.entries.map((path) =>
                  gone?.has(path) ? (
                    <s key={path} className="lore-chip" title="No longer in the library">
                      {titleOf(path)}
                    </s>
                  ) : (
                    <Link key={path} className="lore-chip" to={entryUrl(path)} title={path}>
                      {titleOf(path)}
                    </Link>
                  ),
                )}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The model's reasoning, folded; while it comes, open and kept scrolled to its end. */
function Thinking({ text, live }: { text: string; live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, live]);
  if (!text) return null;
  return (
    <details className="lore-thinking" open={live || undefined}>
      <summary>{live ? "Thinking…" : "Thinking"}</summary>
      {/* The model's words, as plain text. */}
      <div ref={box} className="lore-thinking-text">
        {text}
      </div>
    </details>
  );
}

/** The work behind an answer that is in: one line, "Read 6 entries · thought for 12s", that opens. */
export function TurnWork({ turn, gone }: { turn: LoreTurn; gone: ReadonlySet<string> }) {
  const trace = turn.trace!;
  const n = turn.given.length;
  return (
    <details className="lore-work turn-meta">
      <summary>
        Read {n} {n === 1 ? "entry" : "entries"} · thought for {duration(trace.ms)} · $
        {turn.costUsd.toFixed(3)}
      </summary>
      <Steps steps={trace.steps.map((step) => ({ step, active: false }))} gone={gone} />
      <Thinking text={trace.reasoning} live={false} />
    </details>
  );
}

/** A question being answered, as the page holds it. */
export interface Live {
  question: string;
  run: string | null;
  steps: { step: LoreStep; active: boolean }[];
  reasoning: string;
  /** How much of the answer the model has written, in characters. */
  chars: number;
  started: number;
  state: "working" | "stopping" | "stopped" | "failed";
  error?: string;
}

/**
 * Asking with the work shown: `ask` starts, `stop` stops the work on the server. Leaving the page
 * only stops the showing; the server still keeps the answer in the conversation.
 */
export function useLoreAsk(
  onDone: (r: { conversation: LoreConversation; gone: string[] }) => void,
) {
  const [live, setLive] = useState<Live | null>(null);
  const reading = useRef<AbortController | null>(null);
  const run = useRef<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => () => reading.current?.abort(), []);

  const ask = useCallback(async (question: string, conversation?: string) => {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    run.current = null;
    setLive({
      question,
      run: null,
      steps: [],
      reasoning: "",
      chars: 0,
      started: Date.now(),
      state: "working",
    });
    const update = (change: (l: Live) => Live) => {
      if (!controller.signal.aborted) setLive((l) => (l ? change(l) : l));
    };
    try {
      const r = await api.askStreamed(
        question,
        conversation,
        (e) => {
          if (e.type === "run") {
            run.current = e.run;
            update((l) => ({ ...l, run: e.run }));
          } else if (e.type === "step") {
            update((l) => {
              const steps = [...l.steps];
              steps[e.n] = { step: e.step, active: e.active };
              return { ...l, steps };
            });
          } else if (e.type === "reasoning") {
            update((l) => ({ ...l, reasoning: l.reasoning + e.text }));
          } else if (e.type === "writing") {
            update((l) => ({ ...l, chars: e.chars }));
          }
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setLive(null);
      done.current(r);
    } catch (err) {
      if (controller.signal.aborted) return;
      const stopped = err instanceof ApiFailure && err.code === "ai_stopped";
      update((l) => ({
        ...l,
        steps: l.steps.map((s) => ({ ...s, active: false })),
        state: stopped ? "stopped" : "failed",
        error: err instanceof ApiFailure ? err.message : "The question could not be asked.",
      }));
    }
  }, []);

  const stop = useCallback(() => {
    if (!run.current) return;
    setLive((l) => (l ? { ...l, state: "stopping" } : l));
    api.stopAsking(run.current).catch(() => {
      // The stop could not reach the server: stop showing the work at least.
      reading.current?.abort();
      setLive((l) => (l ? { ...l, state: "stopped" } : l));
    });
  }, []);

  const clear = useCallback(() => setLive(null), []);
  return { live, ask, stop, clear };
}

/** A question being answered: its steps as they happen, the thinking, and a Stop button. */
export function LiveTurn({ live, onStop }: { live: Live; onStop: () => void }) {
  const working = live.state === "working" || live.state === "stopping";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [working]);
  const writing = working && live.chars > 0;

  return (
    <li className="turn lore-live" aria-busy={working}>
      <p className="turn-question">{live.question}</p>
      <div className="lore-work-live" aria-live="polite">
        <Steps steps={live.steps} />
        <Thinking text={live.reasoning} live={working} />
        {writing && (
          <p className="lore-writing muted">
            <Icon icon={LoaderCircle} size="sm" className="lore-spin" /> Writing the answer ·{" "}
            {live.chars.toLocaleString()} characters
          </p>
        )}
      </div>
      {working && (
        <p className="lore-live-bar">
          <span className="muted">
            {live.state === "stopping" ? "Stopping…" : `Working · ${duration(now - live.started)}`}
          </span>
          <button
            type="button"
            className="quiet lore-stop"
            disabled={!live.run || live.state === "stopping"}
            onClick={onStop}
          >
            <Icon icon={Square} size="sm" /> Stop
          </button>
        </p>
      )}
      {live.state === "stopped" && <p className="muted lore-stopped">Stopped. Nothing was kept.</p>}
      {live.state === "failed" && (
        <div className="lore-failed" role="alert">
          <Icon icon={CircleAlert} size="sm" />
          <div>
            <p>
              <strong>The answer could not be finished.</strong>
            </p>
            <p>{live.error}</p>
          </div>
        </div>
      )}
    </li>
  );
}
