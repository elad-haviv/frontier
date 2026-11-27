import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PassageComment } from "../../api.ts";
import { changesOf } from "./model.ts";
import { useStatus } from "../Shell.tsx";

const NONE: PassageComment[] = [];

/**
 * The comments on an entry, read again when the server says an entry's comments changed (the status
 * stream, which names the entry and nothing else) and when asked to. What is shown stays while the
 * new list is read, so a reply being typed is not lost. A failed read (no connection, an entry that
 * is not saved) keeps what was there.
 */
export function useComments(path: string): {
  comments: PassageComment[];
  loaded: boolean;
  reload: () => void;
} {
  const [state, setState] = useState<{ path: string; list: PassageComment[] } | null>(null);
  const changes = changesOf(useStatus()?.comments, path);
  const read = useRef(0);
  const load = useCallback(() => {
    const mine = ++read.current;
    api.comments(path).then(
      (r) => {
        if (mine === read.current) setState({ path, list: r.comments });
      },
      () => undefined,
    );
  }, [path]);
  // Read when the entry is opened, and again whenever its comments changed.
  useEffect(load, [load, changes]);
  const here = state?.path === path;
  return { comments: here ? state.list : NONE, loaded: here, reload: load };
}
