/** Discovery on a map: explore mode, the proposals on this map, and the one opened. */
import type { Position } from "@frontier/geo";
import { useEffect, useState } from "react";
import { api, ApiFailure, type Discovery } from "../api.ts";

export function useDiscovery(
  id: string,
  {
    timeOn,
    chronicleId,
    year,
    setNotice,
  }: {
    timeOn: boolean;
    chronicleId: string | null;
    year: number | null;
    setNotice: (notice: string | null) => void;
  },
) {
  const [exploring, setExploring] = useState(false);
  const [found, setFound] = useState<{
    items: Discovery[];
    ready: boolean;
    art: boolean;
    folders: string[];
  }>({ items: [], ready: false, art: false, folders: [] });
  const [openFound, setOpenFound] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  useEffect(() => {
    api.discoveries(id).then(
      (r) => setFound({ items: r.discoveries, ready: r.ready, art: r.art, folders: r.folders }),
      () => undefined,
    );
  }, [id]);

  /** Exploring: a tap asks what is found there. */
  function explore(position: Position | null) {
    if (!position || seeking) return;
    setSeeking(true);
    setNotice("Looking at what is near…");
    api
      .discover(id, position, timeOn ? chronicleId : null, timeOn ? year : null)
      .then(
        (r) => {
          setFound((f) => ({ ...f, items: [...f.items, ...r.discoveries] }));
          setOpenFound(r.discoveries[0]?.id ?? null);
          setNotice(null);
        },
        (err: unknown) =>
          setNotice(err instanceof ApiFailure ? err.message : "Nothing could be discovered."),
      )
      .finally(() => setSeeking(false));
  }

  return { exploring, setExploring, found, setFound, openFound, setOpenFound, seeking, explore };
}
