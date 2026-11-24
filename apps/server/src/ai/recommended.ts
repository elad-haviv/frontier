/**
 * Frontier's pick for each task, reviewed 2026-11: an ordered list of provider-qualified ids. The
 * first that a connected provider lists gets the "Recommended" badge. There is no ranking to
 * explain; review the list when providers change their models.
 */
import type { AiTaskName } from "@frontier/schema";

export const REVIEWED = "2026-11";

export const RECOMMENDED: Record<AiTaskName, string[]> = {
  // Reading an entry and proposing fields: a fast, cheap model that keeps to a form.
  extraction: [
    "openrouter:google/gemini-2.5-flash",
    "google:gemini-2.5-flash",
    "anthropic:claude-haiku-5-5",
    "openrouter:anthropic/claude-haiku-5.5",
    "openai:gpt-5-mini",
    "openrouter:openai/gpt-5-mini",
    "xai:grok-3-mini",
  ],
  // Lore conversations: careful reading of many entries and plain, faithful prose.
  conversation: [
    "anthropic:claude-sonnet-5-5",
    "openrouter:anthropic/claude-sonnet-5.5",
    "google:gemini-2.5-pro",
    "openrouter:google/gemini-2.5-pro",
    "openai:gpt-5",
    "openrouter:openai/gpt-5",
    "xai:grok-4",
  ],
  art: [
    "openrouter:google/gemini-2.5-flash-image",
    "google:gemini-2.5-flash-image",
    "openai:gpt-image-1",
    "xai:grok-2-image",
  ],
};

/** The recommended id for each task among the ids available, if any. */
export function recommendedAmong(ids: Set<string>): Record<AiTaskName, string | null> {
  const pick = (task: AiTaskName) => RECOMMENDED[task].find((id) => ids.has(id)) ?? null;
  return { extraction: pick("extraction"), conversation: pick("conversation"), art: pick("art") };
}
