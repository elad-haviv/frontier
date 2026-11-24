/**
 * A map's file on this device: loading it, the save queue, changes with undo and redo, and the
 * entries being linked to its features.
 */
import { type MapFeature, type MapFile, mergeMaps } from "@frontier/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiFailure, fromServer } from "../api.ts";
import { useReadAgain } from "../components/OfflineCopy.tsx";
import { markOpened, servedFromDevice } from "../offline/copy.ts";
import { useDialogs } from "../components/Dialogs.tsx";
import { useRefresh } from "../components/Shell.tsx";
import { useSaveState } from "../components/ui/SaveStatus.tsx";
import { type Known, type LinkItem, type QueueKey, queue } from "../sync/queue.ts";
import type { OtherMap } from "./layersBeneath.ts";
import type { TimeState } from "./useMapTime.ts";

export type Names = Record<string, { path: string; title: string }>;
export type MarkerSets = { name: string; icons: { name: string; path: string }[] }[];

export function useMapFile(
  id: string,
  {
    time,
    setNotice,
    onOpen,
    onLoaded,
  }: {
    time: Pick<TimeState, "yearRef" | "setYear" | "setPin">;
    setNotice: (notice: string | null) => void;
    /** Called as the map starts to load. */
    onOpen: () => void;
    /** Called once the map is loaded, to set up what it shows. */
    onLoaded: (map: MapFile) => void;
  },
) {
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const { yearRef, setYear, setPin } = time;

  const [map, setMap] = useState<MapFile | null>(null);
  const [names, setNames] = useState<Names>({});
  const [children, setChildren] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  /** When the map was opened from this device's copy, the time that copy was stored. */
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const key: QueueKey = `map:${id}`;
  const saving = useSaveState(key);
  const [sets, setSets] = useState<MarkerSets>([]);
  const [otherMaps, setOtherMaps] = useState<OtherMap[]>([]);
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<{ past: MapFile[]; future: MapFile[] }>({
    past: [],
    future: [],
  });
  /** The year at which each remembered step was taken, so undo shows what it changes. */
  const stamps = useRef(new WeakMap<MapFile, number>());
  const mapRef = useRef<MapFile | null>(null);
  /** What the next record in the save queue starts from: the server's last confirmed map. */
  const known = useRef<Known>({ draftId: "", revision: 0, baseBlob: "" });
  /** The entries asked for by features whose link is on its way, by feature id. */
  const linkTitles = useRef(new Map<string, { path: string; title: string }>());
  mapRef.current = map;

  // ---- Loading ---------------------------------------------------------------------------------

  useEffect(() => {
    let live = true;
    setMap(null);
    setError(null);
    onOpen();
    setHistory({ past: [], future: [] });
    // Opened: kept on this device among the recent maps.
    markOpened(key);
    Promise.all([api.map(id), queue.get(key)]).then(
      ([loaded, unsent]) => {
        if (!live) return;
        setOfflineAt(servedFromDevice(loaded));
        known.current = {
          draftId: "",
          revision: loaded.revision,
          baseBlob: loaded.blob,
          base: loaded.map,
        };
        // A change this device has not sent yet is newer than the server's copy.
        if (unsent) loaded = { ...loaded, map: unsent.value as MapFile };
        setMap(loaded.map);
        setNames(loaded.entries);
        setChildren(loaded.children);
        onLoaded(loaded.map);
      },
      (err: unknown) =>
        live && setError(err instanceof ApiFailure ? err.message : "The map could not be opened."),
    );
    api.markerSets().then(
      (r) => live && setSets(r.sets),
      () => undefined,
    );
    api.maps().then(
      (r) => live && setOtherMaps(r.maps.filter((m) => m.id !== id)),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // The address is read once, when the map opens.
  }, [id]);

  // Opened from the device's copy: the server's copy replaces it once it answers, when nothing
  // here is unsent and it differs. With a record, the queue's merge brings the two together.
  useReadAgain(offlineAt, `/api/maps/${id}`, () => {
    void (async () => {
      const loaded = await fromServer(() => api.map(id)).catch(() => null);
      if (!loaded) return;
      setOfflineAt(null);
      setNames((n) => ({ ...n, ...loaded.entries }));
      if (await queue.get(key)) return;
      const was = known.current;
      if (loaded.revision === was.revision && loaded.blob === was.baseBlob) return;
      known.current = {
        draftId: "",
        revision: loaded.revision,
        baseBlob: loaded.blob,
        base: loaded.map,
      };
      setHistory({ past: [], future: [] });
      setMap(loaded.map);
      setNotice("Updated from the server.");
    })();
  });

  // What the save queue hears from the server about this map.
  useEffect(
    () =>
      queue.subscribe(key, (e) => {
        if (e.type === "saved") {
          known.current = e.known;
          if (e.link.length > 0) {
            // The server gave the linked features their entry ids; nothing else is taken from it.
            const saved = e.value as MapFile;
            const ids = new Map(saved.features.map((f) => [f.id, f.entry]));
            const added: Names = {};
            for (const l of e.link) {
              const entry = ids.get(l.id);
              const asked = linkTitles.current.get(l.id);
              if (entry && asked?.path === l.path) added[entry] = asked;
              if (asked?.path === l.path) linkTitles.current.delete(l.id);
            }
            setNames((n) => ({ ...n, ...added }));
            setMap((now) =>
              now
                ? {
                    ...now,
                    features: now.features.map((f) =>
                      e.link.some((l) => l.id === f.id) && !linkTitles.current.has(f.id)
                        ? { ...f, entry: ids.get(f.id) ?? null }
                        : f,
                    ),
                  }
                : now,
            );
            if (e.unlinked.length > 0) setNotice(`Not linked: ${e.unlinked[0]!.reason}`);
          }
          refresh();
        } else if (e.type === "merged") {
          // Another device changed the map: its version was merged with this one, item by item.
          known.current = e.known;
          setMap(e.value as MapFile);
          // What changed in both places is said once the save answers, with Compare (stage 15c).
          setNotice("Changes from another device were merged in.");
          void api.map(id).then(
            (theirs) => setNames((n) => ({ ...theirs.entries, ...n })),
            () => undefined,
          );
        }
      }),
    [key, id, refresh],
  );

  // ---- Changing and saving ---------------------------------------------------------------------

  /** Puts the map into the save queue, which keeps it on this device until the server has it. */
  const store = useCallback(
    (next: MapFile, link?: LinkItem[]) =>
      void queue.put(key, next, { ...known.current, ...(link ? { link } : {}) }),
    [key],
  );

  /** Applies a change. `remember` is false for the steps of one drag, which undo as a whole. */
  const change = useCallback(
    (next: MapFile, remember = true, link?: LinkItem[]) => {
      const before = mapRef.current;
      if (!before) return;
      if (remember) {
        if (yearRef.current !== null) stamps.current.set(before, yearRef.current);
        setHistory((h) => ({ past: [...h.past.slice(-99), before], future: [] }));
      }
      mapRef.current = next;
      setMap(next);
      store(next, link);
    },
    [store],
  );

  const setFeature = useCallback(
    (next: MapFeature, remember = true) => {
      const now = mapRef.current;
      if (now)
        change(
          { ...now, features: now.features.map((f) => (f.id === next.id ? next : f)) },
          remember,
        );
    },
    [change],
  );

  /** Remembers the map before the first move of a drag, so one drag is one step to undo. */
  function beginStep() {
    if (!mapRef.current) return;
    const start = mapRef.current;
    if (yearRef.current !== null) stamps.current.set(start, yearRef.current);
    setHistory((h) => ({ past: [...h.past.slice(-99), start], future: [] }));
  }

  function undo() {
    setHistory((h) => {
      const before = h.past[h.past.length - 1];
      if (!before || !mapRef.current) return h;
      const now = mapRef.current;
      // Back at the year the change was made, what is undone is on screen.
      const then = stamps.current.get(before);
      if (then !== undefined && yearRef.current !== null) {
        stamps.current.set(now, then);
        setYear(then);
      }
      setPin(null);
      setMap(before);
      store(before);
      return { past: h.past.slice(0, -1), future: [now, ...h.future] };
    });
  }
  function redo() {
    setHistory((h) => {
      const next = h.future[0];
      if (!next || !mapRef.current) return h;
      const now = mapRef.current;
      const then = stamps.current.get(next);
      if (then !== undefined && yearRef.current !== null) {
        stamps.current.set(now, then);
        setYear(then);
      }
      setPin(null);
      setMap(next);
      store(next);
      return { past: [...h.past, now], future: h.future.slice(1) };
    });
  }

  /** Links a feature to an entry, or unlinks it with a null path. */
  function link(feature: MapFeature, path: string | null, title: string) {
    setPendingNames((p) => {
      const next = { ...p };
      if (path) next[feature.id] = title;
      else delete next[feature.id];
      return next;
    });
    if (path) linkTitles.current.set(feature.id, { path, title });
    else linkTitles.current.delete(feature.id);
    // The link travels with the save; a link still waiting is taken back by an unlink.
    const now = mapRef.current ?? map!;
    change(
      {
        ...now,
        features: now.features.map((f) => (f.id === feature.id ? { ...feature, entry: null } : f)),
      },
      true,
      [{ id: feature.id, path: path || null }],
    );
  }

  /** Takes in the map as the server holds it, after the server changed it, as when a discovery is kept. */
  async function reloadMap() {
    try {
      const loaded = await api.map(id);
      const base = (known.current.base as MapFile | undefined) ?? loaded.map;
      known.current = {
        draftId: "",
        revision: loaded.revision,
        baseBlob: loaded.blob,
        base: loaded.map,
      };
      setNames((n) => ({ ...n, ...loaded.entries }));
      setHistory({ past: [], future: [] });
      const unsent = await queue.get(key);
      if (!unsent || !mapRef.current) {
        setMap(loaded.map);
        return;
      }
      // A change still unsent is merged with what the server holds now, and goes from there.
      const merged = mergeMaps(base, mapRef.current, loaded.map).map;
      await queue.drop(key);
      setMap(merged);
      store(merged);
    } catch {
      setNotice("The map could not be read again. Open it anew to see the new marker.");
    }
  }

  async function removeMap() {
    const ok = await dialogs.confirm({
      title: `Delete the map "${map!.title}"?`,
      body: "It is removed from the library when you save a version.",
      action: "Delete the map",
      danger: true,
    });
    if (!ok) return;
    await queue.drop(key);
    await api.deleteMap(id).catch(() => undefined);
    refresh();
    navigate("/maps");
  }

  // A map of a place chosen while editing is known by its title at once, not only after a reload.
  const childTitles = useMemo(
    () => ({ ...Object.fromEntries(otherMaps.map((m) => [m.id, m.title])), ...children }),
    [otherMaps, children],
  );

  return {
    key,
    map,
    mapRef,
    error,
    offlineAt,
    names,
    children: childTitles,
    sets,
    otherMaps,
    pendingNames,
    /** The path of the entry a feature's link waits to be saved with, if any. */
    pendingPathOf: (feature: string) => linkTitles.current.get(feature)?.path ?? null,
    saving,
    history,
    change,
    setFeature,
    beginStep,
    undo,
    redo,
    link,
    reloadMap,
    removeMap,
  };
}
