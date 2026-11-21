import type { SpanPoints } from "./points.js";

/** What a chronicle says about something at one year. */
export type Presence = "not_yet" | "perhaps" | "there" | "gone" | "undated";

/**
 * Whether a span has begun and not ended at a year. An unknown start counts as already begun and
 * an unknown end as still going on; an open start or end is never reached. An event has one
 * point: what it stands for is there from that moment on.
 */
export function presenceAt(points: SpanPoints, isEvent: boolean, year: number): Presence {
  const { start, end } = points;
  if (isEvent) {
    if (!start) return "undated";
    if (year < start.lo) return "not_yet";
    return year < start.hi ? "perhaps" : "there";
  }
  if (!start && !end) return "undated";
  // An end that lies wholly before the start says nothing usable about when it exists.
  if (start && end && end.hi < start.lo) return "undated";
  if (start && year < start.lo) return "not_yet";
  // What is surely over is gone, even inside the range its start may fall in.
  if (end && year > end.hi) return "gone";
  if (start && year < start.hi) return "perhaps";
  if (end && year > end.lo) return "perhaps";
  return "there";
}
