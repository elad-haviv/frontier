import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  api,
  ApiFailure,
  type CharacterLine,
  type CharacterProfile,
  entryUrl,
  type Trait,
} from "../api.ts";
import { useRefresh } from "../components/Shell.tsx";

const KINDS: [Trait["kind"], string][] = [
  ["voice", "How they speak"],
  ["knows", "What they know"],
  ["believes", "What they believe"],
  ["unknown", "Not known"],
];
const titleOf = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
const failed = (err: unknown, fallback: string) =>
  err instanceof ApiFailure ? err.message : fallback;

/** The profile being made: proposed by the AI, edited and approved by the author. */
function ProfileForm(p: {
  path: string;
  start: CharacterProfile | null;
  onApproved: (profile: CharacterProfile) => void;
}) {
  const refresh = useRefresh();
  const [traits, setTraits] = useState<(Trait & { supported?: boolean })[]>(p.start?.traits ?? []);
  const [words, setWords] = useState(p.start?.moment.words ?? "");
  const [year, setYear] = useState(p.start?.moment.year?.toString() ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setBusy("propose");
    setError(null);
    try {
      setTraits((await api.proposeProfile(p.path)).traits);
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

  const set = (i: number, change: Partial<Trait>) =>
    setTraits(traits.map((t, j) => (j === i ? { ...t, ...change } : t)));

  return (
    <form className="profile-form" onSubmit={approve}>
      <p className="muted">
        The character speaks from this profile. Each trait drawn from the entries shows where it
        came from; what the entries leave open is marked as not known. Edit anything before you
        approve it: the profile is saved in the library with your next version.
      </p>
      <p className="change-actions">
        <button
          type="button"
          className="quiet"
          disabled={busy !== null}
          onClick={() => void propose()}
        >
          {busy === "propose"
            ? "Reading the entries…"
            : traits.length
              ? "Draft again"
              : "Draft a profile from the entries"}
        </button>
      </p>
      <ul className="traits">
        {traits.map((t, i) => (
          <li key={i} className={`trait trait-${t.kind}`}>
            <select
              aria-label="Kind of trait"
              value={t.kind}
              onChange={(e) => set(i, { kind: e.target.value as Trait["kind"] })}
            >
              {KINDS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Trait"
              rows={2}
              value={t.text}
              onChange={(e) => set(i, { text: e.target.value })}
            />
            {t.sources.length > 0 && (
              <p className="muted sources">
                From{" "}
                {t.sources.map((s, j) => (
                  <span key={s}>
                    {j > 0 && ", "}
                    <Link to={entryUrl(s)}>{titleOf(s)}</Link>
                  </span>
                ))}
                {t.quotes[0] && <> · “{t.quotes[0].text}”</>}
              </p>
            )}
            <button
              type="button"
              className="plain danger"
              onClick={() => setTraits(traits.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="change-actions">
        <button
          type="button"
          className="quiet"
          onClick={() =>
            setTraits([...traits, { kind: "voice", text: "", sources: [], quotes: [] }])
          }
        >
          Add a trait
        </button>
      </p>
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
        <span>That moment's year in the main chronicle (optional)</span>
        <input
          type="text"
          inputMode="decimal"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <em className="muted">
          Entries whose span in the main chronicle begins after it are kept from the character.
        </em>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="change-actions">
        <button type="submit" className="primary" disabled={busy !== null}>
          Approve the profile
        </button>
      </p>
    </form>
  );
}

/** Talking with a character, in their voice, from their moment. */
export function TalkPage() {
  const { pathname } = useLocation();
  const path = decodeURIComponent(pathname.replace(/^\/talk\//, ""));
  const name = titleOf(path);
  const refresh = useRefresh();
  const [profile, setProfile] = useState<CharacterProfile | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState<
    (
      { who: "author"; text: string } | ({ who: "character" } & CharacterLine & { kept?: boolean })
    )[]
  >([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.characterProfile(path).then(
      (r) => setProfile(r.profile),
      () => setProfile(null),
    );
  }, [path]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    const history = said.map((l) => ({ who: l.who, text: l.text }));
    try {
      const { lines } = await api.say(path, message.trim(), history);
      setSaid([
        ...said,
        { who: "author", text: message.trim() },
        ...lines.map((l) => ({ who: "character" as const, ...l })),
      ]);
      setMessage("");
    } catch (err) {
      setError(failed(err, "The character did not answer."));
    } finally {
      setBusy(false);
    }
  }

  async function keep(i: number) {
    const line = said[i];
    if (!line || line.who !== "character") return;
    try {
      await api.keepLine(path, line.text);
      refresh();
      setSaid(said.map((l, j) => (j === i ? { ...l, kept: true } : l)));
    } catch (err) {
      setError(failed(err, "The line could not be added."));
    }
  }

  if (profile === undefined) return <p className="center muted">Opening…</p>;
  return (
    <article className="entry wide talk">
      <header className="entry-head">
        <p className="muted">
          <Link to={entryUrl(path)}>{name}</Link>
        </p>
        <h1>Talk with {name}</h1>
        {profile && !editing && (
          <p className="muted lede">
            Speaking from: {profile.moment.words || "a moment not named"}.{" "}
            <button type="button" className="plain" onClick={() => setEditing(true)}>
              Change the profile
            </button>
          </p>
        )}
      </header>

      {(!profile || editing) && (
        <ProfileForm
          path={path}
          start={profile}
          onApproved={(p) => {
            setProfile(p);
            setEditing(false);
          }}
        />
      )}

      {profile && !editing && (
        <>
          <ol className="talk-lines">
            {said.map((l, i) =>
              l.who === "author" ? (
                <li key={i} className="talk-author">
                  {l.text}
                </li>
              ) : (
                <li key={i} className={"talk-character" + (l.improvised ? " is-improvised" : "")}>
                  <p>{l.text}</p>
                  {l.improvised ? (
                    <p className="guess">Improvised: nothing in the entries says this.</p>
                  ) : (
                    <p className="muted sources">
                      From{" "}
                      {l.sources.map((s, j) => (
                        <span key={s}>
                          {j > 0 && ", "}
                          <Link to={entryUrl(s)}>{titleOf(s)}</Link>
                        </span>
                      ))}
                    </p>
                  )}
                  {l.kept ? (
                    <p className="muted">Added to {name}'s entry as an unsaved change.</p>
                  ) : (
                    <button type="button" className="plain" onClick={() => void keep(i)}>
                      Add to {name}'s entry
                    </button>
                  )}
                </li>
              ),
            )}
          </ol>
          <form className="ask-box" onSubmit={send}>
            <label className="field">
              <span>Say something to {name}</span>
              <textarea
                rows={2}
                value={message}
                disabled={busy}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <p className="change-actions">
              <button type="submit" className="primary" disabled={busy || !message.trim()}>
                {busy ? `${name} is thinking…` : "Say it"}
              </button>
            </p>
          </form>
          <p className="muted">
            This conversation is not kept: it ends when you leave the page. Lines you add to the
            entry stay among your unsaved changes.
          </p>
        </>
      )}
    </article>
  );
}
