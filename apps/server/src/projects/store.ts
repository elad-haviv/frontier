import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  OLD_SLUG_DAYS,
  type ProjectRole,
  ProjectSlug,
  ProjectsFile,
  type ProjectRecord,
  RESERVED_SLUGS,
} from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { StateFiles } from "../state/files.js";

/** How often a member's last activity is written at most. */
export const ACTIVE_EVERY_MS = 5 * 60 * 1000;

const LAST_OWNER = "A project needs at least one owner. Make someone else an owner first.";

/** How many owners a project has. */
export const ownersOf = (p: ProjectRecord): number =>
  p.members.filter((m) => m.role === "owner").length;

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

  /** Who is told when a member is removed or their role changes; see `watchMembers`. */
  private readonly watchers = new Set<
    (projectId: string, personId: string) => void | Promise<void>
  >();

  /**
   * Asks to be told, after the change is written, when a person leaves a project or their role
   * changes. The server uses it to cut the requests and streams that person has open there.
   */
  watchMembers(listener: (projectId: string, personId: string) => void | Promise<void>): void {
    this.watchers.add(listener);
  }

  /** Tells the watchers, and waits for them, so the answer to the change comes after their work. */
  private async told(projectId: string, personId: string): Promise<void> {
    await Promise.all([...this.watchers].map(async (w) => w(projectId, personId)));
  }

  /** A member's role as held in memory right now (no file read); null when they are not one. */
  roleOfSync(projectId: string, personId: string | undefined): ProjectRole | null {
    if (!personId) return null;
    return (
      this.held?.projects
        .find((p) => p.id === projectId)
        ?.members.find((m) => m.personId === personId)?.role ?? null
    );
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

  /**
   * Adds a person to a project with a role. When they are already a member nothing changes and
   * `added` is false (their role is kept as it is). Refuses with `no_project` when the project is
   * gone. Runs inside the store's turn, so two invitations used at once cannot both be lost.
   */
  addMember(
    projectId: string,
    personId: string,
    role: ProjectRole,
  ): Promise<{ added: boolean; record: ProjectRecord }> {
    return this.change(async (projects) => {
      const now = projects.find((p) => p.id === projectId);
      if (!now) throw new ApiError("no_project", "There is no such project.");
      if (now.members.some((m) => m.personId === personId)) {
        return { projects, result: { added: false as boolean, record: now } };
      }
      const record: ProjectRecord = {
        ...now,
        members: [...now.members, { personId, role, addedAt: this.now().toISOString() }],
      };
      return {
        projects: projects.map((p) => (p.id === projectId ? record : p)),
        result: { added: true as boolean, record },
      };
    });
  }

  /**
   * Changes a member's role. The rule that a project keeps an owner is checked here, inside the
   * serialized change, on the members as they are at that moment: two owners demoting each other
   * at once cannot leave the project with none.
   */
  async setRole(projectId: string, personId: string, role: ProjectRole): Promise<ProjectRecord> {
    const { record, changed } = await this.changeRole(projectId, personId, role);
    // The same role again writes nothing and cuts nothing.
    if (changed) await this.told(projectId, personId);
    return record;
  }

  private changeRole(
    projectId: string,
    personId: string,
    role: ProjectRole,
  ): Promise<{ record: ProjectRecord; changed: boolean }> {
    return this.change(async (projects) => {
      const now = projects.find((p) => p.id === projectId);
      const member = now?.members.find((m) => m.personId === personId);
      if (!now || !member) throw new ApiError("not_found", "This person is not a member here.");
      if (member.role === role)
        return { projects, result: { record: now, changed: false as boolean } };
      if (member.role === "owner" && role !== "owner" && ownersOf(now) <= 1) {
        throw new ApiError("last_owner", LAST_OWNER);
      }
      const record = {
        ...now,
        members: now.members.map((m) => (m.personId === personId ? { ...m, role } : m)),
      };
      return {
        projects: projects.map((p) => (p.id === projectId ? record : p)),
        result: { record, changed: true as boolean },
      };
    });
  }

  /** Takes a member out (or lets them leave). The last owner cannot go; checked as `setRole` is. */
  async removeMember(projectId: string, personId: string): Promise<ProjectRecord> {
    const record = await this.takeOut(projectId, personId);
    await this.told(projectId, personId);
    return record;
  }

  private takeOut(projectId: string, personId: string): Promise<ProjectRecord> {
    return this.change(async (projects) => {
      const now = projects.find((p) => p.id === projectId);
      const member = now?.members.find((m) => m.personId === personId);
      if (!now || !member) throw new ApiError("not_found", "This person is not a member here.");
      if (member.role === "owner" && ownersOf(now) <= 1) {
        throw new ApiError("last_owner", LAST_OWNER);
      }
      const record = { ...now, members: now.members.filter((m) => m.personId !== personId) };
      return { projects: projects.map((p) => (p.id === projectId ? record : p)), result: record };
    });
  }

  /**
   * Notes that a member used the project, unless it was noted within `everyMs`. Cheap: it reads
   * what is held in memory and writes the file at most once per person per window. Changes
   * nothing for someone who is not a member (or no longer one).
   */
  touchMember(projectId: string, personId: string, everyMs = ACTIVE_EVERY_MS): Promise<void> {
    // Decided now, before anything waits: ten requests arriving together make one note, not ten.
    const key = `${projectId}:${personId}`;
    const at = this.now();
    const last = this.noted.get(key);
    if (last !== undefined && at.getTime() - last < everyMs) return Promise.resolve();
    this.noted.set(key, at.getTime());
    const work = this.touch(projectId, personId, everyMs, at).catch((err: unknown) => {
      // Not written: the next request may try again.
      this.noted.delete(key);
      throw err;
    });
    this.touching.add(work);
    const done = () => this.touching.delete(work);
    work.then(done, done);
    return work;
  }

  /** Waits for the writes still under way (a last-active note that has not landed), at shutdown. */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.touching]);
    await this.turn;
  }

  private readonly touching = new Set<Promise<void>>();
  /** When each member was last noted by this process, so a burst of requests asks the file once. */
  private readonly noted = new Map<string, number>();

  private async touch(
    projectId: string,
    personId: string,
    everyMs: number,
    at: Date,
  ): Promise<void> {
    // Checked again inside the serialized change, on the file as it is then: a note that landed
    // while this one waited (or one from before a restart) means there is nothing to write.
    await this.change(async (projects) => {
      const member = projects
        .find((p) => p.id === projectId)
        ?.members.find((m) => m.personId === personId);
      if (!member) return { projects, result: undefined };
      if (member.lastActiveAt && at.getTime() - Date.parse(member.lastActiveAt) < everyMs) {
        return { projects, result: undefined };
      }
      return {
        projects: projects.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                members: p.members.map((m) =>
                  m.personId === personId ? { ...m, lastActiveAt: at.toISOString() } : m,
                ),
              },
        ),
        result: undefined,
      };
    }, true);
  }

  async remove(id: string): Promise<void> {
    const members = (await this.get(id))?.members ?? [];
    await this.change(async (projects) => ({
      projects: projects.filter((p) => p.id !== id),
      result: undefined,
    }));
    for (const m of members) await this.told(id, m.personId);
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
    quiet = false,
  ): Promise<T> {
    const run = this.turn.then(async () => {
      const before = await this.all();
      const { projects, result } = await work(before);
      // Nothing was changed: the file is left alone (a refused or repeated change costs no write).
      if (projects === before) return result;
      const file = ProjectsFile.parse({ version: 1, projects });
      await this.files.writeJson(this.file, file, quiet);
      this.held = { stamp: await this.stamp(), projects: file.projects };
      return result;
    });
    this.turn = run.catch(() => undefined);
    return run;
  }
}
