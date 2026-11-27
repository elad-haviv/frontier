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
} from "@frontier/schema";
import { asBiomeZones } from "../map/biomes.ts";
import { newItemId } from "../map/viewUrl.ts";
import type { ProjectWork } from "../projectWork.ts";
import { METRES, type World } from "./model.ts";
import { HEIGHT_LOW, HEIGHT_SEA, paintWorld } from "./picture.ts";
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
  return { map, add };
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
  styles: readonly MapStyle[];
  addStyles: (styles: MapStyle[]) => void;
}

/** Makes the world's map in the project and answers its id. */
export async function makeWorld(
  work: ProjectWork,
  world: World,
  title: string,
  steps: MakeSteps,
): Promise<string> {
  const name = fileName(title);
  steps.say("Painting the map…");
  // Let the page show the words before the painting holds the thread.
  await new Promise((r) => setTimeout(r, 30));
  const painted = paintWorld(world, PICTURE.w, PICTURE.h);
  const zones = worldZones(world);
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
  const { map, add } = worldMap(made.map, world, zones, heights.path, steps.styles);
  if (add.length) steps.addStyles(add);
  await work.queue.put(`map:${id}`, map, {
    draftId: "",
    revision: made.revision,
    baseBlob: made.blob,
    base: made.map,
    delay: 0,
  });
  await work.queue.sendNow(`map:${id}`);
  return id;
}
