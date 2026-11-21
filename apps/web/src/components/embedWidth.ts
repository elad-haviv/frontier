/**
 * Reading and rewriting the width of an image embed, "![[name.png|300]]". The width is Obsidian's:
 * a number of pixels after the bar. Only the part after the bar changes; the name stays as written.
 */
import { isImage } from "@frontier/vault";

export interface ImageEmbed {
  /** What the embed points at, as written: the part before the bar. */
  target: string;
  /** The width set in the embed, or null when it has none. */
  width: number | null;
  /** False when the part after the bar is not a width, such as a caption, which is kept. */
  sizable: boolean;
}

const EMBED = /^!\[\[([^[\]\n]+?)\]\]$/;
const SIZE = /^\d+(x\d+)?$/;

/** Reads an embed of an image, or answers null for anything else. */
export function readImageEmbed(raw: string): ImageEmbed | null {
  const m = EMBED.exec(raw);
  if (!m) return null;
  const inner = m[1]!;
  const pipe = /\\?\|/.exec(inner);
  const left = pipe ? inner.slice(0, pipe.index) : inner;
  const target = left.split("#")[0]!;
  if (!isImage(target.trim())) return null;
  const after = pipe ? inner.slice(pipe.index + pipe[0].length).trim() : null;
  if (after === null) return { target, width: null, sizable: true };
  if (SIZE.test(after)) return { target, width: parseInt(after, 10), sizable: true };
  return { target, width: null, sizable: false };
}

/**
 * The embed with its width set to `width`, or removed when `width` is null. A bar already written
 * as "\|" stays so; a new bar is written "\|" when `inTable`, so it does not split the table cell.
 */
export function withWidth(raw: string, width: number | null, inTable = false): string {
  const inner = raw.slice(3, -2);
  const pipe = /\\?\|/.exec(inner);
  const left = pipe ? inner.slice(0, pipe.index) : inner;
  if (width === null) return `![[${left}]]`;
  const bar = pipe ? pipe[0] : inTable ? "\\|" : "|";
  return `![[${left}${bar}${width}]]`;
}

/** A dragged width as written: whole pixels, at least 50, and no wider than `max`. */
export function clampWidth(width: number, max: number): number {
  return Math.max(50, Math.min(Math.round(width), Math.floor(max)));
}
