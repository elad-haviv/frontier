/**
 * The words of the join page and of the Google problems (stage 27c), as plain functions so they
 * can be tested: what a dead link says, who to ask, what each `problem` of a Google trip means.
 */
import type { ProjectRole } from "@frontier/schema";

/** Where the Google trip went wrong, as the server says it in `?problem=` of `/login` and `/join/<code>`. */
const GOOGLE: Record<string, string> = {
  google_no_account:
    "That Google account has no Frontier account yet. You need an invite link from a project's owner.",
  google_denied: "Google sign-in was cancelled. You can try again, or use another way.",
  google_failed:
    "Google did not confirm who you are, or could not be reached. Try again, or use another way.",
  google_unverified:
    "Google has not verified that email address, so Frontier cannot use it. Use another Google account, or another way.",
  google_expired: "That Google sign-in took too long, or was already used. Start it again.",
  google_off: "Signing in with Google is not available on this server.",
  // Linking from Settings → Signing in.
  google_taken:
    "That Google account belongs to another person on this server, so it cannot be added to yours.",
  google_already_linked:
    "This account already has a Google account linked. Unlink it first to use another.",
  recent_login_needed: "Linking Google asks for a login from the last few minutes.",
};

/** What a `problem` value of a Google trip says, or null for one that is not known. */
export function googleProblem(problem: string | null): string | null {
  if (!problem) return null;
  return GOOGLE[problem] ?? null;
}

/** `account_exists` on a join trip that started with Google: the account is not linked to that Google identity. */
export const ACCOUNT_EXISTS =
  "You may already have an account here: log in to join. Your name and email are kept for the invitation.";

/** The sentence for a link that does not work, with who to ask. */
export interface DeadLink {
  title: string;
  body: string;
}

/**
 * What the page says for each way a link can be dead. `inviter` is the name of the person who
 * made it, when the server gave one.
 */
export function deadLink(code: string, inviter: string | undefined): DeadLink | null {
  const ask = inviter ? inviter : "an owner of the project";
  switch (code) {
    case "invite_used":
      return {
        title: "This invite link was already used",
        body: `Each link works once. If you did not use it yourself, ask ${ask} for a new one.`,
      };
    case "invite_cancelled":
      return {
        title: "This invitation was cancelled",
        body: `It was taken back, or the project no longer exists. Ask ${ask} for a new link.`,
      };
    case "invite_expired":
      return {
        title: "This invite link has run out",
        body: `A link works for 7 days. Ask ${ask} for a new one.`,
      };
    case "invite_unknown":
      return {
        title: "This link does not work",
        body: "No invitation has this address. The link may have been cut short when it was copied. Ask the person who sent it for the whole link.",
      };
    default:
      return null;
  }
}

/** The heading: who invited you, to what, and as what. */
export function inviteHeading(inviter: string, project: string, role: ProjectRole): string {
  const to = role === "owner" ? "own" : role === "writer" ? "write in" : "read";
  return `${inviter || "Someone"} invited you to ${to} ${project}`;
}

/** What the role allows, in one line for the join page. */
export const ROLE_ALLOWS: Record<ProjectRole, string> = {
  owner:
    "As an owner you can do everything a writer can, and change members, invite links and settings, and delete the project.",
  writer: "As a writer you can read and change entries, maps and chronicles, and save versions.",
  reader:
    "As a reader you can read everything, search, ask the lore and talk with characters. You cannot change anything.",
};

/** The counts under the project's name: "214 entries · 6 maps · 3 people", leaving out what is not counted. */
export function projectCounts(p: {
  entries: number | null;
  maps: number | null;
  people: number;
}): string {
  const part = (n: number | null, one: string, many: string) =>
    n === null ? null : `${n} ${n === 1 ? one : many}`;
  return [
    part(p.entries, "entry", "entries"),
    part(p.maps, "map", "maps"),
    part(p.people, "person", "people"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The note about AI keys that comes with every invitation. */
export const AI_KEY_NOTE =
  "Frontier's AI help runs on your own AI key, which you add after joining. It stays on your device.";

/** What to say for a failure that is not a dead link: rate limit and the rest, in plain words. */
export function joinFailure(code: string, message: string): string {
  if (code === "rate_limited")
    return "Too many tries from this address. Wait a few minutes, then try again.";
  return message;
}
