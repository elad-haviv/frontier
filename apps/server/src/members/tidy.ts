import type { Server } from "../server.js";

/**
 * Housekeeping for the invitations (`InviteStore.tidy`), with what the project list says: whether a
 * link's maker is still an owner of its project, and who joined a project when a claim was left
 * unsettled. Run at startup and whenever an owner reads the list.
 */
export async function tidyInvites(server: Server): Promise<void> {
  const projects = await server.projects.all();
  const find = (id: string) => projects.find((p) => p.id === id);
  await server.invites.tidy({
    isOwner: (projectId, personId) =>
      find(projectId)?.members.some((m) => m.personId === personId && m.role === "owner") ?? false,
    // Someone who came into the project with that role after the claim, other than the link's
    // maker: that is who the cut-off use was for.
    memberSince: (invite) =>
      find(invite.projectId)?.members.find(
        (m) =>
          m.addedAt >= (invite.usedAt ?? "") &&
          m.role === invite.role &&
          m.personId !== invite.createdBy,
      )?.personId ?? null,
  });
}
