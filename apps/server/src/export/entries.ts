/**
 * Exports meant for reading: which entries go, and their text with every link rewritten for the
 * format. Only published text; never appendices, Frontier's own files, or notes in quarantine.
 */
import { isExcluded, isImage, isInAppendix, isNote, splitFrontmatter, stem } from "@frontier/vault";
import { ApiError } from "../errors.js";
import type { VaultIndex } from "../index/build.js";
import type { DraftStore } from "../state/drafts.js";

export interface Chosen {
  path: string;
  title: string;
  /** A name safe for a file and an anchor, unique within the export. */
  slug: string;
}

export interface Choice {
  entries: Chosen[];
  /** Chosen entries that have unsaved changes, which are not exported. */
  unsaved: string[];
  /** Asked for but left out: appendices, Frontier's files, notes in quarantine, missing ones. */
  skipped: string[];
}

/** The entries of a folder (with everything under it) or of a list, in reading order. */
export function choose(
  index: VaultIndex,
  drafts: DraftStore,
  mayRead: (path: string) => boolean,
  pick: { folder?: string | undefined; paths?: string[] | undefined },
): Choice {
  const wanted =
    pick.paths && pick.paths.length > 0
      ? pick.paths
      : index
          .allNotes()
          .map((n) => n.path)
          .filter((p) => {
            const folder = (pick.folder ?? "").replace(/\/+$/, "");
            return folder === "" || p.startsWith(`${folder}/`);
          });
  const skipped: string[] = [];
  const ok: { path: string; title: string }[] = [];
  for (const path of new Set(wanted)) {
    const note = index.note(path);
    if (!note || !isNote(path) || isInAppendix(path) || isExcluded(path) || !mayRead(path)) {
      skipped.push(path);
      continue;
    }
    ok.push({ path, title: note.title });
  }
  ok.sort((a, b) => {
    const fa = a.path.split("/").slice(0, -1).join("/");
    const fb = b.path.split("/").slice(0, -1).join("/");
    return fa.localeCompare(fb) || a.title.localeCompare(b.title);
  });
  const used = new Set<string>();
  const entries = ok.map((e) => {
    const base =
      e.title
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "entry";
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return { ...e, slug };
  });
  if (entries.length === 0) throw new ApiError("invalid", "There is nothing to export there.");
  const unsaved = entries
    .map((e) => e.path)
    .filter((p) => {
      const d = drafts.byPath(p);
      return d !== undefined && !d.binary;
    });
  return { entries, unsaved, skipped };
}

/** An anchor for a heading, as the reader makes them. */
export const anchorOf = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const escapeLabel = (s: string) => s.replace(/([[\]\\*_`])/g, "\\$1");

export interface Rewrite {
  /** A link to an entry in the export. */
  inside: (entry: Chosen, heading: string | null, label: string) => string;
  /** A link to an entry not in the export: its words, marked. */
  outside: (label: string) => string;
  /** An embedded image, by its path in the library. */
  image: (path: string, alt: string, width: number | null) => string;
}

/**
 * An entry's body with every link rewritten: links to entries in the export lead to them; to
 * entries outside, their words marked; to nothing, their words; images embedded.
 */
export function rewrite(
  index: VaultIndex,
  path: string,
  inExport: ReadonlyMap<string, Chosen>,
  how: Rewrite,
): string {
  const note = index.note(path)!;
  const offset = splitFrontmatter(note.text).frontmatter?.length ?? 0;
  let text = note.text;
  const links = [...note.links].sort((a, b) => b.link.start - a.link.start);
  for (const { link, resolution } of links) {
    if (link.start < offset) continue;
    const label =
      (link.kind === "wikilink" ? link.display : link.display) ||
      (link.heading && !link.target ? link.heading : stem(link.target || path)) ||
      link.raw;
    let out: string;
    if (resolution.kind === "file" && isImage(resolution.path)) {
      out = link.embed
        ? how.image(
            resolution.path,
            stem(resolution.path),
            link.kind === "wikilink" ? link.width : null,
          )
        : escapeLabel(label);
    } else if (resolution.kind === "note" || resolution.kind === "ambiguous") {
      // A name several entries share leads to the one in the export, when just one of them is.
      const paths = resolution.kind === "note" ? [resolution.path] : resolution.candidates;
      const inside = paths.filter((p) => inExport.has(p));
      const target = inside.length === 1 ? inExport.get(inside[0]!) : undefined;
      const heading = resolution.kind === "note" ? resolution.heading : link.heading;
      out = target
        ? how.inside(target, heading, escapeLabel(label))
        : how.outside(escapeLabel(label));
    } else if (link.kind === "mdlink" && /^(https?:|mailto:)/i.test(link.target)) {
      continue;
    } else {
      out = escapeLabel(label);
    }
    text = text.slice(0, link.start) + out + text.slice(link.end);
  }
  return text.slice(offset).replace(/^\s+/, "");
}

/** Headings one level down, outside fenced code, so an entry reads as a part of one document. */
export function demote(markdown: string, title: string): string {
  let fenced = false;
  const lines = markdown.split("\n");
  // An entry that opens with its own title as a heading does not repeat it.
  const first = lines.findIndex((l) => l.trim() !== "");
  if (
    first >= 0 &&
    /^#\s+/.test(lines[first]!) &&
    lines[first]!.replace(/^#\s+/, "").trim() === title
  ) {
    lines.splice(first, 1);
  }
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return /^#{1,5}\s/.test(line) ? `#${line}` : line;
    })
    .join("\n");
}
