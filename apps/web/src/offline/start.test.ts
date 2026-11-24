import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../api.ts";
import {
  openApp,
  SESSION_WAIT_MS,
  SIGNED_IN,
  SIGNED_IN_MS,
  type SignedIn,
  startMode,
} from "./start.ts";

const NOW = 1_700_000_000_000;

/** A store holding `signedIn`, and a connection that records what it was told. */
function deps(signedIn: SignedIn | undefined, session: () => Promise<{ loggedIn: boolean }>) {
  const values = new Map<string, unknown>(signedIn ? [[SIGNED_IN, signedIn]] : []);
  const told: string[] = [];
  return {
    values,
    told,
    d: {
      session,
      store: {
        meta: async <T>(key: string) => values.get(key) as T | undefined,
        setMeta: async (key: string, value: unknown) => void values.set(key, value),
        removeMeta: async (key: string) => void values.delete(key),
      },
      connection: {
        startOffline: () => void told.push("startOffline"),
        reached: () => void told.push("reached"),
        unauthorised: () => void told.push("unauthorised"),
      },
      now: () => NOW,
    },
  };
}

const offline = () => Promise.reject(new ApiFailure(0, "offline", "Can't reach Frontier."));
const never = () => new Promise<{ loggedIn: boolean }>(() => undefined);
const valid = { until: NOW + 1000 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the start", () => {
  it("may start offline only while the note of a sign-in holds", () => {
    expect(startMode(undefined, NOW)).toBe("check");
    expect(startMode({ until: NOW - 1 }, NOW)).toBe("check");
    expect(startMode({ until: NOW }, NOW)).toBe("check");
    expect(startMode(valid, NOW)).toBe("may-start-offline");
  });

  it("never starts offline without a sign-in noted, or after it ran out", async () => {
    for (const signedIn of [undefined, { until: NOW - 1 }]) {
      const { d, told } = deps(signedIn, offline);
      await expect(openApp(d)).resolves.toBe(false);
      const { d: slow, told: toldSlow } = deps(signedIn, never);
      const opening = openApp(slow);
      await vi.advanceTimersByTimeAsync(SESSION_WAIT_MS * 10);
      expect(await Promise.race([opening, Promise.resolve("waiting")])).toBe("waiting");
      expect([...told, ...toldSlow]).toEqual([]);
    }
  });

  it("starts offline when the server cannot be reached", async () => {
    const { d, told } = deps(valid, offline);
    await expect(openApp(d)).resolves.toBe(true);
    expect(told).toEqual(["startOffline"]);
  });

  it("starts offline when the session check does not answer in time", async () => {
    const { d, told } = deps(valid, never);
    const opening = openApp(d);
    await vi.advanceTimersByTimeAsync(SESSION_WAIT_MS - 1);
    expect(told).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(opening).resolves.toBe(true);
    expect(told).toEqual(["startOffline"]);
  });

  it("goes by the late answer: logged out means signed out", async () => {
    let answer: (s: { loggedIn: boolean }) => void = () => undefined;
    const { d, told, values } = deps(valid, () => new Promise((resolve) => (answer = resolve)));
    const opening = openApp(d);
    await vi.advanceTimersByTimeAsync(SESSION_WAIT_MS);
    await expect(opening).resolves.toBe(true);
    answer({ loggedIn: false });
    await vi.waitFor(() => expect(told).toEqual(["startOffline", "unauthorised"]));
    expect(values.has(SIGNED_IN)).toBe(false);
  });

  it("goes by the late answer: logged in means online, noted again", async () => {
    let answer: (s: { loggedIn: boolean }) => void = () => undefined;
    const { d, told, values } = deps(valid, () => new Promise((resolve) => (answer = resolve)));
    const opening = openApp(d);
    await vi.advanceTimersByTimeAsync(SESSION_WAIT_MS);
    await opening;
    answer({ loggedIn: true });
    await vi.waitFor(() => expect(told).toEqual(["startOffline", "reached"]));
    expect(values.get(SIGNED_IN)).toEqual({ until: NOW + SIGNED_IN_MS });
  });

  it("notes the sign-in after every check that says logged in, and opens online", async () => {
    for (const signedIn of [undefined, valid]) {
      const { d, told, values } = deps(signedIn, async () => ({ loggedIn: true }));
      await expect(openApp(d)).resolves.toBe(true);
      expect(values.get(SIGNED_IN)).toEqual({ until: NOW + SIGNED_IN_MS });
      expect(told).toEqual([]);
    }
  });

  it("shows the login page when the server says logged out, or answers with an error", async () => {
    const { d, values } = deps(valid, async () => ({ loggedIn: false }));
    await expect(openApp(d)).resolves.toBe(false);
    expect(values.has(SIGNED_IN)).toBe(false);
    const broken = deps(valid, () => Promise.reject(new ApiFailure(500, "unknown", "Broken.")));
    await expect(openApp(broken.d)).resolves.toBe(false);
    expect(broken.told).toEqual([]);
  });
});
