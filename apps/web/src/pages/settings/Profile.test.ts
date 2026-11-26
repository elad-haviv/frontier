import { describe, expect, it } from "vitest";
import { checkProfile } from "./Profile.tsx";

describe("checking the profile before it is sent", () => {
  it("accepts a name and an email", () => {
    expect(checkProfile("Olive Owner", "olive@example.com")).toEqual({});
    expect(checkProfile("  O  ", "  o@x.co ")).toEqual({});
  });

  it("says what is missing or wrong, in the words the server uses", () => {
    expect(checkProfile("", "")).toEqual({ name: "Give a name.", email: "Give an email." });
    expect(checkProfile("   ", "a@b.co")).toEqual({ name: "Give a name." });
    expect(checkProfile("A", "a b@c.co")).toEqual({ email: "This is not an email address." });
    expect(checkProfile("A", "no-at-sign")).toEqual({ email: "This is not an email address." });
    expect(checkProfile("x".repeat(81), "a@b.co")).toEqual({
      name: "Use 80 characters or fewer.",
    });
  });
});
