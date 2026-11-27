/**
 * What a call cost. The provider's own figure comes first (OpenRouter gives one); without it the
 * cost is worked out from the model's prices and the tokens used, and marked as an estimate;
 * without prices it is unknown, and counts as nothing in the total.
 */
import type { CostKind, ModelPrice } from "@frontier/schema";
import type { Usage } from "./providers/index.js";

export function costOf(
  usage: Usage,
  price: ModelPrice | null,
): { costUsd: number; costKind: CostKind } {
  if (usage.costUsd !== null) return { costUsd: usage.costUsd, costKind: "reported" };
  if (price && (usage.promptTokens > 0 || usage.completionTokens > 0)) {
    const costUsd =
      (usage.promptTokens * price.promptPrice + usage.completionTokens * price.completionPrice) /
      1e6;
    return { costUsd: Math.round(costUsd * 1e8) / 1e8, costKind: "estimated" };
  }
  return { costUsd: 0, costKind: "unknown" };
}
