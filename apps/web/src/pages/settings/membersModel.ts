/**
 * The words of Settings → Members (stage 27c), kept apart from the page so they can be tested:
 * how long an invite link has left, when a person was last here, what a role may do, and what
 * the server's refusals mean for the person reading them.
 */
import type { MemberRow, ProjectRole } from "@frontier/schema";

/** What each role may do, in the key under the invite box and on the join page. */
export const ROLE_MAY: Record<ProjectRole, string> = {
  owner:
    "Everything a writer does, plus members, invite links, project settings and deleting the project.",
  writer: "Writes entries, maps and chronicles, saves versions, and uses the AI help.",
  reader: "Reads, searches, asks the lore and talks with characters. Cannot change anything.",
};

/** The roles in the order a select lists them: the least first, so the safe choice is first. */
export const ROLE_ORDER: ProjectRole[] = ["reader", "writer", "owner"];

/** "6 days left", "5 hours left", "40 minutes left", "less than a minute left". */
export function timeLeft(seconds: number): string {
  if (seconds <= 0) return "no time left";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "less than a minute left";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  const days = Math.floor(hours / 24);
  return `${days} days left`;
}

/** When a person last used the project: kept by the server to within a few minutes. */
export function lastActive(iso: string | null, now = Date.now()): string {
  if (!iso) return "not here since joining";
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 15 * 60) return "active just now";
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return "active this hour";
  if (hours < 24) return `active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "active yesterday";
  if (days < 14) return `active ${days} days ago`;
  return `active ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** "a Writer", "an Owner". */
export const withArticle = (word: string): string =>
  `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

/** Why the last owner cannot step down, leave or be removed, in words for the person. */
export const LAST_OWNER =
  "A project always needs an owner. Make someone else an owner first, then this can be done.";

/** Whether this row is the only owner of the project. */
export function isOnlyOwner(
  member: Pick<MemberRow, "role">,
  all: readonly Pick<MemberRow, "role">[],
): boolean {
  return member.role === "owner" && all.filter((m) => m.role === "owner").length === 1;
}

/** The sentence under the list: how many people, in plain words. */
export function peopleLine(count: number, project: string, owner: boolean): string {
  if (count <= 1) return owner ? "Only you so far. Invite someone below." : "Only you so far.";
  return `${count} people can open ${project}.`;
}
