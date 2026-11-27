import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  OLD_SLUG_DAYS,
  ProjectSlug,
  ProjectsFile,
  type ProjectRecord,
  RESERVED_SLUGS,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { StateFiles } from "../state/files.js";

/** A new id: ten lowercase letters and digits. */
export function newProjectId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(10)].map((b) => alphabet[b % 36]).join("");
}

/**
 * Every project, in `/data/state/projects.json` (a server-wide file, in the backup). Made like the
 * people store: one server process is its only writer, changes run one after another, and what is
 * held in memory is checked against the file's stamp on each read.
 */
export class ProjectStore {
  readonly file: string;
  private turn: Promise<unknown> = Promise.resolve();
  private held: { stamp: string | null; projects: ProjectRecord[] } | null = null;

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = join(stateDir, "projects.json");
  }

  private async stamp(): Promise<string | null> {
    try {
      const s = await stat(this.file);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return null;
    }
  }

  async exists(): Promise<boolean> {
    return (await this.stamp()) !== null;
  }

  async all(): Promise<ProjectRecord[]> {
    const stamp = await this.stamp();
    if (this.held && this.held.stamp === stamp) return this.held.projects;
    const projects = (await this.files.readJson(this.file, ProjectsFile))?.projects ?? [];
    this.held = { stamp, projects };
    return projects;
  }

  async get(id: string): Promise<ProjectRecord | null> {
    return (await this.all()).find((p) => p.id === id) ?? null;
  }

  /** The projects a person is a member of, oldest first. */
  async of(personId: string): Promise<ProjectRecord[]> {
    return (await this.all()).filter((p) => p.members.some((m) => m.personId === personId));
  }

  /**
   * The project an address names: its current slug, or one it had before a rename that has not
   * run out. `movedFrom` is the old address when that is how it was reached.
   */
  async resolve(slug: string): Promise<{ record: ProjectRecord; movedFrom: string | null } | null> {
    const all = await this.all();
    const current = all.find((p) => p.slug === slug);
    if (current) return { record: current, movedFrom: null };
    const at = this.now().getTime();
    const old = all.find((p) =>
      p.previousSlugs.some((o) => o.slug === slug && Date.parse(o.until) > at),
    );
    return old ? { record: old, movedFrom: slug } : null;
  }

  /** Why an address cannot be used for a project, in words; null when it can. */
  async whyNotSlug(slug: string, own: string | null = null): Promise<string | null> {
    if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return "This address is taken.";
    const parsed = ProjectSlug.safeParse(slug);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "This is not a usable address.";
    const at = this.now().getTime();
    const clash = (await this.all()).some(
      (p) =>
        p.id !== own &&
        (p.slug === slug ||
          p.previousSlugs.some((o) => o.slug === slug && Date.parse(o.until) > at)),
    );
    return clash ? "Another project already uses this address." : null;
  }

  /** Adds a project. Refuses an address that is not free. */
  create(
    input: Omit<ProjectRecord, "id" | "createdAt" | "previousSlugs"> & { id?: string },
  ): Promise<ProjectRecord> {
    return this.change(async (projects) => {
      const reason = await this.whyNotSlug(input.slug, null);
      if (reason) throw new ApiError("slug_taken", reason);
      const record: ProjectRecord = {
        ...input,
        id: input.id ?? newProjectId(),
        createdAt: this.now().toISOString(),
        previousSlugs: [],
      };
      return { projects: [...projects, record], result: record };
    });
  }

  /**
   * Changes one project. A new slug leaves the old one working for `OLD_SLUG_DAYS`, and an old
   * address that has run out is forgotten.
   */
  update(id: string, change: (p: ProjectRecord) => ProjectRecord): Promise<ProjectRecord> {
    return this.change(async (projects) => {
      const now = projects.find((p) => p.id === id);
      if (!now) throw new ApiError("no_project", "There is no such project.");
      const next = { ...change(now), id: now.id, createdAt: now.createdAt, layout: now.layout };
      const at = this.now().getTime();
      let previous = next.previousSlugs.filter(
        (o) => Date.parse(o.until) > at && o.slug !== next.slug,
      );
      if (next.slug !== now.slug) {
        const reason = await this.whyNotSlug(next.slug, id);
        if (reason) throw new ApiError("slug_taken", reason);
        previous = [
          ...previous.filter((o) => o.slug !== now.slug),
          { slug: now.slug, until: new Date(at + OLD_SLUG_DAYS * 86_400_000).toISOString() },
        ];
      }
      const record = { ...next, previousSlugs: previous };
      return { projects: projects.map((p) => (p.id === id ? record : p)), result: record };
    });
  }

  remove(id: string): Promise<void> {
    return this.change(async (projects) => ({
      projects: projects.filter((p) => p.id !== id),
      result: undefined,
    }));
  }

  /** Makes the first project, but only while there is none. Returns it, or null when one exists. */
  createIfEmpty(make: () => ProjectRecord): Promise<ProjectRecord | null> {
    return this.change(async (projects) => {
      if (projects.length > 0) return { projects, result: null };
      const record = make();
      return { projects: [record], result: record };
    });
  }

  private change<T>(
    work: (projects: ProjectRecord[]) => Promise<{ projects: ProjectRecord[]; result: T }>,
  ): Promise<T> {
    const run = this.turn.then(async () => {
      const { projects, result } = await work(await this.all());
      const file = ProjectsFile.parse({ version: 1, projects });
      await this.files.writeJson(this.file, file);
      this.held = { stamp: await this.stamp(), projects: file.projects };
      return result;
    });
    this.turn = run.catch(() => undefined);
    return run;
  }
}
