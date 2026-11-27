// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { emailInfo } from "../testing/email.ts";
import {
  bannerLead,
  bannerView,
  isJoinPath,
  looksLikeEmail,
  mailFailure,
  mailState,
  passwordCount,
  rememberInvitation,
  sentWords,
  takeInvitation,
} from "./emailModel.ts";

afterEach(() => localStorage.clear());

describe("the banner's view of an address", () => {
  it("is never drawn with mail off, whatever the address is", () => {
    expect(bannerView(emailInfo({ mailOn: false }), "a@b.co")).toBeNull();
    expect(bannerView(undefined, "a@b.co")).toBeNull();
  });

  it("asks to confirm an unconfirmed address, by what became of the last link", () => {
    const sent = bannerView(emailInfo(), "yael@example.org");
    expect(sent).toMatchObject({ kind: "confirm", state: "sent", address: "yael@example.org" });
    expect(bannerView(emailInfo({ sent: null }), "y@x.co")).toMatchObject({ state: "unsent" });
    expect(bannerView(emailInfo({ sent: { at: "t", ok: false } }), "y@x.co")).toMatchObject({
      state: "failed",
    });
    expect(bannerView(emailInfo({ sent: { at: "t", ok: null } }), "y@x.co")).toMatchObject({
      state: "sending",
    });
  });

  it("shows nothing for a confirmed address, and nothing for an account that never had one", () => {
    expect(
      bannerView(emailInfo({ status: "confirmed", confirmedBy: "link" }), "a@b.co"),
    ).toBeNull();
    expect(bannerView(emailInfo({ status: "none" }), "")).toBeNull();
  });

  it("is about the new address while a change waits", () => {
    const view = bannerView(
      emailInfo({
        pending: { address: "new@x.co", requestedAt: "t", sent: { at: "t", ok: true } },
      }),
      "old@x.co",
    );
    expect(view).toMatchObject({ pending: true, address: "new@x.co", current: "old@x.co" });
    expect(bannerLead(view as never)).toBe("Confirm your new address:");
  });

  it("asks a displaced account to add an address", () => {
    expect(bannerView(emailInfo({ status: "none", needsAddress: true }), "")).toEqual({
      kind: "add",
    });
  });

  it("tells the state of a mail from its record", () => {
    expect(mailState(null)).toBe("unsent");
    expect(mailState({ at: "t", ok: null })).toBe("sending");
    expect(mailState({ at: "t", ok: true })).toBe("sent");
    expect(mailState({ at: "t", ok: false })).toBe("failed");
  });
});

describe("the words of the new refusals", () => {
  it("says try again in a few minutes for the rate limit, the same for every address", () => {
    expect(mailFailure("rate_limited", "Too many requests. Try again later.")).toBe(
      "Try again in a few minutes.",
    );
  });

  it("words each code in the plain voice and keeps the server's message for the rest", () => {
    expect(mailFailure("already_confirmed", "")).toBe("That address is already confirmed.");
    expect(mailFailure("link_invalid", "")).toContain("run out");
    expect(mailFailure("use_change_address", "")).toContain("Change address");
    expect(mailFailure("email_taken", "x")).toBe("Another account already uses that address.");
    expect(mailFailure("mail_off", "")).toBe("This server cannot send email.");
    expect(mailFailure("invalid", "The current password is not right.")).toBe(
      "The current password is not right.",
    );
    expect(mailFailure("weird", "")).toBe("That did not work. Try again.");
  });

  it("says what a send came to", () => {
    expect(sentWords("sent", "a@b.co")).toBe("Sent again. Check your inbox and spam.");
    expect(sentWords("failed", "a@b.co")).toBe("We could not send it. Try again in a minute.");
    expect(sentWords("off", "a@b.co")).toBe("Your address is now a@b.co.");
  });
});

describe("addresses and passwords", () => {
  it("accepts a plain address and refuses the rest", () => {
    expect(looksLikeEmail(" a@b.co ")).toBe(true);
    for (const bad of ["", "a", "a@b", "a b@c.co", "@b.co"])
      expect(looksLikeEmail(bad)).toBe(false);
  });

  it("counts a new password live: how many more, then good", () => {
    expect(passwordCount(0)).toBe("12 or more characters.");
    expect(passwordCount(5)).toBe("7 more characters needed.");
    expect(passwordCount(11)).toBe("1 more character needed.");
    expect(passwordCount(12)).toBe("Good.");
  });
});

describe("the invitation a reset comes back to", () => {
  it("accepts only an invite page of this app", () => {
    expect(isJoinPath("/join/abc_DEF-1")).toBe(true);
    expect(isJoinPath("/join/abc?m=Zr3_h-8")).toBe(true);
    for (const bad of [
      "https://evil.example/join/a",
      "//evil.example",
      "/login",
      "/join/",
      "/join/a?x=1",
      3,
      null,
    ])
      expect(isJoinPath(bad)).toBe(false);
  });

  it("is kept for an hour, read once, and never anything but an invite page", () => {
    rememberInvitation("/join/abc?m=xyz", 1000);
    expect(takeInvitation(1000 + 60_000)).toBe("/join/abc?m=xyz");
    // Read once: forgotten as it was read.
    expect(takeInvitation(1000 + 60_000)).toBeNull();
    rememberInvitation("/join/abc", 1000);
    expect(takeInvitation(1000 + 61 * 60_000)).toBeNull();
    rememberInvitation("https://evil.example/", 1000);
    expect(takeInvitation(1001)).toBeNull();
    localStorage.setItem(
      "frontier.afterReset",
      JSON.stringify({ path: "//evil.example", until: 9e15 }),
    );
    expect(takeInvitation()).toBeNull();
    localStorage.setItem("frontier.afterReset", "not json");
    expect(takeInvitation()).toBeNull();
  });
});
