/**
 * Feature groups on the map page: which group a feature is in, what a click picks, and the
 * changes that grouping, ungrouping, taking out and deleting make. Pure functions of the map; the
 * page applies what they return through its history, so each is one step to undo.
 *
 * A group lives in one layer (stage 19, decision 1). Its members are the features of that layer
 * that name it. A group of one is just a feature, so taking out, deleting or moving a member
 * that leaves one behind dissolves the group.
 */
import {
  GROUP_LOOK,
  type MapFeature,
  type MapFile,
  type MapGroup,
  type MapStyle,
  orderFeature,
  orderGroup,
  repairGroups,
  withGroups,
} from "@frontier/schema";
import { darker } from "./groupLabel.ts";
import { INK, paintOf } from "./mapStyles.ts";
import type { GroupName } from "./overlay.ts";

/** The group with this id, or null. */
export function groupById(map: MapFile, id: string | null | undefined): MapGroup | null {
  if (!id) return null;
  return map.groups?.find((g) => g.id === id) ?? null;
}

/** The group a feature is in, or null. */
export function groupOf(map: MapFile, feature: string | null | undefined): MapGroup | null {
  const f = feature ? map.features.find((x) => x.id === feature) : undefined;
  return groupById(map, f?.group);
}

/** A group's members, in the order of the map. */
export function membersOf(map: MapFile, group: string): MapFeature[] {
  return map.features.filter((f) => f.group === group);
}

/** The ids of the features an id stands for: a group's members, or the feature itself. */
export function featureIds(map: MapFile, id: string): string[] {
  return groupById(map, id) ? membersOf(map, id).map((f) => f.id) : [id];
}

/**
 * What a click on a feature picks, given what is selected: the feature's group, unless the
 * selection is already inside that group (one of its members), when the click stays inside and
 * picks the member. `inside` goes inside at once: a double-click, or a second tap on a phone.
 */
export function pickOf(
  map: MapFile,
  hit: string | null,
  selected: string | null,
  inside = false,
): string | null {
  if (hit === null) return null;
  const group = groupOf(map, hit);
  if (!group) return hit;
  if (inside) return hit;
  const selectedGroup = groupOf(map, selected);
  return selectedGroup?.id === group.id ? hit : group.id;
}

/** The plain words a group goes by: its name, else its entry's title, else "Group". */
export function groupTitle(group: MapGroup, entryTitle: (id: string) => string | undefined) {
  return group.label?.trim() || (group.entry ? entryTitle(group.entry) : undefined) || "Group";
}

/**
 * Why the picked items cannot be grouped, or null when they can: two or more features, counting
 * a group's members, are needed.
 */
export function groupReason(map: MapFile, picked: readonly string[]): string | null {
  const ids = new Set(picked.flatMap((id) => featureIds(map, id)));
  const groups = new Set(picked.filter((id) => groupById(map, id)));
  if (ids.size < 2 || (groups.size === 1 && picked.length < 2)) {
    return "Pick two or more to group (Shift-click)";
  }
  return null;
}

/**
 * Groups the picked features and groups. With a group among them the rest join it ("Add to
 * Aldmere"); with two or more, they become one, the first one picked. The group keeps to one
 * layer: that of the group among them, else of the first one picked, and the others move there.
 * Null when they cannot be grouped.
 */
export function makeGroup(
  map: MapFile,
  picked: readonly string[],
  newId: string,
): { map: MapFile; group: string; moved: string[] } | null {
  if (groupReason(map, picked)) return null;
  const groups = picked.map((id) => groupById(map, id)).filter((g): g is MapGroup => g !== null);
  const into = groups[0] ?? null;
  const first = map.features.find((f) => f.id === featureIds(map, picked[0]!)[0]);
  const layer = into?.layer ?? first?.layer;
  if (!layer) return null;
  const id = into?.id ?? newId;
  const joining = new Set(picked.flatMap((p) => featureIds(map, p)));
  const moved: string[] = [];
  const features = map.features.map((f) => {
    if (!joining.has(f.id)) return f;
    if (f.layer !== layer) moved.push(f.id);
    return f.group === id && f.layer === layer ? f : orderFeature({ ...f, layer, group: id });
  });
  const merged = new Set(groups.slice(1).map((g) => g.id));
  const kept = (map.groups ?? []).filter((g) => !merged.has(g.id));
  const made: MapGroup = { id, layer, label: null, entry: null };
  const list = into ? kept : [...kept, made];
  return { map: withGroups({ ...map, features }, list), group: id, moved };
}

/** The map without a group; its members stay where they are, in no group. */
export function ungroup(map: MapFile, group: string): MapFile {
  const features = map.features.map((f) =>
    f.group === group ? orderFeature({ ...f, group: null }) : f,
  );
  return withGroups(
    { ...map, features },
    (map.groups ?? []).filter((g) => g.id !== group),
  );
}

/**
 * The map with groups of one member dissolved and empty ones dropped, after a change that may
 * have taken members away: a group of one is just a feature.
 */
export function tidyGroups(map: MapFile): MapFile {
  const repaired = repairGroups(map);
  const count = new Map<string, number>();
  for (const f of repaired.features) {
    if (f.group != null) count.set(f.group, (count.get(f.group) ?? 0) + 1);
  }
  const lone = (repaired.groups ?? []).filter((g) => (count.get(g.id) ?? 0) < 2);
  return lone.reduce((m, g) => ungroup(m, g.id), repaired);
}

/** The map with features taken out of their groups. */
export function takeOut(map: MapFile, ids: readonly string[]): MapFile {
  const out = new Set(ids);
  return tidyGroups({
    ...map,
    features: map.features.map((f) =>
      out.has(f.id) && f.group != null ? orderFeature({ ...f, group: null }) : f,
    ),
  });
}

/** The map with features added to a group: they move into its layer when they are elsewhere. */
export function addToGroup(map: MapFile, ids: readonly string[], group: string): MapFile {
  const g = groupById(map, group);
  if (!g) return map;
  const adding = new Set(ids);
  return tidyGroups({
    ...map,
    features: map.features.map((f) =>
      adding.has(f.id) ? orderFeature({ ...f, layer: g.layer, group: g.id }) : f,
    ),
  });
}

/** The map without these features and groups, a group with all its members. */
export function deleteItems(map: MapFile, ids: readonly string[]): MapFile {
  const gone = new Set(ids.flatMap((id) => featureIds(map, id)));
  const groups = new Set(ids.filter((id) => groupById(map, id)));
  return tidyGroups(
    withGroups(
      { ...map, features: map.features.filter((f) => !gone.has(f.id)) },
      (map.groups ?? []).filter((g) => !groups.has(g.id)),
    ),
  );
}

/** The map with one group changed; its keys are put in order, the defaults left out. */
export function setGroup(map: MapFile, id: string, change: Partial<MapGroup>): MapFile {
  return {
    ...map,
    groups: (map.groups ?? []).map((g) => (g.id === id ? orderGroup({ ...g, ...change }) : g)),
  };
}

/** A group's look with one part set back to its default, by leaving the key out. */
export function withoutKey(map: MapFile, id: string, key: keyof MapGroup): MapFile {
  return {
    ...map,
    groups: (map.groups ?? []).map((g) => {
      if (g.id !== id) return g;
      const next = { ...g };
      delete next[key];
      return orderGroup(next);
    }),
  };
}

/** The map with a group and all its members moved into another layer. */
export function moveGroupTo(map: MapFile, id: string, layer: string): MapFile {
  if (!map.layers.some((l) => l.id === layer)) return map;
  const moved = setGroup(map, id, { layer });
  return {
    ...moved,
    features: moved.features.map((f) => (f.group === id ? orderFeature({ ...f, layer }) : f)),
  };
}

/**
 * The map with one feature changed as its tab or menu asks: a member moved to another layer
 * leaves its group, and a group left with one member is dissolved.
 */
export function withFeature(map: MapFile, next: MapFeature): MapFile {
  const was = map.features.find((f) => f.id === next.id);
  const left = was && was.layer !== next.layer && next.group != null;
  const feature = left ? orderFeature({ ...next, group: null }) : next;
  const changed = { ...map, features: map.features.map((f) => (f.id === next.id ? feature : f)) };
  return left ? tidyGroups(changed) : changed;
}

/** The ids of the features hidden with their group: those of each hidden group. */
export function hiddenMembers(map: MapFile, hidden: ReadonlySet<string>): string[] {
  const groups = new Set((map.groups ?? []).filter((g) => hidden.has(g.id)).map((g) => g.id));
  if (groups.size === 0) return [];
  return map.features.filter((f) => f.group != null && groups.has(f.group)).map((f) => f.id);
}

/** The words a group's name is written in on the map: none without a name or an entry. */
export function nameWords(group: MapGroup, entryTitle: (id: string) => string | undefined) {
  const words =
    group.label?.trim() || (group.entry ? entryTitle(group.entry)?.trim() : undefined) || "";
  return words.toLocaleUpperCase();
}

/**
 * The colour a group's name is written in: its own, else a darker shade of the colour of its
 * zones' style (or their layer), so a purple realm has a deep purple name.
 */
export function nameColour(map: MapFile, group: MapGroup, styles: readonly MapStyle[]): string {
  if (group.color) return group.color;
  const layer = map.layers.find((l) => l.id === group.layer)?.color;
  const zone = map.features.find((f) => f.group === group.id && f.kind === "zone");
  return darker(zone ? paintOf(zone, layer, styles).colour : (layer ?? INK));
}

/**
 * The group names the overlay writes: each group that is written, with a name or an entry, and
 * its members that are shown.
 */
export function groupNamesOf(
  map: MapFile,
  opts: {
    entryTitle: (id: string) => string | undefined;
    styles: readonly MapStyle[];
    hidden: ReadonlySet<string>;
    /** The group selected while editing: its name is framed and can be dragged. */
    selected: string | null;
    /** How strongly a group is drawn at the year shown: faint when it is perhaps there. */
    opacity?: (group: MapGroup) => number;
  },
): GroupName[] {
  const out: GroupName[] = [];
  for (const g of map.groups ?? []) {
    const words = g.write === false ? "" : nameWords(g, opts.entryTitle);
    if (!words || opts.hidden.has(g.id) || opts.hidden.has(g.layer)) continue;
    const members = new Set(
      map.features.filter((f) => f.group === g.id && !opts.hidden.has(f.id)).map((f) => f.id),
    );
    if (members.size === 0) continue;
    out.push({
      id: g.id,
      words,
      size: g.size ?? GROUP_LOOK.size,
      colour: nameColour(map, g, opts.styles),
      rotate: g.rotate ?? GROUP_LOOK.rotate,
      spacing: g.spacing ?? GROUP_LOOK.spacing,
      at: g.at ?? null,
      members,
      opacity: opts.opacity?.(g) ?? 1,
      ring: opts.selected === g.id,
    });
  }
  return out;
}

/** The ids of the features of locked groups, which cannot be picked on the map. */
export function lockedMembers(map: MapFile): Set<string> {
  const locked = new Set((map.groups ?? []).filter((g) => g.locked).map((g) => g.id));
  return new Set(
    map.features.filter((f) => f.group != null && locked.has(f.group)).map((f) => f.id),
  );
}
