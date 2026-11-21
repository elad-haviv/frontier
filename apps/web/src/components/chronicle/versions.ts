import type { ChronicleFile, ChronicleSpan } from "@frontier/schema";

/** How the spans of two chronicles correspond, and what differs between them. */
export interface Versus {
  /** For each span of the other chronicle, the span of this one it corresponds to. */
  match: Map<string, string>;
  /** Spans of this chronicle that differ from, or are missing in, the other. */
  mine: Map<string, "differs" | "only">;
  /** The same for the other chronicle's spans. */
  theirs: Map<string, "differs" | "only">;
}

type End = ChronicleSpan["start"];

const sameEnd = (a: End, b: End, by: number): boolean => {
  if (a === null || b === null || a === "open" || b === "open") return a === b;
  // Years may be decimals, and adding an offset to one does not always land exactly on the other.
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  return near(a.low, b.low + by) && near(a.high, b.high + by);
};

/**
 * Compares two chronicles. Spans are matched by id, then by name. `offset` is the number of
 * years added to the other's starts and ends to bring the two onto one ruler.
 */
export function compareVersions(
  mine: ChronicleFile,
  theirs: ChronicleFile,
  offset: number,
): Versus {
  const match = new Map<string, string>();
  const taken = new Set<string>();
  for (const t of theirs.spans) {
    if (mine.spans.some((m) => m.id === t.id)) {
      match.set(t.id, t.id);
      taken.add(t.id);
    }
  }
  for (const t of theirs.spans) {
    if (match.has(t.id) || !t.name) continue;
    const m = mine.spans.find((x) => !taken.has(x.id) && x.name === t.name);
    if (m) {
      match.set(t.id, m.id);
      taken.add(m.id);
    }
  }

  /** The statements about one span, written with this chronicle's ids so the two can be compared. */
  const said = (c: ChronicleFile, id: string, rename: (id: string) => string): string =>
    c.relations
      .filter((r) => r.a === id || r.b === id)
      .map((r) => `${rename(r.a)} ${r.kind} ${rename(r.b)}`)
      .sort()
      .join("\n");

  const mineState = new Map<string, "differs" | "only">();
  const theirState = new Map<string, "differs" | "only">();
  for (const m of mine.spans) if (!taken.has(m.id)) mineState.set(m.id, "only");
  for (const t of theirs.spans) {
    const id = match.get(t.id);
    const m = mine.spans.find((x) => x.id === id);
    if (!m) {
      theirState.set(t.id, "only");
      continue;
    }
    const same =
      m.point === t.point &&
      sameEnd(m.start, t.start, offset) &&
      sameEnd(m.end, t.end, offset) &&
      (m.length?.low ?? null) === (t.length?.low ?? null) &&
      (m.length?.high ?? null) === (t.length?.high ?? null) &&
      said(mine, m.id, (x) => (mine.spans.some((s) => s.id === x) ? x : `(${x})`)) ===
        said(theirs, t.id, (x) => match.get(x) ?? `(${x})`);
    if (!same) {
      mineState.set(m.id, "differs");
      theirState.set(t.id, "differs");
    }
  }
  return { match, mine: mineState, theirs: theirState };
}

/** Spans both chronicles hold with a start that is a number: what the two can be aligned on. */
export function alignable(mine: ChronicleFile, theirs: ChronicleFile, versus: Versus) {
  const out: { mine: ChronicleSpan; offset: number }[] = [];
  for (const t of theirs.spans) {
    const m = mine.spans.find((x) => x.id === versus.match.get(t.id));
    if (!m || !m.start || m.start === "open" || !t.start || t.start === "open") continue;
    out.push({ mine: m, offset: m.start.low - t.start.low });
  }
  return out;
}
