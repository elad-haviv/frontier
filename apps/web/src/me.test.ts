import type { MeResponse } from "@frontier/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ME: MeResponse = {
  id: "p1",
  name: "Olive",
  email: "olive@example.com",
  admin: true,
  needsProfile: false,
  passkeys: [],
  passwordSet: true,
  passwordOff: false,
  method: "password",
};

const store = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the person logged in", () => {
  it("is read from the server, kept on the device, and forgotten at log out", async () => {
    vi.doMock("./api.ts", () => ({ api: { me: async () => ME } }));
    const me = await import("./me.ts");
    expect(await me.loadMe()).toEqual(ME);
    expect(JSON.parse(store.get("frontier.me")!)).toEqual(ME);
    me.clearMe();
    expect(store.has("frontier.me")).toBe(false);
  });

  it("shows the kept person while the server cannot be reached", async () => {
    store.set("frontier.me", JSON.stringify(ME));
    vi.doMock("./api.ts", () => ({
      api: {
        me: async () => {
          throw new Error("offline");
        },
      },
    }));
    const me = await import("./me.ts");
    expect(await me.loadMe()).toEqual(ME);
  });

  it("takes a profile just saved, and survives storage that throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    vi.doMock("./api.ts", () => ({ api: { me: async () => ME } }));
    const me = await import("./me.ts");
    me.noteMe({ ...ME, name: "Changed" });
    expect(await me.loadMe()).toEqual(ME);
    me.clearMe();
  });
});
