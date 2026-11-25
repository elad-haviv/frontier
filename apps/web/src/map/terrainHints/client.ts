/** The Terrain dialog's side of terrain hints: it asks Find areas' worker. */
import { ask } from "../findAreas/client.ts";
import type { HintsBuilt, HintsFound, HintsImage, HintsRequest } from "./protocol.ts";

type Of<T extends HintsRequest["type"]> = Omit<Extract<HintsRequest, { type: T }>, "type">;

export const findTerrainHints = (req: Of<"hints.find">) =>
  ask<HintsFound>({ type: "hints.find", ...req });
export const buildFromHints = (req: Of<"hints.build">) =>
  ask<HintsBuilt>({ type: "hints.build", ...req });
export const imageFromHints = (req: Of<"hints.image">) =>
  ask<HintsImage>({ type: "hints.image", ...req });
