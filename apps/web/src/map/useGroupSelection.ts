/**
 * Groups on the map page (stage 19): picking several, what a click picks (the group, or once
 * inside it a member), going inside and back out, grouping and ungrouping, and what the overlay
 * draws for them. Kept here so the page only wires it in.
 */
import type { MapFile, MapGroup, MapStyle } from "@frontier/schema";
import { type RefObject, useMemo, useState } from "react";
import type { PointerKind } from "./gesture.ts";
import {
  deleteItems,
  featureIds,
  groupById,
  groupNamesOf,
  groupOf,
  groupReason,
  groupTitle,
  lockedMembers,
  makeGroup,
  membersOf,
  pickOf,
  ungroup as ungroupMap,
} from "./groups.ts";
import type { OverlayInput } from "./overlay.ts";
import type { Names } from "./useMapFile.ts";
import { newItemId } from "./viewUrl.ts";

export function useGroupSelection(o: {
  map: MapFile | null;
  mapRef: RefObject<MapFile | null>;
  change: (next: MapFile) => void;
  editing: boolean;
  selected: string | null;
  setSelected: (id: string | null) => void;
  /** What is hidden now, with what is inside hidden layers. */
  hiddenNow: ReadonlySet<string>;
  /** Layers locked, by themselves or by a layer they are inside. */
  lockedLayers: ReadonlySet<string>;
  names: Names;
  styles: readonly MapStyle[];
  say: (words: string) => void;
  toast: (t: { message: string; action?: { label: string; run: () => void } }) => void;
  undo: () => void;
  /** How strongly a group is drawn at the year shown. */
  opacityOf?: (group: MapGroup) => number;
}) {
  const { map, editing, selected, setSelected } = o;
  /** The items picked together (features and groups), two or more, or any while picking mode is on. */
  const [picks, setPicks] = useState<string[]>([]);
  /** "Select several" is on (the phone's button): each tap picks. */
  const [picking, setPicking] = useState(false);
  /** The group just made: its tab opens with the name ready to type. */
  const [justMade, setJustMade] = useState<string | null>(null);

  const entryTitle = (id: string) => o.names[id]?.title;
  const exists = (id: string) =>
    !!map && (map.features.some((f) => f.id === id) || !!groupById(map, id));
  const several = picks.filter(exists);
  const selectedGroup = map ? groupById(map, selected) : null;
  const insideGroup = map && !selectedGroup ? groupOf(map, selected) : null;
  const titleOfGroup = (g: MapGroup) => groupTitle(g, entryTitle);

  const draw = useMemo((): Pick<
    OverlayInput,
    "picked" | "groupBox" | "groupNames" | "unpickable"
  > => {
    if (!map) return {};
    const picked = new Set<string>();
    if (selectedGroup) for (const f of membersOf(map, selectedGroup.id)) picked.add(f.id);
    for (const id of several) for (const f of featureIds(map, id)) picked.add(f);
    const boxed = selectedGroup ?? insideGroup;
    const unpickable = lockedMembers(map);
    for (const g of map.groups ?? []) if (g.locked) unpickable.add(g.id);
    return {
      picked,
      groupBox: boxed
        ? {
            members: new Set(membersOf(map, boxed.id).map((f) => f.id)),
            tag: selectedGroup ? `Group · ${titleOfGroup(boxed)}` : `Inside ${titleOfGroup(boxed)}`,
            faint: !selectedGroup,
          }
        : null,
      groupNames: groupNamesOf(map, {
        entryTitle,
        styles: o.styles,
        hidden: o.hiddenNow,
        selected: editing ? selected : null,
        ...(o.opacityOf ? { opacity: o.opacityOf } : {}),
      }),
      unpickable,
    };
  }, [map, selected, several.join(), o.hiddenNow, o.names, o.styles, editing, o.opacityOf]);

  /** The selected group as the pointer may drag it: not while viewing, nor when locked. */
  const dragGroup =
    map &&
    editing &&
    selectedGroup &&
    !selectedGroup.locked &&
    !o.lockedLayers.has(selectedGroup.layer)
      ? {
          id: selectedGroup.id,
          members: new Set(membersOf(map, selectedGroup.id).map((f) => f.id)),
        }
      : null;

  const clearPicks = () => {
    setPicks([]);
    setPicking(false);
  };

  /** What a tap on the map selects: see `pickOf`; with Shift, Ctrl or ⌘, or picking, it adds. */
  function pickTap(
    hit: string | null,
    how: { add: boolean; kind: PointerKind; piece?: string | null },
  ) {
    const now = o.mapRef.current;
    if (!now) return;
    if (how.add || picking) {
      if (hit === null) return;
      const item = pickOf(now, hit, null) ?? hit;
      const base = several.length > 0 ? several : selected ? [selected] : [];
      const next = base.includes(item) ? base.filter((x) => x !== item) : [...base, item];
      if (!picking && next.length <= 1) {
        setPicks([]);
        setSelected(next[0] ?? null);
      } else {
        setPicks(next);
        setSelected(null);
      }
      return;
    }
    setPicks([]);
    // On a phone a second tap on a member of the selected group goes inside: there is no
    // double-click. While viewing a click always picks the group.
    const second =
      editing &&
      how.kind !== "mouse" &&
      !!groupById(now, selected) &&
      groupOf(now, how.piece)?.id === selected;
    if (second && how.piece) return setSelected(how.piece);
    setSelected(editing ? pickOf(now, hit, selected, second) : pickOf(now, hit, null));
  }

  /** A double-click on a member goes straight inside its group. */
  function goInside(hit: string | null) {
    const now = o.mapRef.current;
    if (!now || !hit || !groupOf(now, hit)) return false;
    setPicks([]);
    setSelected(hit);
    return true;
  }

  /** Groups what is picked (Ctrl/⌘+G); says why not when it cannot. */
  function group(items: string[] = several.length > 0 ? several : selected ? [selected] : []) {
    const now = o.mapRef.current;
    if (!now) return false;
    const reason = groupReason(now, items);
    if (reason) {
      o.say(reason);
      return;
    }
    const made = makeGroup(now, items, newItemId());
    if (!made) return;
    o.change(made.map);
    clearPicks();
    setSelected(made.group);
    if (!groupById(now, made.group)) setJustMade(made.group);
    const into = made.map.layers.find((l) => l.id === groupById(made.map, made.group)?.layer);
    const count = membersOf(made.map, made.group).length;
    o.toast({
      message:
        made.moved.length > 0
          ? `Grouped ${count}; moved ${made.moved.length} into ${into?.name ?? "its layer"}.`
          : `Grouped ${count}.`,
      action: { label: "Undo", run: o.undo },
    });
  }

  /** Ungroups the selected group (Shift+Ctrl/⌘+G): its members stay picked. */
  function ungroup(id: string | null = selectedGroup?.id ?? insideGroup?.id ?? null) {
    const now = o.mapRef.current;
    if (!now || !id || !groupById(now, id)) return false;
    const members = membersOf(now, id).map((f) => f.id);
    o.change(ungroupMap(now, id));
    setSelected(null);
    setPicks(members);
    o.toast({ message: `Ungrouped ${members.length}.`, action: { label: "Undo", run: o.undo } });
  }

  /** Enter: inside the selected group, to its first member. */
  function enter() {
    const now = o.mapRef.current;
    if (!now || !selectedGroup) return false;
    const first = membersOf(now, selectedGroup.id)[0];
    if (!first) return false;
    setSelected(first.id);
  }

  /** Deletes what is picked, a group with its members: one step, with Undo in the toast. */
  function deletePicked(items: string[] = several) {
    const now = o.mapRef.current;
    if (!now || items.length === 0) return;
    const count = new Set(items.flatMap((id) => featureIds(now, id))).size;
    o.change(deleteItems(now, items));
    clearPicks();
    setSelected(null);
    o.toast({
      message: `Deleted ${count === 1 ? "1 feature" : `${count} features`}.`,
      action: { label: "Undo", run: o.undo },
    });
  }

  /** The features a hovered feature lights: its whole group, unless the selection is inside it. */
  function haloIds(feature: string): ReadonlySet<string> {
    const now = o.mapRef.current;
    const g = now ? groupOf(now, feature) : null;
    if (!now || !g || groupOf(now, selected)?.id === g.id) return new Set([feature]);
    return new Set(membersOf(now, g.id).map((f) => f.id));
  }

  /** What grouping the picked would do, in words for the side bar: the group they would join. */
  const pickedGroups = map ? several.map((id) => groupById(map, id)).filter((g) => g !== null) : [];
  const addTo = pickedGroups.length === 1 ? titleOfGroup(pickedGroups[0]!) : null;
  const reason = map ? groupReason(map, several) : null;
  let moveNote: string | null = null;
  if (map && several.length > 1) {
    const firstLayer =
      pickedGroups[0]?.layer ??
      map.features.find((f) => f.id === featureIds(map, several[0]!)[0])?.layer;
    const away = several.filter((id) => {
      const layer = groupById(map, id)?.layer ?? map.features.find((f) => f.id === id)?.layer;
      return layer !== firstLayer;
    });
    const layerName = map.layers.find((l) => l.id === firstLayer)?.name ?? "";
    if (away.length > 0) {
      const name = (id: string) => {
        const g = groupById(map, id);
        if (g) return titleOfGroup(g);
        const f = map.features.find((x) => x.id === id);
        return f?.label ?? (f?.entry ? entryTitle(f.entry) : undefined) ?? "one";
      };
      moveNote = `A group keeps to one layer. Grouping moves ${away.map(name).join(", ")} into ${layerName}.`;
    }
  }

  return {
    several,
    setPicks,
    picking,
    setPicking,
    clearPicks,
    justMade,
    clearJustMade: () => setJustMade(null),
    selectedGroup,
    insideGroup,
    titleOfGroup,
    draw,
    dragGroup,
    pickTap,
    goInside,
    group,
    ungroup,
    enter,
    deletePicked,
    haloIds,
    addTo,
    reason,
    moveNote,
  };
}
