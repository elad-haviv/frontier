/**
 * Maps: read from the vault and from the author's drafts, and written as drafts. A map reaches
 * `main` only through Publish, like a note.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type DraftRecord,
  makeId,
  MAP_FOLDER,
  type MapFile,
  mapIdOf,
  mapPath,
  parseMap,
  repairGroups,
  serialiseMap,
} from "@frontier/schema";
import { basename, isImage, isNote, makeEntryId, readFields, stem } from "@frontier/vault";
import sharp from "sharp";
import type { EntryChanger } from "../entries/change.js";
import { ApiError } from "../errors.js";
import type { GitGateway } from "../git/gateway.js";
import type { VaultIndex } from "../index/build.js";
import { type DraftStore, keepOtherSide, keptOf } from "../state/drafts.js";

export type MapState = "published" | "unpublished" | "new";

export interface LoadedMap {
  map: MapFile;
  /** The draft's revision; 0 when the map has no draft. */
  revision: number;
  state: MapState;
}

export interface MapStoreDeps {
  vaultDir: string;
  iconFolder: string;
  git: GitGateway;
  index: VaultIndex;
  drafts: DraftStore;
  changer: EntryChanger;
}

export class MapStore {
  private published = new Map<string, MapFile>();
  /** Map files in the vault that cannot be read, with the reason. */
  problems: { path: string; message: string }[] = [];

  constructor(private readonly d: MapStoreDeps) {}

  /** Reads every map file from the working copy. Called after each fetch. */
  refresh(): void {
    this.published.clear();
    this.problems = [];
    const dir = join(this.d.vaultDir, MAP_FOLDER);
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const path = `${MAP_FOLDER}/${name}`;
      const id = mapIdOf(path);
      if (id === null) continue;
      const parsed = parseMap(readFileSync(join(dir, name), "utf8"));
      if (!parsed.ok) this.problems.push({ path, message: parsed.message });
      else if (parsed.map.id !== id) {
        this.problems.push({ path, message: "The id inside does not match the file's name." });
      } else this.published.set(id, parsed.map);
    }
  }

  /** The text of a map as it is on `main`, or null. */
  publishedText(path: string): string | null {
    const full = join(this.d.vaultDir, path);
    return mapIdOf(path) !== null && existsSync(full) ? readFileSync(full, "utf8") : null;
  }

  private draftOf(id: string): DraftRecord | undefined {
    return this.d.drafts.byPath(mapPath(id));
  }

  /**
   * When the map last changed: its draft's last save, or else the time its file was last written
   * in the vault (when it was last brought up to date from the library). Null when unknown.
   */
  editedAt(id: string): string | null {
    const draft = this.draftOf(id);
    if (draft) return draft.updatedAt;
    try {
      return statSync(join(this.d.vaultDir, mapPath(id))).mtime.toISOString();
    } catch {
      return null;
    }
  }

  /** The map as the author sees it: his draft, or else what is published. */
  async get(id: string): Promise<LoadedMap | null> {
    const draft = this.draftOf(id);
    const published = this.published.get(id);
    if (draft) {
      if (draft.kind === "delete") return null;
      const parsed = parseMap(await this.d.drafts.text(draft.id));
      if (parsed.ok) {
        return {
          map: parsed.map,
          revision: draft.revision,
          state: published ? "unpublished" : "new",
        };
      }
    }
    return published ? { map: published, revision: 0, state: "published" } : null;
  }

  /** As `get`, with the blob of the library file, which a save sends back to say where it started. */
  async open(id: string): Promise<(LoadedMap & { blob: string }) | null> {
    const loaded = await this.get(id);
    if (!loaded) return null;
    return { ...loaded, blob: (await this.d.git.blobHash(mapPath(id))) ?? "" };
  }

  async list(): Promise<LoadedMap[]> {
    const ids = new Set(this.published.keys());
    for (const draft of this.d.drafts.list()) {
      const id = mapIdOf(draft.path);
      if (id) ids.add(id);
    }
    const out: LoadedMap[] = [];
    for (const id of ids) {
      const loaded = await this.get(id);
      if (loaded) out.push(loaded);
    }
    return out.sort((a, b) => a.map.title.localeCompare(b.map.title));
  }

  /** The bytes of an image in the vault or uploaded and not yet published. */
  private async imageBytes(path: string): Promise<Buffer> {
    if (isImage(path)) {
      if (this.d.index.hasFile(path)) return readFileSync(join(this.d.vaultDir, path));
      const draft = this.d.drafts.byPath(path);
      if (draft?.binary) return this.d.drafts.bytes(draft.id);
    }
    throw new ApiError("invalid", `There is no image at "${path}".`);
  }

  async create(input: {
    title: string;
    kind: "sphere" | "flat" | "stars" | "system";
    image?: string | undefined;
  }): Promise<string> {
    let id = makeEntryId(randomBytes);
    while ((await this.get(id)) !== null) id = makeEntryId(randomBytes);
    let map: MapFile;
    if (input.kind === "stars") {
      // Open space needs no image: places are given by three numbers.
      map = {
        version: 1,
        id,
        title: input.title,
        space: { kind: "stars", unit: "ly" },
        images: [],
        markerSets: [],
        layers: [
          {
            id: makeEntryId(randomBytes),
            name: "Stars",
            visible: true,
            color: "#f2d28a",
            look: "dot",
          },
          {
            id: makeEntryId(randomBytes),
            name: "Stations and ports",
            visible: true,
            color: "#fbf7f0",
            look: "pin",
          },
        ],
        features: [],
      };
    } else if (input.kind === "system") {
      // A system model begins with its star at the centre; the rest is added around it.
      map = {
        version: 1,
        id,
        title: input.title,
        space: { kind: "system", unit: "AU" },
        images: [],
        markerSets: [],
        layers: [{ id: makeEntryId(randomBytes), name: "Bodies", visible: true, color: "#f2d28a" }],
        features: [],
      };
      map.features.push({
        id: makeEntryId(randomBytes),
        kind: "marker",
        layer: map.layers[0]!.id,
        at: [0, 0],
        entry: null,
        label: "The star",
        icon: null,
        child: null,
        body: { type: "star", a: 0, mass: 1 },
      });
    } else {
      if (!input.image) throw new ApiError("invalid", "A map of this kind needs an image.");
      let size: { width?: number | undefined; height?: number | undefined };
      try {
        size = await sharp(await this.imageBytes(input.image)).metadata();
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError("invalid", "This image cannot be read.");
      }
      const width = size.width ?? 1000;
      const height = size.height ?? 1000;
      map = {
        version: 1,
        id,
        title: input.title,
        space:
          input.kind === "sphere"
            ? { kind: "sphere", radius: null, unit: "km" }
            : { kind: "flat", width, height, scale: null, unit: "km" },
        images: [
          {
            id: makeEntryId(randomBytes),
            name: stem(basename(input.image)),
            path: input.image,
            extent: input.kind === "sphere" ? [-180, -90, 180, 90] : [0, 0, width, height],
            visible: true,
          },
        ],
        markerSets: this.markerSets().map((s) => s.name),
        layers: [{ id: makeEntryId(randomBytes), name: "Places", visible: true, color: "#9a3b1f" }],
        features: [],
      };
    }
    await this.d.drafts.saveFrom({
      id: makeId(randomBytes),
      path: mapPath(id),
      kind: "create",
      content: serialiseMap(map),
      baseBlob: "",
      lineEnding: "lf",
    });
    return id;
  }

  /**
   * Saves the whole map as a draft. `link` names entries by path for features that should carry
   * their id; an entry without an id gets one, written into a draft of the entry.
   */
  async save(
    id: string,
    input: MapFile,
    revision: number,
    link: { feature: string; path: string }[] = [],
    sent: {
      baseBlob?: string | undefined;
      op?: string | undefined;
      clashes?: string[] | undefined;
    } = {},
  ): Promise<{
    map: MapFile;
    revision: number;
    unlinked: { feature: string; reason: string }[];
    kept?: string;
  }> {
    if (input.id !== id) throw new ApiError("invalid", "The map's id cannot be changed.");
    const path = mapPath(id);
    const draft = this.draftOf(id);
    // A repeat of the last accepted send: what it stored is the answer.
    if (draft && sent.op !== undefined && draft.lastOp === sent.op) {
      const parsed = parseMap(await this.d.drafts.text(draft.id));
      if (parsed.ok) {
        return {
          map: parsed.map,
          revision: draft.revision,
          unlinked: [],
          ...keptOf(this.d.drafts, draft.id, sent.clashes),
        };
      }
    }
    const published = this.published.has(id);
    if (!draft && !published) throw new ApiError("not_found", "There is no such map.");
    if (draft?.kind === "delete") {
      throw new ApiError("not_allowed", "This map is marked for deletion.");
    }
    const stale = () =>
      new ApiError(
        "stale_revision",
        "This map was changed from another device. The two are being merged.",
        draft ? { id: draft.id } : {},
      );
    if (draft && revision !== draft.revision) throw stale();
    // A save for a map without a draft starts one: its draft was saved as a version or discarded.
    // When the device says which file it started from and the library has moved on since, it
    // merges with the library's copy first. Without that, as from an older build, it starts one
    // whatever revision the page last saw.
    if (!draft && revision > 0 && sent.baseBlob !== undefined) {
      if (sent.baseBlob !== ((await this.d.git.blobHash(path)) ?? "")) throw stale();
    }

    const unlinked: { feature: string; reason: string }[] = [];
    const features = [...input.features];
    // A group is linked to its entry as a feature is; the two never share an id.
    const groups = [...(input.groups ?? [])];
    for (const { feature, path: entryPath } of link) {
      const list: { id: string; entry: string | null }[] = features.some((f) => f.id === feature)
        ? features
        : groups;
      const at = list.findIndex((f) => f.id === feature);
      if (at === -1) continue;
      try {
        if (!isNote(entryPath)) throw new ApiError("invalid", "Only an entry can be linked.");
        list[at] = { ...list[at]!, entry: await this.d.changer.ensureId(entryPath) };
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        list[at] = { ...list[at]!, entry: null };
        unlinked.push({ feature, reason: err.message });
      }
    }
    // Memberships that name no group, or one in another layer, are cleared, never refused.
    const map = repairGroups({ ...input, features, ...(groups.length > 0 ? { groups } : {}) });
    const text = serialiseMap(map);
    // The device merged items both sides changed and kept its own: the side it replaces is kept
    // beside the draft, made first from the library's copy when there is none.
    const other = sent.clashes?.length
      ? await keepOtherSide(this.d.drafts, draft, sent.clashes, async () => ({
          path,
          text: this.publishedText(path) ?? "",
          blob: (await this.d.git.blobHash(path)) ?? "",
        }))
      : draft;
    const record = other
      ? await this.d.drafts.serverChange(other.id, text, { op: sent.op })
      : await this.d.drafts.saveFrom({
          id: makeId(randomBytes),
          path,
          kind: "edit",
          content: text,
          baseBlob: (await this.d.git.blobHash(path)) ?? "",
          lineEnding: "lf",
          op: sent.op,
        });
    return {
      map,
      revision: record.revision,
      unlinked,
      ...(sent.clashes?.length ? { kept: record.id } : {}),
    };
  }

  /** Marks a published map for deletion, or throws away a map that was never published. */
  async remove(id: string): Promise<void> {
    const draft = this.draftOf(id);
    if (draft) await this.d.drafts.discard(draft.id);
    if (!this.published.has(id)) {
      if (!draft) throw new ApiError("not_found", "There is no such map.");
      return;
    }
    const path = mapPath(id);
    await this.d.drafts.saveFrom({
      id: makeId(randomBytes),
      path,
      kind: "delete",
      content: "",
      baseBlob: (await this.d.git.blobHash(path)) ?? "",
      lineEnding: "lf",
    });
  }

  /** Settles a map that changed here and in the vault in ways that cannot be merged. */
  async resolve(id: string, keep: "mine" | "theirs"): Promise<void> {
    const draft = this.draftOf(id);
    if (!draft) throw new ApiError("not_found", "This map has no unpublished change.");
    if (keep === "theirs") {
      await this.d.drafts.discard(draft.id);
      return;
    }
    const path = mapPath(id);
    await this.d.drafts.rebase(
      draft.id,
      await this.d.drafts.text(draft.id),
      (await this.d.git.blobHash(path)) ?? "",
      true,
    );
  }

  /** Every folder directly under the icon folder is a marker set. */
  markerSets(): { name: string; icons: { name: string; path: string }[] }[] {
    const prefix = this.d.iconFolder + "/";
    const sets = new Map<string, { name: string; path: string }[]>();
    for (const file of this.d.index.files) {
      if (!file.startsWith(prefix) || !isImage(file)) continue;
      const rest = file.slice(prefix.length).split("/");
      // Images directly in the icon folder form a set named after the folder itself.
      const set = rest.length === 1 ? basename(this.d.iconFolder) : rest[0]!;
      if (rest.length > 2) continue;
      const list = sets.get(set) ?? [];
      list.push({ name: stem(rest[rest.length - 1]!), path: file });
      sets.set(set, list);
    }
    return [...sets]
      .map(([name, icons]) => ({ name, icons: icons.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The path of the entry with this id: among the published entries, and then among the drafts,
   * so an id that was just written is found before it is published.
   */
  async entryPath(id: string): Promise<string | null> {
    const published = this.d.index.byId(id);
    if (published) return published;
    for (const draft of this.d.drafts.list()) {
      if (draft.binary || draft.kind === "delete" || !isNote(draft.path)) continue;
      if (readFields(await this.d.drafts.text(draft.id)).id === id) return draft.path;
    }
    return null;
  }

  /** The id an entry carries, in its draft or else as published. */
  async entryId(path: string): Promise<string | null> {
    const text = await this.d.changer.text(path);
    return text === null ? null : readFields(text).id;
  }

  /** The maps, drafts included, that have a feature for this entry id. */
  async mapsFor(entryId: string): Promise<{ id: string; title: string; feature: string }[]> {
    const out: { id: string; title: string; feature: string }[] = [];
    for (const { map } of await this.list()) {
      const feature = map.features.find((f) => f.entry === entryId);
      if (feature) out.push({ id: map.id, title: map.title, feature: feature.id });
    }
    return out;
  }
}
