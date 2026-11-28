/**
 * The World Wizard's last step (stage 34): the world made into things the project keeps. Two
 * pictures are uploaded (the painted map and its height picture), a globe map is made over the
 * first, and it is given its size, its terrain and the biome zones. All of it goes through the
 * routes and the save queue everything else uses, so it arrives as unsaved changes.
 */
import {
  type Biome,
  biomeById,
  type MapFeature,
  type MapFile,
  type MapStyle,
  orderFeature,
  orderLayer,
  STARTER_STYLES,
} from "@frontier/schema";
import { newDraftId } from "../api.ts";
import { asBiomeZones } from "../map/biomes.ts";
import { addBody, bodyFeatures } from "../map/systemMap.ts";
import { newItemId } from "../map/viewUrl.ts";
import type { ProjectWork } from "../projectWork.ts";
import { METRES, type World } from "./model.ts";
import { HEIGHT_LOW, HEIGHT_SEA, paintWorld } from "./picture.ts";
import { type River, riverLines, riversOf } from "./rivers.ts";
import {
  calendarEntry,
  homeOf,
  MOON_DISTANCES,
  STARS,
  type SystemSettings,
  TWIN,
} from "./system.ts";
import { worldZones, type WorldZone } from "./zones.ts";

/** The size the map's picture and its height picture are painted at. */
export const PICTURE = { w: 2048, h: 1024 };
const EARTH_KM = 6371;

/** The map with the world's size, terrain and biome zones; and the styles the library lacks. */
export function worldMap(
  made: MapFile,
  world: World,
  zones: readonly WorldZone[],
  heights: string,
  styles: readonly MapStyle[],
  rivers: readonly River[] = [],
): { map: MapFile; add: MapStyle[] } {
  let map: MapFile = {
    ...made,
    space:
      made.space.kind === "sphere"
        ? { ...made.space, radius: Math.round(EARTH_KM * world.s.size), unit: "km" }
        : made.space,
    terrain: {
      image: heights,
      seaLevel: Math.round(HEIGHT_SEA * 1000) / 1000,
      range: [Math.round(HEIGHT_LOW * METRES), METRES],
      rangeUnit: "m",
    },
  };
  const add: MapStyle[] = [];
  const byKind = new Map<string, { biome: Biome; ids: string[] }>();
  const features: MapFeature[] = [];
  for (const zone of zones) {
    const biome = biomeById(zone.kind, []);
    if (!biome) continue;
    const id = newItemId();
    features.push(
      orderFeature({
        id,
        kind: "zone",
        layer: map.layers[0]!.id,
        points: zone.points,
        entry: null,
        label: null,
        child: null,
      } as MapFeature),
    );
    const group = byKind.get(zone.kind) ?? { biome, ids: [] };
    group.ids.push(id);
    byKind.set(zone.kind, group);
  }
  map = { ...map, features: [...map.features, ...features] };
  for (const { biome, ids } of byKind.values()) {
    const done = asBiomeZones(map, ids, biome, [...styles, ...add], null);
    if (done.add) add.push(done.add);
    map = done.map;
  }
  return withRivers(map, rivers, [...styles, ...add], add);
}

/** The name of the layer the wizard's rivers go to. */
export const RIVERS_LAYER = "Rivers";

/** The map with the rivers as paths in a Rivers layer, drawn over the biomes, in the River style. */
function withRivers(
  map: MapFile,
  rivers: readonly River[],
  styles: readonly MapStyle[],
  add: MapStyle[],
): { map: MapFile; add: MapStyle[] } {
  const lines = rivers.flatMap(riverLines);
  if (lines.length === 0) return { map, add };
  const river = STARTER_STYLES.find((s) => s.counts === "river" && s.for === "path")!;
  if (!styles.some((s) => s.id === river.id)) add.push(river);
  const layer = orderLayer({
    id: newItemId(),
    name: RIVERS_LAYER,
    visible: true,
    color: river.color ?? "#2f6f9f",
  });
  const paths = lines.map((points) =>
    orderFeature({
      id: newItemId(),
      kind: "path",
      layer: layer.id,
      points,
      curve: "smooth",
      style: river.id,
      entry: null,
      label: null,
      child: null,
    } as MapFeature),
  );
  return {
    map: { ...map, layers: [layer, ...map.layers], features: [...map.features, ...paths] },
    add,
  };
}

/**
 * The system model the server made (a star at its middle) given the wizard's system: the star's
 * mass and name, a second star, the planets in order with the world marked as home and pointing
 * at its globe map, and the world's moons.
 */
export function systemMap(
  made: MapFile,
  sys: SystemSettings,
  worldTitle: string,
  globe: string | null,
): MapFile {
  const layer = made.layers[0]!.id;
  const first = bodyFeatures(made).find((f) => f.body.type === "star");
  if (!first) return made;
  const star = STARS[sys.star];
  const label =
    (id: string, name: string, more: Record<string, unknown> = {}) =>
    (f: MapFeature) =>
      f.id === id ? ({ ...f, label: name, ...more } as MapFeature) : f;
  let map: MapFile = {
    ...made,
    features: made.features.map((f) =>
      f.id === first.id
        ? ({
            ...f,
            label: `${star.name} star`,
            body: { ...first.body, mass: star.mass },
          } as MapFeature)
        : f,
    ),
  };
  if (sys.twin) {
    const twin = addBody(map, layer, "companion", null, TWIN.apart, 0, 0);
    map = {
      ...twin.map,
      features: twin.map.features.map((f) =>
        f.id === twin.id && f.kind === "marker" && f.body
          ? ({
              ...f,
              label: "Companion star",
              body: { ...f.body, mass: TWIN.mass, a: TWIN.apart },
            } as MapFeature)
          : f,
      ),
    };
  }
  const home = homeOf(sys);
  // Each kind is numbered by itself: "Rocky planet 1", "Gas giant 1".
  const counted: Record<string, number> = {};
  sys.planets.forEach((planet, n) => {
    const isHome = planet === home;
    // Spread round the star, so the planets do not start in a line.
    const added = addBody(map, layer, planet.kind, first.id, planet.a, n * 2.1 + 0.6, 0);
    const name = isHome
      ? worldTitle
      : `${planet.kind === "rocky" ? "Rocky planet" : planet.kind === "gas" ? "Gas giant" : "Ice giant"} ${(counted[planet.kind] = (counted[planet.kind] ?? 0) + 1)}`;
    map = {
      ...added.map,
      features: added.map.features.map((f) =>
        f.id === added.id && f.kind === "marker" && f.body
          ? ({
              ...f,
              label: name,
              ...(isHome ? { child: globe, body: { ...f.body, home: true } } : {}),
            } as MapFeature)
          : f,
      ),
    };
    if (isHome) {
      MOON_DISTANCES.slice(0, sys.moons).forEach((distance, m) => {
        const moon = addBody(map, layer, "moon", added.id, distance, m * 2.3 + 1, 0);
        map = {
          ...moon.map,
          features: moon.map.features.map(
            label(moon.id, sys.moons === 1 ? "The moon" : `Moon ${m + 1}`),
          ),
        };
      });
    }
  });
  return map;
}

/** RGBA pixels as a PNG file. */
async function pngOf(pixels: Uint8ClampedArray, w: number, h: number, name: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot paint the picture.");
  const image = ctx.createImageData(w, h);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error("This browser cannot save the picture.");
  return new File([blob], name, { type: "image/png" });
}

/** A file name from a title: letters, digits, spaces and hyphens. */
export const fileName = (title: string): string =>
  title
    .replace(/[^\p{L}\p{N} -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() || "World";

export interface MakeSteps {
  /** Told what is being done, for the page to show. */
  say: (words: string) => void;
  /** The star system: a system model and the calendar entry are made from it. */
  system: SystemSettings;
  styles: readonly MapStyle[];
  addStyles: (styles: MapStyle[]) => void;
}

/** What Make it made. */
export interface Made {
  /** The globe map. */
  map: string;
  /** The system model. */
  system: string;
  /** The path of the calendar entry. */
  calendar: string;
}

/** Sends a map the server just made, changed, through the save queue. */
async function send(
  work: ProjectWork,
  id: string,
  made: { map: MapFile; revision: number; blob?: string | null | undefined },
  map: MapFile,
): Promise<void> {
  await work.queue.put(`map:${id}`, map, {
    draftId: "",
    revision: made.revision,
    baseBlob: made.blob ?? "",
    base: made.map,
    delay: 0,
  });
  await work.queue.sendNow(`map:${id}`);
}

/** Makes the world's maps and its calendar entry in the project and answers what they are. */
export async function makeWorld(
  work: ProjectWork,
  world: World,
  title: string,
  steps: MakeSteps,
): Promise<Made> {
  const name = fileName(title);
  steps.say("Painting the map…");
  // Let the page show the words before the painting holds the thread.
  await new Promise((r) => setTimeout(r, 30));
  const painted = paintWorld(world, PICTURE.w, PICTURE.h);
  const zones = worldZones(world);
  const rivers = riversOf(world);
  steps.say("Sending the pictures…");
  const picture = await work.api.upload(
    await pngOf(painted.picture, painted.w, painted.h, `${name} map.png`),
  );
  const heights = await work.api.upload(
    await pngOf(painted.heights, painted.w, painted.h, `${name} heights.png`),
  );
  steps.say("Making the map…");
  const { id } = await work.api.createMap(title, "sphere", picture.path);
  const made = await work.api.map(id);
  const { map, add } = worldMap(made.map, world, zones, heights.path, steps.styles, rivers);
  if (add.length) steps.addStyles(add);
  await send(work, id, made, map);

  steps.say("Making the star system…");
  const system = await work.api.createMap(`${title} system`, "system");
  const model = await work.api.map(system.id);
  await send(work, system.id, model, systemMap(model.map, steps.system, title, id));

  steps.say("Writing the calendar…");
  const calendar = `The sky and the calendar of ${name}.md`;
  const known = await work.api.names(`The sky and the calendar of ${name}`).catch(() => null);
  // An entry of that name from a world made before is left as it is.
  if (!known?.results.some((r) => r.path === calendar)) {
    const key = `entry:${calendar}` as const;
    await work.queue.put(key, calendarEntry(title, steps.system, world.s), {
      kind: "create",
      draftId: newDraftId(),
      revision: 0,
      baseBlob: "",
    });
    await work.queue.sendNow(key);
  }
  return { map: id, system: system.id, calendar };
}
