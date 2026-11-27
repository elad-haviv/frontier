/**
 * A run of field proposals over a folder (stage 27f), driven from the browser: the server lists the
 * entries, and the browser asks for the proposals one entry at a time with the key of this device.
 * Nothing goes on after the page is left, so no key has to outlive a request. What was left is
 * kept on this device, per person, and can be continued.
 */
import { currentProject } from "./project.ts";
import { readOwn, writeOwn } from "./personStorage.ts";

export interface RunProgress {
  folder: string;
  total: number;
  done: number;
  made: number;
  failed: { path: string; message: string }[];
}

export interface RunLeft extends RunProgress {
  /** The entries not read yet. */
  remaining: string[];
}

export type RunEnd =
  | { state: "done" }
  | { state: "cancelled" }
  /** No later entry can do better: no model, no key, or a key the provider turned away. */
  | { state: "stopped"; why: string };

const WHAT = "folderRun";
/** Errors after which no later entry can do better. */
const STOPS = new Set(["ai_off", "ai_key_missing", "ai_key_rejected"]);

const asLeft = (raw: unknown): RunLeft | null => {
  const r = raw as Partial<RunLeft> | null;
  return r &&
    typeof r.folder === "string" &&
    Array.isArray(r.remaining) &&
    r.remaining.length > 0 &&
    typeof r.total === "number"
    ? {
        folder: r.folder,
        remaining: r.remaining.filter((p): p is string => typeof p === "string"),
        total: r.total,
        done: Number(r.done) || 0,
        made: Number(r.made) || 0,
        failed: Array.isArray(r.failed) ? r.failed : [],
      }
    : null;
};

/** A run that was left before it ended, for this person, or null. */
export const runLeft = (): RunLeft | null => readOwn(WHAT, asLeft);

/** Forgets the run that was left. */
export const forgetRun = (project: string | undefined = currentProject()?.id): void =>
  writeOwn(WHAT, null, project);

/**
 * Reads the entries one at a time. After each, `onProgress` says how far it got and what is left is
 * kept on the device. Stops between entries when `signal` aborts.
 */
export async function runFolder(
  start: RunProgress,
  paths: readonly string[],
  propose: (path: string) => Promise<{ made: number }>,
  signal: AbortSignal,
  onProgress: (p: RunProgress) => void,
): Promise<RunEnd> {
  const progress: RunProgress = { ...start, failed: [...start.failed] };
  // What is left is kept for the project the run began in, even if the page is left for another.
  const project = currentProject()?.id;
  const keep = (rest: string[]) =>
    writeOwn(WHAT, rest.length > 0 ? { ...progress, remaining: rest } : null, project);
  for (let i = 0; i < paths.length; i++) {
    const rest = paths.slice(i);
    if (signal.aborted) {
      keep(rest);
      return { state: "cancelled" };
    }
    try {
      progress.made += (await propose(paths[i]!)).made;
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      const message = err instanceof Error ? err.message : "Something went wrong.";
      if (STOPS.has(code)) {
        keep(rest);
        return { state: "stopped", why: message };
      }
      progress.failed.push({ path: paths[i]!, message });
    }
    progress.done++;
    keep(paths.slice(i + 1));
    onProgress({ ...progress, failed: [...progress.failed] });
  }
  forgetRun(project);
  return { state: "done" };
}
