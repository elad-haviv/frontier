import { Download, Plus, Trash2, X } from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "../nav.tsx";
import {
  api,
  ApiFailure,
  type CharacterProfile,
  type CharacterTalk,
  entryUrl,
  type TalkSummary,
  type Trait,
} from "../api.ts";
import { useRefresh } from "../components/Shell.tsx";
import { useCanWrite } from "../components/projectContext.ts";
import { ActionButton } from "../components/ui/ActionButton.tsx";
import { IconButton } from "../components/ui/IconButton.tsx";
import { downloadTalk, momentText } from "../talkExport.ts";

const KINDS: [Trait["kind"], string][] = [
  ["voice", "How they speak"],
  ["knows", "What they know"],
  ["believes", "What they believe"],
  ["unknown", "Not known"],
];
const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
const failed = (err: unknown, fallback: string) =>
  err instanceof ApiFailure ? err.message : fallback;
const day = (at: string) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** A trait while it is edited; `key` keeps its row as traits move between kinds. */
type EditedTrait = Trait & { key: number };
let nextKey = 1;
const keyed = (traits: Trait[]): EditedTrait[] =>
  traits.map(({ kind, text, sources, quotes }) => ({
    kind,
    text,
    sources,
    quotes,
    key: nextKey++,
  }));

/** A text box that is as tall as its words. */
function GrowingText(
  p: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    focusNow?: boolean;
    box?: RefObject<HTMLTextAreaElement | null>;
  },
) {
  const { focusNow, box, ...rest } = p;
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = box ?? own;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [p.value, ref]);
  useEffect(() => {
    if (focusNow) ref.current?.focus();
  }, [focusNow, ref]);
  return <textarea ref={ref} rows={1} {...rest} />;
}

function Sources({ paths }: { paths: string[] }) {
  return (
    <>
      From{" "}
      {paths.map((s, j) => (
        <span key={s}>
          {j > 0 && ", "}
          <Link to={entryUrl(s)}>{titleOf(s)}</Link>
        </span>
      ))}
    </>
  );
}

/** What the year of the moment keeps from the character, said as the author types it. */
function Withheld({ path, name, year }: { path: string; name: string; year: string }) {
  const [found, setFound] = useState<{
    year: string;
    read: number;
    withheld: { path: string; title: string }[];
  } | null>(null);
  const y = year.trim();
  const bad = y !== "" && !Number.isFinite(Number(y));
  useEffect(() => {
    if (bad) return;
    let live = true;
    const timer = setTimeout(() => {
      api.characterMoment(path, y).then(
        (r) => live && setFound({ year: y, ...r }),
        () => live && setFound(null),
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, y, bad]);

  if (bad)
    return <p className="talk-withheld">The year is a number of the main chronicle, or empty.</p>;
  if (!found || found.year !== y) return <p className="talk-withheld muted">&nbsp;</p>;
  if (y === "") {
    return (
      <p className="talk-withheld" role="status">
        No year given: {name} may draw on all {found.read} entries read for the profile.
      </p>
    );
  }
  if (found.withheld.length === 0) {
    return (
      <p className="talk-withheld" role="status">
        None of the {found.read} entries read for the profile begins after {y} in the main
        chronicle.
      </p>
    );
  }
  return (
    <p className="talk-withheld" role="status">
      {found.withheld.length} of {found.read} entries begin after {y} and are kept from {name}:{" "}
      {found.withheld.map((w, i) => (
        <span key={w.path}>
          {i > 0 && ", "}
          <Link to={entryUrl(w.path)}>{w.title}</Link>
        </span>
      ))}
      .
    </p>
  );
}

/** The profile being made: proposed by the AI, edited and approved by the author. */
function ProfileEditor(p: {
  path: string;
  name: string;
  start: CharacterProfile | null;
  /** The traits to open with when there is no profile yet: a first draft, or none. */
  drafted: Trait[];
  onApproved: (profile: CharacterProfile) => void;
  onCancel: (() => void) | null;
}) {
  const refresh = useRefresh();
  const [traits, setTraits] = useState<EditedTrait[]>(() => keyed(p.start?.traits ?? p.drafted));
  const [words, setWords] = useState(p.start?.moment.words ?? "");
  const [year, setYear] = useState(p.start?.moment.year?.toString() ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  async function propose() {
    setBusy("propose");
    setError(null);
    try {
      setTraits(keyed((await api.proposeProfile(p.path)).traits));
    } catch (err) {
      setError(failed(err, "No profile could be drafted."));
    } finally {
      setBusy(null);
    }
  }

  async function approve(e: FormEvent) {
    e.preventDefault();
    const y = year.trim() === "" ? null : Number(year);
    if (y !== null && !Number.isFinite(y)) {
      setError("The year is a number of the main chronicle, or empty.");
      return;
    }
    setBusy("approve");
    setError(null);
    try {
      const { profile } = await api.approveProfile(
        p.path,
        traits.map(({ kind, text, sources, quotes }) => ({ kind, text, sources, quotes })),
        { words, year: y },
      );
      refresh();
      p.onApproved(profile);
    } catch (err) {
      setError(failed(err, "The profile could not be saved."));
    } finally {
      setBusy(null);
    }
  }

  const set = (key: number, change: Partial<Trait>) =>
    setTraits(traits.map((t) => (t.key === key ? { ...t, ...change } : t)));
  const remove = (key: number) => setTraits(traits.filter((t) => t.key !== key));
  const add = (kind: Trait["kind"]) => {
    const key = nextKey++;
    setTraits([...traits, { kind, text: "", sources: [], quotes: [], key }]);
    setAdded(key);
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>, t: EditedTrait) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Backspace" && t.text === "") {
      e.preventDefault();
      remove(t.key);
    }
  };
  const written = traits.filter((t) => t.text.trim() !== "").length;

  return (
    <form className="profile-form" onSubmit={approve}>
      <div className="talk-cols">
        <div>
          {KINDS.map(([kind, label]) => {
            const mine = traits.filter((t) => t.kind === kind);
            return (
              <section key={kind} className={`trait-group trait-group-${kind}`} aria-label={label}>
                <div className="trait-group-head">
                  <h2>{label}</h2>
                  <span className="muted">{mine.length}</span>
                </div>
                {kind === "unknown" && (
                  <p className="muted trait-group-note">
                    Asked about these, {p.name} improvises, and the line is marked as improvised.
                  </p>
                )}
                <ul className="traits">
                  {mine.map((t) => (
                    <li key={t.key} className={`trait trait-${t.kind}`}>
                      <GrowingText
                        aria-label="Trait"
                        className="trait-text"
                        placeholder="Write the trait…"
                        value={t.text}
                        focusNow={added === t.key}
                        onChange={(e) => set(t.key, { text: e.target.value })}
                        onKeyDown={(e) => keys(e, t)}
                      />
                      <div className="trait-tools">
                        <select
                          aria-label="Kind of trait"
                          value={t.kind}
                          onChange={(e) => set(t.key, { kind: e.target.value as Trait["kind"] })}
                        >
                          {KINDS.map(([k, l]) => (
                            <option key={k} value={k}>
                              {k === t.kind ? "Move…" : l}
                            </option>
                          ))}
                        </select>
                        <IconButton
                          label="Remove trait"
                          icon={X}
                          size="sm"
                          onClick={() => remove(t.key)}
                        />
                      </div>
                      <p className="muted sources">
                        {t.sources.length > 0 ? (
                          <>
                            <Sources paths={t.sources} />
                            {t.quotes[0] && <> · “{t.quotes[0].text}”</>}
                          </>
                        ) : t.kind === "unknown" ? (
                          "The entries don't say"
                        ) : (
                          "Added by you"
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
                <button type="button" className="plain trait-add" onClick={() => add(kind)}>
                  <Plus size={14} aria-hidden="true" /> Add
                  <span className="sr-only"> to {label}</span>
                </button>
              </section>
            );
          })}
        </div>
        <aside className="talk-panel" aria-label="The moment">
          <h2>The moment</h2>
          <label className="field">
            <span>Speaks from</span>
            <input
              type="text"
              value={words}
              placeholder="For example: the year before the Exodus"
              onChange={(e) => setWords(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Year in the main chronicle (optional)</span>
            <input
              type="text"
              inputMode="decimal"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
          <Withheld path={p.path} name={p.name} year={year} />
          <ActionButton
            type="button"
            className="quiet"
            disabled={busy !== null}
            onClick={() => void propose()}
          >
            {busy === "propose" ? "Reading the entries…" : "Draft again from the entries"}
          </ActionButton>
        </aside>
      </div>
      <div className="talk-foot">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="talk-foot-row">
          <ActionButton type="submit" className="primary" disabled={busy !== null}>
            Approve and start talking
          </ActionButton>
          {p.onCancel && (
            <button type="button" className="quiet" onClick={p.onCancel}>
              Cancel
            </button>
          )}
          <p className="muted">
            {written} {written === 1 ? "trait" : "traits"} · saved in the library with your next
            version
          </p>
        </div>
      </div>
    </form>
  );
}

/** The saved conversations with a character: open one, export it, delete it. */
function TalkList(p: {
  name: string;
  talks: TalkSummary[];
  open: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
  onDeleted: (id: string) => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(id: string) {
    setError(null);
    try {
      downloadTalk(p.name, (await api.talk(id)).talk);
    } catch (err) {
      setError(failed(err, "The conversation could not be exported."));
    }
  }
  async function remove(id: string) {
    setError(null);
    try {
      await api.deleteTalk(id);
      setAsking(null);
      p.onDeleted(id);
    } catch (err) {
      setError(failed(err, "The conversation could not be deleted."));
    }
  }

  return (
    <section className="talk-list" aria-label={`Conversations with ${p.name}`}>
      <div className="talk-list-head">
        <h2>Conversations with {p.name}</h2>
        <span>
          <button type="button" className="quiet" onClick={p.onNew}>
            New conversation
          </button>{" "}
          <button type="button" className="quiet" onClick={p.onBack}>
            Back
          </button>
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {p.talks.length === 0 && <p className="muted">No conversations are saved yet.</p>}
      <ul>
        {p.talks.map((t) => (
          <li key={t.id}>
            <div className="talk-list-what">
              <button
                type="button"
                className="plain talk-list-title"
                onClick={() => p.onOpen(t.id)}
              >
                {t.title || "Nothing said yet"}
              </button>
              {t.id === p.open && <span className="talk-list-now">Open now</span>}
              <p className="muted">
                {day(t.updatedAt)} · speaking from {momentText(t.moment)} · {t.lines}{" "}
                {t.lines === 1 ? "line" : "lines"}
                {t.kept > 0 && ` · ${t.kept} added to the entry`}
              </p>
            </div>
            {asking === t.id ? (
              <span className="talk-list-ask">
                <ActionButton
                  type="button"
                  className="quiet danger"
                  onClick={() => void remove(t.id)}
                >
                  Delete
                </ActionButton>{" "}
                <button type="button" className="quiet" onClick={() => setAsking(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <span className="talk-list-tools">
                <IconButton
                  label="Export this conversation"
                  icon={Download}
                  size="sm"
                  onClick={() => void save(t.id)}
                />
                <IconButton
                  label="Delete this conversation"
                  icon={Trash2}
                  size="sm"
                  onClick={() => setAsking(t.id)}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Talking with a character, in their voice, from their moment. */
export function TalkPage() {
  const { pathname } = useLocation();
  const path = decodeURIComponent(pathname.replace(/^\/talk\//, ""));
  const name = titleOf(path);
  const refresh = useRefresh();
  // A reader talks with a character that has a profile, and keeps their own conversations; making
  // the profile and adding what was said to the entry change the project, and are writers'
  // (stage 31, roles).
  const canWrite = useCanWrite();
  const [profile, setProfile] = useState<CharacterProfile | null | undefined>(undefined);
  /** Set while the profile is edited: the traits to open with when there is no profile yet. */
  const [editing, setEditing] = useState<Trait[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [talks, setTalks] = useState<TalkSummary[]>([]);
  /** The open conversation; null until the first thing is said in a new one. */
  const [talk, setTalk] = useState<CharacterTalk | null>(null);
  const [listing, setListing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let live = true;
    setProfile(undefined);
    setTalk(null);
    setTalks([]);
    setEditing(null);
    setListing(false);
    void (async () => {
      const found = await api.characterProfile(path).then(
        (r) => r.profile,
        () => null,
      );
      // The page opens on the conversation last spoken in.
      const saved = found
        ? await api.talks(path).then(
            (r) => r.talks,
            () => [],
          )
        : [];
      const latest = saved[0]
        ? await api.talk(saved[0].id).then(
            (r) => r.talk,
            () => null,
          )
        : null;
      if (!live) return;
      setTalks(saved);
      setTalk(latest);
      setProfile(found);
    })();
    return () => {
      live = false;
    };
  }, [path]);

  const lines = talk?.lines ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length, busy]);

  const relist = () =>
    api.talks(path).then(
      (r) => setTalks(r.talks),
      () => undefined,
    );

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      setEditing((await api.proposeProfile(path)).traits);
    } catch (err) {
      setError(failed(err, "No profile could be drafted."));
    } finally {
      setDrafting(false);
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const said = await api.say(path, text, talk?.id ?? null);
      setTalk(said.talk);
      setMessage("");
      void relist();
    } catch (err) {
      setError(failed(err, "The character did not answer."));
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  async function keep(i: number) {
    const line = lines[i];
    if (!talk || !line || line.who !== "character") return;
    try {
      const kept = await api.keepLine(path, line.text, talk.id, i);
      refresh();
      setTalk(
        kept.talk ?? {
          ...talk,
          lines: talk.lines.map((l, j) =>
            j === i && l.who === "character" ? { ...l, kept: true } : l,
          ),
        },
      );
      void relist();
    } catch (err) {
      setError(failed(err, "The line could not be added."));
    }
  }

  async function open(id: string) {
    setError(null);
    try {
      setTalk((await api.talk(id)).talk);
      setListing(false);
    } catch (err) {
      setError(failed(err, "The conversation could not be opened."));
      void relist();
    }
  }

  const ask = (text: string) => {
    setSheet(false);
    setListing(false);
    setMessage(text);
    box.current?.focus();
  };

  if (profile === undefined) return <p className="center muted">Opening…</p>;
  const talking = profile !== null && editing === null;
  const unknown = profile?.traits.filter((t) => t.kind === "unknown") ?? [];

  return (
    <article className={`entry wide talk${talking ? " is-talking" : ""}`}>
      <header className="entry-head">
        <p className="muted">
          <Link to={entryUrl(path)}>{name}</Link>
        </p>
        <h1>Talk with {name}</h1>
        {talking && (
          <p className="muted lede">
            Speaking from {momentText(profile.moment)} ·{" "}
            <button type="button" className="plain" onClick={() => setListing(!listing)}>
              Conversations ({talks.length})
            </button>
            <span className="talk-phone">
              {" "}
              ·{" "}
              <button type="button" className="plain" onClick={() => setSheet(true)}>
                Profile
              </button>
            </span>
          </p>
        )}
      </header>

      {profile === null && !canWrite && (
        <section className="talk-empty">
          <h2>{name} has no profile yet</h2>
          <p className="muted">
            There is no one to talk with until a writer or an owner of the project drafts and
            approves a profile.
          </p>
        </section>
      )}

      {profile === null && editing === null && canWrite && (
        <section className="talk-empty">
          <h2>{name} needs a profile before speaking</h2>
          <p>
            The profile is what the character speaks from. Frontier drafts it from the entries; you
            correct it and approve it.
          </p>
          <dl>
            <div>
              <dt>How they speak</dt>
              <dd>Voice, habits of speech</dd>
            </div>
            <div>
              <dt>What they know</dt>
              <dd>Facts the entries give them</dd>
            </div>
            <div>
              <dt>What they believe</dt>
              <dd>Convictions, right or wrong</dd>
            </div>
            <div>
              <dt>Not known</dt>
              <dd>What the entries leave open</dd>
            </div>
          </dl>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="change-actions">
            <ActionButton
              type="button"
              className="primary"
              disabled={drafting}
              onClick={() => void draft()}
            >
              {drafting ? "Reading the entries…" : "Draft a profile from the entries"}
            </ActionButton>
          </p>
          <p className="muted">
            Reads {name}'s entry and up to eleven entries around it. Nothing is saved until you
            approve.{" "}
            <button
              type="button"
              className="plain"
              disabled={drafting}
              onClick={() => setEditing([])}
            >
              Write it yourself instead
            </button>
          </p>
        </section>
      )}

      {editing !== null && canWrite && (
        <ProfileEditor
          path={path}
          name={name}
          start={profile}
          drafted={editing}
          onApproved={(p) => {
            setProfile(p);
            setEditing(null);
          }}
          onCancel={profile ? () => setEditing(null) : null}
        />
      )}

      {talking && (
        <div className="talk-cols">
          <div className="talk-convo">
            {listing ? (
              <TalkList
                name={name}
                talks={talks}
                open={talk?.id ?? null}
                onOpen={(id) => void open(id)}
                onBack={() => setListing(false)}
                onNew={() => {
                  setTalk(null);
                  setListing(false);
                }}
                onDeleted={(id) => {
                  if (talk?.id === id) setTalk(null);
                  void relist();
                }}
              />
            ) : (
              <>
                <ol className="talk-lines">
                  {lines.map((l, i) =>
                    l.who === "author" ? (
                      <li key={i} className="talk-author">
                        {l.text}
                      </li>
                    ) : (
                      <li
                        key={i}
                        className={"talk-character" + (l.improvised ? " is-improvised" : "")}
                      >
                        <p className="talk-said">{l.text}</p>
                        <p className="talk-meta">
                          {l.improvised ? (
                            <>
                              <span className="talk-tag">Improvised</span>
                              <span>Nothing in the entries says this.</span>
                            </>
                          ) : (
                            <span className="sources">
                              <Sources paths={l.sources} />
                            </span>
                          )}
                          {l.kept ? (
                            <span>Added to {name}'s entry as an unsaved change.</span>
                          ) : (
                            canWrite && (
                              <ActionButton
                                type="button"
                                className="plain"
                                onClick={() => void keep(i)}
                              >
                                Add to {name}'s entry
                              </ActionButton>
                            )
                          )}
                        </p>
                      </li>
                    ),
                  )}
                  {busy && (
                    <li className="talk-character muted" role="status">
                      {name} is thinking…
                    </li>
                  )}
                  <li ref={end} aria-hidden="true" />
                </ol>
                <form className="talk-composer" onSubmit={(e) => void send(e)}>
                  {lines.length === 0 && (
                    <p className="talk-starters">
                      <button
                        type="button"
                        onClick={() => ask("What do you want most, right now?")}
                      >
                        What do you want most, right now?
                      </button>
                      {unknown.slice(0, 2).map((t) => (
                        <button
                          key={t.text}
                          type="button"
                          onClick={() => ask(`Tell me about this: ${t.text}`)}
                        >
                          Ask: {t.text}
                        </button>
                      ))}
                    </p>
                  )}
                  <div className="talk-composer-row">
                    <GrowingText
                      aria-label={`Say something to ${name}`}
                      placeholder={`Say something to ${name}…`}
                      value={message}
                      disabled={busy}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      box={box}
                    />
                    <ActionButton
                      type="submit"
                      className="primary"
                      disabled={busy || !message.trim()}
                    >
                      Say it
                    </ActionButton>
                  </div>
                  {error && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                  <p className="muted talk-hint">
                    <span className="talk-keys">Enter to say it · Shift+Enter for a new line</span>
                    <span>
                      Saved as you talk
                      {lines.length > 0 && (
                        <>
                          {" · "}
                          <button type="button" className="plain" onClick={() => setTalk(null)}>
                            New conversation
                          </button>
                        </>
                      )}
                    </span>
                  </p>
                </form>
              </>
            )}
          </div>
          <aside
            className={`talk-panel talk-profile${sheet ? " is-open" : ""}`}
            aria-label="Profile"
          >
            <div className="talk-panel-head">
              <h2>Profile</h2>
              <span>
                {canWrite && (
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setSheet(false);
                      setEditing([]);
                    }}
                  >
                    Edit
                  </button>
                )}
                <span className="talk-phone">
                  <IconButton
                    label="Close the profile"
                    icon={X}
                    size="sm"
                    onClick={() => setSheet(false)}
                  />
                </span>
              </span>
            </div>
            {KINDS.map(([kind, label]) => {
              const mine = profile.traits.filter((t) => t.kind === kind);
              if (mine.length === 0) return null;
              return (
                <section key={kind}>
                  <h3>{label}</h3>
                  <ul>
                    {mine.map((t, i) => (
                      <li key={i}>
                        <span>{t.text}</span>
                        {kind === "unknown" && (
                          <button
                            type="button"
                            className="plain"
                            onClick={() => ask(`Tell me about this: ${t.text}`)}
                          >
                            Ask
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {profile.traits.length === 0 && <p className="muted">The profile has no traits.</p>}
          </aside>
        </div>
      )}
    </article>
  );
}
