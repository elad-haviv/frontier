import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  artLibrary,
  type MakePictureRequest,
  makeId,
  PictureTry,
  type PicturesResponse,
  type PictureShape,
  splitModelId,
} from "@frontier/schema";
import { isExcluded, stem } from "@frontier/vault";
import sharp from "sharp";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { currentPersonId } from "../projects/view.js";
import { cleanImageName, saveImage } from "../images/save.js";
import type { StateFiles } from "../state/files.js";
import type { SettingsStore } from "../state/settings.js";
import type { Connections } from "./connections.js";
import { type AiLog, monthOf } from "./log.js";

/** How long a picture that was made but not inserted is kept. */
export const KEEP_TRIES_MS = 7 * 24 * 60 * 60 * 1000;

const ASPECT: Record<PictureShape, "1:1" | "3:2" | "2:3"> = {
  square: "1:1",
  wide: "3:2",
  tall: "2:3",
};

const EXTENSIONS: Record<string, PictureTry["ext"]> = { png: "png", jpeg: "jpg", webp: "webp" };

/**
 * A try as it is kept: with the person it was made for. Tries are each person's own, like their
 * unsaved changes: nobody sees, fetches or inserts another person's. (A try from before people
 * has no person and is nobody's; it is dropped after its seven days.)
 */
const StoredTry = PictureTry.extend({ person: z.string().default("") });
type StoredTry = z.infer<typeof StoredTry>;
const TriesFile = z.object({ tries: z.array(StoredTry) });

/** The person whose request is being served; outside a request, nobody in particular. */
const who = (): string => currentPersonId() ?? "";
const shown = (t: StoredTry): PictureTry => PictureTry.parse(t);

export interface EntryPicturesDeps {
  /** The folder the tries and their list are kept in. */
  dir: string;
  files: StateFiles;
  settings: SettingsStore;
  log: AiLog;
  provider: {
    connections: Connections;
    image(
      prompt: string,
      entry?: string,
      aspect?: "1:1" | "3:2" | "2:3",
    ): Promise<{ bytes: Buffer; costUsd: number }>;
  };
  /** Where an inserted picture goes: as an upload does. */
  saving: Parameters<typeof saveImage>[0];
  now?: () => Date;
}

/**
 * Pictures made for entries (stage 29). Each press makes one, with the picture model chosen for
 * concept art and the art style from the settings. A picture is kept on the server as a try until
 * it is inserted, which keeps it as an unpublished image like an upload, or until seven days pass.
 */
export class EntryPictures {
  private readonly now: () => Date;
  /** Calls are made one after another per list, so two quick presses do not lose a try. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: EntryPicturesDeps) {
    this.now = d.now ?? (() => new Date());
  }

  private get listFile(): string {
    return join(this.d.dir, "tries.json");
  }

  private file(t: Pick<PictureTry, "id" | "ext">): string {
    return join(this.d.dir, `${t.id}.${t.ext}`);
  }

  /** The tries still kept, the ones over seven days old dropped with their pictures. */
  private async all(): Promise<StoredTry[]> {
    const read = (await this.d.files.readJson(this.listFile, TriesFile).catch(() => null))?.tries;
    const list = read ?? [];
    const since = this.now().getTime() - KEEP_TRIES_MS;
    const old = list.filter((t) => Date.parse(t.at) < since);
    if (old.length === 0) return list;
    for (const t of old) await this.d.files.remove(this.file(t)).catch(() => undefined);
    const kept = list.filter((t) => !old.includes(t));
    await this.d.files.writeJson(this.listFile, { tries: kept });
    return kept;
  }

  private change<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writing.then(fn, fn);
    this.writing = next.catch(() => undefined);
    return next;
  }

  /**
   * Why a picture cannot be made now, or null when it can: no picture model is chosen, or this
   * device has no key for its provider (each person sends their own, see `keyring.ts`).
   */
  private async off(): Promise<PicturesResponse["off"]> {
    const chosen = (await this.d.settings.current()).ai.models.art ?? null;
    if (!chosen) {
      return {
        message:
          "Pictures need a picture model. Choose one in Settings › AI models, under Concept art.",
        href: "/settings/you/ai-models/art",
      };
    }
    const kind = splitModelId(chosen).provider;
    if (!this.d.provider.connections.get(kind)) {
      return {
        message:
          "There is no key on this device for the picture model's provider. Add one under AI keys.",
        href: "/settings/device/ai-keys",
      };
    }
    return null;
  }

  /** What a picture has cost lately: the middle of the last five that worked with this model. */
  private async perPicture(): Promise<number | null> {
    const chosen = (await this.d.settings.current()).ai.models.art;
    if (!chosen) return null;
    const now = this.now();
    const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const person = currentPersonId();
    const mine = <T extends { person?: string | undefined }>(c: T) =>
      person === null || c.person === person;
    const calls = [
      ...(await this.d.log.calls(monthOf(before))),
      ...(await this.d.log.calls(monthOf(now))),
    ]
      .filter(mine)
      .filter((c) => c.task === "art" && c.ok && c.model === chosen && c.costKind !== "unknown")
      .slice(-5)
      .map((c) => c.costUsd)
      .sort((a, b) => a - b);
    if (calls.length === 0) return null;
    return calls[Math.floor(calls.length / 2)]!;
  }

  async status(entry: string): Promise<PicturesResponse> {
    const library = artLibrary((await this.d.settings.current()).ai);
    return {
      off: await this.off(),
      style: library.styles.find((x) => x.id === library.usual)?.text ?? "",
      styles: library.styles,
      usualStyle: library.usual,
      perPictureUsd: await this.perPicture(),
      tries: (await this.all())
        .filter((t) => t.entry === entry && t.person === who())
        .map(shown)
        .reverse(),
    };
  }

  /** Makes one picture and keeps it as a try. */
  async make(input: MakePictureRequest): Promise<PictureTry> {
    if (!input.entry.endsWith(".md") || isExcluded(input.entry)) {
      throw new ApiError("invalid", "Pictures are made for entries.");
    }
    const style = input.style.trim();
    const prompt = input.prompt.trim();
    const { bytes } = await this.d.provider.image(
      style ? `${style}\n\nThe subject: ${prompt}` : prompt,
      input.entry,
      ASPECT[input.shape],
    );
    let format: string | undefined;
    try {
      format = (await sharp(bytes).metadata()).format;
    } catch {
      format = undefined;
    }
    const ext = format ? EXTENSIONS[format] : undefined;
    if (!ext)
      throw new ApiError("ai_failed", "The picture model sent something that is not a picture.");
    const made: StoredTry = {
      person: who(),
      id: makeId(randomBytes),
      entry: input.entry,
      prompt,
      style,
      ...(input.styleName ? { styleName: input.styleName } : {}),
      shape: input.shape,
      ext,
      at: this.now().toISOString(),
    };
    await this.d.files.write(this.file(made), bytes);
    return this.change(async () => {
      await this.d.files.writeJson(this.listFile, { tries: [...(await this.all()), made] });
      return shown(made);
    });
  }

  private async find(id: string): Promise<StoredTry> {
    const found = (await this.all()).find((t) => t.id === id && t.person === who());
    if (!found) throw new ApiError("not_found", "That picture is no longer kept.");
    return found;
  }

  async bytes(id: string): Promise<Buffer> {
    const t = await this.find(id);
    return readFile(this.file(t)).catch(() => {
      throw new ApiError("not_found", "That picture is no longer kept.");
    });
  }

  /**
   * Keeps a try as an unpublished image in the upload folder, named as asked or after its entry,
   * and made unique; the try is then no longer kept.
   */
  async insert(id: string, name: string): Promise<{ path: string; embed: string }> {
    const t = await this.find(id);
    const bytes = await this.bytes(id);
    const base = cleanImageName(name)
      .replace(/\.(png|jpe?g|webp)$/i, "")
      .slice(0, 80)
      .trim();
    const wanted = `${base || cleanImageName(stem(t.entry.split("/").pop() ?? "")) || "Picture"}.${t.ext}`;
    const saved = await saveImage(this.d.saving, wanted, bytes);
    await this.change(async () => {
      await this.d.files.writeJson(this.listFile, {
        tries: (await this.all()).filter((x) => x.id !== id),
      });
      await this.d.files.remove(this.file(t)).catch(() => undefined);
    });
    return saved;
  }
}
