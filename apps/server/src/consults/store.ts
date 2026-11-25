/**
 * The history of Consult (stage 24): each consultation of an entry, kept as a working file in
 * `/data/state/consults.json` beside the comments. Not lore: not in the library, its history or
 * any export. A review holds the AI's summary, verdicts and findings and what the author did
 * with each finding, not the entry's text; a finding holds its passage's words, so the editor
 * finds it again as the text changes. The last `KEEP` reviews of an entry are kept.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { movedPath } from "../publish/publish.js";
import type { StateFiles } from "../state/files.js";
import { KINDS, SEVERITIES, VERDICTS } from "../ai/review.js";

export const KEEP = 20;
/** The questions kept with one finding. */
export const MAX_ASKS = 10;

const Source = z.object({ path: z.string(), title: z.string(), quote: z.string() });
const Ask = z.object({
  question: z.string().max(600),
  reply: z.string().max(8000),
  checked: z.boolean(),
});

export const StoredFinding = z.object({
  id: z.string(),
  kind: z.enum(KINDS),
  severity: z.enum(SEVERITIES),
  certainty: z.enum(["checked", "opinion", "unverified"]),
  anchor: z.string(),
  comment: z.string(),
  suggestion: z.string(),
  sources: z.array(Source),
  /** What the author did: Open until he applies it or dismisses it. */
  state: z.enum(["open", "applied", "dismissed"]).default("open"),
  /** Whether he made a comment from it; independent of the state. */
  commented: z.boolean().default(false),
  /** The words an applied suggestion replaced, and the words put in their place. */
  applied: z.object({ before: z.string(), after: z.string() }).nullable().default(null),
  asks: z.array(Ask).default([]),
});
export type StoredFinding = z.infer<typeof StoredFinding>;

export const Review = z.object({
  id: z.string().regex(/^[a-z0-9]{12}$/),
  path: z.string(),
  at: z.string(),
  /** What was read: the changes, the whole entry, or a selected passage. */
  scope: z.enum(["edits", "content", "passage"]),
  focus: z.enum(["edits", "content"]),
  summary: z.string(),
  overall: z.enum(["no_issues", "minor", "needs_attention"]),
  edits: z.array(
    z.object({
      hunk: z.string(),
      verdict: z.enum(VERDICTS),
      reason: z.string(),
      after: z.string(),
    }),
  ),
  findings: z.array(StoredFinding),
  given: z.array(z.object({ path: z.string(), title: z.string() })),
  changed: z.number(),
  typos: z.number(),
  partial: z.boolean(),
  droppedFindings: z.number(),
  droppedQuotes: z.number(),
});
export type Review = z.infer<typeof Review>;

const File = z.object({ reviews: z.array(Review) });

/** What the author did with a finding; any part may be given. */
export interface FindingChange {
  state?: "open" | "applied" | "dismissed" | undefined;
  commented?: boolean | undefined;
  applied?: { before: string; after: string } | null | undefined;
  ask?: z.infer<typeof Ask> | undefined;
}

export class ConsultStore {
  private readonly file: string;
  /** The reviews, read once; every change goes through `queue`, one after another. */
  private loaded: Promise<Review[]> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    stateDir: string,
    private readonly files: StateFiles,
  ) {
    this.file = join(stateDir, "consults.json");
  }

  private all(): Promise<Review[]> {
    this.loaded ??= this.files.readJson(this.file, File).then((f) => f?.reviews ?? []);
    return this.loaded;
  }

  /** Runs a change after every earlier one, so two at once cannot undo each other. */
  private apply<T>(work: (all: Review[]) => { next: Review[] | null; value: T }) {
    const run = this.queue.then(async () => {
      const { next, value } = work(await this.all());
      if (next) {
        this.loaded = Promise.resolve(next);
        await this.files.writeJson(this.file, { reviews: next });
      }
      return value;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** An entry's reviews, newest first. */
  async forPath(path: string): Promise<Review[]> {
    return (await this.all())
      .filter((r) => r.path === path)
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Keeps a new review and drops the oldest of the entry's beyond the last `KEEP`. */
  add(
    input: Omit<Review, "id" | "at" | "findings"> & {
      findings: Omit<StoredFinding, "state" | "commented" | "applied" | "asks">[];
    },
    now = new Date(),
  ): Promise<Review> {
    return this.apply((all) => {
      const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
      const id = [...randomBytes(12)].map((b) => alphabet[b % 36]).join("");
      const review = Review.parse({ ...input, id, at: now.toISOString() });
      const mine = all
        .filter((r) => r.path === input.path)
        .sort((a, b) => b.at.localeCompare(a.at));
      const drop = new Set(mine.slice(KEEP - 1).map((r) => r.id));
      return { next: [...all.filter((r) => !drop.has(r.id)), review], value: review };
    });
  }

  /** What the author did with one finding: its state, a comment made, words applied, a question. */
  change(id: string, finding: string, change: FindingChange): Promise<Review> {
    return this.apply((all) => {
      const found = all.find((r) => r.id === id);
      if (!found) throw new ApiError("not_found", "That review is not there any more.");
      if (!found.findings.some((f) => f.id === finding)) {
        throw new ApiError("not_found", "That finding is not in the review.");
      }
      const next: Review = {
        ...found,
        findings: found.findings.map((f) =>
          f.id !== finding
            ? f
            : {
                ...f,
                ...(change.state === undefined ? {} : { state: change.state }),
                ...(change.commented === undefined ? {} : { commented: change.commented }),
                ...(change.applied === undefined ? {} : { applied: change.applied }),
                ...(change.ask ? { asks: [...f.asks, change.ask].slice(-MAX_ASKS) } : {}),
              },
        ),
      };
      return { next: all.map((r) => (r.id === id ? next : r)), value: next };
    });
  }

  async remove(id: string): Promise<void> {
    await this.apply((all) => ({
      next: all.some((r) => r.id === id) ? all.filter((r) => r.id !== id) : null,
      value: undefined,
    }));
  }

  /** Every review of an entry. */
  async clear(path: string): Promise<void> {
    await this.apply((all) => ({
      next: all.some((r) => r.path === path) ? all.filter((r) => r.path !== path) : null,
      value: undefined,
    }));
  }

  /** A saved rename: reviews follow their entry, or the entries of a renamed folder. */
  async renamed(from: string, to: string): Promise<void> {
    await this.apply((all) => {
      let changed = false;
      const next = all.map((r) => {
        const moved = movedPath(r.path, from, to);
        if (moved === null) return r;
        changed = true;
        return { ...r, path: moved };
      });
      return { next: changed ? next : null, value: undefined };
    });
  }
}
