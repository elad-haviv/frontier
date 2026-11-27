/**
 * The words and the small rules of "who did what" (stage 27d): authors on versions, the notice
 * that someone else has unsaved changes to an entry, and who is reading. No React in here.
 */
import type { OtherUnsaved, Reading } from "@frontier/schema";

/** A name worth showing: an unknown author is a blank, and a blank is shown as nothing. */
export function shownName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", or the date. */
export function whenText(iso: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  const minutes = Math.round(s / 60);
  if (s < 3600) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(s / 3600);
  if (s < 86_400) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  if (s < 172_800) return "yesterday";
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Last version by Wren, 2 hours ago"; with no known author, "Last version, 2 hours ago". */
export function lastVersionText(
  version: { at: string; by?: { name: string } | null } | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!version) return null;
  const who = shownName(version.by?.name);
  const when = whenText(version.at, now);
  return `Last version${who ? ` by ${who}` : ""}${when ? `, ${when}` : ""}`;
}

/** "by Wren" for a row of the history, or an empty string for an author nobody knows. */
export function byText(by: { name: string } | null | undefined): string {
  const who = shownName(by?.name);
  return who ? `by ${who}` : "";
}

/**
 * Names joined as people say them: "Wren", "Wren and Rex", "Wren, Rex and Sam", and from four on
 * "Wren, Rex and 2 more".
 */
export function joinNames(names: string[]): string {
  const list = names.map((n) => shownName(n) ?? "Someone");
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} more`;
}

export interface OthersNotice {
  /** "Wren and Rex" */
  names: string;
  /** "has" for one person, "have" for several. */
  verb: "has" | "have";
  /** How long ago the earliest of them began, "2 hours ago". */
  since: string;
  /** "Wren has unsaved changes to this entry" */
  headline: string;
  /** ", since 2 hours ago." (or just ".") */
  tail: string;
  /** The whole sentence. */
  text: string;
}

/**
 * The notice for an entry others have unsaved changes to. Never says what they wrote. With
 * several people, the time is when the first of them began.
 */
export function othersNotice(
  people: readonly Pick<OtherUnsaved, "name" | "since">[],
  now: number = Date.now(),
): OthersNotice | null {
  if (people.length === 0) return null;
  const names = joinNames(people.map((p) => p.name));
  const earliest = people.reduce((a, b) => (new Date(b.since) < new Date(a.since) ? b : a));
  const since = whenText(earliest.since, now);
  const verb = people.length === 1 ? "has" : "have";
  const lead = people.length === 1 ? "since" : "the first since";
  const headline = `${names} ${verb} unsaved changes to this entry`;
  const tail = since ? `, ${lead} ${since}.` : ".";
  return { names, verb, since, headline, tail, text: headline + tail };
}

/** What the editor adds: what will happen when both want to save. */
export const SAVE_SECOND_COMPARES =
  "You can still edit. Whoever saves second compares the two texts before anything is kept.";

/** "Wren is also here", "Wren and Rex are also here". */
export function readingText(people: readonly Pick<Reading, "name">[]): string {
  if (people.length === 0) return "";
  return `${joinNames(people.map((p) => p.name))} ${people.length === 1 ? "is" : "are"} also here`;
}

/** The status's list of people with unsaved changes, by entry path. */
export function othersByPath(
  list: { path: string; people: OtherUnsaved[] }[] | undefined,
): Map<string, OtherUnsaved[]> {
  return new Map((list ?? []).map((o) => [o.path, o.people]));
}

/** People reading one entry, once each (a person in two tabs is one). */
export function readersOf(
  presence: readonly Reading[] | undefined,
  path: string,
): Pick<Reading, "id" | "name">[] {
  const seen = new Set<string>();
  const out: Pick<Reading, "id" | "name">[] = [];
  for (const r of presence ?? []) {
    if (r.path !== path || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: r.name });
  }
  return out;
}

/**
 * What a removal or a leaving says about the unsaved changes the person left in the project: how
 * many are kept, and for how long. Empty when there are none.
 */
export function keptText(
  kept: { unsavedKept: number; keptDays: number } | undefined,
  whose: "their" | "your",
): string {
  if (!kept || kept.unsavedKept <= 0) return "";
  const n = kept.unsavedKept;
  const days = `${kept.keptDays} ${kept.keptDays === 1 ? "day" : "days"}`;
  const things = `${n} unsaved ${n === 1 ? "change is" : "changes are"}`;
  return whose === "their"
    ? `${things} kept for ${days}, and come back if they rejoin in that time.`
    : `${things} kept for ${days}, and come back if you rejoin in that time.`;
}
