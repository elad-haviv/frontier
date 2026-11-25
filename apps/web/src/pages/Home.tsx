/**
 * Home (stage 25, keep going): where the app opens. What to pick up, what to work on next, a dice,
 * a question to answer, the pinned entries, what was read lately, the week, and how thin each
 * folder is. Pins and recents come from this device and work offline; the rest asks the server and
 * says so when it cannot. The design is docs/designs/stage-25-keep-going.md.
 */
import {
  type DayQuestion,
  type EntryRow,
  type NeedsLoveRow,
  type QueueResponse,
  type WantedRow,
} from "@frontier/schema";
import { BookOpen, Dices, PenLine, PinOff } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiFailure, editUrl, entryUrl } from "../api.ts";
import { NewEntry } from "../components/NewEntry.tsx";
import { useRevealInTree } from "../components/shell/panels.tsx";
import { useStatus } from "../components/Shell.tsx";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { Icon } from "../components/ui/Icon.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { shortcutText } from "../keys.ts";
import {
  ago,
  barHeights,
  dayLetter,
  dayName,
  entriesWord,
  folderOf,
  lastRead,
  mentionsText,
  newestDraft,
  onThisDayWhen,
  stemOf,
} from "../keepGoing/homeModel.ts";
import { type Pin, togglePin, usePins } from "../keepGoing/pins.ts";
import { RANDOM_KINDS, type RandomKind } from "../keepGoing/random.ts";
import { useRecents } from "../keepGoing/recents.ts";
import { useRandom } from "../keepGoing/useRandom.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { type Async, failureOf, useAsync } from "../useAsync.ts";
import "./Home.css";

/** Rows of the work queue shown before "Show all". */
const SHOWN = 8;

const FILTERS = [
  { id: "love", label: "Needs love" },
  { id: "wanted", label: "Wanted" },
  { id: "orphans", label: "Orphans" },
  { id: "deadEnds", label: "Dead ends" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const EMPTY: Record<Filter, string> = {
  love: "Every entry has a type, a picture and some text. Pick a random one to reread.",
  wanted: "Every link points at an entry that exists.",
  orphans: "Every entry has something linking to it.",
  deadEnds: "Every entry links to something.",
};

/** Whether a failed load is the server being out of reach, rather than the server saying no. */
const unreachable = (error: ApiFailure | null) => !!error && error.status === 0;

/** One card of the page: a heading with an optional small note, and its content. */
function Card({
  id,
  title,
  note,
  tone,
  children,
}: {
  id: string;
  title: ReactNode;
  note?: ReactNode;
  tone?: "pickup" | "ai";
  children: ReactNode;
}) {
  return (
    <section className={`home-card${tone ? ` is-${tone}` : ""}`} aria-labelledby={`home-${id}`}>
      <h2 id={`home-${id}`}>
        {title}
        {note && <span className="home-card-note">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

/** What a card says when the server cannot be reached, with the way back when it can. */
const NeedsConnection = ({ what }: { what: string }) => (
  <p className="muted home-offline">{what} needs a connection.</p>
);

// ---- Pick up where you left off ----------------------------------------------------------------

function PickUp() {
  const { recents } = useRecents();
  const offline = useNeedsConnection();
  const drafts = useAsync(() => api.unpublished(), `home-drafts:${!!offline}`);
  const read = lastRead(recents);
  const draft = drafts.state === "ready" ? newestDraft(drafts.value.drafts, recents) : null;
  // With no connection the server's list is out of reach; this device still knows what it edited.
  const edited = !draft && offline ? recents.find((r) => r.kind === "edited") : undefined;
  const target = draft
    ? {
        path: draft.path,
        title: recents.find((r) => r.path === draft.path)?.title ?? stemOf(draft.path),
        note: draft.kind === "create" ? "A new entry, not published yet" : "Unpublished changes",
      }
    : edited
      ? { path: edited.path, title: edited.title, note: "Edited on this device" }
      : null;
  const when = target ? recents.find((r) => r.path === target.path && r.kind === "edited") : null;
  const other = read && read.path !== target?.path ? read : null;
  if (!target && !other) return null;
  return (
    <Card id="pickup" title="Pick up where you left off" tone="pickup">
      {target && (
        <>
          <p className="home-pick-title">{target.title}</p>
          <p className="home-meta">
            {target.note}
            {when ? ` · edited ${ago(when.at)}` : ""}
          </p>
        </>
      )}
      <div className="home-actions">
        {target && (
          <Link to={editUrl(target.path)} className="home-btn is-primary">
            <Icon icon={PenLine} size="sm" /> Continue editing
          </Link>
        )}
        {other && (
          <Link to={entryUrl(other.path)} className="home-btn">
            <Icon icon={BookOpen} size="sm" /> Last read: {other.title}
          </Link>
        )}
      </div>
    </Card>
  );
}

// ---- What to work on next ------------------------------------------------------------------------

/** A line of one row: the name, what is wrong with it, and what to do about it. */
function QueueItem({
  name,
  tag,
  why,
  tone,
  action,
}: {
  name: string;
  tag?: string;
  why: string;
  tone?: "missing";
  action: ReactNode;
}) {
  return (
    <li>
      <div className="home-who">
        <span className={`home-name${tone ? ` is-${tone}` : ""}`}>{name}</span>
        {tag && <span className="home-tag">{tag}</span>}
        <div className="home-why">{why}</div>
      </div>
      {action}
    </li>
  );
}

const openLink = (path: string, title: string) => (
  <Link to={entryUrl(path)} className="home-btn is-small" aria-label={`Open ${title}`}>
    Open
  </Link>
);

const whereText = (row: { folder: string }, text: string) =>
  row.folder ? `${row.folder} · ${text}` : text;

function Queue({
  queue,
  onWrite,
}: {
  queue: Async<QueueResponse>;
  onWrite: (name: string, folder: string) => void;
}) {
  const offline = useNeedsConnection();
  const [filter, setFilter] = useState<Filter>("love");
  const [all, setAll] = useState(false);
  const failed = queue.state === "failed" || (queue.state === "ready" && queue.error);
  const lost = unreachable(failureOf(queue)) || !!offline;

  let body: ReactNode;
  if (queue.state === "loading") body = <Progress label="Loading what to work on" />;
  else if (queue.state === "failed" && lost) body = <NeedsConnection what="The work queue" />;
  else if (queue.state === "failed")
    body = <Problem reason={queue.error.message} onRetry={queue.retry} />;
  else {
    const q = queue.value;
    const lists: Record<Filter, { total: number; rows: unknown[] }> = {
      love: q.needsLove,
      wanted: q.wanted,
      orphans: q.orphans,
      deadEnds: q.deadEnds,
    };
    const list = lists[filter];
    const rows = all ? list.rows : list.rows.slice(0, SHOWN);
    body = (
      <>
        {list.total === 0 ? (
          <p className="home-empty">{EMPTY[filter]}</p>
        ) : (
          <ul className="home-queue">
            {filter === "love" &&
              (rows as NeedsLoveRow[]).map((r) => (
                <QueueItem
                  key={r.path}
                  name={r.title}
                  {...(r.reasons.some((x) => x.rule === "stub") ? { tag: "stub" } : {})}
                  why={whereText(r, r.reasons.map((x) => x.text).join(" · "))}
                  action={openLink(r.path, r.title)}
                />
              ))}
            {filter === "wanted" &&
              (rows as WantedRow[]).map((r) => (
                <QueueItem
                  key={r.name}
                  name={r.name}
                  tone="missing"
                  why={mentionsText(r.mentions, r.folder)}
                  action={
                    <button
                      type="button"
                      className="home-btn is-small is-primary"
                      aria-label={`Write ${r.name}`}
                      onClick={() => onWrite(r.name, r.folder ?? "")}
                    >
                      Write it
                    </button>
                  }
                />
              ))}
            {(filter === "orphans" || filter === "deadEnds") &&
              (rows as EntryRow[]).map((r) => (
                <QueueItem
                  key={r.path}
                  name={r.title}
                  why={whereText(
                    r,
                    filter === "orphans"
                      ? `Nothing links here · links to ${entriesWord(r.linksTo)}`
                      : `Links to nothing · linked from ${entriesWord(r.linkedFrom)}`,
                  )}
                  action={openLink(r.path, r.title)}
                />
              ))}
          </ul>
        )}
        {list.rows.length > SHOWN && (
          <button type="button" className="home-link" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${list.rows.length}`}
          </button>
        )}
        {list.total > list.rows.length && (
          <p className="home-meta">
            The first {list.rows.length} of {list.total}.
          </p>
        )}
      </>
    );
  }

  const counts = queue.state === "ready" ? countsOf(queue.value) : null;
  return (
    <Card id="queue" title="What to work on next" note="from the link index">
      {!(failed && lost) && (
        <div className="home-chips" role="group" aria-label="What to look at">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="home-chip"
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setAll(false);
              }}
            >
              {f.label}
              {counts && <b>{counts[f.id]}</b>}
            </button>
          ))}
        </div>
      )}
      {body}
    </Card>
  );
}

const countsOf = (q: QueueResponse): Record<Filter, number> => ({
  love: q.needsLove.total,
  wanted: q.wanted.total,
  orphans: q.orphans.total,
  deadEnds: q.deadEnds.total,
});

// ---- A question to answer (AI) --------------------------------------------------------------------

function Question() {
  const offline = useNeedsConnection();
  const today = useAsync(() => api.todaysQuestion(), `home-question:${!!offline}`);
  const [made, setMade] = useState<DayQuestion | null>(null);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<ApiFailure | null>(null);
  const stop = useRef<AbortController | null>(null);
  // Leaving the page stops a question being made, so nothing is paid for that no one will read.
  useEffect(() => () => stop.current?.abort(), []);

  const question = made ?? (today.state === "ready" ? today.value.question : null);

  async function ask(another: boolean) {
    stop.current?.abort();
    const control = new AbortController();
    stop.current = control;
    setAsking(true);
    setProblem(null);
    try {
      const r = await api.makeQuestion(another, control.signal);
      if (!control.signal.aborted) setMade(r.question);
    } catch (err) {
      if (control.signal.aborted) return;
      setProblem(err instanceof ApiFailure ? err : new ApiFailure(0, "unknown", String(err)));
    } finally {
      if (!control.signal.aborted) setAsking(false);
    }
  }

  let body: ReactNode;
  if (today.state === "loading") body = <Progress label="Loading today's question" />;
  else if (today.state === "failed" && (unreachable(today.error) || offline))
    body = <NeedsConnection what="Today's question" />;
  else if (today.state === "failed")
    body = <Problem reason={today.error.message} onRetry={today.retry} />;
  else if (question) {
    body = (
      <>
        <q className="home-question">{question.question}</q>
        <p className="home-meta">
          From <i>{question.title}</i>, a thin entry.
        </p>
        <div className="home-actions">
          <Link to={editUrl(question.path)} className="home-btn is-small is-primary">
            Answer it in {question.title}
          </Link>
          <ActionButton
            className="home-btn is-small"
            disabled={asking}
            onClick={() => void ask(true)}
          >
            Another question
          </ActionButton>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className="home-meta">
          One question about a thin entry, made when you ask and kept for the day.
        </p>
        <div className="home-actions">
          <ActionButton
            className="home-btn is-small is-primary"
            disabled={asking}
            onClick={() => void ask(false)}
          >
            Give me a question
          </ActionButton>
        </div>
      </>
    );
  }
  return (
    <Card
      id="question"
      title={
        <>
          A question to answer <span className="home-ai">AI</span>
        </>
      }
      tone="ai"
    >
      {asking && <Progress label="Thinking of a question" />}
      {body}
      {problem && <Problem reason={problem.message} href={problem.href} />}
    </Card>
  );
}

// ---- Random entry -------------------------------------------------------------------------------

/** The dice's state, shared by its card and the phone's round button. */
function useDice(lastFolder: string | null, lastPath: string | null) {
  const roll = useRandom();
  const toast = useToast();
  const [kind, setKind] = useState<RandomKind>("any");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (kind === "folder" && lastFolder === null) {
      toast({ message: "Read an entry first: this picks from the folder of the last one." });
      return;
    }
    setBusy(true);
    try {
      // Another entry of that folder: not the one just read.
      await roll(
        kind === "folder"
          ? { kind, folder: lastFolder ?? "", ...(lastPath ? { not: lastPath } : {}) }
          : { kind },
      );
    } finally {
      setBusy(false);
    }
  }
  return { kind, setKind, busy, go };
}

type Dice = ReturnType<typeof useDice>;

function DiceCard({ dice, lastFolder }: { dice: Dice; lastFolder: string | null }) {
  const key = shortcutText("app.random");
  return (
    <Card
      id="dice"
      title="Random entry"
      note={key && <kbd className="home-kbd">{key.replace(/ then /, " ")}</kbd>}
    >
      <div className="home-actions">
        <ActionButton
          className="home-btn is-dice"
          disabled={dice.busy}
          onClick={() => void dice.go()}
        >
          <Icon icon={Dices} size="sm" /> Roll
        </ActionButton>
        <span className="home-meta" aria-live="polite">
          {dice.kind === "folder"
            ? lastFolder === null
              ? "No entry read yet, so no folder to pick from."
              : `In ${lastFolder || "the top of the library"}`
            : RANDOM_KINDS.find((k) => k.kind === dice.kind)?.label}
        </span>
      </div>
      <div className="home-chips is-scroll" role="group" aria-label="Kind of entry">
        {RANDOM_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className="home-chip"
            aria-pressed={dice.kind === k.kind}
            onClick={() => dice.setKind(k.kind)}
          >
            {k.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

// ---- Working on, and recently --------------------------------------------------------------------

function Pins({ pins }: { pins: readonly Pin[] }) {
  const toast = useToast();
  async function unpin(pin: Pin) {
    try {
      await togglePin(pin.path);
      toast({ message: `Unpinned ${pin.title}.` });
    } catch (err) {
      toast({
        message: `Could not unpin: ${err instanceof ApiFailure ? err.message : "something went wrong."}`,
      });
    }
  }
  return (
    <Card id="pins" title="Working on">
      {pins.length === 0 ? (
        <p className="home-empty">Pin an entry from its page, or press p on it, to keep it here.</p>
      ) : (
        <ul className="home-mini">
          {pins.map((p) => (
            <li key={p.path}>
              <Link to={entryUrl(p.path)} className="home-lnk">
                {p.title}
              </Link>
              <ActionButton
                className="home-icon-btn"
                aria-label={`Unpin ${p.title}`}
                title="Unpin"
                onClick={() => void unpin(p)}
              >
                <Icon icon={PinOff} size="sm" />
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Recently() {
  const { recents } = useRecents();
  if (recents.length === 0) return null;
  const now = Date.now();
  return (
    <Card id="recent" title="Recently">
      <ul className="home-mini">
        {recents.slice(0, 8).map((r) => (
          <li key={r.path}>
            <Link to={entryUrl(r.path)} className="home-lnk">
              {r.title}
            </Link>
            <span className="home-tag">{r.kind}</span>
            <span className="home-when">{ago(r.at, now)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---- This week, and on this day --------------------------------------------------------------------

function Week() {
  const offline = useNeedsConnection();
  const week = useAsync(() => api.keepGoingWeek(), `home-week:${!!offline}`);
  if (week.state === "failed" && (unreachable(week.error) || offline)) {
    return (
      <Card id="week" title="This week">
        <NeedsConnection what="The week's numbers" />
      </Card>
    );
  }
  if (week.state === "failed") {
    return (
      <Card id="week" title="This week">
        <Problem reason={week.error.message} onRetry={week.retry} />
      </Card>
    );
  }
  if (week.state === "loading") {
    return (
      <Card id="week" title="This week">
        <Progress label="Loading the week" />
      </Card>
    );
  }
  const { week: w, onThisDay } = week.value;
  const heights = barHeights(w.days);
  const quiet = w.entriesTouched === 0;
  return (
    <>
      <Card id="week" title="This week">
        <p className="home-meta">
          {quiet
            ? "Nothing written yet this week."
            : `${entriesWord(w.entriesTouched)} touched · ${w.wordsAdded.toLocaleString()} words · ${w.linksFilled} missing ${w.linksFilled === 1 ? "link" : "links"} filled`}
        </p>
        <div
          className="home-week"
          role="img"
          aria-label={`Entries touched each day: ${w.days.map((d) => `${dayName(d.date)} ${d.entries}`).join(", ")}`}
        >
          {w.days.map((d, i) => (
            <i
              key={d.date}
              className={i === w.days.length - 1 ? "is-today" : undefined}
              style={{ height: `${heights[i]}%` }}
              title={`${dayName(d.date)}: ${entriesWord(d.entries)}`}
            />
          ))}
        </div>
        <div className="home-days" aria-hidden="true">
          {w.days.map((d) => (
            <span key={d.date}>{dayLetter(d.date)}</span>
          ))}
        </div>
      </Card>
      {onThisDay.length > 0 && (
        <Card id="day" title="On this day">
          <ul className="home-mini">
            {onThisDay.map((r) => (
              <li key={`${r.span}|${r.path}`}>
                <Link to={entryUrl(r.path)} className="home-lnk">
                  {r.title}
                </Link>
                <span className="home-when">{onThisDayWhen(r)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// ---- Folders ---------------------------------------------------------------------------------------

function Folders({ queue }: { queue: QueueResponse }) {
  const reveal = useRevealInTree();
  if (queue.folders.length === 0) return null;
  return (
    <Card id="folders" title="Folders">
      <ul className="home-mini">
        {queue.folders.map((f) => (
          <li key={f.folder}>
            <button
              type="button"
              className="home-lnk"
              title="Show it in the folder tree"
              onClick={() => reveal(f.folder)}
            >
              {f.folder.split("/").pop()}
            </button>
            <span className="home-when">
              {f.stubs} of {f.entries} {f.stubs === 1 ? "is a stub" : "are stubs"}
              <span className="home-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${f.entries === 0 ? 0 : Math.round(100 - (f.stubs / f.entries) * 100)}%`,
                  }}
                />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---- The page ----------------------------------------------------------------------------------------

export function Home() {
  const navigate = useNavigate();
  const status = useStatus();
  const offline = useNeedsConnection();
  const { recents } = useRecents();
  const pins = usePins();
  const tree = useAsync(() => api.tree(), "home-tree");
  // Read once, for the queue, the folders and the empty library; it is read again when the
  // connection comes back.
  const queue = useAsync(() => api.keepGoingQueue(), `home-queue:${!!offline}`);
  const [writing, setWriting] = useState<{ name: string; folder: string } | null>(null);
  const read = lastRead(recents);
  const lastFolder = read ? folderOf(read.path) : null;
  const dice = useDice(lastFolder, read?.path ?? null);
  const brandNew = queue.state === "ready" && queue.value.entries === 0;
  const first = recents[0];

  return (
    <div className="home">
      <header className="home-hello">
        <h1>{brandNew ? "Welcome to Frontier" : "Welcome back"}</h1>
        {first && !brandNew && (
          <p>
            Last here {ago(first.at)}, in {first.title}.
          </p>
        )}
      </header>

      {brandNew ? (
        <Card id="first" title="Write your first entry">
          <p className="home-meta">
            The library has no entries yet. Name one, pick a folder for it, and start writing.
          </p>
          <div className="home-actions">
            <button
              type="button"
              className="home-btn is-primary"
              onClick={() => setWriting({ name: "", folder: "" })}
            >
              New entry
            </button>
          </div>
        </Card>
      ) : (
        <div className="home-cols">
          <div className="home-stack">
            <PickUp />
            <Queue queue={queue} onWrite={(name, folder) => setWriting({ name, folder })} />
            {status?.ai?.conversation && <Question />}
          </div>
          <div className="home-stack">
            <DiceCard dice={dice} lastFolder={lastFolder} />
            <Pins pins={pins} />
            <Recently />
            <Week />
            {queue.state === "ready" && <Folders queue={queue.value} />}
          </div>
        </div>
      )}

      {!brandNew && (
        <ActionButton
          className="home-fab"
          aria-label="Random entry"
          disabled={dice.busy}
          onClick={() => void dice.go()}
        >
          <Icon icon={Dices} />
        </ActionButton>
      )}

      {writing && (
        <NewEntry
          tree={tree}
          folder={writing.folder}
          name={writing.name}
          action="Start writing"
          onRetry={tree.retry}
          onClose={() => setWriting(null)}
          onMake={(path, type) => {
            setWriting(null);
            navigate(`${editUrl(path)}?new=1${type ? `&type=${encodeURIComponent(type)}` : ""}`);
          }}
        />
      )}
    </div>
  );
}
