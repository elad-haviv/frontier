/**
 * The stage 25 settings: which needs-love rules are on. Kept apart from `keepGoing.ts` because the
 * settings file's schema (`state.ts`) reads them and `keepGoing.ts` reads `state.ts`.
 */
import { z } from "zod";

export const NEEDS_LOVE_RULES = [
  "stub",
  "emptyHeadings",
  "noType",
  "noPicture",
  "openComments",
  "todoMarks",
] as const;
export const NeedsLoveRule = z.enum(NEEDS_LOVE_RULES);
export type NeedsLoveRule = z.infer<typeof NeedsLoveRule>;

/** What each rule is called in Settings. */
export const NEEDS_LOVE_LABELS: Record<NeedsLoveRule, string> = {
  stub: "Stubs that many entries link to",
  emptyHeadings: "Headings with nothing under them",
  noType: "Entries with no type",
  noPicture: "Longer entries with no picture",
  openComments: "Entries with open comments",
  todoMarks: "Entries marked TODO, TBD or ??",
};

/** Which rules are on. Every one is on until the author switches it off. */
export const NeedsLoveRules = z.object({
  stub: z.boolean().default(true),
  emptyHeadings: z.boolean().default(true),
  noType: z.boolean().default(true),
  noPicture: z.boolean().default(true),
  openComments: z.boolean().default(true),
  todoMarks: z.boolean().default(true),
});
export type NeedsLoveRules = z.infer<typeof NeedsLoveRules>;

/** The part of `/data/state/settings.json` that belongs to stage 25. */
export const KeepGoingSettings = z.object({ needsLove: NeedsLoveRules.default({}) });
export type KeepGoingSettings = z.infer<typeof KeepGoingSettings>;

/** `PUT /api/settings/keep-going`: the rules to change; the others stay as they are. */
export const KeepGoingSettingsRequest = z.object({
  needsLove: NeedsLoveRules.partial().optional(),
});
export type KeepGoingSettingsRequest = z.infer<typeof KeepGoingSettingsRequest>;
