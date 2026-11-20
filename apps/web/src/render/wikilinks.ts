/**
 * A remark plugin that turns "[[...]]" and "![[...]]" in a note's text into links and images,
 * using the resolution the server sent with the entry. Text inside code is never touched, because
 * code is not a text node.
 */
import type { EntryLink } from "@frontier/schema";
import type { Image, Link, PhrasingContent, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import { entryUrl, imageUrl } from "../api.ts";

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;

export interface WikilinkOptions {
  links: EntryLink[];
}

/** How a link is drawn. Carried to the rendered element as `data-kind`. */
export type ShownKind = "resolved" | "unresolved" | "ambiguous" | "outside" | "image";

function parts(inner: string): { target: string; heading: string | null; display: string | null } {
  const pipe = /\\?\|/.exec(inner);
  const left = pipe ? inner.slice(0, pipe.index) : inner;
  const display = pipe ? inner.slice(pipe.index + pipe[0].length) : null;
  const hash = left.indexOf("#");
  return {
    target: hash === -1 ? left : left.slice(0, hash),
    heading: hash === -1 ? null : left.slice(hash + 1),
    display,
  };
}

function label(p: ReturnType<typeof parts>): string {
  if (p.display !== null && p.display.trim() !== "") return p.display;
  const name = p.target.trim().split("/").pop() ?? "";
  if (name === "") return p.heading ?? "";
  return p.heading ? `${name} › ${p.heading}` : name.replace(/\.md$/i, "");
}

function linkNode(url: string, kind: ShownKind, text: string, title?: string): Link {
  return {
    type: "link",
    url,
    ...(title ? { title } : {}),
    children: [{ type: "text", value: text }],
    data: { hProperties: { dataKind: kind } },
  };
}

export function wikilinks(options: WikilinkOptions) {
  const byRaw = new Map<string, EntryLink>();
  for (const l of options.links) if (!byRaw.has(l.raw)) byRaw.set(l.raw, l);

  const find = (url: string): EntryLink | undefined =>
    byRaw.get(url) ??
    options.links.find((l) => l.raw.endsWith(`](${url})`) || l.raw.endsWith(`](<${url}>)`));

  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined || !node.value.includes("[[")) return;
      const out: PhrasingContent[] = [];
      let last = 0;
      WIKI.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKI.exec(node.value))) {
        const raw = m[0];
        const embed = m[1] === "!";
        const p = parts(m[2] ?? "");
        const info = byRaw.get(raw);
        if (m.index > last) out.push({ type: "text", value: node.value.slice(last, m.index) });
        last = m.index + raw.length;

        if (info?.kind === "image" && info.target) {
          const width =
            embed && p.display && /^\d+/.test(p.display.trim()) ? parseInt(p.display, 10) : null;
          const image: Image = {
            type: "image",
            url: imageUrl(info.target, 1280),
            alt: p.target.trim(),
            data: { hProperties: { dataKind: "image", ...(width ? { width } : {}) } },
          };
          out.push(image);
        } else if (info?.kind === "resolved" && info.target) {
          out.push(linkNode(entryUrl(info.target, p.heading), "resolved", label(p)));
        } else if (info?.kind === "ambiguous") {
          const n = info.candidates?.length ?? 0;
          out.push(
            linkNode(
              "#",
              "ambiguous",
              label(p),
              `${n} files share this name: ${info.candidates?.join(", ")}`,
            ),
          );
        } else if (info?.kind === "outside") {
          out.push(linkNode("#", "outside", label(p), "A file outside the vault's notes"));
        } else {
          out.push(linkNode("#", "unresolved", label(p), "Not written yet"));
        }
      }
      if (out.length === 0) return;
      if (last < node.value.length) out.push({ type: "text", value: node.value.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });

    // Standard Markdown links and images that point inside the vault.
    visit(tree, (node) => {
      if (node.type !== "link" && node.type !== "image") return;
      const n = node as Link | Image;
      if ((n.data as { hProperties?: unknown } | undefined)?.hProperties) return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(n.url) || n.url.startsWith("#") || n.url.startsWith("//"))
        return;
      const info = find(n.url);
      if (!info) return;
      if (info.kind === "image" && info.target) {
        n.url = imageUrl(info.target, 1280);
        n.data = { hProperties: { dataKind: "image" } };
      } else if (info.kind === "resolved" && info.target) {
        n.url = entryUrl(info.target);
        n.data = { hProperties: { dataKind: "resolved" } };
      } else {
        n.url = "#";
        n.data = { hProperties: { dataKind: info.kind === "image" ? "unresolved" : info.kind } };
      }
    });
  };
}
