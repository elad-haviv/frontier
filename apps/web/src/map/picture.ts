/**
 * A picture of a map as it is shown: the same view, projection, images, layers and features, at a
 * larger size, drawn in the browser on canvases of its own and saved as a PNG.
 */
import { makeView, type ViewState } from "@frontier/geo";
import { type MapFile, planarSpace } from "@frontier/schema";
import { drawLegendCard, type LegendRow } from "./biomeLegend.ts";
import { drawOverlay, type OverlayInput } from "./overlay.ts";
import { MapRenderer } from "./renderer.ts";

/** The view scaled up: the same place in the middle, everything `f` times larger. */
export function scaleView(state: ViewState, f: number): ViewState {
  if (state.kind === "projected")
    return { ...state, k: state.k * f, x: state.x * f, y: state.y * f };
  return { ...state, k: state.k * f };
}

/** The largest side a picture may have, in device pixels: what phones' canvases still draw. */
const LARGEST = 8192;

export async function mapPicture(input: {
  map: MapFile;
  state: ViewState;
  width: number;
  height: number;
  scale: number;
  images: { id: string; extent: MapFile["images"][number]["extent"]; url: string }[];
  overlay: Omit<
    OverlayInput,
    "map" | "view" | "selected" | "selectedVertex" | "sketch" | "editing"
  >;
  /** The biomes' legend card, drawn at the bottom left when there are rows. */
  legend?: readonly LegendRow[];
}): Promise<Blob> {
  const ratio = window.devicePixelRatio || 1;
  const f = Math.min(input.scale, LARGEST / (Math.max(input.width, input.height) * ratio));
  const w = Math.round(input.width * f);
  const h = Math.round(input.height * f);
  const state = scaleView(input.state, f);

  const glCanvas = document.createElement("canvas");
  const top = document.createElement("canvas");
  glCanvas.style.width = `${w}px`;
  glCanvas.style.height = `${h}px`;
  // The images are fetched again for this canvas; the picture is drawn once they have arrived.
  let arrived = 0;
  let ready: () => void = () => undefined;
  const all = new Promise<void>((resolve) => (ready = resolve));
  const renderer = new MapRenderer(glCanvas, () => {
    arrived += 1;
    if (arrived >= input.images.length) ready();
  });
  for (const image of input.images) renderer.load(image.id, image.url);
  if (input.images.length === 0) ready();
  await Promise.race([all, new Promise((r) => setTimeout(r, 30_000))]);

  top.width = Math.round(w * ratio);
  top.height = Math.round(h * ratio);
  const out = document.createElement("canvas");
  out.width = top.width;
  out.height = top.height;
  const ctx = out.getContext("2d")!;
  renderer.draw(planarSpace(input.map.space), state, input.images, w, h, false);
  // Copied at once, before the browser may clear a canvas it has not been asked to keep.
  ctx.drawImage(glCanvas, 0, 0, out.width, out.height);
  drawOverlay(top.getContext("2d")!, {
    ...input.overlay,
    map: input.map,
    view: makeView(state, w, h),
    selected: null,
    selectedVertex: null,
    sketch: null,
    editing: false,
  });
  if (input.legend?.length) drawLegendCard(top.getContext("2d")!, input.legend, h, ratio);
  ctx.drawImage(top, 0, 0);
  return new Promise((resolve, reject) =>
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("The picture could not be made."))),
      "image/png",
    ),
  );
}
