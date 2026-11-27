import { projectKey } from "../projectStorage.ts";
import * as Popover from "@radix-ui/react-popover";
import { Flag, Map as MapIcon, Plus, Redo2, Undo2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Link, useNavigate } from "../nav.tsx";
import { type ChronicleFile, mergeChronicles } from "@frontier/schema";
import { allSpanPoints, formatYears, placeable } from "@frontier/time";
import { ApiFailure, chronicleUrl, mapUrl } from "../api.ts";
import { AddEvent } from "../components/chronicle/AddEvent.tsx";
import { CompareView } from "../components/chronicle/CompareView.tsx";
import { Details, type OnMap, ReadDetails } from "../components/chronicle/Details.tsx";
import { useCanWrite } from "../components/projectContext.ts";
import { typeWhen } from "../components/chronicle/edit.ts";
import { Flags, redCount } from "../components/chronicle/Flags.tsx";
import { UnitList } from "../components/chronicle/Lists.tsx";
import { ListView } from "../components/chronicle/ListView.tsx";
import {
  type Change,
  LANE_COLORS,
  countFrom,
  newId,
  placeFromStatements,
  shiftSpan,
  spanName,
  withSpan,
  withTies,
  work,
} from "../components/chronicle/model.ts";
import { type Ghost, Timeline, type TimelineHandle } from "../components/chronicle/Timeline.tsx";
import { ZOOMS } from "../components/chronicle/timelineLayout.ts";
import { alignable, compareVersions } from "../components/chronicle/versions.ts";
import { useDialogs } from "../components/Dialogs.tsx";
import { OfflineCopy, useReadAgain } from "../components/OfflineCopy.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { IconButton } from "../components/ui/IconButton.tsx";
import { Menu, MenuItem, MenuLink, MenuSeparator } from "../components/ui/Menu.tsx";
import { SaveStatus, useSaveState } from "../components/ui/SaveStatus.tsx";
import { useItemFile } from "../hooks/useItemFile.ts";
import { useShortcut } from "../keys.ts";
import { markOpened, servedFromDevice } from "../offline/copy.ts";
import { useNeedsConnection } from "../sync/connection.ts";
import { type QueueKey } from "../sync/queue.ts";
import "./ChroniclePage.css";
import { useProjectWork } from "../projectWork.ts";

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

/** What this device remembers per chronicle: never part of the file. */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Without storage it is simply not remembered.
    }
  },
};
const OFFER_KEY = (id: string) => projectKey(`frontier.chronicle.placeOffer.${id}`);
const YEAR_KEY = (id: string) => projectKey(`frontier.chronicle.mapYear.${id}`);
const FOLD_KEY = (id: string) => projectKey(`frontier.chronicle.folded.${id}`);

/** One chronicle, shown as a timeline (stage 17). */
export function ChroniclePage() {
  const { id = "" } = useParams();
  // A different chronicle gets a fresh page, with its own saving loop and undo history.
  return <Chronicle key={id} id={id} />;
}

/** A box over the page for a dialog that has forms of its own (units, comparing lengths). */
function Sheet(p: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);
  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="dialog ch-dialog" role="dialog" aria-modal="true" aria-label={p.title}>
        <header className="ch-dialog-head">
          <h2>{p.title}</h2>
          <button type="button" className="quiet" onClick={p.onClose}>
            Done
          </button>
        </header>
        {p.children}
      </div>
    </div>
  );
}

function Chronicle({ id }: { id: string }) {
  const proj = useProjectWork();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const dialogs = useDialogs();
  const narrow = useNarrow();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() => {
    const s = params.get("span");
    return s ? [s] : [];
  });
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"compare" | "units" | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0);
  const [focus, setFocus] = useState<{ what: "name" | "dates"; at: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const timeline = useRef<TimelineHandle>(null);

  const initialYear = useMemo(() => {
    const t = params.get("t");
    return t !== null && Number.isFinite(Number(t)) ? Number(t) : null;
  }, []);
  const [mapYear, setMapYearState] = useState<number | null>(() => {
    if (initialYear !== null) return initialYear;
    const kept = store.get(YEAR_KEY(id));
    return kept !== null && Number.isFinite(Number(kept)) ? Number(kept) : 0;
  });
  const setMapYear = (year: number) => {
    const y = Math.round(year);
    setMapYearState(y);
    store.set(YEAR_KEY(id), String(y));
    const next = new URLSearchParams(params);
    next.set("t", String(y));
    setParams(next, { replace: true });
  };
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(store.get(FOLD_KEY(id)) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const fold = (lane: string) =>
    setFolded((now) => {
      const next = new Set(now);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      store.set(FOLD_KEY(id), JSON.stringify([...next]));
      return next;
    });

  // Entries by id, for the spans linked to one; and links asked for that a save carries.
  const [entries, setEntries] = useState<Record<string, { path: string; title: string }>>({});
  const [onMaps, setOnMaps] = useState<Record<string, OnMap[]>>({});
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
      const loaded = await proj.api.chronicle(id);
      setOfflineAt(servedFromDevice(loaded));
      setEntries(loaded.entries);
      setOnMaps(loaded.onMaps ?? {});
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
        void proj.api.chronicle(id).then(
          (r) => {
            setEntries(r.entries);
            setOnMaps(r.onMaps ?? {});
          },
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
      return withTies({
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
      });
    },
    // The server writes an entry's id into a span that was linked by path.
    changed: (sent, saved) =>
      sent.spans.some((s) => saved.spans.find((x) => x.id === s.id)?.entry !== s.entry),
  });
  const chronicle = file.value;
  const worked = useMemo(() => (chronicle ? work(chronicle) : null), [chronicle]);
  // Every change runs through the ties, so what is tied follows what it is tied to.
  const fileChange = file.change;
  // A chronicle is read by everyone and changed by writers (stage 27c): for a reader nothing
  // changes it, and nothing is queued for the server, which would refuse it.
  const canWrite = useCanWrite();
  const change = useCallback<Change>(
    (fn, tag) => {
      if (canWrite) fileChange((c) => withTies(fn(c)), tag);
    },
    [fileChange, canWrite],
  );
  // A merge with another device's copy, or a copy that predates a move, can leave a tied number
  // behind: it is worked out again and saved.
  useEffect(() => {
    if (canWrite && chronicle && withTies(chronicle) !== chronicle) fileChange(withTies, "ties");
  }, [chronicle, fileChange, canWrite]);
  const offers = useMemo(() => (chronicle ? placeable(chronicle) : []), [chronicle]);
  const [offerSeen, setOfferSeen] = useState(() => store.get(OFFER_KEY(id)) !== null);
  const answerOffer = () => {
    store.set(OFFER_KEY(id), "1");
    setOfferSeen(true);
  };
  // Opened from the device's copy: the server's copy is taken in once it answers, unless a change
  // waits here, which the queue's merge brings together with it.
  useReadAgain(offlineAt, `/api/chronicles/${id}`, () => {
    void proj.queue.get(key).then((r) => (r ? undefined : file.reload()));
  });

  // The maps, for "Open map at…": read once; offline the button is simply not offered.
  const [maps, setMaps] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let live = true;
    proj.api.maps().then(
      (r) => live && setMaps(r.maps.map((m) => ({ id: m.id, title: m.title }))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  // Another version drawn underneath: today's "Compare with…", in the same rows.
  const [under, setUnder] = useState<ChronicleFile | null>(null);
  const [others, setOthers] = useState<{ id: string; title: string }[] | null>(null);
  const ghost = useMemo<Ghost | null>(() => {
    if (!under || !chronicle) return null;
    const anchors = alignable(chronicle, under, compareVersions(chronicle, under, 0));
    const anchor = anchors.find((a) => a.mine.id === chronicle.origin) ??
      anchors[0] ?? { offset: 0 };
    const moved = { ...under, spans: under.spans.map((x) => shiftSpan(x, anchor.offset)) };
    const versus = compareVersions(chronicle, under, anchor.offset);
    const matchOf = new Map<string, string>();
    for (const [theirs, mine] of versus.match) matchOf.set(mine, theirs);
    return {
      points: allSpanPoints(moved.spans),
      matchOf,
      spans: new Map(moved.spans.map((s) => [s.id, s])),
      differs: new Set([...versus.mine].filter(([, v]) => v === "differs").map(([k]) => k)),
    };
  }, [under, chronicle]);

  useShortcut("chronicle.undo", () => (canWrite ? file.undo() : false));
  useShortcut("chronicle.redo", () => (canWrite ? file.redo() : false));
  useShortcut("chronicle.add", () => {
    if (!chronicle || !canWrite) return false;
    setAdding(laneFor());
    return true;
  });

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

  const primary = selected.at(-1) ?? null;
  const span = chronicle.spans.find((s) => s.id === primary) ?? null;
  const red = redCount(worked);
  function laneFor(): string {
    const s = chronicle?.spans.find((x) => x.id === selected.at(-1));
    return s?.lane ?? chronicle!.lanes[0]!.id;
  }

  const select = (ids: string[]) => {
    setSelected(ids);
    const last = ids.at(-1);
    if (last) {
      requestAnimationFrame(() => timeline.current?.reveal(last));
    } else setSheetOpen(false);
  };
  const selectOne = (id: string | null) => select(id ? [id] : []);

  async function rename() {
    const title = await dialogs.prompt({
      title: "Rename the chronicle",
      label: "Title",
      initial: chronicle!.title,
      action: "Rename",
    });
    if (title?.trim()) change((c) => ({ ...c, title: title.trim() }));
  }

  async function addGroup() {
    const name = await dialogs.prompt({ title: "New group", label: "Name", action: "Add" });
    if (!name?.trim()) return;
    change((c) => ({
      ...c,
      lanes: [
        ...c.lanes,
        {
          id: newId(),
          name: name.trim(),
          color: LANE_COLORS[c.lanes.length % LANE_COLORS.length]!,
          clock: c.clock,
        },
      ],
    }));
  }

  async function removeGroup(laneId: string) {
    const at = chronicle!.lanes.findIndex((l) => l.id === laneId);
    const lane = chronicle!.lanes[at];
    const into = chronicle!.lanes[at - 1] ?? chronicle!.lanes[at + 1];
    if (!lane || !into) return;
    const count = chronicle!.spans.filter((s) => s.lane === laneId).length;
    if (count > 0) {
      const ok = await dialogs.confirm({
        title: `Delete the group ${lane.name}?`,
        body: `Its ${count} ${count === 1 ? "event moves" : "events move"} to ${into.name}.`,
        action: "Delete the group",
        danger: true,
      });
      if (!ok) return;
    }
    change((c) => ({
      ...c,
      lanes: c.lanes.filter((l) => l.id !== laneId),
      spans: c.spans.map((s) => (s.lane === laneId ? { ...s, lane: into.id } : s)),
    }));
  }

  const moveGroup = (laneId: string, by: number) =>
    change((c) => {
      const from = c.lanes.findIndex((l) => l.id === laneId);
      const to = from + by;
      if (from < 0 || to < 0 || to >= c.lanes.length) return c;
      const lanes = [...c.lanes];
      [lanes[from], lanes[to]] = [lanes[to]!, lanes[from]!];
      return { ...c, lanes };
    });

  async function recolour(laneId: string) {
    const lane = chronicle!.lanes.find((l) => l.id === laneId);
    const at = LANE_COLORS.indexOf(lane?.color ?? "");
    const color = LANE_COLORS[(at + 1) % LANE_COLORS.length]!;
    change((c) => ({
      ...c,
      lanes: c.lanes.map((l) => (l.id === laneId ? { ...l, color } : l)),
    }));
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
      await proj.api.deleteChronicle(id);
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "The chronicle could not be deleted.");
      return;
    }
    refresh();
    navigate("/chronicles");
  }

  async function copy() {
    try {
      const made = await proj.api.copyChronicle(id);
      refresh();
      navigate(chronicleUrl(made.id));
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "The chronicle could not be copied.");
    }
  }

  async function makeMain() {
    try {
      await proj.api.makeMainChronicle(id);
      // The server wrote the mark itself, so the page takes in what the server now holds.
      await file.reload();
      refresh();
    } catch (err) {
      setNotice(err instanceof ApiFailure ? err.message : "It could not be made the main one.");
    }
  }

  async function showUnder() {
    try {
      const list = (await proj.api.chronicles()).chronicles.filter((c) => c.id !== id);
      setOthers(list.map((c) => ({ id: c.id, title: c.title })));
    } catch {
      setNotice("The other chronicles could not be read.");
    }
  }

  const linkSpan = (spanId: string, path: string, title: string, hadEntry: boolean) => {
    links.current.set(spanId, path);
    dropped.current.delete(spanId);
    titles.current.set(spanId, { path, title });
    setLinking((now) => ({ ...now, [spanId]: { path, title } }));
    // The link travels with the next save. Nothing in the file changes until the server answers,
    // so there is no step for undo to take back yet.
    const link = [{ id: spanId, path }];
    if (!hadEntry) file.touch(link);
    else file.change((c) => withSpan(c, spanId, (s) => ({ ...s, entry: null })), undefined, link);
  };

  const origin = chronicle.spans.find((s) => s.id === chronicle.origin);
  const originAtZero =
    origin?.start && origin.start !== "open" && origin.start.low === 0 && origin.start.high === 0
      ? origin
      : null;
  const placedSpans = chronicle.spans.filter((s) => s.start && s.start !== "open");
  const onMapIds = new Set(Object.keys(onMaps));
  const yearText = mapYear !== null ? formatYears(mapYear, mapYear) : "";
  const mapLink = (mapId: string) =>
    `${mapUrl(mapId)}?${new URLSearchParams({ c: id, ...(mapYear !== null ? { t: String(mapYear) } : {}) }).toString()}`;
  const offlineReason = offline ? `${offline}.` : undefined;

  const groupMenu = (laneId: string) => {
    const at = chronicle.lanes.findIndex((l) => l.id === laneId);
    const lane = chronicle.lanes[at]!;
    return (
      <Menu label={`${lane.name}: more`} className="tl-group-menu">
        <MenuItem onSelect={() => setAdding(laneId)}>Add an event to {lane.name}</MenuItem>
        <MenuItem onSelect={() => void recolour(laneId)}>Next colour</MenuItem>
        <MenuItem disabled={at === 0} onSelect={() => moveGroup(laneId, -1)}>
          Move up
        </MenuItem>
        <MenuItem
          disabled={at === chronicle.lanes.length - 1}
          onSelect={() => moveGroup(laneId, 1)}
        >
          Move down
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          danger
          disabled={chronicle.lanes.length === 1}
          disabledReason="The last group stays"
          onSelect={() => void removeGroup(laneId)}
        >
          Delete the group
        </MenuItem>
      </Menu>
    );
  };

  const details = span && !canWrite && (
    <ReadDetails
      key={span.id}
      chronicle={chronicle}
      worked={worked}
      span={span}
      onSelect={selectOne}
      onMaps={onMaps[span.id] ?? []}
      entry={
        span.entry === null
          ? { state: "none" }
          : entries[span.entry]
            ? { state: "linked", ...entries[span.entry]! }
            : { state: "gone" }
      }
      second={false}
    />
  );
  const writerDetails = span && canWrite && (
    <Details
      key={span.id}
      chronicle={chronicle}
      worked={worked}
      span={span}
      change={change}
      onSelect={selectOne}
      focus={focus}
      onMaps={onMaps[span.id] ?? []}
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
        span.entry !== null && chronicle.spans.find((s) => s.entry === span.entry)?.id !== span.id
      }
      onLink={(path, title) => linkSpan(span.id, path, title, span.entry !== null)}
      onUnlink={() => {
        links.current.delete(span.id);
        dropped.current.add(span.id);
        setLinking((now) => Object.fromEntries(Object.entries(now).filter(([k]) => k !== span.id)));
        // A link still waiting to be sent is taken back with it.
        file.change((c) => withSpan(c, span.id, (s) => ({ ...s, entry: null })), undefined, [
          { id: span.id, path: null },
        ]);
      }}
    />
  );

  const fits = (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="ch-pill is-red" aria-label={`${red} doesn't fit`}>
          ⚠ {red} doesn’t fit
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="ch-fits" align="end" sideOffset={6} collisionPadding={8}>
          <Flags
            chronicle={chronicle}
            worked={worked}
            change={change}
            onSelect={(sid) => {
              selectOne(sid);
              setSheetOpen(false);
            }}
            onSelectBoth={(ids) => {
              select(ids);
              setSheetOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );

  return (
    <div className={`ch-page tl-page${narrow ? " is-narrow" : ""}`}>
      <header className="ch-bar">
        <Link to="/chronicles" className="map-back" aria-label="All chronicles">
          ←
        </Link>
        <h1>{chronicle.title}</h1>
        {!narrow &&
          (chronicle.main ? (
            <span className="ch-pill is-main" title="Maps that change with time read this one">
              ★ Main · maps use this
            </span>
          ) : !canWrite ? null : (
            <button
              type="button"
              className="ch-pill"
              disabled={offline !== undefined}
              title={offline ?? "Maps that change with time will read this one"}
              onClick={() => void makeMain()}
            >
              Make main
            </button>
          ))}
        {canWrite && <SaveStatus state={saving.state} variant="chronicle" />}
        {canWrite && red > 0 && fits}
        {!narrow && maps.length === 1 && mapYear !== null && (
          <Link className="ch-pill is-map" to={mapLink(maps[0]!.id)}>
            🗺 Open map at {yearText}
          </Link>
        )}
        {!narrow && maps.length > 1 && mapYear !== null && (
          <Menu label="Open a map at the map year" icon={MapIcon} text={`Open map at ${yearText}`}>
            {maps.map((m) => (
              <MenuLink key={m.id} to={mapLink(m.id)}>
                {m.title}
              </MenuLink>
            ))}
          </Menu>
        )}
        <Menu label="More actions" className="ch-more-menu">
          {narrow && (
            <>
              {canWrite && (
                <>
                  <MenuItem disabled={!file.canUndo} onSelect={file.undo}>
                    Undo
                  </MenuItem>
                  <MenuItem disabled={!file.canRedo} onSelect={file.redo}>
                    Redo
                  </MenuItem>
                </>
              )}
              <MenuItem onSelect={() => timeline.current?.fit()}>Fit everything</MenuItem>
              <MenuSeparator />
            </>
          )}
          {canWrite && (
            <>
              <MenuItem onSelect={() => void rename()}>Rename</MenuItem>
              <MenuItem onSelect={() => void addGroup()}>Add a group</MenuItem>
              <MenuItem onSelect={() => setDialog("units")}>Units…</MenuItem>
              <MenuItem onSelect={() => setDialog("compare")}>
                Compare lengths with real history…
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {narrow && chronicle.main && (
            <MenuItem disabled onSelect={() => undefined}>
              ★ Main · maps use this
            </MenuItem>
          )}
          {narrow && canWrite && !chronicle.main && (
            <MenuItem
              disabled={offline !== undefined}
              disabledReason={offlineReason}
              onSelect={() => void makeMain()}
            >
              Make main
            </MenuItem>
          )}
          {narrow &&
            mapYear !== null &&
            maps.map((m) => (
              <MenuLink key={m.id} to={mapLink(m.id)}>
                🗺 Open {m.title} at {yearText}
              </MenuLink>
            ))}
          {canWrite && (
            <MenuItem
              disabled={offline !== undefined}
              disabledReason={offlineReason}
              onSelect={() => void copy()}
            >
              Copy, to try another version
            </MenuItem>
          )}
          {under ? (
            <MenuItem onSelect={() => setUnder(null)}>
              Stop showing {under.title} underneath
            </MenuItem>
          ) : (
            <MenuItem
              disabled={offline !== undefined}
              disabledReason={offlineReason}
              onSelect={() => void showUnder()}
            >
              Show another version underneath…
            </MenuItem>
          )}
          {canWrite && (
            <>
              <MenuSeparator />
              <MenuItem
                danger
                disabled={offline !== undefined}
                disabledReason={offlineReason}
                onSelect={() => void remove()}
              >
                Delete the chronicle
              </MenuItem>
            </>
          )}
        </Menu>
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
      {canWrite && offers.length > 0 && !offerSeen && (
        <p className="banner ch-offer-banner" role="status">
          {offers.length === 1
            ? "1 event can be placed from what you said."
            : `${offers.length} events can be placed from what you said.`}{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              change(placeFromStatements);
              answerOffer();
            }}
          >
            Place them
          </button>{" "}
          <button type="button" className="plain" onClick={answerOffer}>
            Not now
          </button>
        </p>
      )}
      {saving.state === "failed" && file.error && (
        <p className="banner" role="alert">
          {file.error}
        </p>
      )}
      {others && (
        <div className="banner ch-under-pick" role="group" aria-label="Show another version">
          <label>
            <span>Show underneath: </span>
            <select
              value=""
              onChange={(e) => {
                const pick = e.target.value;
                setOthers(null);
                if (!pick) return;
                proj.api.chronicle(pick).then(
                  (r) => setUnder(r.chronicle),
                  () => setNotice("That chronicle could not be read."),
                );
              }}
            >
              <option value="">Choose a chronicle…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </label>{" "}
          <button type="button" className="plain" onClick={() => setOthers(null)}>
            Cancel
          </button>
          {others.length === 0 && <span className="muted"> There is no other chronicle.</span>}
        </div>
      )}
      {under && (
        <p className="banner ch-under-note" role="status">
          Grey underneath: {under.title}. Outlined: differs.{" "}
          <button type="button" className="plain" onClick={() => setUnder(null)}>
            Hide
          </button>
        </p>
      )}

      <div className="ch-tools" role="toolbar" aria-label="Timeline tools">
        {!narrow && canWrite && (
          <button
            type="button"
            className="primary"
            title="Add an event (N)"
            onClick={() => setAdding(laneFor())}
          >
            + Add
          </button>
        )}
        <div className="ch-seg" role="group" aria-label="Zoom">
          {ZOOMS.map((z, i) => (
            <button
              key={z.id}
              type="button"
              aria-pressed={view === "timeline" && zoomLevel === i}
              disabled={view !== "timeline"}
              title={`${z.label} (${i + 1})`}
              onClick={() => timeline.current?.zoomTo(i)}
            >
              {narrow ? z.short : z.label}
            </button>
          ))}
        </div>
        {!narrow && (
          <button
            type="button"
            className="quiet"
            disabled={view !== "timeline"}
            title="Fit everything (F)"
            onClick={() => timeline.current?.fit()}
          >
            Fit
          </button>
        )}
        {!narrow && canWrite && (
          <>
            <IconButton
              label="Undo"
              icon={Undo2}
              shortcut="chronicle.undo"
              disabled={!file.canUndo}
              onClick={file.undo}
            />
            <IconButton
              label="Redo"
              icon={Redo2}
              shortcut="chronicle.redo"
              disabled={!file.canRedo}
              onClick={file.redo}
            />
            {placedSpans.length > 0 && (
              <Menu
                label="Change what year 0 is"
                icon={Flag}
                text={originAtZero ? `Year 0 = ${spanName(originAtZero)}` : "Year 0"}
                className="ch-origin"
                align="start"
              >
                {placedSpans.map((s) => (
                  <MenuItem
                    key={s.id}
                    checked={s.id === originAtZero?.id}
                    onSelect={() => change((c) => countFrom(c, s.id))}
                  >
                    Count from the start of {spanName(s)}
                  </MenuItem>
                ))}
              </Menu>
            )}
          </>
        )}
        <div className="ch-seg ch-views" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            Timeline
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            List
          </button>
        </div>
      </div>

      <div className={`ch-body${span ? " has-details" : ""}`}>
        <div className="ch-main">
          {view === "timeline" ? (
            <Timeline
              ref={timeline}
              chronicle={chronicle}
              worked={worked}
              change={change}
              selected={selected}
              onSelect={select}
              narrow={narrow}
              folded={folded}
              onFold={fold}
              mapYear={mapYear}
              onMapYear={setMapYear}
              initialYear={initialYear}
              onZoomChange={setZoomLevel}
              onMaps={onMapIds}
              linked={(s) => s.entry !== null || linking[s.id] !== undefined}
              onAddTo={(laneId) => setAdding(laneId)}
              onCreated={() => setFocus({ what: "name", at: Date.now() })}
              onEdit={(what) => setFocus({ what, at: Date.now() })}
              onTypeWhen={(sid, text) => {
                const [a, b] = text.split(/\s*→\s*/);
                let next = chronicle;
                for (const [part, t] of [
                  ["start", a ?? ""],
                  ["end", b],
                ] as const) {
                  if (t === undefined) continue;
                  const out = typeWhen(next, sid, part, t);
                  if (!out.ok) return out.message;
                  next = out.chronicle;
                }
                change(() => next);
                return null;
              }}
              onGroupMenu={groupMenu}
              onRenameGroup={(laneId, name) =>
                change((c) => ({
                  ...c,
                  lanes: c.lanes.map((l) => (l.id === laneId ? { ...l, name } : l)),
                }))
              }
              ghost={ghost}
              readOnly={!canWrite}
            />
          ) : (
            <ListView
              chronicle={chronicle}
              worked={worked}
              selected={primary}
              onSelect={(sid) => selectOne(sid)}
              mapYear={mapYear}
            />
          )}
          {chronicle.spans.length === 0 && (
            <div className="ch-start">
              <p>
                {canWrite
                  ? "Lay out a history. Add the events you know, rough dates are fine. Year 0 is whatever you place first."
                  : "Nothing has been laid out in this chronicle yet."}
              </p>
              {canWrite && (
                <button type="button" className="primary" onClick={() => setAdding(laneFor())}>
                  + Add the first event
                </button>
              )}
            </div>
          )}
          <p className="ch-note muted">
            Working numbers, not lore. Nothing here is written into a note.
          </p>
        </div>

        {span && (
          <aside
            className={`ch-details${narrow ? " is-sheet" : ""}${sheetOpen ? " is-open" : ""}`}
            aria-label={`${spanName(span)}: details`}
          >
            <header>
              {narrow && (
                <button
                  type="button"
                  className="ch-grab"
                  aria-label={sheetOpen ? "Show less" : "Show more"}
                  aria-expanded={sheetOpen}
                  onClick={() => setSheetOpen(!sheetOpen)}
                />
              )}
              <h2>{spanName(span)}</h2>
              <button type="button" className="quiet" onClick={() => select([])}>
                Close
              </button>
            </header>
            {details || writerDetails}
          </aside>
        )}
      </div>

      {narrow && canWrite && !span && (
        <button
          type="button"
          className="ch-fab"
          aria-label="Add an event"
          title="Add an event"
          onClick={() => setAdding(laneFor())}
        >
          <Plus aria-hidden="true" />
        </button>
      )}

      {adding && canWrite && (
        <AddEvent
          chronicle={chronicle}
          lane={adding}
          onCancel={() => setAdding(null)}
          onAdd={(added) => {
            setAdding(null);
            if (added.entry) {
              titles.current.set(added.id, added.entry);
              links.current.set(added.id, added.entry.path);
              setLinking((now) => ({ ...now, [added.id]: added.entry! }));
              file.change(() => withTies(added.chronicle), undefined, [
                { id: added.id, path: added.entry.path },
              ]);
            } else change(() => added.chronicle);
            select([added.id]);
          }}
        />
      )}
      {dialog === "units" && (
        <Sheet title="Units" onClose={() => setDialog(null)}>
          <UnitList chronicle={chronicle} change={change} />
        </Sheet>
      )}
      {dialog === "compare" && (
        <Sheet title="Compare lengths with real history" onClose={() => setDialog(null)}>
          <CompareView
            chronicle={chronicle}
            worked={worked}
            change={change}
            onSelect={(sid) => {
              setDialog(null);
              selectOne(sid);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
