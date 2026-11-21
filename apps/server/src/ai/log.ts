/**
 * The record of every call to the AI provider, one line per attempt, a file per month. The
 * month's spending is summed from it and held against the author's cap.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const AiCall = z.object({
  at: z.string(),
  task: z.string(),
  model: z.string(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  costUsd: z.number(),
  /** The entry the call was about, when there is one. */
  entry: z.string().nullable(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type AiCall = z.infer<typeof AiCall>;

/** The calendar month of a moment, in UTC, as "2026-11". */
export const monthOf = (at: Date): string => at.toISOString().slice(0, 7);

export class AiLog {
  private readonly dir: string;
  private totals = new Map<string, number>();

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

  /** What was spent in a month, in US dollars. */
  async spent(month: string): Promise<number> {
    const known = this.totals.get(month);
    if (known !== undefined) return known;
    const total = (await this.calls(month)).reduce((sum, c) => sum + c.costUsd, 0);
    this.totals.set(month, total);
    return total;
  }

  async append(call: AiCall): Promise<void> {
    const month = call.at.slice(0, 7);
    const before = await this.spent(month);
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file(month), JSON.stringify(call) + "\n");
    this.totals.set(month, before + call.costUsd);
    this.onWrite();
  }
}
