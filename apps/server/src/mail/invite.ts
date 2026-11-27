import type { InviteRecord } from "@frontier/schema";
import { ApiError } from "../errors.js";
import { displayName } from "../members/names.js";
import type { Server } from "../server.js";
import { linkTo } from "./accounts.js";
import { mailable, MailError, recipientKey } from "./mailer.js";
import { inviteMail } from "./templates.js";

/**
 * Takes one emailed invitation from what a person may send in an hour (20, new and resent
 * together) and one mail from the address's allowance (counted without any `+tag`).
 */
export function takeInviteMail(server: Server, actorId: string, address: string): void {
  server.inviteMailLimit.attempt(actorId);
  server.mailLimit.attempt(recipientKey(address));
}

/**
 * Refuses an address for an emailed invitation before anything is made: the server must send
 * mail, and the address must be one mail can go to. Then counts the mail.
 */
export function checkInviteAddress(server: Server, actorId: string, email: string): void {
  if (!server.mail.enabled) throw new ApiError("mail_off", "This server cannot send email.");
  if (!mailable(email)) throw new ApiError("invalid", "That doesn't look like an email address.");
  takeInviteMail(server, actorId, email);
}

/**
 * Emails an invitation link (with its proof, `?m=`) and records what became of it. A failure is not an error: the link
 * exists and is shown to its maker either way.
 */
export async function emailInvite(
  server: Server,
  invite: InviteRecord,
  code: string,
  proof: string,
  projectName: string,
): Promise<"sent" | "failed"> {
  let mail: "sent" | "failed" = "sent";
  try {
    const inviter = displayName(await server.people.get(invite.createdBy));
    await server.mail.send({
      to: invite.email ?? "",
      ...inviteMail({
        from: server.mail.sender!,
        inviter,
        project: projectName,
        role: invite.role,
        // The proof is in this link and nowhere else, so joining with it shows the mail was read.
        url: linkTo(server, `/join/${code}?m=${proof}`),
        expiresAt: invite.expiresAt,
      }),
    });
  } catch (err) {
    if (!(err instanceof MailError)) throw err;
    mail = "failed";
  }
  await server.invites.setMail(invite.id, mail).catch(() => undefined);
  return mail;
}
