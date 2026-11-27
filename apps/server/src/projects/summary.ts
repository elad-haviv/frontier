import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProjectSummary } from "@frontier/schema";
import type { Services } from "./services.js";

/**
 * What the project list shows of a library that is not open: how many notes and maps it has and
 * when it was last saved. Each project writes this small file when its index changes, so the
 * list never has to open (clone, sync, index and start timers for) every project to count it.
 * The file is a convenience, not data: it can be deleted, and a project without one shows no
 * numbers until it is opened once.
 */
const FILE = "summary.json";

const Stored = z.object({
  entries: z.number().int(),
  maps: z.number().int(),
  lastVersion: z.object({ at: z.string(), by: z.string() }).nullable(),
});

export type Counts = Pick<ProjectSummary, "entries" | "maps" | "lastVersion">;

export const UNKNOWN: Counts = { entries: null, maps: null, lastVersion: null };

/** The counts from the file in a project's state folder; unknown when it is missing or damaged. */
export async function readSummary(stateDir: string): Promise<Counts> {
  try {
    return Stored.parse(JSON.parse(await readFile(join(stateDir, FILE), "utf8")));
  } catch {
    return UNKNOWN;
  }
}

/** The counts of an open project, read from its index (and Git for the last version). */
export async function countsOf(open: Services): Promise<Counts> {
  return {
    entries: open.index.allNotes().length,
    maps: (await open.maps.list()).length,
    lastVersion: await open.git.lastVersion(),
  };
}

/**
 * Keeps the file up to date for one project: call `noteIndexed` after each sync. It writes only
 * when the index was built from another commit than the file was last written for, and never
 * after the project was closed (a deleted project's folder must not be made again). A failure to
 * write is not an error: the list just shows no numbers.
 */
export class SummaryWriter {
  private written: string | null = null;
  private closed = false;

  constructor(private readonly stateDir: string) {}

  close(): void {
    this.closed = true;
  }

  async noteIndexed(open: Services): Promise<void> {
    const commit = open.index.commit;
    if (this.closed || commit === null || commit === this.written) return;
    try {
      const counts = await countsOf(open);
      if (this.closed) return;
      await mkdir(this.stateDir, { recursive: true });
      if (this.closed) return;
      await writeFile(join(this.stateDir, FILE), JSON.stringify(counts) + "\n");
      this.written = commit;
    } catch {
      /* the numbers are shown the next time the index changes */
    }
  }
}
