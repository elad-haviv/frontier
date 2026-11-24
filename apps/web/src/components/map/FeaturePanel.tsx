import {
  isLined,
  type MapFeature,
  type MapFile,
  type MapStyle,
  orderFeature,
  reorderFeature,
} from "@frontier/schema";
import { withStyle } from "../../map/mapStyles.ts";
import { addShape, reasonFor, removeShape, type Resolved, shapeOf, tie } from "../../map/time.ts";
import { deleteFeature, removePoint, setCurve, type Tool } from "../../map/tools.ts";
import type { useMapFile } from "../../map/useMapFile.ts";
import type { TimeState } from "../../map/useMapTime.ts";
import { newItemId } from "../../map/viewUrl.ts";
import { FeatureTime, OrbitEditor } from "../MapTime.tsx";
import { FeatureCard } from "./FeatureCard.tsx";
import type { GeneratedFeature } from "../../api.ts";
import { FeatureEditor } from "./FeatureEditor.tsx";
import { FeatureGenerate } from "./FeatureGenerate.tsx";

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
  onCopyLink,
  onEdit,
  styles,
  onEditStyles,
  generate,
  onMakeEntry,
}: {
  /** The library's path and zone styles. */
  styles: MapStyle[];
  /** Opens the Styles tab. */
  onEditStyles: () => void;
  /** Generate with AI, once a model is chosen: where to ask, and what to do with the answer. */
  generate: {
    mapId: string;
    choices: { id: string; name: string }[];
    moment: { chronicle: string | null; year: number | null };
    onUse: (proposal: GeneratedFeature) => void;
  } | null;
  /** Opens New entry for the feature, to make its entry and link it. */
  onMakeEntry: (name: string, body: string) => void;
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
  /** Copies a link to this place, and starts editing with it selected: from the Selected tab. */
  onCopyLink: () => void;
  onEdit: () => void;
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
        onCopyLink={onCopyLink}
        onEdit={onEdit}
        onClose={() => onSelect(null)}
      />
    );
  }
  // The Marker tool stays on after a marker is placed, and its tab opens to link it; so does
  // Find areas after a zone is made.
  const stays = tool === feature.kind || (tool === "find" && feature.kind === "zone");
  if (tool !== "select" && !stays) return null;
  return (
    <FeatureEditor
      key={feature.id}
      feature={feature}
      map={map}
      names={names}
      pendingEntry={file.pendingNames[feature.id] ?? null}
      pendingPath={file.pendingPathOf(feature.id)}
      {...(onScreen ? { drawn: onScreen.feature } : {})}
      onCurve={(curved) => setFeature(setCurve(feature, curved))}
      styles={styles}
      onStyle={(style) => setFeature(withStyle(feature, style))}
      onEditStyles={onEditStyles}
      sets={file.sets}
      otherMaps={file.otherMaps}
      vertex={vertex}
      onChange={(next) => setFeature(next)}
      onLink={(path, title) => file.link(feature, path, title)}
      onCreateEntry={(typed) => onMakeEntry(typed, "")}
      generate={
        generate && (
          <FeatureGenerate
            mapId={generate.mapId}
            feature={feature}
            choices={generate.choices}
            moment={generate.moment}
            onUse={generate.onUse}
            onMakeEntry={
              feature.entry || file.pendingNames[feature.id]
                ? null
                : (name, body) => onMakeEntry(name, body)
            }
          />
        )
      }
      onDelete={() => {
        change(deleteFeature(map, feature.id));
        onSelect(null);
      }}
      onRemoveVertex={() => {
        if (!onScreen || vertex === null) return;
        const done = removePoint(map, onScreen, vertex);
        if (!done || !("feature" in done)) return;
        setFeature(done.feature);
        onVertex(null);
      }}
      {...(onScreen && isLined(onScreen.feature)
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
