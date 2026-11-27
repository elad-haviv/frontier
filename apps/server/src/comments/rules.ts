/**
 * Who may do what with a comment (stage 27e). One place, so the routes and the tests say the same.
 *
 *   read            everyone in the project reads the comments of saved entries; a comment for the
 *                   AI is its author's alone
 *   comment, reply  every role
 *   edit            the words of your own comment or reply, nobody else's (an owner's too)
 *   delete          your own; an owner may delete anyone's
 *   resolve/reopen  the thread's author, any writer, any owner (not other readers)
 *   for the AI      writers and owners, on their own comments
 *   legacy          a comment from before people (a note kept when only writers and owners read
 *                   comments) is seen by writers and owners only, whether it is for the AI or not,
 *                   until its author or an owner shares it with everyone
 */
import { type ProjectRole, roleAtLeast } from "@frontier/schema";
import type { Comment, Reply } from "./store.js";

export interface Who {
  id: string;
  role: ProjectRole;
}

export const canSee = (c: Comment, me: Who): boolean =>
  c.legacy ? roleAtLeast(me.role, "writer") : c.for !== "ai" || c.person === me.id;

/** Sharing an old, writers-only comment with everyone: its shown author, when a writer, or an owner. */
export const canShare = (c: Comment, me: Who): boolean =>
  !!c.legacy && (me.role === "owner" || (c.person === me.id && roleAtLeast(me.role, "writer")));

export const canEdit = (x: Comment | Reply, me: Who): boolean => x.person === me.id;

export const canDelete = (x: Comment | Reply, me: Who): boolean =>
  x.person === me.id || me.role === "owner";

export const canResolve = (c: Comment, me: Who): boolean =>
  c.person === me.id || roleAtLeast(me.role, "writer");

/** Giving a comment to the AI and taking it back: its author, when they may use the writing help. */
export const canHand = (c: Comment, me: Who): boolean =>
  c.person === me.id && roleAtLeast(me.role, "writer");
