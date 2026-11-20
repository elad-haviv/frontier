import { findLinks } from "./links.js";
import { isNote } from "./paths.js";
import { createResolver } from "./resolve.js";

/** The recorded result of resolving every link in a vault at one commit. */
export interface LinkBaseline {
  /** The vault commit the baseline was made from. */
  vaultCommit: string;
  resolved: { note: string; link: string; target: string }[];
  unresolved: { note: string; link: string }[];
  ambiguous: { note: string; link: string; candidates: string[] }[];
  outside: { note: string; link: string }[];
}

/** Resolves every link in every note and returns the result in a stable order. */
export function buildLinkBaseline(
  vaultCommit: string,
  allPaths: Iterable<string>,
  readNote: (path: string) => string,
): LinkBaseline {
  const paths = [...allPaths];
  const resolver = createResolver(paths);
  const out: LinkBaseline = {
    vaultCommit,
    resolved: [],
    unresolved: [],
    ambiguous: [],
    outside: [],
  };
  for (const note of paths.filter(isNote).sort()) {
    for (const link of findLinks(readNote(note))) {
      const r = resolver.resolve(link, note);
      if (r.kind === "note" || r.kind === "file") {
        out.resolved.push({ note, link: link.raw, target: r.path });
      } else if (r.kind === "unresolved") {
        out.unresolved.push({ note, link: link.raw });
      } else if (r.kind === "ambiguous") {
        out.ambiguous.push({ note, link: link.raw, candidates: r.candidates });
      } else {
        out.outside.push({ note, link: link.raw });
      }
    }
  }
  return out;
}

function lines(b: LinkBaseline): string[] {
  return [
    ...b.resolved.map((r) => `resolved    ${r.note} :: ${r.link} -> ${r.target}`),
    ...b.unresolved.map((r) => `unresolved  ${r.note} :: ${r.link}`),
    ...b.ambiguous.map((r) => `ambiguous   ${r.note} :: ${r.link} -> ${r.candidates.join(" | ")}`),
    ...b.outside.map((r) => `outside     ${r.note} :: ${r.link}`),
  ];
}

/** The entries that differ between two baselines, as readable lines. */
export function diffBaselines(
  before: LinkBaseline,
  after: LinkBaseline,
): { removed: string[]; added: string[] } {
  const count = (list: string[]) => {
    const m = new Map<string, number>();
    for (const l of list) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(lines(before));
  const b = count(lines(after));
  const removed: string[] = [];
  const added: string[] = [];
  for (const [line, n] of a) for (let i = b.get(line) ?? 0; i < n; i++) removed.push(line);
  for (const [line, n] of b) for (let i = a.get(line) ?? 0; i < n; i++) added.push(line);
  return { removed, added };
}
