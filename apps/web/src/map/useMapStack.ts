/**
 * The maps of a stack, loaded together and saved each by its own file. A change to one of them goes
 * into the save queue under that map's own key, as on the map page, so it is kept on this device
 * until the server has it. The layered view has no undo: each layer's own map page has one.
 */
import type { MapFeature, MapFile } from "@frontier/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { type Known, type LinkItem, queue } from "../sync/queue.ts";
import { stackOf } from "./stack.ts";

export type Names = Record<string, { path: string; title: string }>;

export interface MapStack {
  /** The maps, top to bottom. */
  order: string[];
  maps: Record<string, MapFile>;
  names: Names;
  error: string | null;
  /** Puts the changed maps in the save queue. */
  change: (changed: Record<string, MapFile>, link?: Record<string, LinkItem[]>) => void;
  /** The titles of entries just linked, by feature id, until the save brings the entry's id. */
  pendingNames: Record<string, string>;
  /** Links a place to an entry, or unlinks it with a null path. */
  link: (mapId: string, feature: MapFeature, path: string | null, title: string) => void;
  /** Sends everything now, as Done does. */
  sendAll: () => void;
  /** The state of the queue for the stack's maps: unsent changes may remain. */
  dirty: boolean;
}

export function useMapStack(id: string): MapStack {
  const [order, setOrder] = useState<string[]>([]);
  const [maps, setMaps] = useState<Record<string, MapFile>>({});
  const [names, setNames] = useState<Names>({});
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({});
  const known = useRef<Record<string, Known>>({});
  const latest = useRef<Record<string, MapFile>>({});

  useEffect(() => {
    let live = true;
    setError(null);
    (async () => {
      const list = await api.maps();
      const ids = stackOf(id, list.maps);
      const loaded = await Promise.all(
        ids.map(async (mid) => {
          const [m, unsent] = await Promise.all([api.map(mid), queue.get(`map:${mid}`)]);
          known.current[mid] = { draftId: "", revision: m.revision, baseBlob: m.blob, base: m.map };
          return { id: mid, map: unsent ? (unsent.value as MapFile) : m.map, entries: m.entries };
        }),
      );
      if (!live) return;
      const next: Record<string, MapFile> = {};
      const entries: Names = {};
      for (const l of loaded) {
        next[l.id] = l.map;
        Object.assign(entries, l.entries);
      }
      latest.current = next;
      setOrder(ids);
      setMaps(next);
      setNames(entries);
    })().catch((err: unknown) => {
      if (live) setError(err instanceof ApiFailure ? err.message : "The maps could not be opened.");
    });
    return () => {
      live = false;
    };
  }, [id]);

  const change = useCallback(
    (changed: Record<string, MapFile>, link?: Record<string, LinkItem[]>) => {
      latest.current = { ...latest.current, ...changed };
      setMaps(latest.current);
      for (const [mid, next] of Object.entries(changed)) {
        const items = link?.[mid];
        void queue.put(`map:${mid}`, next, {
          ...known.current[mid]!,
          ...(items ? { link: items } : {}),
        });
      }
      setDirty(true);
    },
    [],
  );

  const link = useCallback(
    (mapId: string, feature: MapFeature, path: string | null, title: string) => {
      setPendingNames((p) => {
        const next = { ...p };
        if (path) next[feature.id] = title;
        else delete next[feature.id];
        return next;
      });
      const now = latest.current[mapId];
      if (!now) return;
      change(
        {
          [mapId]: {
            ...now,
            features: now.features.map((f) =>
              f.id === feature.id ? { ...feature, entry: null } : f,
            ),
          },
        },
        { [mapId]: [{ id: feature.id, path: path || null }] },
      );
    },
    [change],
  );

  const sendAll = useCallback(() => {
    for (const mid of Object.keys(latest.current)) void queue.sendNow(`map:${mid}`);
    setDirty(false);
  }, []);

  return { order, maps, names, error, change, pendingNames, link, sendAll, dirty };
}
