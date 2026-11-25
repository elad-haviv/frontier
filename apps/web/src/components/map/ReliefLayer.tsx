/**
 * The map's relief: its height map drawn over the map as soft light, shade and contour lines. A
 * view anyone can turn on (key H), editing or viewing. The height picture is read in Find areas'
 * worker; loaded only when relief is first shown.
 */
import { makeView, type ViewState } from "@frontier/geo";
import type { MapFile } from "@frontier/schema";
import { useEffect, useRef, useState } from "react";
import { mapImageUrl } from "../../api.ts";
import { shadeOf } from "../../map/findPaths/client.ts";
import { terrainExtent } from "../../map/findPaths/page.ts";
import "./TerrainDialog.css";

export default function ReliefLayer({
  map,
  view,
  size,
}: {
  map: MapFile;
  view: ViewState | null;
  size: { width: number; height: number };
}) {
  const terrain = map.terrain ?? null;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shade, setShade] = useState<{ key: string; picture: HTMLCanvasElement } | null>(null);
  const key = JSON.stringify(terrain);
  useEffect(() => {
    if (!terrain) return;
    let stale = false;
    shadeOf({
      url: mapImageUrl(terrain.image, 2560),
      invert: terrain.invert === true,
      smoothing: terrain.smoothing ?? 0,
      seaLevel: terrain.seaLevel ?? null,
    }).then(
      (r) => {
        if (stale) return;
        const picture = document.createElement("canvas");
        picture.width = r.w;
        picture.height = r.h;
        picture
          .getContext("2d")!
          .putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h), 0, 0);
        setShade({ key, picture });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
    // The key is the terrain.
  }, [key]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !view) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.round(size.width * ratio);
    c.height = Math.round(size.height * ratio);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (!terrain || shade?.key !== key) return;
    const v = makeView(view, size.width, size.height);
    const extent = terrainExtent(map, terrain);
    const a = v.project([extent[0], extent[1]]);
    const b = v.project([extent[2], extent[3]]);
    if (a && b) ctx.drawImage(shade.picture, a[0], a[1], b[0] - a[0], b[1] - a[1]);
  });

  return (
    <canvas
      ref={canvas}
      className="map-canvas map-relief"
      aria-hidden="true"
      data-drawn={shade?.key === key || undefined}
    />
  );
}
