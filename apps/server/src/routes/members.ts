import {
  ChangeRoleRequest,
  CreateInviteRequest,
  type CreateInviteResponse,
  type InvitesResponse,
  type MembersResponse,
  AWAY_KEEP_DAYS,
  type RemoveMemberResponse,
} from "@frontier/schema";
import { z } from "zod";
import { personOf } from "../auth/session.js";
import { ApiError } from "../errors.js";
import { isUnconfirmed } from "../mail/accounts.js";
import { checkInviteAddress, emailInvite, takeInviteMail } from "../mail/invite.js";
import { displayName, nameOf } from "../members/names.js";
import { tidyInvites } from "../members/tidy.js";
import type { RouteApp } from "../projects/facade.js";
import type { Services } from "../projects/services.js";

const PersonParam = z.object({ id: z.string().min(1).max(100) });
const InviteParam = z.object({ id: z.string().min(1).max(100) });

/**
 * Members and invitation links of the project (stage 31c). Anyone in the project reads the list
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
          unconfirmed: owner ? isUnconfirmed(s.server, person) : null,
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

  app.delete("/api/members/:id", async (request): Promise<RemoveMemberResponse> => {
    const project = here(request);
    const { id } = PersonParam.parse(request.params);
    // How many unsaved changes they leave, told to the owner who removes them: counted before, so
    // the answer is right whatever the watchers then do. They are kept for 30 days.
    const unsavedKept = s.drafts.unsavedOf(id);
    // What the person wrote stays: versions are the library's, and nothing here touches them.
    await s.server.projects.removeMember(project.record.id, id);
    return { ok: true, unsavedKept, keptDays: AWAY_KEEP_DAYS };
  });

  /** Any member leaves for themselves; the last owner cannot. */
  app.post("/api/members/leave", async (request): Promise<RemoveMemberResponse> => {
    const project = here(request);
    const unsavedKept = s.drafts.unsavedOf(personOf(request).id);
    await s.server.projects.removeMember(project.record.id, personOf(request).id);
    return { ok: true, unsavedKept, keptDays: AWAY_KEEP_DAYS };
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
          sentTo: i.email ?? null,
          mail: i.email ? (i.mail ?? null) : null,
        })),
      ),
    };
  });

  /** The answer for a made link, with what became of its email. The code is only ever given here. */
  const madeLink = (
    invite: {
      id: string;
      role: CreateInviteResponse["role"];
      expiresAt: string;
      email?: string | undefined;
    },
    code: string,
    mail: "sent" | "failed" | null,
  ): CreateInviteResponse => {
    const path = `/join/${code}`;
    return {
      id: invite.id,
      code,
      path,
      url: `${s.server.config.publicUrl.replace(/\/+$/, "")}${path}`,
      role: invite.role,
      expiresAt: invite.expiresAt,
      sentTo: invite.email ?? null,
      mail,
    };
  };

  app.post("/api/invites", async (request, reply): Promise<CreateInviteResponse> => {
    const project = here(request);
    const { role, email } = CreateInviteRequest.parse(request.body);
    if (email !== undefined) checkInviteAddress(s.server, personOf(request).id, email);
    const { invite, code, proof } = await s.server.invites.create({
      projectId: project.record.id,
      role,
      createdBy: personOf(request).id,
      ...(email !== undefined ? { email } : {}),
    });
    // The code appears in this answer and nowhere else, and is not logged.
    reply.status(201).header("cache-control", "no-store");
    const mail =
      email !== undefined && proof !== null
        ? await emailInvite(s.server, invite, code, proof, (await current(project.record.id)).name)
        : null;
    return madeLink(invite, code, mail);
  });

  /**
   * Resend: the old link is cancelled, a new one is made for the same role and address, and it is
   * emailed. Only a link that was emailed and still waits can be resent.
   */
  app.post("/api/invites/:id/resend", async (request, reply): Promise<CreateInviteResponse> => {
    const project = here(request);
    const { id } = InviteParam.parse(request.params);
    if (!s.server.mail.enabled) throw new ApiError("mail_off", "This server cannot send email.");
    // A link that cannot be resent is told so before anything is taken from an allowance.
    const old = await s.server.invites.checkResendable(project.record.id, id);
    takeInviteMail(s.server, personOf(request).id, old.email ?? "");
    const { invite, code, proof } = await s.server.invites.replace(
      project.record.id,
      id,
      personOf(request).id,
    );
    reply.status(201).header("cache-control", "no-store");
    const mail = await emailInvite(
      s.server,
      invite,
      code,
      proof,
      (await current(project.record.id)).name,
    );
    return madeLink(invite, code, mail);
  });

  app.delete("/api/invites/:id", async (request): Promise<{ ok: true }> => {
    const project = here(request);
    const { id } = InviteParam.parse(request.params);
    await s.server.invites.cancel(project.record.id, id);
    return { ok: true };
  });
}
