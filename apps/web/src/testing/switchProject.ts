/**
 * Helpers for tests of work that finishes after the person has gone to another project (stage
 * 31b). `switchWhileAsking` stands in for the server and, while one chosen call is being
 * answered, opens another project: the second half of a multi-step action then runs with the
 * wrong project open unless the action took its project when it began.
 */
import { vi } from "vitest";
import { setKeysOwner } from "../aiKeys.ts";
import { type ProjectRef, setCurrentProject } from "../project.ts";
import { loadProjects } from "../projects.ts";

export const ALPHA: ProjectRef = { id: "projecta01", slug: "alpha" };
export const BETA: ProjectRef = { id: "projectb01", slug: "beta" };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Signs a person in whose projects are alpha (the legacy library) and beta, as the server lists them. */
export async function signInWithProjects(person = "person1"): Promise<void> {
  setKeysOwner(person);
  const summary = (p: ProjectRef, legacy: boolean) => ({
    ...p,
    name: p.slug,
    description: "",
    colour: 0,
    kind: "own",
    role: "owner",
    entries: null,
    maps: null,
    members: [],
    lastVersion: null,
    legacy,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ projects: [summary(ALPHA, true), summary(BETA, false)], last: null, canCreate: true }),
    ),
  );
  await loadProjects();
  vi.unstubAllGlobals();
}

export interface Switching {
  /** Every address asked, in order, with its method. */
  asked: { url: string; method: string }[];
}

/**
 * Stubs `fetch`. The first call whose address `when` accepts opens `to` before it is answered
 * with `answer(url)`; any other call is answered with `answer(url)` too, and a call `answer`
 * returns `undefined` for fails as a lost connection does, so what it would have saved stays
 * on the device.
 */
export function switchWhileAsking(opts: {
  when: (url: string, method: string) => boolean;
  to: ProjectRef | null;
  answer: (url: string, method: string) => unknown;
}): Switching {
  const asked: Switching["asked"] = [];
  let switched = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      asked.push({ url, method });
      if (!switched && opts.when(url, method)) {
        switched = true;
        setCurrentProject(opts.to);
      }
      const body = opts.answer(url, method);
      if (body === undefined) throw new TypeError("Failed to fetch");
      return json(body);
    }),
  );
  return { asked };
}
