/**
 * The record of every call to the AI provider, one line per attempt, a file per month. The
 * month's spending is summed from it, for the spending page.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CostKind } from "@frontier/schema";
import { z } from "zod";

export const AiCall = z.object({
  at: z.string(),
  task: z.string(),
  /** Provider-qualified since stage 18; a bare id in an older line is OpenRouter's. */
  model: z.string(),
  /** The provider id; absent in lines written before stage 18, which were all OpenRouter's. */
  provider: z.string().optional(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  costUsd: z.number(),
  /**
   * How the cost is known: told by the provider, estimated from prices and tokens, or unknown
   * (then `costUsd` is 0). Absent in older lines, whose cost OpenRouter reported.
   */
  costKind: CostKind.optional(),
  /** Who made the call (their id). Absent in lines written before stage 27f: the admin's. */
  person: z.string().optional(),
  /** The entry the call was about, when there is one. */
  entry: z.string().nullable(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type AiCall = z.infer<typeof AiCall>;

/** The calendar month of a moment, in UTC, as "2026-11". */
export const monthOf = (at: Date): string => at.toISOString().slice(0, 7);

/** Who is asking about the log: a person sees their own calls, and the admin the old ones too. */
export interface LogViewer {
  id: string;
  admin: boolean;
}

/** Whether a call is the viewer's own. Lines from before calls named a person are the admin's. */
export const isMine = (c: AiCall, v: LogViewer): boolean =>
  c.person !== undefined ? c.person === v.id : v.admin;

export class AiLog {
  private readonly dir: string;
  private totals = new Map<string, number>();
  private mine = new Map<string, number>();

  constructor(
    stateDir: string,
    /** Called after each line is written, so the backup notices the change. */
    private readonly onWrite: () => void = () => undefined,
  ) {
    this.dir = join(stateDir, "ai-log");
  }

  private file(month: string): string {
    return join(this.dir, `${month}.jsonl`);
  }

  /** Every call of a month, oldest first. Lines that cannot be read are skipped. */
  async calls(month: string): Promise<AiCall[]> {
    if (!/^\d{4}-\d{2}$/.test(month)) return [];
    let text: string;
    try {
      text = await readFile(this.file(month), "utf8");
    } catch {
      return [];
    }
    const out: AiCall[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed = AiCall.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* a half-written last line after a crash */
      }
    }
    return out;
  }

  /** One person's calls of a month, oldest first. */
  async callsOf(month: string, viewer: LogViewer): Promise<AiCall[]> {
    return (await this.calls(month)).filter((c) => isMine(c, viewer));
  }

  /** What was spent in a month by everyone, in US dollars. */
  async spent(month: string): Promise<number> {
    const known = this.totals.get(month);
    if (known !== undefined) return known;
    const total = (await this.calls(month)).reduce((sum, c) => sum + c.costUsd, 0);
    this.totals.set(month, total);
    return total;
  }

  /** What one person spent in a month, in US dollars. */
  async spentBy(month: string, viewer: LogViewer): Promise<number> {
    const key = `${month}|${viewer.id}|${viewer.admin}`;
    const known = this.mine.get(key);
    if (known !== undefined) return known;
    const total = (await this.callsOf(month, viewer)).reduce((sum, c) => sum + c.costUsd, 0);
    this.mine.set(key, total);
    return total;
  }

  async append(call: AiCall): Promise<void> {
    const month = call.at.slice(0, 7);
    const before = await this.spent(month);
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file(month), JSON.stringify(call) + "\n");
    this.totals.set(month, before + call.costUsd);
    this.mine.clear();
    this.onWrite();
  }
}
