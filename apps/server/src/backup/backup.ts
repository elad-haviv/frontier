/**
 * Copies the working files to a backup target.
 *
 *   latest/            mirrors the folders now, including deletions, a few minutes after any change
 *   nightly/<date>/    a full copy each night, kept for 14 days
 *
 * Working files are the only data that cannot be rebuilt from the vault repository.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BackupState } from "@frontier/schema";
import { outsideRequest } from "../ai/keyring.js";
import { SUMMARY_FILE } from "../projects/summary.js";
import type { BackupTarget } from "./targets.js";

export interface BackupOptions {
  /** Folders to back up, each under a name: { state: "/data/state", generated: "/data/assets/generated" }. */
  sources: Record<string, string>;
  target: BackupTarget;
  /** Where the time of the last copy is recorded. It is not itself backed up. */
  stateFile: string;
  /** How long after the first unsaved change a copy runs. */
  delayMs?: number;
  keepNights?: number;
  onResult?: (state: BackupState) => void;
  now?: () => Date;
  /** Told after each file of a draft's folder is read. Used by tests, to write in between. */
  afterDraftRead?: (path: string) => Promise<void> | void;
}

const MANIFEST = "latest/.manifest.json";

/** A draft's folder under the state folder: `drafts/<id>/`, but not the renames' folder. */
const DRAFT_FOLDER = /^drafts\/(?!renames\/)[^/]+(?=\/)/;
/** How many times a draft's folder is read again when its record moves meanwhile. */
const DRAFT_READ_TRIES = 5;

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  if (!existsSync(join(root, rel))) return out;
  for (const name of (await readdir(join(root, rel))).sort()) {
    const child = rel === "" ? name : `${rel}/${name}`;
    if ((await stat(join(root, child))).isDirectory()) out.push(...(await walk(root, child)));
    // Files still being written are skipped; they are renamed into place a moment later.
    else if (!name.endsWith(".tmp")) out.push(child);
  }
  return out;
}

const sha = (data: Buffer) => createHash("sha1").update(data).digest("hex");
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Milliseconds from `now` until the next time the clock shows `hour`:00. */
export function msUntilHour(hour: number, now: Date): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export class Backup {
  private timer: NodeJS.Timeout | undefined;
  private nightly: NodeJS.Timeout | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  /** Set when the project is gone: nothing is written for it any more. */
  private retired = false;
  private readonly delayMs: number;
  private readonly keepNights: number;
  private readonly now: () => Date;

  constructor(private readonly o: BackupOptions) {
    this.delayMs = o.delayMs ?? 5 * 60 * 1000;
    this.keepNights = o.keepNights ?? 14;
    this.now = o.now ?? (() => new Date());
  }

  /** Call on every write to the working files. The copy runs once, `delayMs` after the first call. */
  noteChange(): void {
    if (this.timer) return;
    // Armed outside the request that made the change, so the timer never carries its AI keys.
    this.timer = outsideRequest(() =>
      setTimeout(() => {
        this.timer = undefined;
        void this.runNow();
      }, this.delayMs),
    );
    this.timer.unref();
  }

  /** Starts the nightly copy at 03:00 server time. */
  startNightly(): void {
    const schedule = () => {
      this.nightly = setTimeout(
        () => {
          void this.runNightly().finally(schedule);
        },
        msUntilHour(3, this.now()),
      );
      this.nightly.unref();
    };
    schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
    clearTimeout(this.nightly);
    this.timer = undefined;
  }

  /** The project is gone: stops, and writes nothing more, so its folder is not made again. */
  retire(): void {
    this.retired = true;
    this.stop();
  }

  async lastState(): Promise<BackupState> {
    if (!existsSync(this.o.stateFile)) return { lastSuccessAt: null, lastError: null };
    try {
      return BackupState.parse(JSON.parse(await readFile(this.o.stateFile, "utf8")));
    } catch {
      return { lastSuccessAt: null, lastError: null };
    }
  }

  private async record(error: string | null): Promise<BackupState> {
    const previous = await this.lastState();
    const state: BackupState = {
      lastSuccessAt: error === null ? this.now().toISOString() : previous.lastSuccessAt,
      lastError: error,
    };
    if (!this.retired) {
      await mkdir(dirname(this.o.stateFile), { recursive: true });
      await writeFile(this.o.stateFile, JSON.stringify(state, null, 2) + "\n");
    }
    this.o.onResult?.(state);
    return state;
  }

  /** One job at a time: a copy never overlaps another. */
  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async files(): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    for (const [name, dir] of Object.entries(this.o.sources)) {
      const folders = new Map<string, string[]>();
      for (const rel of await walk(dir)) {
        const full = join(dir, rel);
        if (full === this.o.stateFile) continue;
        // The list's counts of a project are worked out again when it opens; they are not data.
        if (name === "state" && rel === SUMMARY_FILE) continue;
        // A draft's files are one thing, copied together (below).
        const draft = name === "state" ? DRAFT_FOLDER.exec(rel)?.[0] : undefined;
        if (draft !== undefined) folders.set(draft, [...(folders.get(draft) ?? []), rel]);
        else out.set(`${name}/${rel}`, await readFile(full));
      }
      for (const [folder, rels] of folders) {
        for (const [rel, data] of await this.draftFolder(dir, folder, rels)) {
          out.set(`${name}/${rel}`, data);
        }
      }
    }
    return out;
  }

  /**
   * A draft's folder as one consistent copy. The store writes a draft's text and then its record (so
   * a record never names text that is not there), and a kept copy's text and then its record: the
   * record is read first here, then the text, then the record again, and the folder is read again if
   * the record moved meanwhile, so the copy never holds a record newer than its text. A folder that
   * is removed while it is read (a discard) is not copied.
   */
  private async draftFolder(
    dir: string,
    folder: string,
    rels: string[],
  ): Promise<Map<string, Buffer>> {
    const records = rels.filter((r) => r.endsWith(".json"));
    const texts = rels.filter((r) => !r.endsWith(".json"));
    const main = `${folder}/record.json`;
    for (let attempt = 0; ; attempt++) {
      const got = new Map<string, Buffer>();
      try {
        for (const rel of [...records, ...texts]) {
          got.set(rel, await readFile(join(dir, rel)));
          await this.o.afterDraftRead?.(rel);
        }
        const again = records.includes(main) ? await readFile(join(dir, main)) : null;
        if (again === null || again.equals(got.get(main)!) || attempt >= DRAFT_READ_TRIES) {
          return got;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
        throw err;
      }
    }
  }

  /** Brings `latest/` in line with the folders: uploads what changed and removes what is gone. */
  runNow(): Promise<BackupState> {
    clearTimeout(this.timer);
    this.timer = undefined;
    return this.exclusive(async () => {
      try {
        const { target } = this.o;
        const local = await this.files();
        const raw = await target.get(MANIFEST);
        const known: Record<string, string> = raw
          ? (JSON.parse(raw.toString("utf8")) as Record<string, string>)
          : {};
        const next: Record<string, string> = {};
        for (const [path, data] of local) {
          const hash = sha(data);
          next[path] = hash;
          if (known[path] !== hash) await target.put(`latest/${path}`, data);
        }
        for (const key of await target.list("latest/")) {
          const path = key.slice("latest/".length);
          if (key !== MANIFEST && !(path in next)) await target.remove(key);
        }
        await target.put(MANIFEST, Buffer.from(JSON.stringify(next, null, 2)));
        return await this.record(null);
      } catch (err) {
        return await this.record((err as Error).message || "The backup failed.");
      }
    });
  }

  /** Writes a full copy under tonight's date and removes copies older than `keepNights`. */
  runNightly(): Promise<BackupState> {
    return this.exclusive(async () => {
      try {
        const { target } = this.o;
        const today = day(this.now());
        for (const [path, data] of await this.files())
          await target.put(`nightly/${today}/${path}`, data);
        await target.put(`nightly/${today}/.complete`, Buffer.from(this.now().toISOString()));
        const nights = [
          ...new Set((await target.list("nightly/")).map((k) => k.split("/")[1]!)),
        ].sort();
        for (const night of nights.slice(0, Math.max(0, nights.length - this.keepNights))) {
          for (const key of await target.list(`nightly/${night}/`)) await target.remove(key);
        }
        return await this.record(null);
      } catch (err) {
        return await this.record((err as Error).message || "The nightly backup failed.");
      }
    });
  }
}

/**
 * Fills the given folders from a backup. `from` is "latest" or a night such as "2026-11-20".
 * Refuses to write into a folder that already holds files, so a restore cannot overwrite work.
 */
export async function restore(
  target: BackupTarget,
  sources: Record<string, string>,
  from = "latest",
  /**
   * Restores only the files this accepts (a source's name, and the path in it); the rest is left
   * alone, and the folders need not be empty, only free of the files to be written.
   */
  include?: (source: string, rel: string) => boolean,
): Promise<{ files: number; from: string }> {
  const prefix = from === "latest" ? "latest/" : `nightly/${from}/`;
  const keys = (await target.list(prefix)).filter(
    (k) => !k.endsWith("/.manifest.json") && !k.endsWith("/.complete"),
  );
  if (keys.length === 0) throw new Error(`There is no backup under "${prefix}".`);
  if (include === undefined) {
    for (const [name, dir] of Object.entries(sources)) {
      if ((await walk(dir)).length > 0) {
        throw new Error(`"${dir}" (${name}) is not empty. Restore only into an empty folder.`);
      }
    }
  } else {
    // A part of a folder, such as one project among the server's own files: the folder is not
    // empty, so what is refused is writing over a file that is there.
    for (const key of keys) {
      const rel = key.slice(prefix.length);
      const name = rel.split("/")[0]!;
      const dir = sources[name];
      if (!dir || !include(name, rel.slice(name.length + 1))) continue;
      const path = join(dir, rel.slice(name.length + 1));
      if (existsSync(path)) {
        throw new Error(`"${path}" is already there. Restore only where the files are gone.`);
      }
    }
  }
  let files = 0;
  for (const key of keys) {
    const rel = key.slice(prefix.length);
    const name = rel.split("/")[0]!;
    const dir = sources[name];
    if (!dir || (include && !include(name, rel.slice(name.length + 1)))) continue;
    const data = await target.get(key);
    if (data === null) continue;
    const path = join(dir, rel.slice(name.length + 1));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    files++;
  }
  return { files, from: prefix };
}
