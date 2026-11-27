import { cp, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  CreateProjectRequest,
  DeleteProjectRequest,
  type ProjectRecord,
  type ProjectResponse,
  type ProjectsResponse,
  type ProjectSummary,
  type SlugFreeResponse,
  UpdateProjectRequest,
} from "@frontier/schema";
import { z } from "zod";
import { personOf } from "../auth/session.js";
import { ApiError } from "../errors.js";
import { claimForAdmin } from "../projects/guard.js";
import type { RouteApp } from "../projects/facade.js";
import { nextColour } from "../projects/first.js";
import { pathsOf, projectFolder } from "../projects/layout.js";
import type { Services } from "../projects/services.js";
import { countsOf, readSummary, UNKNOWN } from "../projects/summary.js";
import { newProjectId } from "../projects/store.js";
import { ensureOwnLibrary, ensureSampleRemote } from "../sample.js";
import type { Server } from "../server.js";

/** A person as the lists of members show them: the name, or the email when there is no name. */
async function nameOf(server: Server, id: string): Promise<string> {
  const p = await server.people.get(id);
  return p ? p.name.trim() || p.email.trim() || "Someone" : "Someone";
}

async function describe(
  server: Server,
  record: ProjectRecord,
  role: ProjectResponse["role"],
  movedFrom: string | null,
): Promise<ProjectResponse> {
  return {
    id: record.id,
    slug: record.slug,
    movedFrom,
    name: record.name,
    description: record.description,
    colour: record.colour,
    kind: record.kind,
    createdAt: record.createdAt,
    role,
    members: await Promise.all(
      record.members.map(async (m) => ({
        id: m.personId,
        name: await nameOf(server, m.personId),
        role: m.role,
      })),
    ),
    deletable: record.layout !== "legacy",
  };
}

/**
 * `/api/p/:project/project`: the project's own record. Anyone in the project reads it; an owner
 * changes it or deletes it. These have no alias at an old address.
 */
export function projectRoutes(app: RouteApp, s: Services): void {
  const here = (request: {
    project: {
      record: ProjectRecord;
      role: ProjectResponse["role"];
      movedFrom: string | null;
    } | null;
  }) => {
    if (!request.project) throw new ApiError("no_project", "There is no such project.");
    return request.project;
  };

  app.get("/api/project", async (request): Promise<ProjectResponse> => {
    const { record, role, movedFrom } = here(request);
    return describe(s.server, (await s.server.projects.get(record.id)) ?? record, role, movedFrom);
  });

  app.put("/api/project", async (request): Promise<ProjectResponse> => {
    const { record, role } = here(request);
    const input = UpdateProjectRequest.parse(request.body);
    const next = await s.server.projects.update(record.id, (now) => ({
      ...now,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.colour !== undefined ? { colour: input.colour } : {}),
    }));
    return describe(s.server, next, role, null);
  });

  /**
   * Deletes the project: its folder is moved to `trash/<id>-<time>` in the data folder, not
   * removed, so a mistake can be put right by hand. The first project's files are the server's old
   * layout, mixed with its own files, and are not moved; the last project cannot go.
   */
  app.delete("/api/project", async (request) => {
    const { record } = here(request);
    const { name } = DeleteProjectRequest.parse(request.body ?? {});
    if (name.trim() !== record.name) {
      throw new ApiError("invalid", "Type the project's name exactly to delete it.");
    }
    if (record.layout === "legacy") {
      throw new ApiError(
        "project_not_deletable",
        "This is the library the server started with. Its files sit in the server's own data folder, so it cannot be deleted from here.",
      );
    }
    if ((await s.server.projects.all()).length <= 1) {
      throw new ApiError("project_not_deletable", "The last project cannot be deleted.");
    }
    const from = projectFolder(s.server.config.dataDir, record.id);
    // In this order, so a request that is running meets "no such project" and never a half-moved
    // folder: out of the list (the guard finds nothing), marked gone (nothing can open it, and
    // what is open stops writing), the services closed, and only then the folder moved.
    await s.server.projects.remove(record.id);
    await s.server.registry.retire(record.id);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const to = join(s.server.config.dataDir, "trash", `${record.id}-${stamp}`);
    await mkdir(join(s.server.config.dataDir, "trash"), { recursive: true });
    try {
      await rename(from, to);
    } catch (err) {
      // Another disk: copy, then remove.
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      await cp(from, to, { recursive: true });
      await rm(from, { recursive: true, force: true });
    }
    return { ok: true as const };
  });
}

const SlugQuery = z.object({ slug: z.string().max(100) });
const LastRequest = z.object({ slug: z.string().min(1).max(100) });

/** The projects of the whole server: the person's list, making one, and which they used last. */
export function projectsApi(app: FastifyInstance, server: Server): void {
  app.get("/api/projects", async (request): Promise<ProjectsResponse> => {
    const person = personOf(request);
    await claimForAdmin(server, person);
    const mine = await server.projects.of(person.id);
    const projects = await Promise.all(
      mine.map(async (record): Promise<ProjectSummary> => {
        const role = record.members.find((m) => m.personId === person.id)!.role;
        // Never opens the project: an open one is counted live, any other from the small file it
        // saved when its index last changed; unknown (null) when it has not been opened yet.
        const open = server.registry.loaded(record.id);
        const counts = await (open && open.index.commit !== null
          ? countsOf(open).catch(() => UNKNOWN)
          : readSummary(pathsOf(server.config.dataDir, record).state));
        return {
          id: record.id,
          slug: record.slug,
          name: record.name,
          description: record.description,
          colour: record.colour,
          kind: record.kind,
          role,
          legacy: record.layout === "legacy",
          ...counts,
          members: await Promise.all(
            record.members.map(async (m) => ({
              id: m.personId,
              name: await nameOf(server, m.personId),
            })),
          ),
        };
      }),
    );
    const last = mine.find((p) => p.id === person.lastProject)?.slug ?? null;
    return { projects, last, canCreate: person.admin };
  });

  app.get("/api/projects/slug-free", async (request): Promise<SlugFreeResponse> => {
    const { slug } = SlugQuery.parse(request.query);
    const reason = await server.projects.whyNotSlug(slug.trim());
    return { free: reason === null, reason };
  });

  /** Remembers the project the person is in, so the next login opens it. */
  app.put("/api/projects/last", async (request) => {
    const person = personOf(request);
    const { slug } = LastRequest.parse(request.body);
    const found = await server.projects.resolve(slug);
    if (!found?.record.members.some((m) => m.personId === person.id)) {
      throw new ApiError("no_project", "There is no project here that you can open.");
    }
    if (person.lastProject !== found.record.id) {
      await server.people.update(person.id, (p) => ({ ...p, lastProject: found.record.id }));
    }
    return { ok: true as const };
  });

  /**
   * Makes a project, with its own folder and an own library: empty (one welcome entry) or the
   * sample. The person who makes it is its owner. For now only the server's first account may.
   * A vault zip is brought in afterwards with `POST /api/p/:project/import/vault`.
   */
  app.post("/api/projects", async (request, reply): Promise<ProjectResponse> => {
    const person = personOf(request);
    if (!person.admin) {
      throw new ApiError(
        "not_allowed",
        "Only the server's first account can make a project for now.",
      );
    }
    const input = CreateProjectRequest.parse(request.body);
    const reason = await server.projects.whyNotSlug(input.slug);
    if (reason) throw new ApiError("slug_taken", reason);
    const id = newProjectId();
    const dataDir = server.config.dataDir;
    const root = projectFolder(dataDir, id);
    await mkdir(root, { recursive: true });
    try {
      // These run git, which blocks for a moment; the library of a new project is small.
      await new Promise((r) => setImmediate(r));
      if (input.start === "sample") ensureSampleRemote(root, undefined, "library.git");
      else ensureOwnLibrary(root);
      const record = await server.projects.create({
        id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        colour: await nextColour(server),
        kind: "own",
        layout: "folder",
        iconFolder: input.start === "sample" ? "99 Appendices/Icons" : null,
        members: [{ personId: person.id, role: "owner", addedAt: new Date().toISOString() }],
      });
      try {
        await server.registry.open(record);
      } catch (err) {
        await server.registry.close(record.id);
        await server.projects.remove(record.id);
        throw err;
      }
      reply.status(201);
      return describe(server, record, "owner", null);
    } catch (err) {
      await rm(pathsOf(dataDir, { id, layout: "folder" }).root, { recursive: true, force: true });
      throw err;
    }
  });
}
