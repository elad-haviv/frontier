import { type MapFeature, type MapFile, orderFeature, reorderFeature } from "@frontier/schema";
import {
  addShape,
  reasonFor,
  removeShape,
  type Resolved,
  shapeOf,
  tie,
  writeShape,
} from "../../map/time.ts";
import type { Tool } from "../../map/tools.ts";
import type { useMapFile } from "../../map/useMapFile.ts";
import type { TimeState } from "../../map/useMapTime.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { FeatureTime, OrbitEditor } from "../MapTime.tsx";
import { FeatureCard } from "./FeatureCard.tsx";
import { FeatureEditor } from "./FeatureEditor.tsx";

/**
 * The selected feature in the side bar: its card while reading (the Selected tab), its form while
 * editing with the select tool (the Edit feature tab).
 */
export function FeaturePanel({
  feature,
  map,
  editing,
  tool,
  file,
  time,
  onScreen,
  vertex,
  titleOf,
  onVertex,
  onSelect,
}: {
  feature: MapFeature;
  map: MapFile;
  editing: boolean;
  tool: Tool;
  file: ReturnType<typeof useMapFile>;
  time: TimeState;
  /** The selected feature as drawn now. */
  onScreen: Resolved | null;
  vertex: number | null;
  titleOf: (feature: MapFeature) => string;
  onVertex: (vertex: number | null) => void;
  onSelect: (feature: string | null) => void;
}) {
  const { names, setFeature, change } = file;
  const { seen, year, spanName, carry, pin, setPin } = time;
  if (!editing) {
    return (
      <FeatureCard
        feature={feature}
        title={titleOf(feature)}
        names={names}
        children={file.children}
        reason={seen ? reasonFor(feature, seen, year ?? 0, spanName) : null}
        {...(carry ? { carry } : {})}
        onClose={() => onSelect(null)}
      />
    );
  }
  if (tool !== "select") return null;
  return (
    <FeatureEditor
      key={feature.id}
      feature={feature}
      map={map}
      names={names}
      pendingEntry={file.pendingNames[feature.id] ?? null}
      sets={file.sets}
      otherMaps={file.otherMaps}
      vertex={vertex}
      onChange={(next) => setFeature(next)}
      onLink={(path, title) => file.link(feature, path, title)}
      onDelete={() => {
        change({ ...map, features: map.features.filter((f) => f.id !== feature.id) });
        onSelect(null);
      }}
      onRemoveVertex={() => {
        const drawn = onScreen?.feature;
        if (!drawn || drawn.kind === "marker" || vertex === null) return;
        setFeature(
          writeShape(feature, onScreen.shape, {
            points: drawn.points.filter((_, i) => i !== vertex),
          }),
        );
        onVertex(null);
      }}
      {...(onScreen && onScreen.feature.kind !== "marker"
        ? { corners: onScreen.feature.points.length }
        : {})}
      extra={
        map.space.kind === "flat" && feature.kind === "marker" ? (
          <OrbitEditor
            feature={feature}
            markers={map.features
              .filter((f) => f.kind === "marker")
              .map((f) => ({ id: f.id, title: titleOf(f) }))}
            onChange={(orbit) => {
              const next = { ...feature } as MapFeature & { orbit?: unknown };
              delete next.orbit;
              setFeature(orderFeature((orbit ? { ...next, orbit } : next) as MapFeature));
            }}
          />
        ) : null
      }
      time={
        seen && onScreen ? (
          <FeatureTime
            feature={feature}
            time={seen}
            onScreen={onScreen.shape}
            pinned={pin?.feature === feature.id ? pin.shape : undefined}
            nameOf={spanName}
            onTie={(span) => setFeature(tie(feature, span))}
            onPin={(shape) => setPin({ feature: feature.id, shape })}
            onAddShape={(from) => {
              // The new shape starts as the one on screen, and is the one edited next.
              const shape = newItemId();
              setFeature(addShape(feature, shape, from, shapeOf(onScreen.feature)));
              setPin({ feature: feature.id, shape });
            }}
            onRemoveShape={(shape) => {
              setPin(null);
              setFeature(removeShape(feature, shape));
            }}
          />
        ) : (
          <p className="muted feature-time">
            {time.chronicles.length > 0
              ? "Turn time on to see when this exists."
              : "Make a chronicle to say when this exists."}
          </p>
        )
      }
      canMove={{
        forward: reorderFeature(map.features, feature.id, 1) !== map.features,
        back: reorderFeature(map.features, feature.id, -1) !== map.features,
      }}
      onMove={(by) => change({ ...map, features: reorderFeature(map.features, feature.id, by) })}
      onClose={() => onSelect(null)}
    />
  );
}
