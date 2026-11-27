import type { InviteRecord } from "@frontier/schema";
import { ApiError } from "../errors.js";
import { displayName } from "../members/names.js";
import type { Server } from "../server.js";
import { linkTo } from "./accounts.js";
import { mailable, MailError } from "./mailer.js";
import { inviteMail } from "./templates.js";

/**
 * Refuses an address for an emailed invitation before anything is made: the server must send
 * mail, and the address must be one mail can go to. Counts one mail against the address.
 */
export function checkInviteAddress(server: Server, email: string, key: string): void {
  if (!server.mail.enabled) throw new ApiError("mail_off", "This server cannot send email.");
  if (!mailable(email)) throw new ApiError("invalid", "That doesn't look like an email address.");
  server.mailLimit.attempt(key);
}

/**
 * Emails an invitation link and records what became of it. A failure is not an error: the link
 * exists and is shown to its maker either way.
 */
export async function emailInvite(
  server: Server,
  invite: InviteRecord,
  code: string,
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
        url: linkTo(server, `/join/${code}`),
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
