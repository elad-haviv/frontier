/**
 * Discovery on a map: explore mode, the proposals on this map, the one opened, and asking the AI
 * about places chosen (docs/designs/stage-21-explore-points-of-interest.md). A click only
 * chooses; asking is a separate step, up to six places a call.
 */
import { useEffect, useState } from "react";
import { projectKey } from "../projectStorage.ts";
import { api, ApiFailure, type Discovery, type SpotAsk } from "../api.ts";

/** Places asked about in one call; more are asked in turn. */
export const PLACES_PER_CALL = 6;
/** Whether discovery was ready when last asked, for a map opened with no connection. */
const READY_KEY = "frontier.discovery.ready";
const readyKey = () => projectKey(READY_KEY);

function rememberedReady(): boolean {
  try {
    return localStorage.getItem(readyKey()) === "1";
  } catch {
    return false;
  }
}

export function useDiscovery(
  id: string,
  {
    timeOn,
    chronicleId,
    year,
    setNotice,
    enabled = true,
  }: {
    timeOn: boolean;
    chronicleId: string | null;
    year: number | null;
    setNotice: (notice: string | null) => void;
    /**
     * Whether the person may see what the AI proposed and nobody kept: writers (stage 27c). A
     * reader's map never asks for discoveries, which the server refuses to them.
     */
    enabled?: boolean;
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
  /** Why the last ask found nothing, shown until the next one. */
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    api.discoveries(id).then(
      (r) => {
        setFound({ items: r.discoveries, ready: r.ready, art: r.art, folders: r.folders });
        try {
          localStorage.setItem(readyKey(), r.ready ? "1" : "0");
        } catch {
          // Remembered only for opening a map offline.
        }
      },
      // Offline: exploring still works from the map file; asking waits for the connection.
      () => setFound((f) => ({ ...f, ready: f.ready || rememberedReady() })),
    );
  }, [id, enabled]);
  const setExploring = (on: boolean) => {
    setExploringNow(on);
    setFailed(null);
  };

  /** Asks what is found at the places, six a call; true when every call answered. */
  async function ask(spots: SpotAsk[]): Promise<boolean> {
    if (spots.length === 0 || seeking) return false;
    setSeeking(true);
    setFailed(null);
    const calls = Math.ceil(spots.length / PLACES_PER_CALL);
    let first: string | null = null;
    try {
      for (let i = 0; i < spots.length; i += PLACES_PER_CALL) {
        setNotice(
          calls > 1
            ? `Asking about ${spots.length} places, call ${i / PLACES_PER_CALL + 1} of ${calls}…`
            : "Looking at what is there…",
        );
        const r = await api.discover(
          id,
          spots.slice(i, i + PLACES_PER_CALL),
          timeOn ? chronicleId : null,
          timeOn ? year : null,
        );
        setFound((f) => ({ ...f, items: [...f.items, ...r.discoveries] }));
        first ??= r.discoveries[0]?.id ?? null;
      }
      setOpenFound(first);
      setNotice(null);
      return true;
    } catch (err) {
      const message =
        err instanceof ApiFailure ? err.message : "Nothing could be discovered. Try again.";
      setFailed(message);
      setNotice(message);
      if (first) setOpenFound(first);
      return false;
    } finally {
      setSeeking(false);
    }
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
    setFailed,
    ask,
  };
}
