import {
  emailKey,
  type InviteRecord,
  type Person,
  type ProjectRecord,
  type ProjectRole,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import { canDisplace, sendConfirm } from "../mail/accounts.js";
import { confirmedOf } from "../state/people.js";
import type { NewPerson } from "../state/people.js";
import type { Server } from "../server.js";
import { stateOf } from "./invites.js";
import { nameOf } from "./names.js";

/** Runs one piece of work after another, so the steps of two joins never interleave. */
export class Turn {
  private last: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const run = this.last.then(work);
    this.last = run.catch(() => undefined);
    return run;
  }
}

/** What the page is told for an email that has an account already. No name, no hint of which. */
export const accountExists = () =>
  new ApiError(
    "account_exists",
    "You may already have an account with this email. Log in to join with it.",
  );

export interface LiveInvite {
  invite: InviteRecord;
  project: ProjectRecord;
}

/**
 * The invitation a code belongs to, if it still works; otherwise the typed answer that says why:
 * `invite_unknown` (nothing said about anyone), or used, cancelled or expired, each naming the
 * person who made the link so the page can say whom to ask. The server's own clock decides.
 */
export async function liveInvite(server: Server, code: string): Promise<LiveInvite> {
  const invite = await server.invites.byCode(code);
  if (!invite) throw new ApiError("invite_unknown", "This invitation link is not valid.");
  const project = await server.projects.get(invite.projectId);
  const state = stateOf(invite, server.invites.now());
  const inviter = await nameOf(server, invite.createdBy);
  const ask = `Ask ${inviter} for a new one.`;
  // A link made by someone who has since stopped being an owner of the project is no longer good,
  // however it came to still be waiting.
  const makerIsOwner = project?.members.some(
    (m) => m.personId === invite.createdBy && m.role === "owner",
  );
  if (state === "waiting" && !makerIsOwner) {
    throw new ApiError("invite_cancelled", `This link was cancelled. ${ask}`, { inviter });
  }
  if (state === "used") {
    throw new ApiError("invite_used", `This link has already been used. ${ask}`, { inviter });
  }
  // A link for a project that has since been deleted can never be used.
  if (state === "cancelled" || !project) {
    throw new ApiError("invite_cancelled", `This link was cancelled. ${ask}`, { inviter });
  }
  if (state === "expired") {
    throw new ApiError("invite_expired", `This link has run out (links last 7 days). ${ask}`, {
      inviter,
    });
  }
  return { invite, project };
}

export interface Joined {
  person: Person;
  project: ProjectRecord;
  role: ProjectRole;
}

/** Claims the invitation. When another request got there first, says why it no longer works. */
async function claim(server: Server, code: string, invite: InviteRecord): Promise<void> {
  try {
    await server.invites.claim(invite.id);
  } catch (err) {
    // Cancelled (or used) in the instant between the check and the claim: say it as the check would.
    await liveInvite(server, code);
    throw err;
  }
}

/**
 * Makes an account for someone new and puts them in the invitation's project with its role, and
 * uses the invitation up: all or nothing, one after another with every other join. The email is
 * checked before the link is touched, so a refused email leaves the link as it was.
 *
 * Stage 32: an address counts as confirmed when Google verified it (`google`), or when the
 * invitation was emailed to exactly this address AND the join carries the proof that is only in
 * the emailed link (`proof`, constant-time); the owner who made the invitation has the link, not
 * the proof, and a join without it gets a confirm link like any other address. A Google-verified
 * person whose address is an UNCONFIRMED account's takes it, but only when that account's confirm
 * link was sent and ran out unopened and it can still log in without an address (see
 * `mayDisplace`); any other account with the address is still `account_exists`.
 */
export function joinAsNewPerson(
  server: Server,
  code: string,
  account: NewPerson,
  options: { google?: boolean; proof?: string | undefined } = {},
): Promise<Joined> {
  return server.joins.run(async () => {
    const { invite, project } = await liveInvite(server, code);
    const existing = account.email ? await server.people.byEmail(account.email) : null;
    const displace = options.google === true && existing !== null && canDisplace(server, existing);
    if (existing && !displace) throw accountExists();
    const now = new Date().toISOString();
    const emailed =
      !!invite.email &&
      !!account.email &&
      emailKey(invite.email) === emailKey(account.email) &&
      server.invites.proofMatches(invite, options.proof);
    const confirmed = options.google
      ? ({ emailConfirmedAt: now, emailConfirmedBy: "google" } as const)
      : emailed
        ? ({ emailConfirmedAt: now, emailConfirmedBy: "invite" } as const)
        : {};
    await claim(server, code, invite);
    let person: Person;
    let gaveUp: Person | undefined;
    try {
      person = await server.people.create(
        { ...account, ...confirmed },
        { displaceUnconfirmed: displace, onDisplaced: (before) => (gaveUp = before) },
      );
    } catch (err) {
      await server.invites.release(invite.id).catch(() => undefined);
      throw err instanceof ApiError && err.code === "email_taken" ? accountExists() : err;
    }
    try {
      await server.projects.addMember(project.id, person.id, invite.role);
    } catch (err) {
      // All or nothing: the account made a moment ago goes (and the one that gave up its address
      // gets it back), and the link is given back. No step may hide the error that started this.
      await server.people.remove(person.id, gaveUp).catch(() => undefined);
      await server.invites.release(invite.id).catch(() => undefined);
      throw err;
    }
    await server.invites.settle(invite.id, person.id);
    return {
      person,
      project: (await server.projects.get(project.id)) ?? project,
      role: invite.role,
    };
  });
}

/**
 * After someone joined with a password or a passkey: an address nobody has confirmed gets a
 * confirm link. It goes on after the answer, and never fails the join.
 */
export function confirmAfterJoin(server: Server, person: Person): void {
  if (!server.mail.enabled || person.email.trim() === "" || confirmedOf(person)) return;
  server.mail.background(() =>
    sendConfirm(server, person.id, person.email, { pending: false, quiet: true }),
  );
}

/**
 * Puts an existing account in the invitation's project. A person who is already a member is told
 * so (`already_member`) and the link is NOT used up, so the owner can give it to someone else.
 */
export function joinAsExistingPerson(
  server: Server,
  code: string,
  person: Person,
  proof?: string,
): Promise<Joined> {
  return server.joins.run(async () => {
    const { invite, project } = await liveInvite(server, code);
    if (project.members.some((m) => m.personId === person.id)) {
      throw new ApiError("already_member", `You are already in ${project.name}.`, {
        project: project.slug,
      });
    }
    await claim(server, code, invite);
    try {
      await server.projects.addMember(project.id, person.id, invite.role);
    } catch (err) {
      await server.invites.release(invite.id).catch(() => undefined);
      throw err;
    }
    await server.invites.settle(invite.id, person.id);
    // The invitation was emailed to this very address and this request has the proof from that
    // email: the address is the person's, so an unconfirmed one is confirmed.
    let joined = person;
    if (
      invite.email &&
      server.invites.proofMatches(invite, proof) &&
      emailKey(invite.email) === emailKey(person.email) &&
      confirmedOf(person) === null
    ) {
      joined = await server.people
        .update(person.id, (p) =>
          emailKey(p.email) === emailKey(invite.email ?? "") && confirmedOf(p) === null
            ? {
                ...p,
                emailConfirmedAt: new Date().toISOString(),
                emailConfirmedBy: "invite" as const,
              }
            : p,
        )
        .catch(() => person);
    }
    return {
      person: joined,
      project: (await server.projects.get(project.id)) ?? project,
      role: invite.role,
    };
  });
}
