/**
 * Pins: the entries the author is working on, in `.frontier/pins.json`. The file is one of the
 * library's item files, saved at once like the folder file and published with the next version.
 * A pin whose entry is gone is left out when the list is read and dropped by the next change.
 */
import { MAX_PINS, type PinsFile, type PinsResponse } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import type { LibraryFileStore } from "../library/files.js";
import type { DraftStore } from "../state/drafts.js";

export interface PinStoreDeps {
  index: VaultIndex;
  drafts: DraftStore;
  files: LibraryFileStore;
}

export class PinStore {
  constructor(private readonly d: PinStoreDeps) {}

  private file(): PinsFile {
    return this.d.files.current("pins").file as PinsFile;
  }

  /** Whether an entry exists: published and not marked for deletion, or a new draft. */
  private exists(path: string): boolean {
    const draft = this.d.drafts.byPath(path);
    if (draft) return draft.kind !== "delete" && !draft.binary;
    return this.d.index.note(path) !== undefined;
  }

  /** The paths of the pins whose entries still exist, in order. */
  paths(): string[] {
    return this.file()
      .pins.map((p) => p.path)
      .filter((p) => this.exists(p));
  }

  /** The pinned entries that still exist, in order, with their names. */
  async list(
    titleOf: (path: string) => string,
    wordsOf: (path: string) => number,
  ): Promise<PinsResponse> {
    return {
      pins: this.paths().map((path) => ({ path, title: titleOf(path), words: wordsOf(path) })),
    };
  }

  private async write(paths: string[]): Promise<void> {
    await this.d.files.change("pins", (file) => ({
      ...(file as PinsFile),
      pins: paths.map((path) => ({ path })),
    }));
  }

  async add(path: string): Promise<void> {
    if (!this.exists(path)) throw new ApiError("not_found", `There is no entry at "${path}".`);
    const now = this.paths();
    if (now.includes(path)) return;
    if (now.length >= MAX_PINS) {
      throw new ApiError("invalid", `You can pin up to ${MAX_PINS} entries. Unpin one first.`);
    }
    await this.write([...now, path]);
  }

  async remove(path: string): Promise<void> {
    const now = this.paths();
    // Dead pins go with the next change; with none to drop and none to remove, nothing is written.
    if (!now.includes(path) && now.length === this.file().pins.length) return;
    await this.write(now.filter((p) => p !== path));
  }

  /** Puts the pins in the order given; those not named keep their order after the named ones. */
  async reorder(order: string[]): Promise<void> {
    const now = this.paths();
    const named = order.filter((p, i) => now.includes(p) && order.indexOf(p) === i);
    const next = [...named, ...now.filter((p) => !named.includes(p))];
    if (
      next.join("\n") ===
      this.file()
        .pins.map((p) => p.path)
        .join("\n")
    )
      return;
    await this.write(next);
  }
}
