/** The page's side of Find paths: it asks Find areas' worker, which holds the looked-at picture. */
import { ask } from "../findAreas/client.ts";
import type {
  LikelyReply,
  OpenedPaths,
  OpenPaths,
  ReliefReply,
  RiverReply,
  RiverRequest,
  RouteReply,
  RouteRequest,
  TerrainInfo,
  TerrainLook,
  TerrainRequest,
  TraceReply,
  TraceRequest,
} from "./protocol.ts";
import type { SuggestReply, SuggestRequest } from "./suggest.ts";

export const openPaths = (req: OpenPaths) => ask<OpenedPaths>({ type: "paths.open", ...req });
export const setTerrain = (req: TerrainRequest) =>
  ask<TerrainInfo>({ type: "paths.terrain", ...req });
export const riverAt = (req: RiverRequest) => ask<RiverReply>({ type: "paths.river", ...req });
export const likelyRivers = (above: number) => ask<LikelyReply>({ type: "paths.likely", above });
export const routeFor = (req: RouteRequest) => ask<RouteReply>({ type: "paths.route", ...req });
export const traceAt = (req: TraceRequest) => ask<TraceReply>({ type: "paths.trace", ...req });
export const reliefOf = () => ask<ReliefReply>({ type: "paths.relief" });
export const closePaths = () => ask<null>({ type: "paths.close" });
export const suggestOf = (req: SuggestRequest) =>
  ask<SuggestReply>({ type: "paths.suggest", ...req });
export const lookAtTerrain = (url: string | null, heights: string | null) =>
  ask<TerrainLook>({ type: "paths.look", url, heights });
export const shadeOf = (req: {
  url: string;
  invert: boolean;
  smoothing: number;
  seaLevel: number | null;
}) => ask<ReliefReply>({ type: "paths.shade", ...req });
