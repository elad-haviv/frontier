/**
 * What maps and chronicles share: a JSON file whose lists hold one item per line, and a merge of
 * two versions of such a list by item id.
 */

/** The object with the known keys first, in their fixed order, and any others after, as found. */
function ordered(value: Record<string, unknown>, first: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of first) if (k in value) out[k] = value[k];
  for (const k of Object.keys(value)) if (!(k in out)) out[k] = value[k];
  return out;
}

/**
 * The text such a file is stored as. Each item of the lists named in `itemKeys` is on one line,
 * so a difference reads item by item, and the same content always gives the same bytes.
 */
export function serialiseItemFile(
  value: Record<string, unknown>,
  topKeys: string[],
  itemKeys: Record<string, string[]>,
): string {
  const top = ordered(value, topKeys);
  const lines: string[] = ["{"];
  const keys = Object.keys(top);
  keys.forEach((key, i) => {
    const comma = i === keys.length - 1 ? "" : ",";
    const entry = top[key];
    if (key in itemKeys && Array.isArray(entry)) {
      if (entry.length === 0) {
        lines.push(`  ${JSON.stringify(key)}: []${comma}`);
        return;
      }
      lines.push(`  ${JSON.stringify(key)}: [`);
      entry.forEach((item, n) => {
        const text = JSON.stringify(ordered(item as Record<string, unknown>, itemKeys[key]!));
        lines.push(`    ${text}${n === entry.length - 1 ? "" : ","}`);
      });
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(entry)}${comma}`);
    }
  });
  lines.push("}");
  return lines.join("\n") + "\n";
}

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export interface MergedList<T> {
  items: T[];
  /** Ids of the items both sides changed differently. */
  clashes: string[];
}

/**
 * Merges two versions of one list by item id. What only one side added, changed or removed is
 * taken from that side. In a clash the item from `mine` is kept and its id is reported.
 */
export function mergeItemLists<T extends { id: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
): MergedList<T> {
  const baseById = new Map(base.map((i) => [i.id, i]));
  const mineById = new Map(mine.map((i) => [i.id, i]));
  const clashes: string[] = [];
  const items: T[] = [];
  const done = new Set<string>();

  // Their order is the frame; my additions follow. Both sides only ever append.
  for (const t of theirs) {
    done.add(t.id);
    const b = baseById.get(t.id);
    const m = mineById.get(t.id);
    if (!m) {
      // I removed it, or they added it.
      if (!b) items.push(t);
      else if (!sameValue(b, t)) clashes.push(t.id); // my removal is kept
      continue;
    }
    if (sameValue(m, t) || sameValue(b, m)) items.push(t);
    else if (sameValue(b, t)) items.push(m);
    else {
      clashes.push(t.id);
      items.push(m);
    }
  }
  for (const m of mine) {
    if (done.has(m.id)) continue;
    const b = baseById.get(m.id);
    if (!b) items.push(m);
    else if (!sameValue(b, m)) {
      // They removed what I changed: mine is kept.
      clashes.push(m.id);
      items.push(m);
    }
    // Otherwise they removed it and I left it alone: it stays removed.
  }
  return { items, clashes };
}

/** One of three single values: the side that changed it, or `mine` with a clash when both did. */
export function mergeValue<T>(base: T, mine: T, theirs: T): { value: T; clash: boolean } {
  if (sameValue(mine, theirs) || sameValue(base, theirs)) return { value: mine, clash: false };
  if (sameValue(base, mine)) return { value: theirs, clash: false };
  return { value: mine, clash: true };
}
