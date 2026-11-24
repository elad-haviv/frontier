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
  const [exploring, setExploringNow] = useState(false);
  const [found, setFound] = useState<{
    items: Discovery[];
    ready: boolean;
    art: boolean;
    folders: string[];
  }>({ items: [], ready: false, art: false, folders: [] });
  const [openFound, setOpenFound] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  /** Why the last tap found nothing, shown where the tap was asked for until the next one. */
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    api.discoveries(id).then(
      (r) => setFound({ items: r.discoveries, ready: r.ready, art: r.art, folders: r.folders }),
      () => undefined,
    );
  }, [id]);
  const setExploring = (on: boolean) => {
    setExploringNow(on);
    setFailed(null);
  };

  /** Exploring: a tap asks what is found there. */
  function explore(position: Position | null) {
    if (!position || seeking) return;
    setSeeking(true);
    setFailed(null);
    setNotice("Looking at what is near…");
    api
      .discover(id, position, timeOn ? chronicleId : null, timeOn ? year : null)
      .then(
        (r) => {
          setFound((f) => ({ ...f, items: [...f.items, ...r.discoveries] }));
          setOpenFound(r.discoveries[0]?.id ?? null);
          setNotice(null);
        },
        (err: unknown) => {
          const message =
            err instanceof ApiFailure ? err.message : "Nothing could be discovered. Try again.";
          setFailed(message);
          setNotice(message);
        },
      )
      .finally(() => setSeeking(false));
  }

  return {
    exploring,
    setExploring,
    found,
    setFound,
    openFound,
    setOpenFound,
    seeking,
    failed,
    explore,
  };
}
