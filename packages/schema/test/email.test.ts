import { describe, expect, it } from "vitest";
import {
  ChangeEmailRequest,
  ConfirmResponse,
  CONFIRM_LINK_HOURS,
  CreateInviteRequest,
  CreateInviteResponse,
  EmailInfo,
  ERROR_STATUS,
  ForgotPasswordRequest,
  InviteRecord,
  InvitesResponse,
  JoinInfo,
  MeResponse,
  MemberRow,
  PeopleFile,
  Person,
  RESET_LINK_MINUTES,
  ResetPasswordRequest,
  SessionResponse,
  statusOf,
} from "../src/index.js";

describe("stage 32: email", () => {
  it("links last 24 hours (confirm) and 30 minutes (reset)", () => {
    expect(CONFIRM_LINK_HOURS).toBe(24);
    expect(RESET_LINK_MINUTES).toBe(30);
  });

  it("an account from before stage 32 reads as unconfirmed, with nothing waiting", () => {
    const p = Person.parse({ id: "p", createdAt: "2026-11-01T00:00:00.000Z" });
    expect(p).toMatchObject({
      emailConfirmedAt: null,
      emailConfirmedBy: null,
      emailCode: null,
      emailPending: null,
      resetCode: null,
      emailDisplaced: false,
      emailSetBySelf: false,
      emailLinkSentUntil: null,
      emailUsed: null,
    });
    expect(
      PeopleFile.parse({ people: [{ id: "p", createdAt: "2026-11-01T00:00:00.000Z" }] }).people,
    ).toHaveLength(1);
  });

  it("an account keeps a confirm link and a reset link as hashes only", () => {
    const hash = "a".repeat(64);
    const p = Person.parse({
      id: "p",
      createdAt: "2026-11-01T00:00:00.000Z",
      emailCode: {
        codeHash: hash,
        address: "a@b.co",
        createdAt: "2026-11-01T00:00:00.000Z",
        expiresAt: "2026-11-02T00:00:00.000Z",
      },
      resetCode: {
        codeHash: hash,
        createdAt: "2026-11-01T00:00:00.000Z",
        expiresAt: "2026-11-01T00:30:00.000Z",
      },
    });
    expect(p.emailCode?.mail).toBe("queued");
    expect(() =>
      Person.parse({
        id: "p",
        createdAt: "2026-11-01T00:00:00.000Z",
        resetCode: { codeHash: "plain code", createdAt: "x", expiresAt: "x" },
      }),
    ).toThrow();
  });

  it("addresses typed into forms are trimmed and must look like addresses", () => {
    expect(ForgotPasswordRequest.parse({ email: "  a@b.co " }).email).toBe("a@b.co");
    for (const email of ["", "nope", "a@b", "a b@c.co", "x".repeat(250) + "@b.co"]) {
      const r = ForgotPasswordRequest.safeParse({ email });
      expect(r.success, email).toBe(false);
      if (!r.success)
        expect(r.error.issues[0]!.message).toBe("That doesn't look like an email address.");
    }
    expect(ChangeEmailRequest.parse({ email: "a@b.co", password: "x" })).toEqual({
      email: "a@b.co",
      password: "x",
    });
    expect(ChangeEmailRequest.parse({ email: "a@b.co" })).toEqual({ email: "a@b.co" });
  });

  it("a reset password is 12 to 500 characters", () => {
    expect(ResetPasswordRequest.safeParse({ password: "x".repeat(11) }).success).toBe(false);
    expect(ResetPasswordRequest.safeParse({ password: "x".repeat(12) }).success).toBe(true);
    expect(ResetPasswordRequest.safeParse({ password: "x".repeat(500) }).success).toBe(true);
    expect(ResetPasswordRequest.safeParse({ password: "x".repeat(501) }).success).toBe(false);
  });

  it("an invitation takes an optional address, and says where it went", () => {
    expect(CreateInviteRequest.parse({ role: "writer" })).toEqual({ role: "writer" });
    expect(CreateInviteRequest.parse({ role: "writer", email: "a@b.co" }).email).toBe("a@b.co");
    expect(CreateInviteRequest.safeParse({ role: "writer", email: "nope" }).success).toBe(false);
    const made = CreateInviteResponse.parse({
      id: "i",
      code: "c",
      path: "/join/c",
      url: "u",
      role: "writer",
      expiresAt: "x",
    });
    expect(made).toMatchObject({ sentTo: null, mail: null });
    expect(
      InvitesResponse.parse({
        invites: [
          {
            id: "i",
            role: "reader",
            createdBy: { id: "p", name: "n" },
            createdAt: "x",
            expiresAt: "y",
            secondsLeft: 3,
          },
        ],
      }).invites[0],
    ).toMatchObject({ sentTo: null, mail: null });
    expect(
      InviteRecord.parse({
        id: "i",
        projectId: "p",
        role: "writer",
        codeHash: "b".repeat(64),
        createdBy: "c",
        createdAt: "2026-11-01T00:00:00.000Z",
        expiresAt: "2026-11-08T00:00:00.000Z",
        email: "a@b.co",
        mail: "failed",
      }),
    ).toMatchObject({ email: "a@b.co", mail: "failed" });
  });

  it("the join page and the member rows carry what the screens need", () => {
    const info = JoinInfo.parse({
      project: { name: "n", colour: 1, entries: null, maps: null, people: 1 },
      inviter: { name: "i" },
      role: "writer",
      google: false,
      alreadyMember: false,
    });
    expect(info.email).toBeNull();
    expect(
      MemberRow.parse({
        id: "a",
        name: "n",
        email: null,
        role: "reader",
        addedAt: "x",
        lastActiveAt: null,
        you: false,
      }).unconfirmed,
    ).toBeNull();
  });

  it("the session and me say whether mail is on and what the banner needs", () => {
    expect(SessionResponse.parse({ loggedIn: false, passkeys: false, password: true }).mail).toBe(
      false,
    );
    const info = {
      mailOn: true,
      status: "unconfirmed",
      confirmedBy: null,
      confirmedAt: null,
      sent: { at: "x", ok: null },
      pending: { address: "n@b.co", requestedAt: "x", sent: null },
      needsAddress: false,
    };
    expect(EmailInfo.parse(info)).toEqual(info);
    expect(EmailInfo.safeParse({ ...info, status: "maybe" }).success).toBe(false);
    expect(
      SessionResponse.parse({
        loggedIn: true,
        person: { id: "p", name: "n", email: "e", emailInfo: info },
        passkeys: false,
        password: true,
      }).person?.emailInfo?.pending?.address,
    ).toBe("n@b.co");
    expect(MeResponse.shape.emailInfo.isOptional()).toBe(true);
  });

  it("a confirm answer says what it did, and the new codes have their statuses", () => {
    expect(ConfirmResponse.parse({ ok: true, status: "changed", you: true }).status).toBe(
      "changed",
    );
    expect(statusOf("link_invalid")).toBe(410);
    expect(ERROR_STATUS.mail_off).toBe(409);
    expect(ERROR_STATUS.already_confirmed).toBe(409);
    expect(ERROR_STATUS.use_change_address).toBe(409);
  });
});
