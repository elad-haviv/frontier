/**
 * What the library's saved versions say about the work: this week's numbers, entries first written
 * or last changed on this date in earlier months, and how long each entry has been left alone.
 * The log is read once for each build of the index and kept until the next one.
 */
import { OLD_MONTHS, type OnThisDayRow, type WeekDay, type WeekResponse } from "@frontier/schema";
import type { LoggedCommit, WordCommit } from "../git/gateway.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import { derive, listable } from "./derived.js";

const DAY = 24 * 60 * 60 * 1000;
const ON_THIS_DAY_ROWS = 4;

export interface HistoryDeps {
  git: Pick<GitGateway, "changeLog" | "wordChanges">;
  index: VaultIndex;
  now?: () => Date;
}

/** When each entry was first written and last changed, in milliseconds since 1970. */
export interface Ages {
  created: Map<string, number>;
  changed: Map<string, number>;
}

/** "YYYY-MM-DD" for a moment, in the time zone `tz` minutes east of UTC. */
export function dayOf(ms: number, tz: number): string {
  return new Date(ms + tz * 60_000).toISOString().slice(0, 10);
}

/** The day `months` calendar months before a "YYYY-MM-DD", the 31st becoming a month's last day. */
export function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export class KeepGoingHistory {
  private ages: { generation: number; read: Promise<Ages> } | null = null;
  private week = new Map<string, { generation: number; read: Promise<WeekResponse> }>();

  constructor(private readonly d: HistoryDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  /** When each entry was first written and last changed, from the whole log. */
  agesOfEntries(): Promise<Ages> {
    const generation = this.d.index.generation;
    if (this.ages?.generation !== generation) {
      const read = this.d.git.changeLog().then((log) => agesFrom(log));
      // A log that cannot be read is tried again next time, not remembered.
      read.catch(() => {
        if (this.ages?.read === read) this.ages = null;
      });
      this.ages = { generation, read };
    }
    return this.ages.read;
  }

  /** Entries not changed for six months or more, by path. Every entry the log never names counts. */
  async untouched(): Promise<Set<string>> {
    const { changed } = await this.agesOfEntries().catch(() => ({
      changed: new Map<string, number>(),
    }));
    const until = this.now();
    until.setUTCMonth(until.getUTCMonth() - OLD_MONTHS);
    const cutoff = until.getTime();
    const out = new Set<string>();
    for (const note of derive(this.d.index).entries) {
      const at = changed.get(note.path);
      if (at === undefined || at < cutoff) out.add(note.path);
    }
    return out;
  }

  /** This week's numbers and the entries of earlier months on this date. */
  weekAndOnThisDay(tz: number): Promise<WeekResponse> {
    const now = this.now();
    const today = dayOf(now.getTime(), tz);
    const key = `${today}|${tz}`;
    const generation = this.d.index.generation;
    const known = this.week.get(key);
    if (known?.generation === generation) return known.read;
    const read = this.makeWeek(now, tz);
    read.catch(() => {
      if (this.week.get(key)?.read === read) this.week.delete(key);
    });
    // Only the latest day is kept.
    this.week.clear();
    this.week.set(key, { generation, read });
    return read;
  }

  private async makeWeek(now: Date, tz: number): Promise<WeekResponse> {
    const today = dayOf(now.getTime(), tz);
    const days: WeekDay[] = [];
    for (let back = 6; back >= 0; back--) {
      days.push({ date: dayOf(now.getTime() - back * DAY, tz), entries: 0, words: 0 });
    }
    const firstDay = days[0]!.date;
    // The start of the first day, in the reader's zone, as a moment.
    const since = new Date(Date.parse(`${firstDay}T00:00:00Z`) - tz * 60_000).toISOString();

    const [log, patches, ages] = await Promise.all([
      this.d.git.changeLog({ since }),
      this.d.git.wordChanges(since),
      this.agesOfEntries().catch(() => ({
        created: new Map<string, number>(),
        changed: new Map<string, number>(),
      })),
    ]);
    return {
      week: weekFrom(this.d.index, log, patches, days, tz),
      onThisDay: onThisDay(this.d.index, ages, today, tz),
    };
  }
}

/** When each file was first written and last changed, from the log, which is newest first. */
export function agesFrom(log: LoggedCommit[]): Ages {
  const created = new Map<string, number>();
  const changed = new Map<string, number>();
  const oldest = new Map<string, number>();
  for (const commit of log) {
    const at = Date.parse(commit.at);
    for (const { status, path } of commit.changes) {
      if (status === "D") continue;
      if (!changed.has(path)) changed.set(path, at);
      // Walking back in time, so the last write wins: the oldest "added" is the creation.
      if (status === "A") created.set(path, at);
      oldest.set(path, at);
    }
  }
  // A file the log never saw added was there before the log starts.
  for (const [path, at] of oldest) if (!created.has(path)) created.set(path, at);
  return { created, changed };
}

function weekFrom(
  index: VaultIndex,
  log: LoggedCommit[],
  patches: WordCommit[],
  days: WeekDay[],
  tz: number,
): WeekResponse["week"] {
  const d = derive(index);
  const byDay = new Map(days.map((day) => [day.date, day]));
  const touched = new Set<string>();
  const perDay = new Map<string, Set<string>>();
  const written = new Set<string>();
  for (const commit of log) {
    const day = dayOf(Date.parse(commit.at), tz);
    // A commit dated after today (a clock that is wrong) is no part of this week.
    if (!byDay.has(day)) continue;
    const made = new Set(commit.changes.filter((c) => c.status === "A").map((c) => c.path));
    for (const { status, path } of commit.changes) {
      if (status === "D" || !listable(path) || !d.byPath.has(path)) continue;
      touched.add(path);
      const set = perDay.get(day) ?? new Set<string>();
      set.add(path);
      perDay.set(day, set);
      // An entry written this week that something other than its own commit already linked to.
      if (status === "A" && (d.inbound.get(path) ?? []).some((from) => !made.has(from))) {
        written.add(path);
      }
    }
  }
  let wordsAdded = 0;
  for (const commit of patches) {
    const day = byDay.get(dayOf(Date.parse(commit.at), tz));
    if (!day) continue;
    for (const file of commit.files) {
      if (file.deleted || !listable(file.path) || !d.byPath.has(file.path)) continue;
      const net = Math.max(0, file.added - file.removed);
      wordsAdded += net;
      day.words += net;
    }
  }
  for (const day of days) day.entries = perDay.get(day.date)?.size ?? 0;
  return {
    entriesTouched: touched.size,
    wordsAdded,
    linksFilled: written.size,
    days,
  };
}

function onThisDay(index: VaultIndex, ages: Ages, today: string, tz: number): OnThisDayRow[] {
  const d = derive(index);
  const spans = [
    ["month", 1],
    ["sixMonths", 6],
    ["year", 12],
  ] as const;
  const out: OnThisDayRow[] = [];
  for (const [span, months] of spans) {
    const date = monthsBefore(today, months);
    const rows: OnThisDayRow[] = [];
    for (const note of d.entries) {
      const made = ages.created.get(note.path);
      const changed = ages.changed.get(note.path);
      if (made !== undefined && dayOf(made, tz) === date) {
        rows.push({ span, date, kind: "written", path: note.path, title: note.title });
      } else if (changed !== undefined && dayOf(changed, tz) === date) {
        rows.push({ span, date, kind: "changed", path: note.path, title: note.title });
      }
    }
    // Written entries first, then by title.
    rows.sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "written" ? -1 : 1) || a.title.localeCompare(b.title),
    );
    out.push(...rows.slice(0, ON_THIS_DAY_ROWS));
  }
  return out;
}
