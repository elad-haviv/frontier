import type { RouteApp } from "../projects/facade.js";
import { WorldLoreRequest } from "../ai/worldLore.js";
import type { Services } from "../app.js";
import { whileAsked } from "./writing.js";

export function worldLoreRoutes(app: RouteApp, s: Services): void {
  /**
   * The World Wizard's life and lore (stage 34): names and first entries for a world's places,
   * species and life, from what the wizard knows of the world. Nothing is saved.
   */
  app.post("/api/world/lore", async (request, reply) => {
    const input = WorldLoreRequest.parse(request.body);
    return { lore: await s.worldLore.suggest(input, { signal: whileAsked(reply) }) };
  });
}
