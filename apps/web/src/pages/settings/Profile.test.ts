// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMe, noteMe } from "../../me.ts";
import { emailInfo, person } from "../../testing/email.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../../testing/mount.ts";
import { checkProfile, Profile } from "./Profile.tsx";

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

describe("checking the profile with the email set elsewhere (stage 32)", () => {
  it("leaves the email alone when the server sends mail", () => {
    expect(checkProfile("Olive", "", true)).toEqual({});
    expect(checkProfile("", "", true)).toEqual({ name: "Give a name." });
  });
});

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  clearMe();
  vi.unstubAllGlobals();
});

async function profile(
  who = person(),
  route: Parameters<typeof stubServer>[0] = () => answer(who),
) {
  noteMe(who);
  const calls = stubServer(route);
  mounted = await mount(createElement(Profile), null, "/settings/profile");
  await mounted.settle();
  return { m: mounted, calls };
}

describe("Settings → Profile with mail on", () => {
  it("shows the address as text and points to Change address, with no field to type it in", async () => {
    const { m } = await profile();
    expect(m.host.querySelector('input[type="email"]')).toBeNull();
    const block = m.one("[data-testid=profile-email]");
    expect(block.textContent).toContain("yael@example.org");
    const link = block.querySelector("a")!;
    expect(link.textContent).toBe("Change address");
    expect(link.getAttribute("href")).toBe("/settings/account");
  });

  it("saves only the name, and sends the address the account has", async () => {
    const { m, calls } = await profile(person(), (url, method) =>
      method === "PUT" ? answer(person({ name: "Yael S." })) : answer(person()),
    );
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael S.");
    await m.click(m.withText("button", "Save")!);
    await m.settle();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      name: "Yael S.",
      email: "yael@example.org",
    });
    expect(m.host.textContent).toContain("Saved.");
  });

  it("offers Add an address to an account that has none, and does not ask for one here", async () => {
    const { m } = await profile(
      person({
        email: "",
        needsProfile: true,
        emailInfo: emailInfo({ status: "none", sent: null }),
      }),
    );
    expect(m.one("[data-testid=profile-email]").textContent).toContain("None yet");
    expect(m.one("[data-testid=profile-email] a").textContent).toBe("Add an address");
    expect(m.one(".banner").textContent).toContain("email address under Signing in");
  });

  it("says where the address is changed when the server turns the form's address away", async () => {
    const { m } = await profile(person(), (url, method) =>
      method === "PUT"
        ? failure(409, "use_change_address", "Use Change address.")
        : answer(person()),
    );
    await m.change(m.one<HTMLInputElement>('input[autocomplete="name"]'), "Yael S.");
    await m.click(m.withText("button", "Save")!);
    await m.settle();
    expect(m.one('[role="alert"]').textContent).toBe(
      "The address is changed under Signing in, with Change address.",
    );
  });

  it("keeps the email field with mail off, as it was", async () => {
    const { m } = await profile(person({ emailInfo: emailInfo({ mailOn: false }) }));
    expect(m.one<HTMLInputElement>('input[type="email"]').value).toBe("yael@example.org");
    expect(m.host.querySelector("[data-testid=profile-email]")).toBeNull();
  });
});
