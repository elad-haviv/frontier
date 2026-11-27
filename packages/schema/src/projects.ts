import { z } from "zod";

/**
 * Stage 27b: projects. A project is a library with its own members. `/data/state/projects.json`
 * keeps the list (the "project store"); each record says who the members are and where the
 * project's files are. A project is addressed by its slug: `/api/p/<slug>/...` on the server,
 * `/p/<slug>/...` in the app.
 */

export const PROJECT_ROLES = ["owner", "writer", "reader"] as const;
export const ProjectRole = z.enum(PROJECT_ROLES);
export type ProjectRole = z.infer<typeof ProjectRole>;

/** How much a role may do: a higher number may do all that a lower one may. */
export const ROLE_RANK: Record<ProjectRole, number> = { reader: 1, writer: 2, owner: 3 };

/** Whether a person with the role `have` may do what needs at least the role `need`. */
export const roleAtLeast = (have: ProjectRole, need: ProjectRole): boolean =>
  ROLE_RANK[have] >= ROLE_RANK[need];

/** How the project's library is kept: Frontier's own, a GitHub repository others write to, or the sample. */
export const ProjectKind = z.enum(["own", "github", "sample"]);
export type ProjectKind = z.infer<typeof ProjectKind>;

/**
 * Where the project's files are on the server's disk. `legacy` is the layout of a server from
 * before projects (`library.git`, `vault`, `state` and `assets` straight under the data folder),
 * which the first project keeps so that an upgrade moves nothing; `folder` is `projects/<id>/`
 * with the same four inside it.
 */
export const ProjectLayout = z.enum(["legacy", "folder"]);
export type ProjectLayout = z.infer<typeof ProjectLayout>;

/** Words that are addresses of the app itself, so no project may take them. */
export const RESERVED_SLUGS = [
  "new",
  "api",
  "join",
  "settings",
  "projects",
  "login",
  "logout",
  "p",
  "health",
  "assets",
  "icons",
  "admin",
  "help",
] as const;

/** Lowercase letters, digits and single hyphens inside; 2 to 40 characters. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,39}$/;

/** The shape of an address; whether it is free or reserved is the server's answer (`slug_taken`). */
export const SlugShape = z
  .string()
  .trim()
  .regex(
    SLUG_PATTERN,
    "Use 2 to 40 lowercase letters, digits and hyphens, not starting with a hyphen.",
  );

/** An address a project may have: the right shape and not a reserved word. */
export const ProjectSlug = SlugShape.refine(
  (s) => !(RESERVED_SLUGS as readonly string[]).includes(s),
  "This address is taken.",
);

/** An address made from a name: "The Avalymia Atlas!" becomes "the-avalymia-atlas". */
export function slugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "project";
}

/** How many colours a project's letter mark can have; the colour is an index into the app's list. */
export const PROJECT_COLOURS = 8;

export const ProjectMember = z.object({
  personId: z.string().min(1),
  role: ProjectRole,
  addedAt: z.string().datetime(),
  /**
   * When the person last used the project (stage 27c). Written at most once every few minutes, so
   * it is a rough "last seen", never an audit trail. Absent until they next use the project.
   */
  lastActiveAt: z.string().datetime().optional(),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

/** An address the project had before it was renamed; it still reaches the project for a while. */
export const PreviousSlug = z.object({
  slug: z.string().min(1),
  /** When the address stops working. */
  until: z.string().datetime(),
});
export type PreviousSlug = z.infer<typeof PreviousSlug>;

export const ProjectRecord = z.object({
  id: z.string().regex(/^[a-z0-9]{10}$/),
  slug: z.string().min(1),
  previousSlugs: z.array(PreviousSlug).default([]),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).default(""),
  colour: z
    .number()
    .int()
    .min(0)
    .max(PROJECT_COLOURS - 1)
    .default(0),
  createdAt: z.string().datetime(),
  kind: ProjectKind,
  layout: ProjectLayout,
  /** The folder of marker sets, when it is not the server's own setting (a project begun from the sample). */
  iconFolder: z.string().nullable().default(null),
  members: z.array(ProjectMember).default([]),
});
export type ProjectRecord = z.infer<typeof ProjectRecord>;

export const ProjectsFile = z.object({
  version: z.literal(1).default(1),
  projects: z.array(ProjectRecord).default([]),
});
export type ProjectsFile = z.infer<typeof ProjectsFile>;

/** How long a renamed project's old address keeps working. */
export const OLD_SLUG_DAYS = 90;

// ---- The API ---------------------------------------------------------------------------------

/** One person shown on a project card. */
export const ProjectPerson = z.object({ id: z.string(), name: z.string() });
export type ProjectPerson = z.infer<typeof ProjectPerson>;

/** `GET /api/projects`: one entry of the person's list. */
export const ProjectSummary = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  colour: z.number().int(),
  kind: ProjectKind,
  /** The person's own role here. */
  role: ProjectRole,
  /** Notes in the library as last saved; null while its library has never been opened (the list never opens one). */
  entries: z.number().int().nullable(),
  maps: z.number().int().nullable(),
  members: z.array(ProjectPerson),
  /**
   * True for the one project whose files are the server's old layout, the library a device kept
   * its pre-projects copy of: only this project may take over that copy. Absent from a list a
   * device kept before the flag existed.
   */
  legacy: z.boolean().optional(),
  /** The last saved version of the library: when, and by whom (the author's name). */
  lastVersion: z.object({ at: z.string(), by: z.string() }).nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectsResponse = z.object({
  projects: z.array(ProjectSummary),
  /** The slug of the project the person used last, if it is still theirs. */
  last: z.string().nullable(),
  /** Whether this person may make projects (the server's first account, for now). */
  canCreate: z.boolean(),
});
export type ProjectsResponse = z.infer<typeof ProjectsResponse>;

/** `POST /api/projects`. A vault zip is brought in afterwards with `POST /api/p/:project/import/vault`. */
export const CreateProjectRequest = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(80),
  slug: SlugShape,
  description: z.string().trim().max(300).default(""),
  /** An empty library with one welcome entry, or the made-up sample. */
  start: z.enum(["empty", "sample"]).default("empty"),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

/** `GET /api/p/:project/project`, and the answer to `POST /api/projects` and `PUT`. */
export const ProjectResponse = z.object({
  id: z.string(),
  slug: z.string(),
  /** The address the request used, when it was an old one: the app moves to `slug`. */
  movedFrom: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  colour: z.number().int(),
  kind: ProjectKind,
  createdAt: z.string(),
  role: ProjectRole,
  members: z.array(ProjectPerson.extend({ role: ProjectRole })),
  /** Whether `DELETE` is possible: false for the first project, whose files are the old layout. */
  deletable: z.boolean(),
});
export type ProjectResponse = z.infer<typeof ProjectResponse>;

/** `PUT /api/p/:project/project`: what is given is changed. */
export const UpdateProjectRequest = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(80).optional(),
  slug: SlugShape.optional(),
  description: z.string().trim().max(300).optional(),
  colour: z
    .number()
    .int()
    .min(0)
    .max(PROJECT_COLOURS - 1)
    .optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

/** `DELETE /api/p/:project/project`: the name typed again, so a stray click cannot delete it. */
export const DeleteProjectRequest = z.object({ name: z.string() });
export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequest>;

/** `GET /api/projects/slug-free?slug=`: whether an address can be taken. */
export const SlugFreeResponse = z.object({
  free: z.boolean(),
  /** Why not, in words, when it is not free. */
  reason: z.string().nullable(),
});
export type SlugFreeResponse = z.infer<typeof SlugFreeResponse>;
