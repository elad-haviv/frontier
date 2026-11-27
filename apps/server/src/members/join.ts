import type { InviteRecord, Person, ProjectRecord, ProjectRole } from "@frontier/schema";
import { ApiError } from "../errors.js";
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
 */
export function joinAsNewPerson(server: Server, code: string, account: NewPerson): Promise<Joined> {
  return server.joins.run(async () => {
    const { invite, project } = await liveInvite(server, code);
    if (account.email && (await server.people.byEmail(account.email))) throw accountExists();
    await claim(server, code, invite);
    let person: Person;
    try {
      person = await server.people.create(account);
    } catch (err) {
      await server.invites.release(invite.id).catch(() => undefined);
      throw err instanceof ApiError && err.code === "email_taken" ? accountExists() : err;
    }
    try {
      await server.projects.addMember(project.id, person.id, invite.role);
    } catch (err) {
      // All or nothing: the account made a moment ago goes, and the link is given back. Neither
      // step may hide the error that started this.
      await server.people.remove(person.id).catch(() => undefined);
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
 * Puts an existing account in the invitation's project. A person who is already a member is told
 * so (`already_member`) and the link is NOT used up, so the owner can give it to someone else.
 */
export function joinAsExistingPerson(
  server: Server,
  code: string,
  person: Person,
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
    return {
      person,
      project: (await server.projects.get(project.id)) ?? project,
      role: invite.role,
    };
  });
}
