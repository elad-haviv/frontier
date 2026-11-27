import {
  ChangeRoleRequest,
  CreateInviteRequest,
  type CreateInviteResponse,
  type InvitesResponse,
  type MembersResponse,
} from "@frontier/schema";
import { z } from "zod";
import { personOf } from "../auth/session.js";
import { ApiError } from "../errors.js";
import { displayName, nameOf } from "../members/names.js";
import { tidyInvites } from "../members/tidy.js";
import type { RouteApp } from "../projects/facade.js";
import type { Services } from "../projects/services.js";

const PersonParam = z.object({ id: z.string().min(1).max(100) });
const InviteParam = z.object({ id: z.string().min(1).max(100) });

/**
 * Members and invitation links of the project (stage 27c). Anyone in the project reads the list
 * (names and roles; emails go to owners only); owners change roles, remove people and make
 * invitations; any member may leave. The rule that a project keeps an owner is the store's, checked
 * inside its serialized change. These routes have no alias at an old address.
 */
export function memberRoutes(app: RouteApp, s: Services): void {
  const here = (request: { project: { record: { id: string }; role: string } | null }) => {
    if (!request.project) throw new ApiError("no_project", "There is no such project.");
    return request.project;
  };
  /** The record as it is now, not as it was when the request began. */
  const current = async (id: string) => {
    const record = await s.server.projects.get(id);
    if (!record) throw new ApiError("no_project", "There is no such project.");
    return record;
  };

  app.get("/api/members", async (request): Promise<MembersResponse> => {
    const project = here(request);
    const me = personOf(request);
    const record = await current(project.record.id);
    const owner = project.role === "owner";
    const members = await Promise.all(
      record.members.map(async (m) => {
        const person = await s.server.people.get(m.personId);
        return {
          id: m.personId,
          name: displayName(person, owner),
          email: owner ? (person?.email ?? "") : null,
          role: m.role,
          addedAt: m.addedAt,
          lastActiveAt: m.lastActiveAt ?? null,
          you: m.personId === me.id,
        };
      }),
    );
    return { members, canManage: owner };
  });

  app.put("/api/members/:id", async (request): Promise<{ ok: true }> => {
    const project = here(request);
    const { id } = PersonParam.parse(request.params);
    const { role } = ChangeRoleRequest.parse(request.body);
    await s.server.projects.setRole(project.record.id, id, role);
    return { ok: true };
  });

  app.delete("/api/members/:id", async (request): Promise<{ ok: true }> => {
    const project = here(request);
    const { id } = PersonParam.parse(request.params);
    // What the person wrote stays: versions are the library's, and nothing here touches them.
    await s.server.projects.removeMember(project.record.id, id);
    return { ok: true };
  });

  /** Any member leaves for themselves; the last owner cannot. */
  app.post("/api/members/leave", async (request): Promise<{ ok: true }> => {
    const project = here(request);
    await s.server.projects.removeMember(project.record.id, personOf(request).id);
    return { ok: true };
  });

  app.get("/api/invites", async (request): Promise<InvitesResponse> => {
    const project = here(request);
    await tidyInvites(s.server);
    const at = s.server.invites.now().getTime();
    const waiting = await s.server.invites.waiting(project.record.id);
    return {
      invites: await Promise.all(
        waiting.map(async (i) => ({
          id: i.id,
          role: i.role,
          createdBy: { id: i.createdBy, name: await nameOf(s.server, i.createdBy, true) },
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          secondsLeft: Math.max(0, Math.floor((Date.parse(i.expiresAt) - at) / 1000)),
        })),
      ),
    };
  });

  app.post("/api/invites", async (request, reply): Promise<CreateInviteResponse> => {
    const project = here(request);
    const { role } = CreateInviteRequest.parse(request.body);
    const { invite, code } = await s.server.invites.create({
      projectId: project.record.id,
      role,
      createdBy: personOf(request).id,
    });
    // The code appears in this answer and nowhere else, and is not logged.
    reply.status(201).header("cache-control", "no-store");
    const path = `/join/${code}`;
    return {
      id: invite.id,
      code,
      path,
      url: `${s.server.config.publicUrl.replace(/\/+$/, "")}${path}`,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
  });

  app.delete("/api/invites/:id", async (request): Promise<{ ok: true }> => {
    const project = here(request);
    const { id } = InviteParam.parse(request.params);
    await s.server.invites.cancel(project.record.id, id);
    return { ok: true };
  });
}
