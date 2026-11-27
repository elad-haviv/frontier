import { PROJECT_COLOURS, type ProjectRecord, slugFromName } from "@frontier/schema";
import type { Server } from "../server.js";
import { newProjectId } from "./store.js";

/** A name's slug that is free, by adding a number when the plain one is taken or reserved. */
export async function freeSlug(server: Server, name: string): Promise<string> {
  const base = slugFromName(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    if ((await server.projects.whyNotSlug(slug)) === null) return slug;
  }
}

/** The colour a new project's mark starts with: the next one in turn. */
export const nextColour = async (server: Server): Promise<number> =>
  (await server.projects.all()).length % PROJECT_COLOURS;

/**
 * The library the server already has becomes the first project (stage 27b). Its files do not move:
 * the record says `legacy`, which is `library.git`, `vault`, `state` and `assets` straight under
 * the data folder. Made once, when the project store is empty: named from `FRONTIER_PROJECT_NAME`,
 * with the first account as its owner and every other account that exists as well, to be safe.
 * A server that has no account yet (one from before accounts) gets a project with no members,
 * which its first admin takes when they reach it (`claimForAdmin` in `guard.ts`).
 *
 * Every start it also keeps the record's kind in step with the way the server is run, which is
 * what the configuration says.
 */
export async function ensureFirstProject(server: Server): Promise<ProjectRecord> {
  const { config } = server;
  const people = await server.people.all();
  const addedAt = new Date().toISOString();
  const owners = [...people.filter((p) => p.admin), ...people.filter((p) => !p.admin)].map((p) => ({
    personId: p.id,
    role: "owner" as const,
    addedAt,
  }));
  const slug = await freeSlug(server, config.projectName);
  await server.projects.createIfEmpty(() => ({
    id: newProjectId(),
    slug,
    previousSlugs: [],
    name: config.projectName,
    description: "",
    colour: 0,
    createdAt: addedAt,
    kind: config.library,
    layout: "legacy",
    iconFolder: null,
    members: owners,
  }));
  const first = (await server.projects.all()).find((p) => p.layout === "legacy");
  if (!first) throw new Error("The project list has no first project. Restore projects.json.");
  return first.kind === config.library
    ? first
    : server.projects.update(first.id, (p) => ({ ...p, kind: config.library }));
}
