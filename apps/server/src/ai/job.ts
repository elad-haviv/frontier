/** A run of field proposals over a folder, one entry at a time, in the background. */
import type { FieldJobState } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { FieldProposer } from "./fields.js";

export class FieldJob {
  private current: {
    state: FieldJobState["state"];
    folder: string;
    done: number;
    total: number;
    made: number;
    failed: { path: string; message: string }[];
    stoppedBy?: string;
  } = { state: "none", folder: "", done: 0, total: 0, made: 0, failed: [] };
  private cancelled = false;
  private running: Promise<void> | null = null;

  constructor(private readonly proposer: FieldProposer) {}

  snapshot(): FieldJobState {
    return this.current.state === "none" ? { state: "none" } : { ...this.current };
  }

  /** Starts a run. Only one runs at a time. */
  start(folder: string): void {
    if (this.current.state === "running") {
      throw new ApiError("invalid", "A run is going on already. Wait for it or cancel it.");
    }
    const paths = this.proposer.candidates(folder);
    this.cancelled = false;
    this.current = { state: "running", folder, done: 0, total: paths.length, made: 0, failed: [] };
    this.running = this.run(paths);
  }

  cancel(): void {
    if (this.current.state === "running") this.cancelled = true;
  }

  /** Resolves when the current run has ended. For tests. */
  async finished(): Promise<void> {
    await this.running;
  }

  private async run(paths: string[]): Promise<void> {
    for (const path of paths) {
      if (this.cancelled) {
        this.current.state = "cancelled";
        return;
      }
      try {
        this.current.made += await this.proposer.propose(path);
      } catch (err) {
        const code = err instanceof ApiError ? err.code : null;
        const message = err instanceof Error ? err.message : "Something went wrong.";
        // Without a key, a model or money left, no later entry can do better.
        if (code === "ai_off" || code === "ai_cap_reached") {
          this.current.state = "stopped";
          this.current.stoppedBy = message;
          return;
        }
        this.current.failed.push({ path, message });
      }
      this.current.done++;
    }
    this.current.state = "done";
  }
}
