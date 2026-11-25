/**
 * The small decisions Home makes from what it was given, kept apart from the page so they can be
 * tested: which draft to continue, how long ago, the bars of the week, a folder's stub count.
 */
import {
  isStub,
  type OnThisDayRow,
  type TreeFolder,
  type UnpublishedResponse,
  type WeekDay,
} from "@frontier/schema";
import { isInAppendix } from "@frontier/vault";
import type { RecentEntry } from "./recents.ts";

export const folderOf = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** The folder the dice can pick from for the entry last read: null at the library top or none read. */
export const diceFolder = (lastPath: string | null): string | null =>
  (lastPath ? folderOf(lastPath) : "") || null;

export const NO_DICE_FOLDER =
  "Read an entry in a folder first: this picks from the folder of the last one.";

export const stemOf = (path: string): string =>
  (path.split("/").pop() ?? path).replace(/\.md$/i, "");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "2 h ago", "yesterday", the weekday within a week, else a date. */
export function ago(at: number, now: number = Date.now()): string {
  const gone = Math.max(0, now - at);
  if (gone < MINUTE) return "just now";
  if (gone < HOUR) return `${Math.round(gone / MINUTE)} min ago`;
  if (gone < DAY) return `${Math.round(gone / HOUR)} h ago`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 1) return "yesterday";
  if (days < 7) return new Date(at).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type Draft = UnpublishedResponse["drafts"][number];

/**
 * The draft to offer "Continue editing" for: an entry (not a map, a file or a deletion), the one
 * edited last on this device if the recents know any, else the last one the server lists.
 */
export function newestDraft(
  drafts: readonly Draft[],
  recents: readonly Pick<RecentEntry, "path" | "kind">[],
): Draft | null {
  const entries = drafts.filter(
    (d) => d.kind !== "delete" && !d.binary && d.path.toLowerCase().endsWith(".md"),
  );
  for (const r of recents) {
    if (r.kind !== "edited") continue;
    const hit = entries.find((d) => d.path === r.path);
    if (hit) return hit;
  }
  return entries[entries.length - 1] ?? null;
}

/** The newest entry read, as opposed to edited, among the recents. */
export function lastRead<T extends Pick<RecentEntry, "kind">>(recents: readonly T[]): T | null {
  return recents.find((r) => r.kind === "read") ?? null;
}

/** Bar heights for the week, in percent of the tallest day; a quiet day still shows a stub. */
export function barHeights(days: readonly Pick<WeekDay, "entries">[]): number[] {
  const most = Math.max(1, ...days.map((d) => d.entries));
  return days.map((d) =>
    d.entries === 0 ? 8 : Math.max(14, Math.round((d.entries / most) * 100)),
  );
}

/** The first letter of a day's weekday name, for under its bar. */
export function dayLetter(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "narrow" });
}

/** The day's full name for a bar's tooltip. */
export function dayName(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

const SPANS: Record<OnThisDayRow["span"], string> = {
  month: "1 month ago",
  sixMonths: "6 months ago",
  year: "1 year ago",
};

/** "written 1 year ago", "last changed 6 months ago". */
export function onThisDayWhen(row: Pick<OnThisDayRow, "span" | "kind">): string {
  return `${row.kind === "written" ? "written" : "last changed"} ${SPANS[row.span]}`;
}

/** "1 entry", "3 entries". */
export const entriesWord = (n: number): string => (n === 1 ? "1 entry" : `${n} entries`);

/** The words for how many entries mention a wanted name, with where it likely belongs. */
export function mentionsText(mentions: number, folder: string | null): string {
  return `Mentioned in ${entriesWord(mentions)}${folder ? ` · likely in ${folder}` : ""}`;
}

/**
 * How many entries a folder holds and how many of them are stubs, by the words the tree carries
 * (published entries only). The README and the appendices are never counted, as on the server.
 */
export function stubsIn(folder: TreeFolder): { entries: number; stubs: number } {
  if (isInAppendix(folder.path)) {
    return { entries: 0, stubs: 0 };
  }
  let entries = 0;
  let stubs = 0;
  for (const note of folder.notes) {
    if (note.words === undefined || note.path.toLowerCase() === "readme.md") continue;
    entries++;
    if (isStub(note.words)) stubs++;
  }
  for (const sub of folder.folders) {
    const inner = stubsIn(sub);
    entries += inner.entries;
    stubs += inner.stubs;
  }
  return { entries, stubs };
}
