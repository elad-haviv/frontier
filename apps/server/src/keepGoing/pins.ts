/**
 * Pins: the entries a person is working on ("Working on"), kept for each person in each project in
 * `state/pins.json`. They are the person's own, so they are a working file, not part of the
 * library: they are not an unsaved change, and other members of the project never see them.
 *
 * A server from before projects kept them in the library's `.frontier/pins.json`; those pins belong
 * to the project's first owner, who is the one person there was. That file is read when the owner
 * has none kept yet, and is left as it is: the first change the owner makes writes their list here.
 *
 * A pin whose entry is gone is left out when the list is read and dropped by the next change.
 */
import { join } from "node:path";
import { z } from "zod";
import { MAX_PINS, type PinsFile, type PinsResponse } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import { movedPath } from "../publish/publish.js";
import type { LibraryFileStore } from "../library/files.js";
import type { DraftStore } from "../state/drafts.js";
import type { StateFiles } from "../state/files.js";

export interface PinStoreDeps {
  index: VaultIndex;
  drafts: DraftStore;
  /** Where a server from before projects kept its pins. */
  files: LibraryFileStore;
  state: StateFiles;
  stateDir: string;
  /** The person whose pins the library's old pins file holds; null for a project made since. */
  legacyOwner: () => string | null;
}

const Kept = z.object({
  version: z.literal(1).default(1),
  people: z.record(z.string(), z.array(z.string())).default({}),
});
type Kept = z.infer<typeof Kept>;

export class PinStore {
  private readonly file: string;
  private loaded: Promise<Kept> | null = null;
  /** Changes run one after another, so two at once cannot undo each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: PinStoreDeps) {
    this.file = join(d.stateDir, "pins.json");
  }

  private all(): Promise<Kept> {
    this.loaded ??= this.d.state
      .readJson(this.file, Kept)
      .then((k) => k ?? { version: 1 as const, people: {} });
    return this.loaded;
  }

  /** Whether an entry exists: published and not marked for deletion, or a new draft. */
  private exists(path: string): boolean {
    const draft = this.d.drafts.byPath(path);
    if (draft) return draft.kind !== "delete" && !draft.binary;
    return this.d.index.note(path) !== undefined;
  }

  /** The paths a person has pinned, dead ones included, in order. */
  private stored(kept: Kept, person: string): string[] {
    const own = kept.people[person];
    if (own) return own;
    if (person !== this.d.legacyOwner()) return [];
    return (this.d.files.current("pins").file as PinsFile).pins.map((p) => p.path);
  }

  private live(kept: Kept, person: string): string[] {
    return this.stored(kept, person).filter((p) => this.exists(p));
  }

  /** The paths of a person's pins whose entries still exist, in order. */
  async paths(person: string): Promise<string[]> {
    return this.live(await this.all(), person);
  }

  /** The pinned entries that still exist, in order, with their names. */
  async list(
    person: string,
    titleOf: (path: string) => string,
    wordsOf: (path: string) => number,
  ): Promise<PinsResponse> {
    return {
      pins: (await this.paths(person)).map((path) => ({
        path,
        title: titleOf(path),
        words: wordsOf(path),
      })),
    };
  }

  /**
   * Changes a person's pins as they are when this change's turn comes. `next` gets the live paths
   * and returns the new ones, or null to leave things be; a dead pin goes with the next change
   * that writes.
   */
  private edit(
    person: string,
    next: (now: string[], stored: string[]) => string[] | null,
  ): Promise<void> {
    const run = this.queue.then(async () => {
      const kept = await this.all();
      const paths = next(this.live(kept, person), this.stored(kept, person));
      if (paths === null) return;
      const now: Kept = { ...kept, people: { ...kept.people, [person]: paths } };
      await this.d.state.writeJson(this.file, now);
      this.loaded = Promise.resolve(now);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async add(person: string, path: string): Promise<void> {
    await this.edit(person, (now) => {
      if (!this.exists(path)) throw new ApiError("not_found", `There is no entry at "${path}".`);
      if (now.includes(path)) return null;
      if (now.length >= MAX_PINS) {
        throw new ApiError("invalid", `You can pin up to ${MAX_PINS} entries. Unpin one first.`);
      }
      return [...now, path];
    });
  }

  async remove(person: string, path: string): Promise<void> {
    // Dead pins go with the next change; with none to drop and none to remove, nothing is written.
    await this.edit(person, (now, stored) =>
      !now.includes(path) && now.length === stored.length ? null : now.filter((p) => p !== path),
    );
  }

  /** Puts the pins in the order given; those not named keep their order after the named ones. */
  async reorder(person: string, order: string[]): Promise<void> {
    await this.edit(person, (now, stored) => {
      const named = order.filter((p, i) => now.includes(p) && order.indexOf(p) === i);
      const next = [...named, ...now.filter((p) => !named.includes(p))];
      return next.join("\n") === stored.join("\n") ? null : next;
    });
  }

  /** A saved rename: every person's pins follow their entry, or the entries of a renamed folder. */
  renamed(from: string, to: string): Promise<void> {
    const run = this.queue.then(async () => {
      const kept = await this.all();
      // The old library file's pins follow too, for the person who still reads them from there.
      const people = { ...kept.people };
      const owner = this.d.legacyOwner();
      if (owner && !people[owner]) people[owner] = this.stored(kept, owner);
      let changed = false;
      for (const [person, paths] of Object.entries(people)) {
        people[person] = paths.map((p) => {
          const moved = movedPath(p, from, to);
          if (moved === null) return p;
          changed = true;
          return moved;
        });
      }
      if (!changed) return;
      const now: Kept = { ...kept, people };
      await this.d.state.writeJson(this.file, now);
      this.loaded = Promise.resolve(now);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
