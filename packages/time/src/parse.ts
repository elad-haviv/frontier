/**
 * Reading what the author types into a date box (stage 17), and writing a stored number back in
 * the same short forms. Every box takes the same words:
 *
 *   300 · 270-290 · about 280 · 280 ±10 · -50 · 50 before · open
 *   3-5 generations (a length, in one of the author's units)
 *   with First Landing · 10 after The war · 20-40 before The kingdom (ties)
 *
 * The parser turns them into the numbers the chronicle file stores. The words themselves are kept
 * by the caller, as they always were, and are never read again.
 */
import type { Range, RoughLength, Tie, Unit } from "./types.js";

export type WhenPart = "start" | "end" | "length";

export type Parsed =
  | { readonly kind: "empty" }
  | { readonly kind: "open" }
  /** A year (for a start or an end) or a number of years (for a length). */
  | { readonly kind: "years"; readonly low: number; readonly high: number; readonly words: string }
  /** A length typed as a count of one of the author's units. */
  | {
      readonly kind: "count";
      readonly low: number;
      readonly high: number;
      readonly words: string;
      readonly unit: string;
      readonly count: readonly [number, number];
    }
  | { readonly kind: "tie"; readonly tie: Tie; readonly words: string }
  | { readonly kind: "error"; readonly message: string };

export interface ParseContext {
  readonly part: WhenPart;
  readonly units?: readonly Unit[];
  /** The spans a tie may name, by name. */
  readonly spans?: readonly { readonly id: string; readonly name: string }[];
  /** The span being edited: it cannot be tied to itself. */
  readonly self?: string;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;

/** Lengths everyone knows, beside the author's own units. */
const BUILT_IN: { names: string[]; years: number }[] = [
  { names: ["year", "years", "yr", "yrs", "y"], years: 1 },
  { names: ["decade", "decades"], years: 10 },
  { names: ["century", "centuries"], years: 100 },
  { names: ["millennium", "millennia", "millenniums"], years: 1000 },
];

/** Plain ASCII: the minus sign and dashes people paste, and thousands written with commas. */
function tidy(text: string): string {
  return text
    .trim()
    .replace(/−/g, "-")
    .replace(/\s*[–—]\s*/g, " to ")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/\s+/g, " ");
}

/**
 * How far "about" reaches: one step of the last digit that is not 0. "About 280" is 270 to 290,
 * "about 4000" is 3000 to 5000. A number whose last digit is not 0 reaches 5 either way.
 */
export function aboutReach(n: number): number {
  const whole = Math.abs(Math.round(n));
  if (whole === 0) return 10;
  let step = 1;
  while (whole % (step * 10) === 0) step *= 10;
  return step === 1 ? 5 : step;
}

/** A number or a range of numbers: "300", "270-290", "270 to 290", "about 280", "280 ±10". */
export function readRange(text: string): Range | "backwards" | null {
  const t = tidy(text);
  const one = new RegExp(`^${NUMBER}$`);
  if (one.test(t)) return { lo: Number(t), hi: Number(t) };
  const about = new RegExp(`^(?:about|around|circa|c\\.|ca\\.|~)\\s*(${NUMBER})$`, "i").exec(t);
  if (about) {
    const n = Number(about[1]);
    const by = aboutReach(n);
    return { lo: n - by, hi: n + by };
  }
  const plusMinus = new RegExp(`^(${NUMBER})\\s*(?:±|\\+/-|\\+-)\\s*(\\d+(?:\\.\\d+)?)$`).exec(t);
  if (plusMinus) {
    const n = Number(plusMinus[1]);
    const by = Number(plusMinus[2]);
    return { lo: n - by, hi: n + by };
  }
  const range = new RegExp(`^(${NUMBER})\\s*(?:-|to|\\.\\.)\\s*(${NUMBER})$`, "i").exec(t);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    return hi < lo ? "backwards" : { lo, hi };
  }
  return null;
}

const BACKWARDS = "The second number is below the first.";

function nameKey(name: string): string {
  return name
    .trim()
    .replace(/^["'“‘]|["'”’]$/g, "")
    .trim()
    .toLowerCase();
}

/** The span a tie names: by its name, without regard to case or quotes. */
function findSpan(
  name: string,
  ctx: ParseContext,
): { id: string; name: string } | { error: string } {
  const key = nameKey(name);
  const found = (ctx.spans ?? []).find((s) => nameKey(s.name) === key && key !== "");
  if (!found) return { error: `No event here is called “${name.trim()}”.` };
  if (found.id === ctx.self) return { error: "An event cannot be tied to itself." };
  return found;
}

/** The plural people would write: "generations"; a name ending in s is left alone. */
export function plural(name: string, count: number): string {
  return count === 1 || /s$/i.test(name) ? name : `${name}s`;
}

function unitNamed(word: string, units: readonly Unit[]): Unit | null {
  const w = word.toLowerCase();
  return (
    units.find((u) => {
      const n = u.name.trim().toLowerCase();
      return n !== "" && (n === w || `${n}s` === w || `${n}es` === w);
    }) ?? null
  );
}

/** Reads a tie: "with X", "10 after X", "20-40 before the end of X", "the start of X". */
function readTie(t: string, ctx: ParseContext): Parsed | null {
  const words = t;
  const own: "start" | "end" = ctx.part === "end" ? "end" : "start";
  const make = (name: string, edge: "start" | "end", low: number, high: number): Parsed => {
    const found = findSpan(name, ctx);
    if ("error" in found) return { kind: "error", message: found.error };
    return { kind: "tie", tie: { span: found.id, edge, plus: { low, high } }, words };
  };

  const withX = /^(?:with|at|same as)\s+(.+)$/i.exec(t);
  if (withX) {
    const edged = /^the\s+(start|end|beginning)\s+of\s+(.+)$/i.exec(withX[1]!);
    if (edged) return make(edged[2]!, edged[1]!.toLowerCase() === "end" ? "end" : "start", 0, 0);
    return make(withX[1]!, own, 0, 0);
  }
  const edgeOnly = /^(?:at\s+)?(?:the\s+)?(start|end|beginning)\s+of\s+(.+)$/i.exec(t);
  if (edgeOnly) {
    return make(edgeOnly[2]!, edgeOnly[1]!.toLowerCase() === "end" ? "end" : "start", 0, 0);
  }
  const rel = /^(?:(.+?)\s+)?(after|before)\s+(.+)$/i.exec(t);
  if (!rel) return null;
  const amount = (rel[1] ?? "").replace(/\s+(?:years?|yrs?)$/i, "");
  const way = rel[2]!.toLowerCase();
  let target = rel[3]!;
  let edge: "start" | "end" = way === "after" ? "end" : "start";
  const edged = /^the\s+(start|end|beginning)\s+of\s+(.+)$/i.exec(target);
  if (edged) {
    edge = edged[1]!.toLowerCase() === "end" ? "end" : "start";
    target = edged[2]!;
  }
  let by: Range = { lo: 0, hi: 0 };
  if (amount !== "") {
    const read = readRange(amount);
    if (read === "backwards") return { kind: "error", message: BACKWARDS };
    if (read === null) return null;
    if (read.lo < 0)
      return { kind: "error", message: "Give the years after or before as 0 or more." };
    by = read;
  }
  return way === "after" ? make(target, edge, by.lo, by.hi) : make(target, edge, -by.hi, -by.lo);
}

function readLength(t: string, ctx: ParseContext): Parsed {
  const m = /^(.*?)(?:\s*([a-z][a-z\s-]*?))?$/i.exec(t);
  const amount = (m?.[1] ?? t).trim();
  const word = (m?.[2] ?? "").trim();
  const range = readRange(amount);
  if (range === "backwards") return { kind: "error", message: BACKWARDS };
  if (range === null || (word === "" && amount === "")) return lengthHelp();
  if (range.lo < 0) return { kind: "error", message: "A length cannot be below 0." };
  if (word === "") return { kind: "years", low: range.lo, high: range.hi, words: t };
  const unit = unitNamed(word, ctx.units ?? []);
  if (unit) {
    return {
      kind: "count",
      low: range.lo * unit.low,
      high: range.hi * unit.high,
      words: t,
      unit: unit.id,
      count: [range.lo, range.hi],
    };
  }
  const known = BUILT_IN.find((b) => b.names.includes(word.toLowerCase()));
  if (known) {
    return { kind: "years", low: range.lo * known.years, high: range.hi * known.years, words: t };
  }
  return { kind: "error", message: `There is no unit called “${word}”. Add it under Units.` };
}

const lengthHelp = (): Parsed => ({
  kind: "error",
  message: "Type a length such as 400, 350-450 years or 3-5 generations.",
});

/** Reads what was typed into a Starts, Ends or Lasts box. */
export function parseWhen(text: string, ctx: ParseContext): Parsed {
  const t = tidy(text);
  if (t === "") return { kind: "empty" };
  if (ctx.part === "length") {
    if (/^open$/i.test(t)) return { kind: "error", message: "A length cannot be open." };
    return readLength(t, ctx);
  }
  if (/^(?:open|still going|still going on|older|unknown start)$/i.test(t)) return { kind: "open" };

  const plain = /^(?:year\s+)?(.*?)(?:\s+(?:years?|yrs?))?(?:\s+(before|after))?$/i.exec(t);
  if (plain) {
    const range = readRange(plain[1]!);
    if (range === "backwards") return { kind: "error", message: BACKWARDS };
    if (range !== null) {
      const before = plain[2]?.toLowerCase() === "before";
      return before
        ? { kind: "years", low: -range.hi, high: -range.lo, words: t }
        : { kind: "years", low: range.lo, high: range.hi, words: t };
    }
  }
  const tie = readTie(t, ctx);
  if (tie) return tie;
  return {
    kind: "error",
    message: "Type a year such as 300, a range such as 270-290, “open”, or “10 after The war”.",
  };
}

/** A number as written in a box: no long tails, thousands apart. */
export function shortNumber(n: number): string {
  return Number(n.toFixed(2)).toLocaleString("en-GB");
}

/** "300", "270–290", or "-50 to -30" (with a word, so a minus is not read as a dash). */
export function formatYears(lo: number, hi: number): string {
  if (lo === hi) return shortNumber(lo);
  return lo < 0 || hi < 0
    ? `${shortNumber(lo)} to ${shortNumber(hi)}`
    : `${shortNumber(lo)}–${shortNumber(hi)}`;
}

/** A range for reading: open ends in words. */
export function formatRange(range: Range): string {
  if (range.lo === -Infinity) return "open";
  if (range.hi === Infinity) return "open";
  return formatYears(range.lo, range.hi);
}

/** A stored start or end as it is typed: "300", "270–290", "open", or "" when none. */
export function formatEnd(end: { low: number; high: number } | "open" | null): string {
  if (end === null) return "";
  if (end === "open") return "open";
  return formatYears(end.low, end.high);
}

/** A stored length as it is typed: "60–175 years", or "3–5 generations" when typed in a unit. */
export function formatLength(length: RoughLength | null, units: readonly Unit[] = []): string {
  if (!length) return "";
  const unit = length.unit && length.count ? units.find((u) => u.id === length.unit) : undefined;
  if (unit && length.count) {
    const [a, b] = length.count;
    return `${formatYears(a, b)} ${plural(unit.name, b)}`;
  }
  return `${formatYears(length.low, length.high)} ${length.low === 1 && length.high === 1 ? "year" : "years"}`;
}

/**
 * A tie as it is typed, so it reads back to the same tie: "with First Landing", "10 after The
 * war", "20–40 before The kingdom", "5 after the start of X".
 */
export function formatTie(tie: Tie, part: "start" | "end", name: string): string {
  const { low, high } = tie.plus;
  if (low === 0 && high === 0) {
    return tie.edge === part ? `with ${name}` : `with the ${tie.edge} of ${name}`;
  }
  if (low >= 0) {
    const by = formatYears(low, high);
    return tie.edge === "end" ? `${by} after ${name}` : `${by} after the start of ${name}`;
  }
  if (high <= 0) {
    const by = formatYears(-high, -low);
    return tie.edge === "start" ? `${by} before ${name}` : `${by} before the end of ${name}`;
  }
  // A range from before to after cannot be written with one word; say it as a plain sum.
  return `${tie.edge === "end" ? "the end" : "the start"} of ${name} ${formatYears(low, high)}`;
}
