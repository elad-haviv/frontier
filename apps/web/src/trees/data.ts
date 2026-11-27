/**
 * The library's relations as this tab sees them (stage 29): read once from `/api/relations`,
 * shared by the trees and the Relations tab, and read again after any of them writes one. The
 * trees themselves are the trees library file, saved through the save queue like the pins.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  type AddRelationRequest,
  makeId,
  type RelationsResponse,
  type TreeLine,
  TREES,
  type TreesFile,
} from "@frontier/schema";
import { makeEntryId } from "@frontier/vault";
import { api, ApiFailure } from "../api.ts";
import { useLibraryFile } from "../sync/libraryFile.ts";
import { type Graph, kindNamed, makeGraph } from "./model.ts";

export interface RelationsState {
  state: "loading" | "ready" | "failed";
  graph: Graph | null;
  response: RelationsResponse | null;
  error: string | null;
}

let snapshot: RelationsState = { state: "loading", graph: null, response: null, error: null };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function show(next: Partial<RelationsState>) {
  snapshot = { ...snapshot, ...next };
  for (const l of [...listeners]) l();
}

/** Reads the relations again; what is shown stays until the new answer comes. */
export function reloadRelations(): Promise<void> {
  loading = api.relations().then(
    (r) => show({ state: "ready", response: r, graph: makeGraph(r), error: null }),
    (err: unknown) =>
      show({
        state: snapshot.graph ? "ready" : "failed",
        error: err instanceof ApiFailure ? err.message : "The relations could not be read.",
      }),
  );
  return loading;
}

export function useRelations(): RelationsState & { reload: () => Promise<void> } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
  useEffect(() => {
    // Each screen that shows relations reads them fresh when it opens.
    void reloadRelations();
  }, []);
  return { ...s, reload: reloadRelations };
}

export function useTrees() {
  return useLibraryFile(TREES);
}

/** Writes one relation and reads the relations again. */
export async function addRelation(req: AddRelationRequest) {
  const made = await api.addRelation(req);
  await reloadRelations();
  return made;
}

export async function removeRelation(req: {
  path: string;
  index: number;
  what: string;
  who: string;
}) {
  await api.removeRelation(req);
  await reloadRelations();
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const newTreeId = (): string => makeEntryId(random);
export const newOpId = (): string => makeId(random);

/** Changes one tree in the trees file. */
export function changeTree(
  change: (fn: (file: TreesFile) => TreesFile) => Promise<void>,
  id: string,
  fn: (t: TreeLine) => TreeLine,
): Promise<void> {
  return change((file) => ({ ...file, trees: file.trees.map((t) => (t.id === id ? fn(t) : t)) }));
}

/** Where something is added, seen from the selected card. */
export type AddWhere = "up" | "down" | "pair";

/** The word written on the selected entry for an addition there. */
export function wordFor(g: Graph, kindName: string, where: AddWhere): string {
  const kind = kindNamed(g, kindName);
  if (where === "pair") return g.kinds.find((k) => k.couple)?.name ?? "partner";
  if (!kind?.reverse) return kind?.name ?? kindName;
  return where === "up" ? kind.name : kind.reverse;
}

/** The title on the "+": "Add a parent of Wren", "Add what Wyverns descend from". */
export function addTitle(g: Graph, kindName: string, where: AddWhere, name: string): string {
  const kind = kindNamed(g, kindName);
  if (where === "pair") return `Add a partner of ${name}`;
  if (kind?.family) return where === "up" ? `Add a parent of ${name}` : `Add a child of ${name}`;
  const word = wordFor(g, kindName, where);
  return where === "up" ? `Add: ${name} ${word}…` : `Add: ${name} ${word}…`;
}
