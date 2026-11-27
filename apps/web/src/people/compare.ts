/**
 * The compare screen's data and words (stage 27d, decision C). Two people changed one entry; the
 * second to save compares the two texts and chooses. These are the pure parts: turning what the
 * server sends into one shape, what each choice sends, and the sentences.
 */
import type { DraftCompareResponse, PublishPlan } from "@frontier/schema";
import { shownName, whenText } from "./model.ts";

type PlannedConflict = PublishPlan["conflicts"][number];
type PlannedMerge = PublishPlan["merges"][number];

/** What the compare screen holds: a plan's conflict or merge, or the compare call's answer. */
export interface Clash {
  draftId: string;
  path: string;
  reason: PlannedConflict["reason"] | "merge";
  /** The person's own text. */
  mine: string;
  /** The saved version's text; null when there is no file (it was deleted). */
  theirs: string | null;
  base: string | null;
  /** Who saved the version `theirs` is, when, and its blob (sent back when resolving). */
  theirsName: string | null;
  theirsAt: string | null;
  theirsBlob: string | null | undefined;
  /** The two changes combined, when they merge cleanly. */
  mergedText: string | undefined;
}

export function clashOfConflict(c: PlannedConflict): Clash {
  return {
    draftId: c.draftId,
    path: c.path,
    reason: c.reason,
    mine: c.mine,
    theirs: c.theirs,
    base: c.base,
    theirsName: shownName(c.theirsBy?.name),
    theirsAt: c.theirsAt ?? null,
    theirsBlob: c.theirsBlob,
    mergedText: c.mergedText,
  };
}

export function clashOfMerge(m: PlannedMerge, mine: string): Clash {
  return {
    draftId: m.draftId,
    path: m.path,
    reason: "merge",
    mine,
    theirs: m.mainText,
    base: m.baseText,
    theirsName: shownName(m.theirsBy?.name),
    theirsAt: m.theirsAt ?? null,
    theirsBlob: m.theirsBlob,
    mergedText: m.mergedText,
  };
}

/** The clash a compare answer holds, or null when nothing differs any more. */
export function clashOfCompare(a: DraftCompareResponse, mine: string): Clash | null {
  if (a.outcome === "conflict" && a.conflict) return clashOfConflict(a.conflict);
  if (a.outcome === "merge" && a.merge) return clashOfMerge(a.merge, mine);
  return null;
}

export type Choice = "mine" | "theirs" | "merged";

/** The text a choice resolves with. "Keep mine" is the person's own text. */
export function textFor(choice: Choice, clash: Clash, merged: string): string {
  if (choice === "mine") return clash.mine;
  if (choice === "theirs") return clash.theirs ?? "";
  return merged;
}

/** What the "merged" choice starts from: the combined text when there is one, else their own. */
export const startOfMerged = (clash: Clash): string => clash.mergedText ?? clash.mine;

/** "Wren", or "Someone" when the server does not say who. */
export const whoText = (clash: Pick<Clash, "theirsName">): string => clash.theirsName ?? "Someone";

/** The clock time of today's, else the date: "14:02" or "3 Nov, 14:02". */
export function clockText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** "Wren saved this at 14:02": the title over their text. */
export function theirsTitle(clash: Clash, now?: Date): string {
  const at = clockText(clash.theirsAt, now);
  return `${whoText(clash)} saved this${at ? ` at ${at}` : ""}`;
}

/** Said when a save found that someone saved a newer version first. */
export function savedByOtherText(clash: Pick<Clash, "theirsName" | "theirsAt">): string {
  const who = shownName(clash.theirsName) ?? "Someone";
  const at = whenText(clash.theirsAt ?? "");
  return `${who} saved a newer version of this entry${at && at !== "just now" ? ` ${at}` : ""}, while you were working on it. Compare the two and choose.`;
}

/** Said when the choice was refused because they saved again while the person was comparing. */
export function savedAgainText(name: string | null): string {
  return `${shownName(name) ?? "Someone"} saved again while you were comparing. Nothing was changed. Their newest version is below, and your text is still here: compare again and choose.`;
}

/** What a partial save says: which entries went in, and which need comparing. */
export function partialSaveText(
  saved: string[],
  waiting: { path: string }[],
  own: boolean,
): string {
  const verb = own ? "saved" : "published";
  const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;
  const names = (list: string[]) => list.map(nameOfPath).join(", ");
  const left = waiting.map((w) => w.path);
  const head = `${saved.length === 0 ? "Nothing" : `${entries(saved.length)} ${verb}`}${saved.length > 0 ? ` (${names(saved)})` : ""}.`;
  const rest = `${entries(left.length)} ${left.length === 1 ? "needs" : "need"} comparing, because someone saved a newer version first: ${names(left)}.`;
  return `${head} ${rest}`;
}

const nameOfPath = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

const STATIC_REASON: Record<string, string> = {
  overlap: "You and someone else changed the same lines.",
  delete_of_changed_file: "This file was changed in the vault after you chose to delete it.",
  binary_changed_on_both: "This image was changed in both places.",
  chronicle_changed_on_both:
    "This chronicle was changed here and in the library in the same places. Keep one of the two.",
  map_changed_on_both:
    "This map was changed here and in the vault in the same places. Keep one of the two.",
  rename_blocked: "This rename cannot be carried out.",
  map_styles_changed_on_both:
    "The map styles were changed here and in the vault in the same places. Keep one of the two.",
  biomes_changed_on_both:
    "The biomes were changed here and in the vault in the same places. Keep one of the two.",
};

/** The reason for a library file's clash, named by the file. */
export const libraryReason = (noun: string): string =>
  `The ${noun} were changed here and in the vault in the same places. Keep one of the two.`;

/**
 * Why a change was held back, in words, naming the other person where the server did. Undefined
 * for a reason this table does not know, so a page shows nothing rather than a wrong sentence.
 */
export function reasonOf(c: {
  reason: string;
  theirsBy?: { name: string } | null | undefined;
  theirsAt?: string | null | undefined;
}): string | undefined {
  const who = shownName(c.theirsBy?.name);
  const at = clockText(c.theirsAt ?? null);
  const when = at ? ` (${at})` : "";
  switch (c.reason) {
    case "saved_by_other":
      return savedByOtherText({ theirsName: who, theirsAt: c.theirsAt ?? null });
    case "deleted_on_main":
      return who
        ? `${who} deleted this entry${when} while you were working on it. Your text is kept here.`
        : "This entry was deleted from the library while you were working on it. Your text is kept here.";
    case "created_on_main":
      return who
        ? `${who} added an entry with this name${when} while you were writing yours.`
        : "A file with this name was added to the vault meanwhile.";
    default:
      return STATIC_REASON[c.reason];
  }
}
