import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ART_STYLES_MAX,
  type ArtStyle,
  type ArtStyleChange,
  type ArtStylesResponse,
  artLibrary,
  makeId,
  type NewArtStyleRequest,
  type PersonSettings,
  STARTER_ART_STYLES,
  withArtLibrary,
} from "@frontier/schema";
import sharp from "sharp";
import { ApiError } from "../errors.js";
import type { StateFiles } from "../state/files.js";
import type { SettingsStore } from "../state/settings.js";

/** What every sample shows, so two styles can be told apart by their look alone. */
export const SAMPLE_SUBJECT =
  "A lighthouse on a cliff above the sea, with a low sun and a few birds in the sky.";

/** A sample nobody's style points at is kept this long: a dialog still open may yet save it. */
const KEEP_LOOSE_MS = 24 * 60 * 60 * 1000;

const TOKEN = /^[a-z0-9]{12}$/;

export interface ArtStylesDeps {
  /** The folder the samples are kept in, one folder per person. */
  dir: string;
  files: StateFiles;
  settings: SettingsStore;
  image(
    prompt: string,
    entry?: string,
    aspect?: "1:1" | "3:2" | "2:3",
  ): Promise<{ bytes: Buffer; costUsd: number }>;
  now?: () => Date;
}

/**
 * Each person's library of art styles (stage 34): named styles, one of them the usual one, each
 * with a sample picture when the person made one. The styles are part of the person's settings;
 * the samples are files beside them.
 */
export class ArtStyles {
  private readonly now: () => Date;

  constructor(private readonly d: ArtStylesDeps) {
    this.now = d.now ?? (() => new Date());
  }

  private file(person: string, token: string): string {
    return join(this.d.dir, person, `${token}.webp`);
  }

  async library(person: string): Promise<ArtStylesResponse> {
    return artLibrary((await this.d.settings.ofPerson(person)).ai);
  }

  /** Changes the library and answers it as it then is. */
  private async change(
    person: string,
    fn: (now: ArtStylesResponse) => ArtStylesResponse,
  ): Promise<ArtStylesResponse> {
    const next = await this.d.settings.updatePerson(person, (now: PersonSettings) => {
      const { styles, usual } = fn(artLibrary(now.ai));
      return { ...now, ai: withArtLibrary(now.ai, styles, usual) };
    });
    const library = artLibrary(next.ai);
    await this.tidy(person, library.styles).catch(() => undefined);
    return library;
  }

  /** A name is one style's: two that read the same could not be told apart on the strip. */
  private free(styles: ArtStyle[], name: string, but?: string): void {
    const taken = styles.some(
      (s) => s.id !== but && s.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (taken) throw new ApiError("invalid", `There is already a style called "${name.trim()}".`);
  }

  /** A sample a style may point at: a starter's drawing, or a picture this person made. */
  private known(person: string, sample: string | null | undefined): string | null {
    if (!sample) return null;
    if (sample.startsWith("starter-")) return sample;
    if (TOKEN.test(sample) && existsSync(this.file(person, sample))) return sample;
    return null;
  }

  add(person: string, input: NewArtStyleRequest): Promise<ArtStylesResponse> {
    return this.change(person, ({ styles, usual }) => {
      if (styles.length >= ART_STYLES_MAX) {
        throw new ApiError(
          "invalid",
          `A library holds ${ART_STYLES_MAX} styles. Delete one to add another.`,
        );
      }
      this.free(styles, input.name);
      const id =
        input.id && !styles.some((s) => s.id === input.id) ? input.id : makeId(randomBytes);
      const made: ArtStyle = {
        id,
        name: input.name,
        text: input.text,
        sample: this.known(person, input.sample),
      };
      const at = Math.min(input.at ?? styles.length, styles.length);
      return {
        styles: [...styles.slice(0, at), made, ...styles.slice(at)],
        usual: input.usual ? id : usual,
      };
    });
  }

  edit(person: string, id: string, input: ArtStyleChange): Promise<ArtStylesResponse> {
    return this.change(person, ({ styles, usual }) => {
      const found = styles.find((s) => s.id === id);
      if (!found) throw new ApiError("not_found", "There is no such style.");
      if (input.name !== undefined) this.free(styles, input.name, id);
      const next: ArtStyle = {
        ...found,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.sample === undefined ? {} : { sample: this.known(person, input.sample) }),
      };
      return { styles: styles.map((s) => (s.id === id ? next : s)), usual };
    });
  }

  remove(person: string, id: string): Promise<ArtStylesResponse> {
    return this.change(person, ({ styles, usual }) => {
      if (!styles.some((s) => s.id === id)) return { styles, usual };
      if (styles.length === 1) {
        throw new ApiError("invalid", "The last style stays: pictures need one to start from.");
      }
      const kept = styles.filter((s) => s.id !== id);
      return { styles: kept, usual: usual === id ? kept[0]!.id : usual };
    });
  }

  makeUsual(person: string, id: string): Promise<ArtStylesResponse> {
    return this.change(person, ({ styles }) => {
      if (!styles.some((s) => s.id === id))
        throw new ApiError("not_found", "There is no such style.");
      return { styles, usual: id };
    });
  }

  /** What the usual style says, changed: what the one text box of earlier builds did. */
  sayUsual(person: string, text: string): Promise<ArtStylesResponse> {
    return this.change(person, ({ styles, usual }) => ({
      styles: styles.map((s) => (s.id === usual ? { ...s, text } : s)),
      usual,
    }));
  }

  /** Puts back the starter styles the library no longer has, as far as there is room. */
  async starters(person: string): Promise<ArtStylesResponse & { added: number }> {
    let added = 0;
    const library = await this.change(person, ({ styles, usual }) => {
      const next = [...styles];
      for (const s of STARTER_ART_STYLES) {
        if (next.length >= ART_STYLES_MAX) break;
        if (next.some((x) => x.name.toLowerCase() === s.name.toLowerCase())) continue;
        next.push({ ...s, id: next.some((x) => x.id === s.id) ? makeId(randomBytes) : s.id });
        added++;
      }
      return { styles: next, usual };
    });
    return { ...library, added };
  }

  /**
   * Draws the sample scene in a style's words, with the asking person's key, and keeps it small.
   * The token it answers is put on a style when the style is saved.
   */
  async sample(person: string, text: string): Promise<{ sample: string; costUsd: number }> {
    const { bytes, costUsd } = await this.d.image(
      `${text.trim()}\n\nThe subject: ${SAMPLE_SUBJECT}`,
      "style sample",
      "3:2",
    );
    let small: Buffer;
    try {
      small = await sharp(bytes)
        .resize({ width: 640, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new ApiError("ai_failed", "The picture model sent something that is not a picture.");
    }
    const token = makeId(randomBytes);
    await this.d.files.write(this.file(person, token), small, true);
    return { sample: token, costUsd };
  }

  async sampleBytes(person: string, token: string): Promise<Buffer> {
    return readFile(this.file(person, token)).catch(() => {
      throw new ApiError("not_found", "That sample is no longer kept.");
    });
  }

  /** Drops the samples no style points at, once they are a day old. */
  private async tidy(person: string, styles: ArtStyle[]): Promise<void> {
    const dir = join(this.d.dir, person);
    if (!existsSync(dir)) return;
    const used = new Set(styles.map((s) => s.sample));
    const before = this.now().getTime() - KEEP_LOOSE_MS;
    for (const name of await readdir(dir)) {
      const token = name.replace(/\.webp$/, "");
      if (used.has(token)) continue;
      const path = join(dir, name);
      if ((await stat(path)).mtimeMs < before) await this.d.files.remove(path);
    }
  }
}
