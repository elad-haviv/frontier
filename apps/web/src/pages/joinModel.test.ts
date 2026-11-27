import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXISTS,
  AI_KEY_NOTE,
  deadLink,
  googleProblem,
  inviteHeading,
  joinFailure,
  projectCounts,
  ROLE_ALLOWS,
} from "./joinModel.ts";

describe("what a dead invite link says", () => {
  it("says why for each way a link dies, and names the person to ask when the server gave one", () => {
    expect(deadLink("invite_used", "Olive Owner")).toEqual({
      title: "This invite link was already used",
      body: expect.stringContaining("ask Olive Owner for a new one"),
    });
    expect(deadLink("invite_cancelled", "Olive Owner")?.body).toContain(
      "Ask Olive Owner for a new link",
    );
    expect(deadLink("invite_expired", "Olive Owner")?.title).toBe("This invite link has run out");
    expect(deadLink("invite_expired", "Olive Owner")?.body).toContain("7 days");
    // With no name, an owner of the project is whom to ask.
    expect(deadLink("invite_used", undefined)?.body).toContain("ask an owner of the project");
    // An unknown link names no one: a malformed code gets the same words.
    expect(deadLink("invite_unknown", undefined)?.title).toBe("This link does not work");
    expect(deadLink("invite_unknown", "Someone")?.body).not.toContain("Someone");
  });

  it("is not a dead link for any other answer", () => {
    expect(deadLink("rate_limited", undefined)).toBeNull();
    expect(deadLink("offline", undefined)).toBeNull();
    expect(deadLink("account_exists", undefined)).toBeNull();
  });
});

describe("the words of the join page", () => {
  it("says who invited you, to what and as what", () => {
    expect(inviteHeading("Elad", "Avalymia", "writer")).toBe(
      "Elad invited you to write in Avalymia",
    );
    expect(inviteHeading("Elad", "Avalymia", "reader")).toBe("Elad invited you to read Avalymia");
    expect(inviteHeading("Elad", "Avalymia", "owner")).toBe("Elad invited you to own Avalymia");
    expect(inviteHeading("", "Avalymia", "reader")).toBe("Someone invited you to read Avalymia");
    expect(ROLE_ALLOWS.reader).toContain("cannot change the text");
    expect(AI_KEY_NOTE).toContain("stays on your device");
  });

  it("counts what is known of the project, and leaves out what is not", () => {
    expect(projectCounts({ entries: 214, maps: 6, people: 3 })).toBe(
      "214 entries · 6 maps · 3 people",
    );
    expect(projectCounts({ entries: 1, maps: 1, people: 1 })).toBe("1 entry · 1 map · 1 person");
    expect(projectCounts({ entries: null, maps: null, people: 2 })).toBe("2 people");
  });

  it("puts the rate limit in plain words, and leaves other messages as the server wrote them", () => {
    expect(joinFailure("rate_limited", "Too many attempts. Wait 15 minutes and try again.")).toBe(
      "Too many tries from this address. Wait a few minutes, then try again.",
    );
    expect(joinFailure("invalid", "Use at least 12 characters.")).toBe(
      "Use at least 12 characters.",
    );
    expect(ACCOUNT_EXISTS).toContain("log in to join");
  });
});

describe("why a Google trip did not work", () => {
  it("has its own words for each problem the server says", () => {
    for (const problem of [
      "google_no_account",
      "google_denied",
      "google_failed",
      "google_unverified",
      "google_expired",
      "google_off",
      "google_taken",
      "google_already_linked",
      "recent_login_needed",
    ]) {
      const words = googleProblem(problem);
      expect(words, problem).toBeTruthy();
      // Plain sentences, never the code.
      expect(words).not.toContain("_");
    }
    expect(googleProblem("google_no_account")).toContain("invite link");
    expect(googleProblem("google_unverified")).toContain("has not verified");
  });

  it("says nothing for no problem or one it does not know", () => {
    expect(googleProblem(null)).toBeNull();
    expect(googleProblem("")).toBeNull();
    expect(googleProblem("account_exists")).toBeNull();
    expect(googleProblem("something_else")).toBeNull();
  });
});
