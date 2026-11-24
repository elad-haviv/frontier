import { OfflineCopy, useReadAgain } from "../components/OfflineCopy.tsx";
import { markOpened, servedFromDevice } from "../offline/copy.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { type ChronicleFile, mergeChronicles } from "@frontier/schema";
import { api, ApiFailure, chronicleUrl } from "../api.ts";
import { CompareView } from "../components/chronicle/CompareView.tsx";
import { Flags, redCount } from "../components/chronicle/Flags.tsx";
import { LaneList, UnitList } from "../components/chronicle/Lists.tsx";
import { OrderView } from "../components/chronicle/OrderView.tsx";
import { ScaleView } from "../components/chronicle/ScaleView.tsx";
import { ShiftForm } from "../components/chronicle/ShiftForm.tsx";
import { SpanForm } from "../components/chronicle/SpanForm.tsx";
import {
  type Change,
  newSpan,
  placeFromStatements,
  spanName,
  withSpan,
  withTies,
  work,
} from "../components/chronicle/model.ts";
import { placeable } from "@frontier/time";
import { useDialogs } from "../components/Dialogs.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { SaveStatus, useSaveState } from "../components/ui/SaveStatus.tsx";
import { useItemFile } from "../hooks/useItemFile.ts";
import { useShortcut } from "../keys.ts";
import { type QueueKey, queue } from "../sync/queue.ts";

type Tab = "order" | "scale" | "compare" | "flags" | "setup";

const NARROW = "(max-width: 34rem)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const on = () => setNarrow(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return narrow;
}

const OFFER_KEY = (id: string) => `frontier.chronicle.placeOffer.${id}`;

/** Whether the offer to place events from statements was answered on this device. */
function seenOffer(id: string): boolean {
  try {
    return localStorage.getItem(OFFER_KEY(id)) !== null;
  } catch {
    return false;
  }
}

/** Remembers that the offer was answered, so it is made once. */
function markOffer(id: string): true {
  try {
    localStorage.setItem(OFFER_KEY(id), "1");
  } catch {
    // Without storage the offer is made again next time, which does no harm.
  }
  return true;
}

/** One chronicle: its views, its lists, and the form for the selected span. */
export function ChroniclePage() {
  const { id = "" } = useParams();
  // A different chronicle gets a fresh page, with its own saving loop and undo history.
  return <Chronicle key={id} id={id} />;
}

function Chronicle({ id }: { id: string }) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const dialogs = useDialogs();
  const narrow = useNarrow();
  const [tab, setTab] = useState<Tab>("order");
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get("span"));
  const [lane, setLane] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Entries by id, for the spans linked to one; and links asked for that a save carries.
  const [entries, setEntries] = useState<Record<string, { path: string; title: string }>>({});
  const [linking, setLinking] = useState<Record<string, { path: string; title: string }>>({});
  const links = useRef(new Map<string, string>());
  const titles = useRef(new Map<string, { path: string; title: string }>());
  /** Spans unlinked since the last save: the server's answer must not link them again. */
  const dropped = useRef(new Set<string>());
  const key: QueueKey = `chronicle:${id}`;
  const saving = useSaveState(key);
  // Copying, the main mark and deleting go straight to the server.
  const offline = useNeedsConnection();
  /** When the chronicle was opened from this device's copy, the time that copy was stored. */
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  useEffect(() => markOpened(key), [key]);

  const file = useItemFile<ChronicleFile>({
    key,
    load: async () => {
      const loaded = await api.chronicle(id);
      setOfflineAt(servedFromDevice(loaded));
      setEntries(loaded.entries);
      return { value: loaded.chronicle, revision: loaded.revision, blob: loaded.blob };
    },
    onSaved: ({ sent, value, link, unlinked }) => {
      if (link.length > 0) {
        for (const l of link) if (links.current.get(l.id) === l.path) links.current.delete(l.id);
        // The entry's name is known from the picker, so the link shows at once.
        const known: Record<string, { path: string; title: string }> = {};
        for (const l of link) {
          const entry = value.spans.find((s) => s.id === l.id)?.entry;
          const title = titles.current.get(l.id);
          if (entry && title) known[entry] = title;
        }
        setEntries((now) => ({ ...now, ...known }));
        setLinking((now) =>
          Object.fromEntries(Object.entries(now).filter(([span]) => links.current.has(span))),
        );
        if (unlinked.length > 0) setNotice(unlinked.map((u) => u.reason).join(" "));
        void api.chronicle(id).then(
          (r) => setEntries(r.entries),
          () => undefined,
        );
      }
      // An unlink that this save carried is now on the server; one made since still waits.
      for (const span of [...dropped.current]) {
        if (sent.spans.find((s) => s.id === span)?.entry === null) dropped.current.delete(span);
      }
      refresh();
    },
    merge: (base, mine, theirs) => {
      const merged = mergeChronicles(base, mine, theirs).chronicle;
      // A span's entry is settled on its own, so typing in a span while its link is being saved
      // keeps both: the words typed here, and the entry the server wrote. An unlink made here
      // since wins over the server's link.
      return {
        ...merged,
        spans: merged.spans.map((s) => {
          if (dropped.current.has(s.id)) return { ...s, entry: null };
          const b = base.spans.find((x) => x.id === s.id);
          const m = mine.spans.find((x) => x.id === s.id);
          const t = theirs.spans.find((x) => x.id === s.id);
          if (!b || !m || !t) return s;
          const entry = m.entry === b.entry ? t.entry : m.entry;
          return entry === s.entry ? s : { ...s, entry };
        }),
      };
    },
    // The server writes an entry's id into a span that was linked by path.
    changed: (sent, saved) =>
      sent.spans.some((s) => saved.spans.find((x) => x.id === s.id)?.entry !== s.entry),
  });
  const chronicle = file.value;
  const worked = useMemo(() => (chronicle ? work(chronicle) : null), [chronicle]);
  // Every change runs through the ties, so what is tied follows what it is tied to.
  const fileChange = file.change;
  const change = useCallback<Change>(
    (fn, tag) => fileChange((c) => withTies(fn(c)), tag),
    [fileChange],
  );
  // A merge with another device's copy, or a copy that predates a move, can leave a tied number
  // behind: it is worked out again and saved.
  useEffect(() => {
    if (chronicle && withTies(chronicle) !== chronicle) fileChange(withTies, "ties");
  }, [chronicle, fileChange]);
  const offers = useMemo(() => (chronicle ? placeable(chronicle) : []), [chronicle]);
  const [offerSeen, setOfferSeen] = useState(() => seenOffer(id));
  // Opened from the device's copy: the server's copy is taken in once it answers, unless a change
  // waits here, which the queue's merge brings together with it.
  useReadAgain(offlineAt, `/api/chronicles/${id}`, () => {
    void queue.get(key).then((r) => (r ? undefined : file.reload()));
  });

  // Ctrl+Z and Ctrl+Shift+Z, except while typing in a field, which has its own undo.
  useShortcut("chronicle.undo", file.undo);
  useShortcut("chronicle.redo", file.redo);

  if (file.state === "loading") return <p className="center muted">Opening the chronicle…</p>;
  if (file.state === "failed" || !chronicle || !worked) {
    return (
      <div className="center">
        <p className="error">{file.error ?? "The chronicle could not be opened."}</p>
        <p>
          <Link to="/chronicles">All chronicles</Link>
        </p>
      </div>
    );
  }

  const span = chronicle.spans.find((s) => s.id === selected) ?? null;
  const openLane =
    chronicle.lanes.find((l) => l.id === lane)?.id ??
    span?.lane ??
    chronicle.lanes.find((l) => chronicle.spans.some((s) => s.lane === l.id))?.id ??
    chronicle.lanes[0]!.id;
  const red = redCount(worked);

  const select = (next: string | null) => {
    setSelected(next);
    const to = chronicle.spans.find((s) => s.id === next);
    if (to) setLane(to.lane);
  };

  async function add(point: boolean) {
    const name = await dialogs.prompt({
      title: point ? "New event" : "New span",
      body: point
        ? "A single moment, such as a landing or a death."
        : "Something with a beginning and an end, such as a war or a people's presence.",
      label: "Name",
      action: "Add",
    });
    if (!name?.trim()) return;
    const made = newSpan(openLane, point, name.trim());
    file.change((c) => ({ ...c, spans: [...c.spans, made] }));
    setSelected(made.id);
    setTab((t) => (t === "setup" ? "order" : t));
  }

  async function rename() {
    const title = await dialogs.prompt({
      title: "Rename the chronicle",
      label: "Title",
      initial: chronicle!.title,
      action: "Rename",
    });
    if (title?.trim()) file.change((c) => ({ ...c, title: title.trim() }));
  }

  async function remove() {
    const ok = await dialogs.confirm({
      title: `Delete ${chronicle!.title}?`,
      body: "It is marked for deletion and goes when you save a version. Until then it can be brought back from the unsaved changes.",
      action: "Delete the chronicle",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteChronicle(id);
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "The chronicle could not be deleted.");
      return;
    }
    refresh();
    navigate("/chronicles");
  }

  async function copy() {
    try {
      const made = await api.copyChronicle(id);
      refresh();
      navigate(chronicleUrl(made.id));
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "The chronicle could not be copied.");
    }
  }

  async function makeMain() {
    try {
      await api.makeMainChronicle(id);
      // The server wrote the mark itself, so the page takes in what the server now holds.
      await file.reload();
      refresh();
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "It could not be made the main one.");
    }
  }

  const tabs: [Tab, string][] = [
    ["order", "Order"],
    ["scale", "Scale"],
    ["compare", "Compare"],
    ["flags", red > 0 ? `Does not fit (${red})` : "Does not fit"],
    ["setup", narrow ? "Set up" : "Lanes and units"],
  ];

  return (
    <div className={"ch-page" + (span ? " has-form" : "") + (span && folded ? " is-folded" : "")}>
      <header className="ch-bar">
        <Link to="/chronicles" className="map-back" aria-label="All chronicles">
          ←
        </Link>
        <h1>{chronicle.title}</h1>
        {chronicle.main && <span className="chip">main</span>}
        <SaveStatus state={saving.state} variant="chronicle" />
      </header>
      <OfflineCopy at={offlineAt} className="chronicle-offline" />
      {notice && (
        <p className="banner" role="alert">
          {notice}{" "}
          <button type="button" className="plain" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}
      {offers.length > 0 && !offerSeen && (
        <p className="banner ch-offer-banner" role="status">
          {offers.length === 1
            ? "1 event can be placed from what you said."
            : `${offers.length} events can be placed from what you said.`}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              change(placeFromStatements);
              setOfferSeen(markOffer(id));
            }}
          >
            Place them
          </button>{" "}
          <button type="button" className="plain" onClick={() => setOfferSeen(markOffer(id))}>
            Not now
          </button>
        </p>
      )}
      {saving.state === "failed" && file.error && (
        <p className="banner" role="alert">
          {file.error}
        </p>
      )}

      <div className="ch-tools" role="toolbar" aria-label="Chronicle tools">
        <button type="button" className="primary" onClick={() => void add(false)}>
          + Span
        </button>
        <button type="button" className="primary" onClick={() => void add(true)}>
          + Event
        </button>
        <button
          type="button"
          className="quiet ch-icon"
          aria-label="Undo"
          disabled={!file.canUndo}
          onClick={file.undo}
        >
          <span aria-hidden="true">↶</span>
          <span className="ch-wide">Undo</span>
        </button>
        <button
          type="button"
          className="quiet ch-icon"
          aria-label="Redo"
          disabled={!file.canRedo}
          onClick={file.redo}
        >
          <span aria-hidden="true">↷</span>
          <span className="ch-wide">Redo</span>
        </button>
        <details className="ch-more">
          <summary>More</summary>
          <div>
            <button type="button" className="quiet" onClick={() => void rename()}>
              Rename
            </button>
            <button
              type="button"
              className="quiet"
              disabled={offline !== undefined}
              title={offline}
              onClick={() => void copy()}
            >
              Copy, to try another version
            </button>
            {!chronicle.main && (
              <button
                type="button"
                className="quiet"
                disabled={offline !== undefined}
                title={offline}
                onClick={() => void makeMain()}
              >
                Make this the main chronicle
              </button>
            )}
            <button
              type="button"
              className="plain danger"
              disabled={offline !== undefined}
              title={offline}
              onClick={() => void remove()}
            >
              Delete the chronicle
            </button>
            {offline && <p className="muted">Copying and deleting: {offline.toLowerCase()}.</p>}
          </div>
        </details>
      </div>

      <div className="ch-tabs" role="tablist" aria-label="Views">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={(tab === key ? "is-on" : "") + (key === "flags" && red > 0 ? " is-red" : "")}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ch-body">
        <div className="ch-view">
          {tab === "order" && (
            <OrderView
              chronicle={chronicle}
              worked={worked}
              selected={selected}
              onSelect={select}
              narrow={narrow}
              openLane={openLane}
              onOpenLane={setLane}
            />
          )}
          {tab === "scale" && (
            <>
              <ScaleView
                chronicle={chronicle}
                worked={worked}
                selected={selected}
                onSelect={select}
                narrow={narrow}
                openLane={openLane}
                onOpenLane={setLane}
              />
              <ShiftForm chronicle={chronicle} change={change} />
            </>
          )}
          {tab === "compare" && (
            <CompareView chronicle={chronicle} worked={worked} change={change} onSelect={select} />
          )}
          {tab === "flags" && (
            <Flags chronicle={chronicle} worked={worked} change={change} onSelect={select} />
          )}
          {tab === "setup" && (
            <>
              <LaneList chronicle={chronicle} change={change} />
              <UnitList chronicle={chronicle} change={change} />
            </>
          )}
          <p className="ch-note muted">
            Working numbers, not lore. Nothing here is written into a note.
          </p>
        </div>

        {span && (
          <aside className="ch-sheet" aria-label={`${spanName(span)}: details`}>
            <header>
              <h2>{spanName(span)}</h2>
              {narrow && (
                <button
                  type="button"
                  className="quiet"
                  aria-expanded={!folded}
                  onClick={() => setFolded(!folded)}
                >
                  {folded ? "Edit" : "Fold"}
                </button>
              )}
              <button type="button" className="quiet" onClick={() => setSelected(null)}>
                Close
              </button>
            </header>
            <SpanForm
              key={span.id}
              chronicle={chronicle}
              worked={worked}
              span={span}
              change={change}
              onSelect={select}
              entry={
                linking[span.id]
                  ? { state: "pending", ...linking[span.id]! }
                  : span.entry === null
                    ? { state: "none" }
                    : entries[span.entry]
                      ? { state: "linked", ...entries[span.entry]! }
                      : { state: "gone" }
              }
              second={
                span.entry !== null &&
                chronicle.spans.find((s) => s.entry === span.entry)?.id !== span.id
              }
              onLink={(path, title) => {
                links.current.set(span.id, path);
                dropped.current.delete(span.id);
                titles.current.set(span.id, { path, title });
                setLinking((now) => ({ ...now, [span.id]: { path, title } }));
                // The link travels with the next save. Nothing in the file changes until the
                // server answers, so there is no step for undo to take back yet.
                const link = [{ id: span.id, path }];
                if (span.entry === null) file.touch(link);
                else
                  file.change(
                    (c) => withSpan(c, span.id, (s) => ({ ...s, entry: null })),
                    undefined,
                    link,
                  );
              }}
              onUnlink={() => {
                links.current.delete(span.id);
                dropped.current.add(span.id);
                setLinking((now) =>
                  Object.fromEntries(Object.entries(now).filter(([k]) => k !== span.id)),
                );
                // A link still waiting to be sent is taken back with it.
                file.change(
                  (c) => withSpan(c, span.id, (s) => ({ ...s, entry: null })),
                  undefined,
                  [{ id: span.id, path: null }],
                );
              }}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
