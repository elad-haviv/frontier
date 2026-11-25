import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { RandomQuery } from "@frontier/schema";
import { ApiFailure } from "../api.ts";
import { currentEntryPath } from "../components/shell/entryPath.ts";
import { useToast } from "../components/ui/Toast.tsx";
import { useNeedsConnection } from "../sync/connection.ts";
import { NO_DICE_FOLDER } from "./homeModel.ts";
import { openRandom, type RandomKind } from "./random.ts";

/** What to say when the dice finds nothing, for each kind. */
export const NONE_FITS: Record<RandomKind, string> = {
  any: "There is no other entry to open.",
  stub: "No stubs left: every entry has some text.",
  folder: "There is no other entry in this folder.",
  old: "Every entry was touched in the last 6 months.",
};

/**
 * The dice for the left bar, the switcher and the keys: opens a random entry (never the one in
 * view) and says in a toast when none fits or the server cannot be reached. Resolves to whether an
 * entry was opened.
 */
export function useRandom(): (query?: RandomQuery) => Promise<boolean> {
  const navigate = useNavigate();
  const toast = useToast();
  const offline = useNeedsConnection();
  const { pathname } = useLocation();
  const open = currentEntryPath(pathname);
  return useCallback(
    async (query: RandomQuery = {}) => {
      if (offline) {
        toast({ message: `${offline}: the dice asks the server.` });
        return false;
      }
      if (query.kind === "folder" && !query.folder) {
        toast({ message: NO_DICE_FOLDER });
        return false;
      }
      try {
        const entry = await openRandom(navigate, { ...(open ? { not: open } : {}), ...query });
        if (!entry) toast({ message: NONE_FITS[query.kind ?? "any"] });
        return entry !== null;
      } catch (err) {
        toast({
          message: `Could not roll the dice: ${err instanceof ApiFailure ? err.message : "something went wrong."}`,
        });
        return false;
      }
    },
    [navigate, toast, offline, open],
  );
}
