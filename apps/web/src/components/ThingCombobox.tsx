import { thingOf, type ThingKind, thingValue } from "@frontier/vault";
import { TREES } from "@frontier/schema";
import { useEffect, useId, useMemo, useState } from "react";
import { api, chronicleUrl, mapUrl, treeUrl } from "../api.ts";
import { Link } from "../nav.tsx";
import { useLibraryFile } from "../sync/libraryFile.ts";
import { Combobox, type ComboboxOption } from "./ui/Combobox.tsx";

const NONE = "\u0000none";
const WHOLE = "\u0000whole";

interface Named {
  id: string;
  name: string;
}

/** What a kind of link is called, and what the spot inside it is called. */
export const THING_WORDS: Record<ThingKind, { one: string; spot: string | null }> = {
  map: { one: "map", spot: "place" },
  chronicle: { one: "chronicle", spot: "event" },
  tree: { one: "tree", spot: null },
};

// One request per list for the page, shared by every field and every shown link.
const lists = new Map<string, Promise<Named[]>>();
function listOf(kind: "map" | "chronicle"): Promise<Named[]> {
  let known = lists.get(kind);
  if (!known) {
    known =
      kind === "map"
        ? api.maps().then((r) => r.maps.map((m) => ({ id: m.id, name: m.title })))
        : api.chronicles().then((r) => r.chronicles.map((c) => ({ id: c.id, name: c.title })));
    // A list that could not be read is asked for again the next time.
    known.catch(() => lists.delete(kind));
    lists.set(kind, known);
    window.setTimeout(() => lists.delete(kind), 30_000);
  }
  return known;
}

/** The maps, the chronicles or the trees of the project, by name. Null while they load. */
export function useThings(kind: ThingKind): Named[] | null {
  const trees = useLibraryFile(TREES);
  const [found, setFound] = useState<Named[] | null>(null);
  useEffect(() => {
    if (kind === "tree") return;
    let live = true;
    listOf(kind).then(
      (list) => live && setFound(list),
      () => live && setFound([]),
    );
    return () => {
      live = false;
    };
  }, [kind]);
  return useMemo(
    () =>
      kind === "tree" ? (trees.value?.trees ?? []).map((t) => ({ id: t.id, name: t.name })) : found,
    [kind, trees.value, found],
  );
}

/** The places of a map or the events of a chronicle, by name. */
function useSpots(kind: ThingKind, id: string | null): Named[] {
  const [spots, setSpots] = useState<Named[]>([]);
  useEffect(() => {
    setSpots([]);
    if (!id || kind === "tree") return;
    let live = true;
    const read =
      kind === "map"
        ? api.map(id).then((m) =>
            m.map.features
              .map((f) => ({
                id: f.id,
                name: f.label ?? (f.entry ? m.entries[f.entry]?.title : undefined) ?? "",
              }))
              .filter((f) => f.name !== ""),
          )
        : api.chronicle(id).then((c) => c.chronicle.spans.map((s) => ({ id: s.id, name: s.name })));
    read.then(
      (list) => live && setSpots(list),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [kind, id]);
  return spots;
}

/** Options with names that are told apart when two share one. */
function optionsOf(list: Named[]): ComboboxOption[] {
  const seen = new Map<string, number>();
  return list.map((x) => {
    const n = (seen.get(x.name) ?? 0) + 1;
    seen.set(x.name, n);
    return { value: x.id, label: n === 1 ? x.name : `${x.name} (${n})` };
  });
}

/**
 * Chooses a map, a chronicle or a tree by typing part of its name, and then, for a map or a
 * chronicle, a place on it or an event in it if the link should open there. The value is written
 * by id ("map/ab12cd34#f9"), so a rename breaks nothing.
 */
export function ThingCombobox({
  kind,
  value,
  onChange,
  labelledBy,
}: {
  kind: ThingKind;
  value: unknown;
  /** The new value, or null for none. */
  onChange: (value: string | null) => void;
  labelledBy: string;
}) {
  const ref = thingOf(value);
  const chosen = ref?.kind === kind ? ref : null;
  const things = useThings(kind);
  const spots = useSpots(kind, chosen?.id ?? null);
  const spotLabel = useId();
  const words = THING_WORDS[kind];

  const options = useMemo<ComboboxOption[]>(() => {
    const list = optionsOf(things ?? []);
    // What is chosen stays on the button even when the list does not have it (any more).
    if (chosen && !list.some((o) => o.value === chosen.id)) {
      list.unshift({
        value: chosen.id,
        label: things === null ? "…" : `A ${words.one} that is gone`,
      });
    }
    return [{ value: NONE, label: `No ${words.one}` }, ...list];
  }, [things, chosen?.id, words.one]);

  const spotOptions = useMemo<ComboboxOption[]>(
    () => [{ value: WHOLE, label: `The whole ${words.one}` }, ...optionsOf(spots)],
    [spots, words.one],
  );

  return (
    <span className="thing-combobox">
      <Combobox
        labelledBy={labelledBy}
        options={options}
        value={chosen?.id ?? NONE}
        onChange={(id) => onChange(id === NONE ? null : thingValue({ kind, id }))}
        findLabel={`Find a ${words.one}`}
        empty={`No ${words.one} has that name.`}
        placeholder={`Choose a ${words.one}`}
      />
      {chosen && words.spot && spots.length > 0 && (
        <>
          <span className="sr-only" id={spotLabel}>
            Where in the {words.one}
          </span>
          <Combobox
            labelledBy={spotLabel}
            options={spotOptions}
            value={chosen.spot ?? WHOLE}
            onChange={(spot) =>
              onChange(thingValue({ kind, id: chosen.id, ...(spot === WHOLE ? {} : { spot }) }))
            }
            findLabel={`Find ${words.spot === "event" ? "an event" : "a place"}`}
            empty={`No ${words.spot} has that name.`}
          />
        </>
      )}
    </span>
  );
}

/** Where a link to a map, a chronicle or a tree opens. */
export function thingUrl(value: unknown): string | null {
  const ref = thingOf(value);
  if (!ref) return null;
  if (ref.kind === "map") return mapUrl(ref.id, ref.spot);
  if (ref.kind === "tree") return treeUrl(ref.id);
  return `${chronicleUrl(ref.id)}${ref.spot ? `?span=${encodeURIComponent(ref.spot)}` : ""}`;
}

/** A link to a map, a chronicle or a tree as readers see it: its name, opening it. */
export function ThingLink({ value }: { value: unknown }) {
  const ref = thingOf(value);
  const things = useThings(ref?.kind ?? "tree");
  const spots = useSpots(ref?.kind ?? "tree", ref?.spot ? ref.id : null);
  const url = thingUrl(value);
  if (!ref || !url) return <>{String(value)}</>;
  const words = THING_WORDS[ref.kind];
  if (things === null) return <span className="muted">…</span>;
  const thing = things.find((t) => t.id === ref.id);
  if (!thing) {
    return (
      <span className="link-unresolved" title={`This ${words.one} is not in the project`}>
        A {words.one} that is gone
      </span>
    );
  }
  const spot = ref.spot ? spots.find((s) => s.id === ref.spot)?.name : undefined;
  return (
    <Link to={url} className="link-resolved thing-link" title={`Open the ${words.one}`}>
      {spot ? `${spot}, ${thing.name}` : thing.name}
    </Link>
  );
}
