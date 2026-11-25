/** Saves the map as it is shown as a PNG, downloaded by the browser. */
import type { ViewState } from "@frontier/geo";
import type { MapFile } from "@frontier/schema";
import { mapImageUrl } from "../api.ts";
import { mapPicture } from "./picture.ts";

/** Saves the map as it is shown, at a few times the size of the screen, as a PNG. */
export async function savePicture(input: {
  map: MapFile;
  /** The features as drawn now, with the shape on screen. */
  shown: MapFile;
  state: ViewState;
  width: number;
  height: number;
  scale: number;
  shownImages: Set<string>;
  overlay: Parameters<typeof mapPicture>[0]["overlay"];
  /** The biomes' legend card, when it is shown on the map. */
  legend?: Parameters<typeof mapPicture>[0]["legend"];
  /** The year shown, named in the file, when the map is seen in time. */
  year: number | null;
  /** Shows a line of news over the map, or clears it. */
  say: (notice: string | null) => void;
}): Promise<void> {
  const { map, say } = input;
  say("Drawing the picture…");
  try {
    const blob = await mapPicture({
      map: input.shown,
      state: input.state,
      width: input.width,
      height: input.height,
      scale: input.scale,
      images: map.images
        .filter((i) => input.shownImages.has(i.id))
        .map((i) => ({ id: i.id, extent: i.extent, url: mapImageUrl(i.path, 4096) })),
      overlay: input.overlay,
      ...(input.legend ? { legend: input.legend } : {}),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${map.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "map"}${
      input.year !== null ? ` year ${input.year}` : ""
    }.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    say(null);
  } catch {
    say("The picture could not be made on this device.");
  }
}
